-- File attachments in private conversations.
--
-- One attachment system for the four places members talk privately:
--
--   * a group's chat (a channel with subgroup_id — Safe-Space and every other
--     private group);
--   * a private lokallag channel (is_private);
--   * a direct message with an organisational representative (a community on
--     dm_policy = 'staff_only' where one of the two is staff);
--   * a member-to-member direct message (everything else — Under The Rug),
--     which stays text-only until both people have written to each other.
--
-- Community-wide channels, the main lokallag chats, the feed and events are
-- deliberately not part of this: message_attachment_policy_for() answers
-- 'unsupported' for them and nothing can be uploaded there.
--
-- The shape, in one paragraph. A file is first a row here (`uploading`), bound
-- from that moment to one conversation and one uploader. The server — never a
-- browser — writes the object into the private bucket and marks the row
-- `ready`. Sending a message claims the caller's own ready rows for that same
-- conversation and makes them `sent`, in the same transaction that writes the
-- message. Nothing can be re-pointed afterwards: the guard trigger refuses any
-- change to who uploaded it, where it lives, what it is, or which message it
-- belongs to. Reads are decided here too, on every request, from the caller's
-- current access to the conversation — so access that ends, ends for files.
--
-- What clients can do directly:
--   select  rows of conversations they can read right now (and their own
--           unsent uploads there);
--   execute message_attachment_policy(), begin_message_attachment(),
--           discard_message_attachment() and the two send functions.
-- What they cannot: insert, update or delete a row; write, replace or delete
-- an object in the bucket; mark an upload ready. An `uploading` row a client
-- conjures through begin_message_attachment() can never become a file, since
-- only the service role can store the object and complete it.

-- ── Bucket ──────────────────────────────────────────────────────────────
--
-- Private, like every other TING bucket. The size limit is the larger of the
-- two tiers; the per-conversation limit is enforced by the functions below.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'message-attachments',
  'message-attachments',
  false,
  26214400,                                        -- 25 MiB
  array[
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif',
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'text/plain',
    'text/csv',
    'audio/mpeg',
    'audio/wav',
    'audio/mp4'
  ]
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- The one allowlist: a type that has no extension here is not an attachment.
create or replace function public.message_attachment_extension(p_mime_type text)
returns text language sql immutable set search_path = public as $$
  select case p_mime_type
    when 'image/jpeg' then 'jpg'
    when 'image/png' then 'png'
    when 'image/webp' then 'webp'
    when 'image/gif' then 'gif'
    when 'application/pdf' then 'pdf'
    when 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' then 'docx'
    when 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' then 'xlsx'
    when 'application/vnd.openxmlformats-officedocument.presentationml.presentation' then 'pptx'
    when 'text/plain' then 'txt'
    when 'text/csv' then 'csv'
    when 'audio/mpeg' then 'mp3'
    when 'audio/wav' then 'wav'
    when 'audio/mp4' then 'm4a'
  end;
$$;

revoke execute on function public.message_attachment_extension(text) from public, anon;
grant execute on function public.message_attachment_extension(text) to authenticated, service_role;

-- ── Attachment-only direct messages ─────────────────────────────────────
--
-- A direct message has had to carry text. One that carries files may now be
-- empty — and only one: `has_attachments` is not among the columns a client
-- may insert (conversation_id and body, 20260919191000), and
-- direct_messages_insert still requires a body, so the only writer of an empty
-- message is send_direct_message_with_attachments() below.

alter table public.direct_messages
  add column has_attachments boolean not null default false;

alter table public.direct_messages
  drop constraint direct_messages_body_present;

alter table public.direct_messages
  add constraint direct_messages_body_present check (
    length(btrim(body)) <= 4000
    and (length(btrim(body)) >= 1 or has_attachments)
  );

comment on column public.direct_messages.has_attachments is
  'True when the message was sent with files (message_attachments). Set only by send_direct_message_with_attachments(); such a message may have an empty body.';

-- ── Table ───────────────────────────────────────────────────────────────

create table public.message_attachments (
  id uuid primary key default gen_random_uuid(),
  community_id text not null references public.communities (id) on delete cascade,

  -- Exactly one of these: the conversation the file was uploaded into.
  channel_id text references public.channels (id) on delete cascade,
  conversation_id uuid references public.direct_conversations (id) on delete cascade,

  -- The message it was sent with. Null until then; never changes after.
  message_id uuid references public.messages (id) on delete cascade,
  direct_message_id uuid references public.direct_messages (id) on delete cascade,

  uploader_id uuid not null references public.profiles (id) on delete cascade,

  -- `<community_id>/<random uuid>.<ext>`. Generated here, never from a
  -- filename, and unrelated to the row's own id.
  storage_path text not null unique,
  -- A small WebP rendition of an image, beside the original.
  thumb_path text unique,

  -- What the uploader's file was called, cleaned. Display text only.
  display_name text not null,
  -- Decided by the server from the file's bytes.
  mime_type text not null,
  size_bytes bigint not null,
  width integer,
  height integer,

  status text not null default 'uploading',
  position smallint not null default 0,
  created_at timestamptz not null default now(),
  attached_at timestamptz,

  constraint message_attachments_one_conversation
    check ((channel_id is null) <> (conversation_id is null)),
  constraint message_attachments_message_scope check (
    (message_id is null or channel_id is not null)
    and (direct_message_id is null or conversation_id is not null)
    and (message_id is null or direct_message_id is null)
  ),
  constraint message_attachments_status_known
    check (status in ('uploading', 'ready', 'sent')),
  constraint message_attachments_sent_has_message
    check ((status = 'sent') = (message_id is not null or direct_message_id is not null)),
  constraint message_attachments_mime_known
    check (message_attachment_extension(mime_type) is not null),
  constraint message_attachments_size
    check (size_bytes between 1 and 26214400),
  constraint message_attachments_display_name_shape check (
    display_name = btrim(display_name)
    and length(display_name) between 1 and 200
    and display_name !~ '[[:cntrl:]/\\]'
  ),
  constraint message_attachments_dimensions check (
    (width is null and height is null)
    or (mime_type like 'image/%' and width between 1 and 30000 and height between 1 and 30000)
  ),
  constraint message_attachments_path_shape check (
    storage_path ~ '^[a-z0-9-]+/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[a-z0-9]+$'
    and split_part(storage_path, '/', 1) = community_id
    and split_part(storage_path, '.', 2) = message_attachment_extension(mime_type)
  ),
  constraint message_attachments_thumb_shape check (
    thumb_path is null
    or (mime_type like 'image/%' and thumb_path = split_part(storage_path, '.', 1) || '.thumb.webp')
  )
);

create index message_attachments_message_idx
  on public.message_attachments (message_id) where message_id is not null;
create index message_attachments_direct_message_idx
  on public.message_attachments (direct_message_id) where direct_message_id is not null;
create index message_attachments_channel_idx
  on public.message_attachments (channel_id) where channel_id is not null;
create index message_attachments_conversation_idx
  on public.message_attachments (conversation_id) where conversation_id is not null;
create index message_attachments_pending_idx
  on public.message_attachments (created_at) where status <> 'sent';
create index message_attachments_uploader_idx
  on public.message_attachments (uploader_id);

comment on table public.message_attachments is
  'Files sent in private conversations: group chats, private lokallag channels and direct messages. Objects live in the private message-attachments bucket; rows are written only by the functions in 20261024100000 and nothing about a sent attachment can change.';

-- ── What may never change ───────────────────────────────────────────────
--
-- Fires for every writer, the service role included. An attachment keeps its
-- uploader, conversation, object and type for life; it moves forward through
-- uploading → ready → sent and never back; and the message it is sent with is
-- set once, to a message in the same conversation written by the same person.

create or replace function public.message_attachments_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_community text;
begin
  if tg_op = 'INSERT' then
    if new.channel_id is not null then
      select c.community_id into v_community from channels c where c.id = new.channel_id;
    else
      select dc.community_id into v_community
      from direct_conversations dc where dc.id = new.conversation_id;
    end if;
    if v_community is null or v_community is distinct from new.community_id then
      raise exception 'Vedlegget hører ikke til dette fellesskapet'
        using errcode = 'check_violation';
    end if;
  else
    if new.id is distinct from old.id
       or new.community_id is distinct from old.community_id
       or new.channel_id is distinct from old.channel_id
       or new.conversation_id is distinct from old.conversation_id
       or new.uploader_id is distinct from old.uploader_id
       or new.storage_path is distinct from old.storage_path
       or new.display_name is distinct from old.display_name
       or new.mime_type is distinct from old.mime_type
       or new.size_bytes is distinct from old.size_bytes
       or new.width is distinct from old.width
       or new.height is distinct from old.height
       or new.created_at is distinct from old.created_at
    then
      raise exception 'Et vedlegg kan ikke endres'
        using errcode = 'check_violation';
    end if;

    if old.status = 'sent'
       or (old.status = 'ready' and new.status = 'uploading')
       or (old.status = 'uploading' and new.status = 'sent')
    then
      raise exception 'Et sendt vedlegg kan ikke endres eller flyttes'
        using errcode = 'check_violation';
    end if;

    if old.status <> 'uploading' and new.thumb_path is distinct from old.thumb_path then
      raise exception 'Et vedlegg kan ikke endres'
        using errcode = 'check_violation';
    end if;
  end if;

  if new.message_id is not null and not exists (
    select 1 from messages m
    where m.id = new.message_id
      and m.channel_id = new.channel_id
      and m.author_id = new.uploader_id
  ) then
    raise exception 'Vedlegget hører ikke til denne meldingen'
      using errcode = 'check_violation';
  end if;

  if new.direct_message_id is not null and not exists (
    select 1 from direct_messages dm
    where dm.id = new.direct_message_id
      and dm.conversation_id = new.conversation_id
      and dm.author_id = new.uploader_id
  ) then
    raise exception 'Vedlegget hører ikke til denne meldingen'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

revoke execute on function public.message_attachments_guard() from public, anon, authenticated;

create trigger message_attachments_guard
before insert or update on public.message_attachments
for each row execute function public.message_attachments_guard();

-- ── Objects to remove ───────────────────────────────────────────────────
--
-- A row can disappear in many ways — a discarded upload, a deleted message, a
-- deleted private channel or group taking its messages with it, a person or a
-- community being removed — and every one of them is a cascade in this
-- database. Storage is a separate system that refuses SQL deletes, so the
-- object cannot go in the same statement. Instead each deleted row leaves its
-- object names here, in the same transaction as whatever deleted it, and the
-- server removes them through the Storage API and then clears the entry
-- (lib/attachment-storage.ts). Nothing in the queue is readable by anyone but
-- the service role, and an object named here is already unreachable: the read
-- policy below needs a row.

create table public.message_attachment_purges (
  storage_path text primary key,
  queued_at timestamptz not null default now()
);

alter table public.message_attachment_purges enable row level security;
revoke all on public.message_attachment_purges from anon, authenticated;

comment on table public.message_attachment_purges is
  'Object names in the message-attachments bucket whose attachment row is gone. Written by a trigger, drained by the server with the service role. No client access.';

create or replace function public.message_attachments_queue_purge()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into message_attachment_purges (storage_path)
  values (old.storage_path)
  on conflict (storage_path) do nothing;

  -- The rendition is queued whether or not the row ever recorded it: an
  -- upload interrupted between storing it and completing leaves one behind.
  if old.mime_type like 'image/%' then
    insert into message_attachment_purges (storage_path)
    values (split_part(old.storage_path, '.', 1) || '.thumb.webp')
    on conflict (storage_path) do nothing;
  end if;

  return old;
end;
$$;

revoke execute on function public.message_attachments_queue_purge() from public, anon, authenticated;

create trigger message_attachments_queue_purge
after delete on public.message_attachments
for each row execute function public.message_attachments_queue_purge();

-- ── Who may attach, and how much ────────────────────────────────────────
--
-- The whole policy, for one person and one conversation, from rows in this
-- database: the channel's own scope and archive state, the conversation's
-- participants, their current memberships and roles, the community's
-- dm_policy, and the messages actually written. Nothing a client sends — no
-- role, no label, no "this is an organisational contact" — enters into it.
--
--   reason         allowed  meaning
--   ok             true
--   not_found      false    no such conversation for this person (or signed out)
--   unsupported    false    a conversation that takes no attachments at all
--   archived       false    readable history, no new files
--   read_only      false    only staff write here
--   closed         false    the other participant is no longer an active member
--   needs_mutual   false    member-to-member: both must first have written text
--
-- Direct messages come in two tiers.
--
--   organisational  the community is on dm_policy = 'staff_only' and at least
--                   one of the two is, right now, its admin or moderator. That
--                   is exactly the set of conversations can_send_dm() lets
--                   exist there (staff with staff, or a member writing to
--                   reachable staff). 25 MiB, five files, straight away.
--
--   member          everything else: every conversation in a community whose
--                   members may write to each other freely, and a staff_only
--                   conversation where neither is staff any longer. First
--                   contact is text only. Files unlock once EACH of the two
--                   has sent at least one message with real text in it, in
--                   this conversation. Ten messages from one side unlock
--                   nothing; neither does an empty or whitespace-only body,
--                   which is all an attachment-only message has. 10 MiB,
--                   three files.

create or replace function public.message_attachment_policy_for(
  p_user_id uuid,
  p_channel_id text,
  p_conversation_id uuid
)
returns table (
  allowed boolean,
  reason text,
  max_bytes bigint,
  max_files integer,
  community_id text
)
language plpgsql security definer stable set search_path = public as $$
#variable_conflict use_column
declare
  v_channel channels%rowtype;
  v_conversation direct_conversations%rowtype;
  v_other uuid;
  v_organizational boolean;
begin
  allowed := false;
  reason := 'not_found';
  max_bytes := 0;
  max_files := 0;
  community_id := null;

  if p_user_id is null or (p_channel_id is null) = (p_conversation_id is null) then
    return next;
    return;
  end if;

  -- ── Channels ──
  if p_channel_id is not null then
    select * into v_channel from channels c where c.id = p_channel_id;
    if not found or not channel_access_admits(
      p_user_id, v_channel.community_id, v_channel.local_group_id,
      v_channel.subgroup_id, v_channel.id, v_channel.is_private
    ) then
      return next;
      return;
    end if;

    community_id := v_channel.community_id;

    if not (v_channel.is_private or v_channel.subgroup_id is not null) then
      reason := 'unsupported';
      return next;
      return;
    end if;

    max_bytes := 26214400;
    max_files := 5;

    if v_channel.archived_at is not null then
      reason := 'archived';
    elsif v_channel.read_only and not exists (
      select 1 from memberships m
      where m.community_id = v_channel.community_id
        and m.user_id = p_user_id
        and m.status = 'active'
        and m.role in ('admin', 'moderator')
    ) then
      reason := 'read_only';
    else
      allowed := true;
      reason := 'ok';
    end if;

    return next;
    return;
  end if;

  -- ── Direct messages ──
  select * into v_conversation from direct_conversations dc where dc.id = p_conversation_id;
  if not found
     or p_user_id not in (v_conversation.participant_one_id, v_conversation.participant_two_id)
     or not exists (
       select 1 from memberships m
       where m.community_id = v_conversation.community_id
         and m.user_id = p_user_id
         and m.status = 'active'
     )
  then
    return next;
    return;
  end if;

  community_id := v_conversation.community_id;
  v_other := case
    when v_conversation.participant_one_id = p_user_id then v_conversation.participant_two_id
    else v_conversation.participant_one_id
  end;

  v_organizational :=
    exists (
      select 1 from communities c
      where c.id = v_conversation.community_id and c.dm_policy = 'staff_only'
    )
    and exists (
      select 1 from memberships m
      where m.community_id = v_conversation.community_id
        and m.user_id in (p_user_id, v_other)
        and m.status = 'active'
        and m.role in ('admin', 'moderator')
    );

  if v_organizational then
    max_bytes := 26214400;
    max_files := 5;
  else
    max_bytes := 10485760;
    max_files := 3;
  end if;

  -- The same rule a reply follows (can_reply_direct_conversation): both ends
  -- must still be active members of the conversation's community.
  if not exists (
    select 1 from memberships m
    where m.community_id = v_conversation.community_id
      and m.user_id = v_other
      and m.status = 'active'
  ) then
    reason := 'closed';
  elsif not v_organizational and not (
    exists (
      select 1 from direct_messages dm
      where dm.conversation_id = v_conversation.id
        and dm.author_id = p_user_id
        and dm.body ~ '\S'
    )
    and exists (
      select 1 from direct_messages dm
      where dm.conversation_id = v_conversation.id
        and dm.author_id = v_other
        and dm.body ~ '\S'
    )
  ) then
    reason := 'needs_mutual';
  else
    allowed := true;
    reason := 'ok';
  end if;

  return next;
end;
$$;

-- Takes a user id, so it is not for clients: they would be able to ask about
-- somebody else. The wrapper below answers for the caller only.
revoke execute on function public.message_attachment_policy_for(uuid, text, uuid)
  from public, anon, authenticated;

create or replace function public.message_attachment_policy(
  p_channel_id text default null,
  p_conversation_id uuid default null
)
returns table (
  allowed boolean,
  reason text,
  max_bytes bigint,
  max_files integer,
  community_id text
)
language sql security definer stable set search_path = public as $$
  select p.allowed, p.reason, p.max_bytes, p.max_files, p.community_id
  from message_attachment_policy_for(auth.uid(), p_channel_id, p_conversation_id) p;
$$;

revoke execute on function public.message_attachment_policy(text, uuid) from public, anon;
grant execute on function public.message_attachment_policy(text, uuid) to authenticated;

-- ── Reading ─────────────────────────────────────────────────────────────
--
-- A sent attachment is readable by whoever can read its conversation NOW —
-- can_read_channel() for a channel, is_direct_conversation_participant() for a
-- direct message — which are the very functions the messages themselves are
-- read through. An unsent upload is its uploader's alone, and only while they
-- still have that access.

create or replace function public.can_read_message_attachment(
  p_channel_id text,
  p_conversation_id uuid,
  p_uploader_id uuid,
  p_status text
)
returns boolean language sql security definer stable set search_path = public as $$
  select auth.uid() is not null
    and (p_status = 'sent' or p_uploader_id = auth.uid())
    and case
      when p_channel_id is not null then can_read_channel(p_channel_id)
      when p_conversation_id is not null then is_direct_conversation_participant(p_conversation_id)
      else false
    end;
$$;

revoke execute on function public.can_read_message_attachment(text, uuid, uuid, text) from public, anon;
grant execute on function public.can_read_message_attachment(text, uuid, uuid, text) to authenticated;

alter table public.message_attachments enable row level security;

revoke all on public.message_attachments from anon, authenticated;
grant select on public.message_attachments to authenticated;

create policy message_attachments_select on public.message_attachments
  for select to authenticated
  using (can_read_message_attachment(channel_id, conversation_id, uploader_id, status));

-- No insert, update or delete policy, and no such grant: every write is one of
-- the functions below.

-- The object follows its row. A name that is nobody's row is nobody's file,
-- so there is nothing to find by guessing a path, and nothing left to read
-- once a row is gone — even before the object itself has been removed.
create or replace function public.can_read_message_attachment_object(p_name text)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from message_attachments a
    where (a.storage_path = p_name or a.thumb_path = p_name)
      and can_read_message_attachment(a.channel_id, a.conversation_id, a.uploader_id, a.status)
  );
$$;

revoke execute on function public.can_read_message_attachment_object(text) from public, anon;
grant execute on function public.can_read_message_attachment_object(text) to authenticated;

create policy message_attachments_read on storage.objects for select to authenticated
using (bucket_id = 'message-attachments' and can_read_message_attachment_object(name));

-- No insert, update or delete policy on the bucket. A browser can neither put
-- a file there nor remove one, with or without the Storage API; the server
-- does both with the service role, after the functions here have decided.

-- ── Uploading ───────────────────────────────────────────────────────────

-- Opens an upload: checks the policy for the caller, the type against the
-- allowlist and the size against this conversation's limit, and reserves a
-- row and an object name. Called by the upload route with the caller's own
-- session, after it has read the file's real type from its bytes.
--
-- A person can hold at most ten unsent uploads per conversation. Opening an
-- eleventh drops the oldest, so a composer abandoned by a reload never locks
-- anyone out and never accumulates.
create or replace function public.begin_message_attachment(
  p_channel_id text,
  p_conversation_id uuid,
  p_display_name text,
  p_mime_type text,
  p_size_bytes bigint,
  p_width integer default null,
  p_height integer default null
)
returns table (attachment_id uuid, storage_path text)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare
  v_user uuid := auth.uid();
  v_policy record;
  v_extension text := message_attachment_extension(p_mime_type);
  v_name text := btrim(coalesce(p_display_name, ''));
  v_id uuid := gen_random_uuid();
  v_path text;
  v_image boolean := coalesce(p_mime_type like 'image/%', false);
begin
  select * into v_policy
  from message_attachment_policy_for(v_user, p_channel_id, p_conversation_id);

  if not coalesce(v_policy.allowed, false) then
    raise exception 'attachment_not_allowed:%', coalesce(v_policy.reason, 'not_found')
      using errcode = 'insufficient_privilege';
  end if;
  if v_extension is null then
    raise exception 'attachment_type' using errcode = 'check_violation';
  end if;
  if p_size_bytes is null or p_size_bytes < 1 or p_size_bytes > v_policy.max_bytes then
    raise exception 'attachment_too_large' using errcode = 'check_violation';
  end if;
  if length(v_name) = 0 or length(v_name) > 200 or v_name ~ '[[:cntrl:]/\\]' then
    raise exception 'attachment_name' using errcode = 'check_violation';
  end if;

  delete from message_attachments a
  where a.id in (
    select b.id from message_attachments b
    where b.uploader_id = v_user
      and b.status <> 'sent'
      and b.channel_id is not distinct from p_channel_id
      and b.conversation_id is not distinct from p_conversation_id
    order by b.created_at desc, b.id
    offset 9
  );

  v_path := v_policy.community_id || '/' || gen_random_uuid()::text || '.' || v_extension;

  insert into message_attachments (
    id, community_id, channel_id, conversation_id, uploader_id,
    storage_path, display_name, mime_type, size_bytes, width, height, status
  )
  values (
    v_id, v_policy.community_id, p_channel_id, p_conversation_id, v_user,
    v_path, v_name, p_mime_type, p_size_bytes,
    case when v_image then p_width end,
    case when v_image then p_height end,
    'uploading'
  );

  attachment_id := v_id;
  storage_path := v_path;
  return next;
end;
$$;

revoke execute on function public.begin_message_attachment(text, uuid, text, text, bigint, integer, integer)
  from public, anon;
grant execute on function public.begin_message_attachment(text, uuid, text, text, bigint, integer, integer)
  to authenticated;

-- Marks an upload ready once its object is really in the bucket, with the
-- size and type the row promised. Service role only: this is the step that
-- vouches for the file's content, and only the server has looked at it.
create or replace function public.complete_message_attachment(p_attachment_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  v_attachment message_attachments%rowtype;
  v_object storage.objects%rowtype;
  v_thumb text;
begin
  select * into v_attachment from message_attachments a where a.id = p_attachment_id for update;
  if not found or v_attachment.status <> 'uploading' then
    return false;
  end if;

  select * into v_object from storage.objects o
  where o.bucket_id = 'message-attachments' and o.name = v_attachment.storage_path;
  if not found
     or nullif(v_object.metadata ->> 'size', '')::bigint is distinct from v_attachment.size_bytes
     or v_object.metadata ->> 'mimetype' is distinct from v_attachment.mime_type
  then
    return false;
  end if;

  if v_attachment.mime_type like 'image/%' then
    v_thumb := split_part(v_attachment.storage_path, '.', 1) || '.thumb.webp';
    if not exists (
      select 1 from storage.objects o
      where o.bucket_id = 'message-attachments'
        and o.name = v_thumb
        and o.metadata ->> 'mimetype' = 'image/webp'
    ) then
      v_thumb := null;
    end if;
  end if;

  update message_attachments a
     set status = 'ready', thumb_path = v_thumb
   where a.id = v_attachment.id;
  return true;
end;
$$;

revoke execute on function public.complete_message_attachment(uuid) from public, anon, authenticated;
grant execute on function public.complete_message_attachment(uuid) to service_role;

-- Takes back one of the caller's own unsent uploads (the × on a selected
-- file). A sent attachment is not something this can touch.
create or replace function public.discard_message_attachment(p_attachment_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  v_deleted uuid;
begin
  delete from message_attachments a
  where a.id = p_attachment_id
    and a.uploader_id = auth.uid()
    and a.status <> 'sent'
  returning a.id into v_deleted;
  return v_deleted is not null;
end;
$$;

revoke execute on function public.discard_message_attachment(uuid) from public, anon;
grant execute on function public.discard_message_attachment(uuid) to authenticated;

-- Uploads that were never sent: a closed tab, a failed send nobody retried.
-- Their rows go here and their objects follow through the purge queue.
create or replace function public.sweep_abandoned_message_attachments(
  p_older_than interval default interval '24 hours'
)
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_count integer;
begin
  with gone as (
    delete from message_attachments a
    where a.status <> 'sent'
      and a.created_at < now() - greatest(p_older_than, interval '10 minutes')
    returning 1
  )
  select count(*)::integer into v_count from gone;
  return v_count;
end;
$$;

revoke execute on function public.sweep_abandoned_message_attachments(interval)
  from public, anon, authenticated;
grant execute on function public.sweep_abandoned_message_attachments(interval) to service_role;

-- ── Sending ─────────────────────────────────────────────────────────────

-- Claims the caller's own ready uploads for one conversation, in the order
-- given, or refuses the lot. Locks them, so the same files cannot be claimed
-- by two sends at once: the second finds them sent and is refused.
create or replace function public.claim_message_attachments(
  p_user_id uuid,
  p_attachment_ids uuid[],
  p_channel_id text,
  p_conversation_id uuid,
  p_max_files integer,
  p_max_bytes bigint
)
returns uuid[] language plpgsql security definer set search_path = public as $$
declare
  v_ids uuid[];
  v_count integer;
  v_claimed integer;
begin
  select array_agg(s.id order by s.ord) into v_ids
  from (
    select u.id, min(u.ord) as ord
    from unnest(coalesce(p_attachment_ids, '{}')) with ordinality as u(id, ord)
    where u.id is not null
    group by u.id
  ) s;

  v_count := coalesce(array_length(v_ids, 1), 0);
  if v_count = 0 then
    raise exception 'attachment_required' using errcode = 'check_violation';
  end if;
  if v_count > p_max_files then
    raise exception 'attachment_too_many' using errcode = 'check_violation';
  end if;

  select count(*)::integer into v_claimed
  from (
    select a.id from message_attachments a
    where a.id = any(v_ids)
      and a.uploader_id = p_user_id
      and a.status = 'ready'
      and a.message_id is null
      and a.direct_message_id is null
      and a.channel_id is not distinct from p_channel_id
      and a.conversation_id is not distinct from p_conversation_id
      and a.size_bytes <= p_max_bytes
    for update
  ) locked;

  if v_claimed <> v_count then
    raise exception 'attachment_invalid' using errcode = 'check_violation';
  end if;

  return v_ids;
end;
$$;

revoke execute on function public.claim_message_attachments(uuid, uuid[], text, uuid, integer, bigint)
  from public, anon, authenticated;

-- A channel message with files. Text-only messages keep going through the
-- ordinary insert and its policies, untouched. This runs the same three
-- questions those policies ask — can the caller read the channel, is it open
-- for writing, may they write in it — through the same functions, plus the
-- attachment policy, then writes the message and attaches the files in one
-- transaction. Either all of it happens or none.
create or replace function public.send_channel_message_with_attachments(
  p_channel_id text,
  p_body text,
  p_attachment_ids uuid[]
)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_body text := btrim(coalesce(p_body, ''), E' \t\n\r');
  v_policy record;
  v_ids uuid[];
  v_message_id uuid;
begin
  select * into v_policy from message_attachment_policy_for(v_user, p_channel_id, null);

  if v_user is null
     or not coalesce(v_policy.allowed, false)
     or not can_read_channel(p_channel_id)
     or not channel_accepts_messages(p_channel_id)
  then
    raise exception 'attachment_not_allowed:%', coalesce(v_policy.reason, 'not_found')
      using errcode = 'insufficient_privilege';
  end if;
  if length(v_body) > 4000 then
    raise exception 'message_too_long' using errcode = 'check_violation';
  end if;

  v_ids := claim_message_attachments(
    v_user, p_attachment_ids, p_channel_id, null, v_policy.max_files, v_policy.max_bytes
  );

  insert into messages (channel_id, author_id, body)
  values (p_channel_id, v_user, v_body)
  returning id into v_message_id;

  update message_attachments a
     set message_id = v_message_id,
         status = 'sent',
         position = (x.ord - 1)::smallint,
         attached_at = now()
    from unnest(v_ids) with ordinality as x(id, ord)
   where a.id = x.id;

  return v_message_id;
end;
$$;

revoke execute on function public.send_channel_message_with_attachments(text, text, uuid[])
  from public, anon;
grant execute on function public.send_channel_message_with_attachments(text, text, uuid[])
  to authenticated;

-- The same for a direct message. can_reply_direct_conversation() is the rule
-- direct_messages_insert applies; the attachment policy adds the tier and, for
-- member-to-member conversations, the mutual-text requirement — checked here,
-- at the moment of sending, whatever the upload was told earlier.
create or replace function public.send_direct_message_with_attachments(
  p_conversation_id uuid,
  p_body text,
  p_attachment_ids uuid[]
)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_body text := btrim(coalesce(p_body, ''), E' \t\n\r');
  v_policy record;
  v_ids uuid[];
  v_message_id uuid;
begin
  select * into v_policy from message_attachment_policy_for(v_user, null, p_conversation_id);

  if v_user is null
     or not coalesce(v_policy.allowed, false)
     or not can_reply_direct_conversation(p_conversation_id)
  then
    raise exception 'attachment_not_allowed:%', coalesce(v_policy.reason, 'not_found')
      using errcode = 'insufficient_privilege';
  end if;
  if length(v_body) > 4000 then
    raise exception 'message_too_long' using errcode = 'check_violation';
  end if;

  v_ids := claim_message_attachments(
    v_user, p_attachment_ids, null, p_conversation_id, v_policy.max_files, v_policy.max_bytes
  );

  insert into direct_messages (conversation_id, author_id, body, has_attachments)
  values (p_conversation_id, v_user, v_body, true)
  returning id into v_message_id;

  update message_attachments a
     set direct_message_id = v_message_id,
         status = 'sent',
         position = (x.ord - 1)::smallint,
         attached_at = now()
    from unnest(v_ids) with ordinality as x(id, ord)
   where a.id = x.id;

  return v_message_id;
end;
$$;

revoke execute on function public.send_direct_message_with_attachments(uuid, text, uuid[])
  from public, anon;
grant execute on function public.send_direct_message_with_attachments(uuid, text, uuid[])
  to authenticated;

-- ── Notification preview for a message without text ─────────────────────
--
-- Identical to the current definition (20260926100000, which names the author
-- by their profile in the conversation's own community and never by their
-- account) except for the preview: a message that is only files says so
-- instead of ending in a bare separator.

create or replace function public.direct_message_after_insert()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_conversation direct_conversations%rowtype;
  v_recipient uuid;
  v_author_name text;
  v_community_name text;
  v_href text;
begin
  select * into v_conversation
  from direct_conversations
  where id = new.conversation_id;

  if not found then
    return new;
  end if;

  update direct_conversations
     set last_message_at = greatest(last_message_at, new.created_at)
   where id = new.conversation_id;

  v_recipient := case
    when v_conversation.participant_one_id = new.author_id then v_conversation.participant_two_id
    else v_conversation.participant_one_id
  end;

  v_href := '/community/' || v_conversation.community_id || '/messages/' || new.conversation_id;

  if coalesce(auth.role(), '') <> 'service_role' then
    -- The author as they appear in the conversation's community.
    select cp.display_name, c.name into v_author_name, v_community_name
    from communities c
    left join community_profiles cp
      on cp.community_id = c.id and cp.user_id = new.author_id
    where c.id = v_conversation.community_id;

    insert into notifications (user_id, kind, community_id, title, body, href)
    select
      v_recipient,
      'direct_message',
      v_conversation.community_id,
      'Ny melding fra ' || coalesce(v_author_name, 'et medlem'),
      coalesce(v_community_name, 'Fellesskapet') || ' · ' || case
        when btrim(new.body) = '' then 'Vedlegg'
        else left(btrim(new.body), 120)
      end,
      v_href
    where not exists (
      select 1
      from notifications n
      where n.user_id = v_recipient
        and n.kind = 'direct_message'
        and n.href = v_href
        and n.read = false
    );
  end if;

  return new;
end;
$$;

revoke execute on function public.direct_message_after_insert()
  from public, anon, authenticated;

-- delete_private_channel() and delete_subgroup() need no change: they delete
-- the channel, its messages follow by cascade, the attachments follow the
-- messages, and each attachment row leaves its object names in
-- message_attachment_purges on the way out. (The note in 20261021100000 that
-- channel messages have nothing in storage is true up to this migration.)
