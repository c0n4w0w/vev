-- Managing one's own direct-message inbox: hiding a conversation, and
-- clearing one's own copy of its history.
--
-- Two separate, per-participant actions. Neither touches the other person's
-- inbox, read state, history or files, and there is no automatic expiry:
-- members of a community that meets twice a year, or once, should find their
-- conversation where they left it.
--
-- ── Fjern fra innboksen (hide) ──────────────────────────────────────────
--
-- The conversation leaves the caller's «Alle meldinger» and sidebar. Nothing
-- else changes: history, files and notices stay readable to both, and the
-- conversation still opens by its address. The next message written in it —
-- by either of them — brings it back for both (direct_message_assign_seq).
-- Nothing else does: an edit, a deletion, a read, the other person hiding it
-- too. Starting a conversation with the same person through an authorised
-- flow (start_direct_conversation) returns the existing thread and brings it
-- back for the caller. No archive, no folder.
--
-- ── Slett samtalehistorikk (clear) ──────────────────────────────────────
--
-- Every message that exists in the conversation at that moment — sent and
-- received — becomes permanently unreadable to the caller, with its files,
-- thumbnails and the caller's notices for it. The other participant keeps
-- their copy, subject to ordinary permissions and deletions. The conversation
-- itself stays (so does file-sharing eligibility, recorded on it by
-- 20261102100000): a later message from either of them starts a new visible
-- history in the same thread. Nothing is removed from TING's servers that the
-- other participant may still read; their copy is theirs.
--
-- ── The boundary ────────────────────────────────────────────────────────
--
-- Not a timestamp. Each conversation numbers its messages (`seq`, 1, 2, 3 …)
-- in a BEFORE INSERT trigger that takes the conversation row's lock to do it
-- and holds it until the message commits. Clearing takes the same lock and
-- records the highest number so far as the caller's `cleared_through_seq`.
-- So when the clear reads the number, every message numbered at or below it
-- has committed (and is cleared), and every message after it is numbered
-- higher (and is visible) — whatever two devices, two senders or the server
-- do at the same moment. Pagination, cursors and reloads all compare the
-- same stored integer.
--
-- The boundary only moves forward, for every writer including the service
-- role: a guard refuses lowering it, nulling its time, moving it past the
-- conversation's own counter or deleting the row while the conversation and
-- the person both still exist. Repeating a clear is harmless.
--
-- ── Every read path ─────────────────────────────────────────────────────
--
--   messages      direct_messages_select (can_read_direct_message): above
--                 the caller's boundary only. Covers the page, any cursor or
--                 id an old URL or API request names, and the inbox preview.
--   files         message_attachments_select and the Storage read policy:
--                 a file sent with a cleared message is not the caller's to
--                 list, preview or download, by row or by object name.
--   unread        direct_unread_count counts only visible messages, and not
--                 hidden conversations.
--   notices       the caller's direct-message notices for the conversation
--                 are deleted when clearing; a later edit by the other
--                 participant never re-quotes a cleared message to them.
--   edit/delete   refused (not_found) for a cleared message, also one's own.
--
-- What a member can change is only their own row, through the two functions
-- below; there is no INSERT, UPDATE or DELETE grant on the state table.

-- ── 1. Message order ────────────────────────────────────────────────────

alter table public.direct_conversations
  add column message_seq bigint not null default 0;

alter table public.direct_messages
  add column seq bigint not null default 0;

comment on column public.direct_conversations.message_seq is
  'Number of the newest message written here (direct_messages.seq). Raised under this row''s lock by direct_message_assign_seq; never lowered.';
comment on column public.direct_messages.seq is
  'Position of the message in its conversation, 1, 2, 3 … Assigned under the conversation''s lock, so it follows commit order. Compared with direct_conversation_states.cleared_through_seq.';

-- Existing messages, in the order they were written. The guard refuses any
-- update of a deleted message, so it steps aside for this one statement.
alter table public.direct_messages disable trigger direct_messages_guard;

with ordered as (
  select id, row_number() over (partition by conversation_id order by created_at, id) as n
  from public.direct_messages
)
update public.direct_messages dm
   set seq = ordered.n
  from ordered
 where ordered.id = dm.id;

alter table public.direct_messages enable trigger direct_messages_guard;

update public.direct_conversations dc
   set message_seq = coalesce((select max(dm.seq) from public.direct_messages dm where dm.conversation_id = dc.id), 0);

alter table public.direct_messages
  add constraint direct_messages_seq_positive check (seq > 0),
  add constraint direct_messages_conversation_seq_key unique (conversation_id, seq);

-- ── 2. Per-participant state ────────────────────────────────────────────

create table public.direct_conversation_states (
  conversation_id uuid not null references public.direct_conversations (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  -- Set while the conversation is out of this person's inbox.
  hidden_at timestamptz,
  -- Messages numbered at or below this are no longer this person's to read.
  cleared_through_seq bigint not null default 0,
  cleared_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (conversation_id, user_id),
  constraint direct_conversation_states_cleared_shape
    check (cleared_through_seq >= 0 and (cleared_through_seq = 0 or cleared_at is not null))
);

create index direct_conversation_states_user_idx
  on public.direct_conversation_states (user_id) where hidden_at is not null;

comment on table public.direct_conversation_states is
  'One participant''s own view of a direct conversation: whether they took it out of their inbox, and how far they cleared its history. Never the other participant''s. Written only by hide_direct_conversation(), clear_direct_conversation_history(), start_direct_conversation() and the message numbering trigger.';

create or replace function public.direct_conversation_states_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_conversation direct_conversations%rowtype;
begin
  if tg_op = 'DELETE' then
    -- Only with the conversation or the person: a boundary is not undone.
    if exists (select 1 from direct_conversations dc where dc.id = old.conversation_id)
       and exists (select 1 from profiles p where p.id = old.user_id)
    then
      raise exception 'direct_conversation_state_is_permanent' using errcode = 'check_violation';
    end if;
    return old;
  end if;

  select * into v_conversation from direct_conversations dc where dc.id = new.conversation_id;
  if not found or new.user_id not in (v_conversation.participant_one_id, v_conversation.participant_two_id) then
    raise exception 'direct_conversation_state_not_participant' using errcode = 'check_violation';
  end if;
  if new.cleared_through_seq > v_conversation.message_seq then
    raise exception 'direct_conversation_state_ahead' using errcode = 'check_violation';
  end if;

  if tg_op = 'UPDATE' then
    if new.conversation_id is distinct from old.conversation_id
       or new.user_id is distinct from old.user_id
    then
      raise exception 'direct_conversation_state_immutable' using errcode = 'check_violation';
    end if;
    if new.cleared_through_seq < old.cleared_through_seq
       or (old.cleared_at is not null and (new.cleared_at is null or new.cleared_at < old.cleared_at))
    then
      raise exception 'direct_conversation_state_is_permanent' using errcode = 'check_violation';
    end if;
  end if;

  new.updated_at := now();
  return new;
end;
$$;

revoke all on function public.direct_conversation_states_guard() from public, anon, authenticated, service_role;

create trigger direct_conversation_states_guard
  before insert or update or delete on public.direct_conversation_states
  for each row execute function public.direct_conversation_states_guard();

alter table public.direct_conversation_states enable row level security;

revoke all on public.direct_conversation_states from public, anon, authenticated, service_role;
grant select on public.direct_conversation_states to authenticated;
grant select, insert, update, delete on public.direct_conversation_states to service_role;

create policy direct_conversation_states_select on public.direct_conversation_states
  for select to authenticated
  using (user_id = auth.uid() and is_direct_conversation_participant(conversation_id));

-- ── 3. Numbering, and new activity bringing a conversation back ─────────

create or replace function public.direct_message_assign_seq()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- Only a participant's message (or the server's) takes a number. Anyone
  -- else's insert keeps 0 and is refused by direct_messages_insert, which
  -- PostgreSQL checks before the constraint that would also refuse 0 — so
  -- an outsider learns nothing, and no lock is taken on their behalf.
  update direct_conversations dc
     set message_seq = dc.message_seq + 1
   where dc.id = new.conversation_id
     and (
       new.author_id in (dc.participant_one_id, dc.participant_two_id)
       or coalesce(auth.role(), '') = 'service_role'
     )
  returning dc.message_seq into new.seq;

  new.seq := coalesce(new.seq, 0);

  if new.seq > 0 then
    update direct_conversation_states s
       set hidden_at = null
     where s.conversation_id = new.conversation_id
       and s.hidden_at is not null;
  end if;

  return new;
end;
$$;

revoke all on function public.direct_message_assign_seq() from public, anon, authenticated, service_role;

create trigger direct_messages_assign_seq
  before insert on public.direct_messages
  for each row execute function public.direct_message_assign_seq();

-- The number, like the author and the time, never changes afterwards.
create or replace function public.direct_messages_guard()
returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if new.edited_at is not null or new.deleted_at is not null then
      raise exception 'message_error:not_allowed' using errcode = 'insufficient_privilege';
    end if;
    return new;
  end if;

  if new.id is distinct from old.id
     or new.conversation_id is distinct from old.conversation_id
     or new.author_id is distinct from old.author_id
     or new.created_at is distinct from old.created_at
     or new.seq is distinct from old.seq
  then
    raise exception 'message_error:immutable' using errcode = 'check_violation';
  end if;
  if old.deleted_at is not null then
    raise exception 'message_error:deleted' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

revoke all on function public.direct_messages_guard() from public, anon, authenticated, service_role;

-- The counter starts at nothing and only goes up; the "wrote" flags stay as
-- 20261102100000 made them.
create or replace function public.direct_conversations_guard_wrote()
returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.participant_one_wrote := false;
    new.participant_two_wrote := false;
    new.message_seq := 0;
  else
    if (old.participant_one_wrote and not new.participant_one_wrote)
       or (old.participant_two_wrote and not new.participant_two_wrote)
    then
      raise exception 'direct_conversation_wrote_is_permanent' using errcode = 'check_violation';
    end if;
    if new.message_seq < old.message_seq then
      raise exception 'direct_conversation_seq_is_permanent' using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.direct_conversations_guard_wrote() from public, anon, authenticated, service_role;

-- ── 4. Reading ──────────────────────────────────────────────────────────

-- For one person: may they read the message numbered p_seq here? Takes a
-- user id, so it is not for clients.
create or replace function public.direct_message_visible_to(
  p_user_id uuid,
  p_conversation_id uuid,
  p_seq bigint
)
returns boolean language sql stable security definer set search_path = public as $$
  select p_user_id is not null
    and is_direct_conversation_participant(p_conversation_id, p_user_id)
    and p_seq > coalesce((
      select s.cleared_through_seq
      from direct_conversation_states s
      where s.conversation_id = p_conversation_id and s.user_id = p_user_id
    ), 0);
$$;

revoke all on function public.direct_message_visible_to(uuid, uuid, bigint) from public, anon, authenticated, service_role;

create or replace function public.can_read_direct_message(p_conversation_id uuid, p_seq bigint)
returns boolean language sql stable security definer set search_path = public as $$
  select direct_message_visible_to(auth.uid(), p_conversation_id, p_seq);
$$;

revoke all on function public.can_read_direct_message(uuid, bigint) from public, anon, service_role;
grant execute on function public.can_read_direct_message(uuid, bigint) to authenticated;

drop policy direct_messages_select on public.direct_messages;
create policy direct_messages_select on public.direct_messages
  for select to authenticated
  using (can_read_direct_message(conversation_id, seq));

-- A file sent with a direct message is readable exactly as long as that
-- message is. Unsent uploads (no message yet) are unchanged: their
-- uploader's alone, and discarded when that uploader clears the history.
create or replace function public.direct_attachment_message_visible(p_direct_message_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select p_direct_message_id is null or exists (
    select 1 from direct_messages dm
    where dm.id = p_direct_message_id
      and direct_message_visible_to(auth.uid(), dm.conversation_id, dm.seq)
  );
$$;

revoke all on function public.direct_attachment_message_visible(uuid) from public, anon, service_role;
grant execute on function public.direct_attachment_message_visible(uuid) to authenticated;

drop policy message_attachments_select on public.message_attachments;
create policy message_attachments_select on public.message_attachments
  for select to authenticated
  using (
    can_read_message_attachment(channel_id, conversation_id, uploader_id, status)
    and direct_attachment_message_visible(direct_message_id)
  );

create or replace function public.can_read_message_attachment_object(p_name text)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from message_attachments a
    where (a.storage_path = p_name or a.thumb_path = p_name)
      and can_read_message_attachment(a.channel_id, a.conversation_id, a.uploader_id, a.status)
      and direct_attachment_message_visible(a.direct_message_id)
  );
$$;

-- ── 5. Inbox and unread ─────────────────────────────────────────────────

-- The caller's inbox in one community: their conversations (under the
-- conversations' own policy — this runs as the caller) that they have not
-- taken out of it, newest first.
create or replace function public.direct_inbox(p_community_id text, p_limit integer default null)
returns setof public.direct_conversations
language sql stable security invoker set search_path = public as $$
  select dc.*
  from direct_conversations dc
  where dc.community_id = p_community_id
    and not exists (
      select 1 from direct_conversation_states s
      where s.conversation_id = dc.id
        and s.user_id = auth.uid()
        and s.hidden_at is not null
    )
  order by dc.last_message_at desc, dc.id
  limit p_limit;
$$;

revoke all on function public.direct_inbox(text, integer) from public, anon, service_role;
grant execute on function public.direct_inbox(text, integer) to authenticated;

create or replace function public.direct_unread_count(p_community_id text)
returns integer language sql security definer stable set search_path = public as $$
  select count(*)::integer
  from direct_conversations dc
  left join direct_conversation_states st
    on st.conversation_id = dc.id
   and st.user_id = auth.uid()
  join lateral (
    select dm.author_id, dm.created_at
    from direct_messages dm
    where dm.conversation_id = dc.id
      and dm.seq > coalesce(st.cleared_through_seq, 0)
    order by dm.seq desc
    limit 1
  ) latest on true
  left join direct_conversation_reads reads
    on reads.conversation_id = dc.id
   and reads.user_id = auth.uid()
  where dc.community_id = p_community_id
    and is_direct_conversation_participant(dc.id)
    and st.hidden_at is null
    and latest.author_id <> auth.uid()
    and latest.created_at > coalesce(reads.last_read_at, '-infinity'::timestamptz);
$$;

-- ── 6. The two actions ──────────────────────────────────────────────────

-- Refusals are raised as `conversation_error:<reason>`.

create or replace function public.hide_direct_conversation(p_conversation_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null or not is_direct_conversation_participant(p_conversation_id, v_user) then
    raise exception 'conversation_error:not_found' using errcode = 'insufficient_privilege';
  end if;

  -- The message lock: a message being written right now either commits
  -- first (and is hidden with the rest) or after (and brings it back).
  perform 1 from direct_conversations dc where dc.id = p_conversation_id for update;

  insert into direct_conversation_states (conversation_id, user_id, hidden_at)
  values (p_conversation_id, v_user, now())
  on conflict (conversation_id, user_id) do update
    set hidden_at = coalesce(direct_conversation_states.hidden_at, excluded.hidden_at);

  return true;
end;
$$;

comment on function public.hide_direct_conversation(uuid) is
  'Takes a conversation out of the caller''s own inbox until the next message in it. History, files and notices are untouched, for both participants. Returns true; the same again on a repeat.';

create or replace function public.clear_direct_conversation_history(p_conversation_id uuid)
returns bigint language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_conversation direct_conversations%rowtype;
  v_stored bigint;
begin
  if v_user is null or not is_direct_conversation_participant(p_conversation_id, v_user) then
    raise exception 'conversation_error:not_found' using errcode = 'insufficient_privilege';
  end if;

  -- Numbering takes this lock and keeps it to commit, so once it is ours
  -- every number up to message_seq belongs to a committed message.
  select * into v_conversation from direct_conversations dc where dc.id = p_conversation_id for update;

  insert into direct_conversation_states (conversation_id, user_id, hidden_at, cleared_through_seq, cleared_at)
  values (p_conversation_id, v_user, now(), v_conversation.message_seq, now())
  on conflict (conversation_id, user_id) do update
    set cleared_through_seq = greatest(direct_conversation_states.cleared_through_seq, excluded.cleared_through_seq),
        cleared_at = greatest(direct_conversation_states.cleared_at, excluded.cleared_at),
        hidden_at = coalesce(direct_conversation_states.hidden_at, excluded.hidden_at)
  returning cleared_through_seq into v_stored;

  -- The caller's own notices for it: they quote messages that are gone for
  -- them. A later message raises a new one.
  delete from notifications n
  where n.user_id = v_user
    and n.kind = 'direct_message'
    and n.href = '/community/' || v_conversation.community_id || '/messages/' || v_conversation.id;

  -- The caller's own files that were never sent here: they belonged to the
  -- history being cleared. Their objects follow through the purge queue.
  delete from message_attachments a
  where a.conversation_id = v_conversation.id
    and a.uploader_id = v_user
    and a.status <> 'sent';

  -- Nothing left unread.
  insert into direct_conversation_reads (conversation_id, user_id, last_read_at)
  values (v_conversation.id, v_user, now())
  on conflict (conversation_id, user_id) do update set last_read_at = excluded.last_read_at;

  return v_stored;
end;
$$;

comment on function public.clear_direct_conversation_history(uuid) is
  'Makes every message in the conversation so far — sent and received — permanently unreadable to the caller, with its files and the caller''s notices, and takes it out of their inbox. The other participant keeps their copy. Returns the stored boundary; repeating it is harmless.';

revoke all on function public.hide_direct_conversation(uuid) from public, anon, service_role;
revoke all on function public.clear_direct_conversation_history(uuid) from public, anon, service_role;
grant execute on function public.hide_direct_conversation(uuid) to authenticated;
grant execute on function public.clear_direct_conversation_history(uuid) to authenticated;

-- ── 7. Existing functions that meet the boundary ────────────────────────

-- Opening a conversation with someone through an authorised flow returns
-- the existing thread and puts it back in the caller's inbox. Identical to
-- 20260919191000 otherwise: a new thread still needs can_send_dm().
create or replace function public.start_direct_conversation(
  p_community_id text,
  p_recipient_id uuid
)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_sender uuid := auth.uid();
  v_one uuid;
  v_two uuid;
  v_conversation_id uuid;
begin
  if v_sender is null then
    raise exception 'Du må være logget inn for å starte en samtale'
      using errcode = 'insufficient_privilege';
  end if;

  if p_recipient_id is null or p_recipient_id = v_sender then
    raise exception 'Du kan ikke starte en samtale med deg selv'
      using errcode = 'check_violation';
  end if;

  if not exists (
    select 1 from memberships
    where community_id = p_community_id
      and user_id = v_sender
      and status = 'active'
  ) then
    raise exception 'Du er ikke aktivt medlem av dette fellesskapet'
      using errcode = 'insufficient_privilege';
  end if;

  if not exists (
    select 1 from memberships
    where community_id = p_community_id
      and user_id = p_recipient_id
      and status = 'active'
  ) then
    raise exception 'Mottakeren er ikke aktivt medlem av dette fellesskapet'
      using errcode = 'insufficient_privilege';
  end if;

  v_one := least(v_sender, p_recipient_id);
  v_two := greatest(v_sender, p_recipient_id);

  select id into v_conversation_id
  from direct_conversations
  where community_id = p_community_id
    and participant_one_id = v_one
    and participant_two_id = v_two;

  if v_conversation_id is not null then
    update direct_conversation_states s
       set hidden_at = null
     where s.conversation_id = v_conversation_id
       and s.user_id = v_sender
       and s.hidden_at is not null;
    return v_conversation_id;
  end if;

  if not can_send_dm(p_community_id, p_recipient_id) then
    raise exception 'Du kan ikke starte en direkte melding med denne personen'
      using errcode = 'insufficient_privilege';
  end if;

  insert into direct_conversations (
    community_id,
    participant_one_id,
    participant_two_id,
    created_by
  )
  values (p_community_id, v_one, v_two, v_sender)
  on conflict (community_id, participant_one_id, participant_two_id)
  do update set last_message_at = direct_conversations.last_message_at
  returning id into v_conversation_id;

  return v_conversation_id;
end;
$$;

-- A cleared message can no longer be edited or deleted by the person who
-- cleared it — it is not theirs to reach any more. Otherwise identical to
-- 20261101100000.
create or replace function public.edit_direct_message(p_message_id uuid, p_body text)
returns public.direct_messages language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_message direct_messages%rowtype;
  v_old_body text;
  v_body text := btrim(coalesce(p_body, ''), E' \t\n\r');
begin
  select * into v_message from direct_messages dm where dm.id = p_message_id for update;
  if v_user is null or not found
     or not direct_message_visible_to(v_user, v_message.conversation_id, v_message.seq)
  then
    raise exception 'message_error:not_found' using errcode = 'insufficient_privilege';
  end if;
  if v_message.author_id <> v_user then
    raise exception 'message_error:not_allowed' using errcode = 'insufficient_privilege';
  end if;
  if v_message.deleted_at is not null then
    raise exception 'message_error:deleted' using errcode = 'check_violation';
  end if;
  if not can_reply_direct_conversation(v_message.conversation_id) then
    raise exception 'message_error:closed' using errcode = 'insufficient_privilege';
  end if;

  if length(v_body) > 4000 then
    raise exception 'message_error:too_long' using errcode = 'check_violation';
  end if;
  if v_body = '' and not v_message.has_attachments then
    raise exception 'message_error:empty' using errcode = 'check_violation';
  end if;
  if v_body = v_message.body then
    return v_message;
  end if;

  v_old_body := v_message.body;
  update direct_messages set body = v_body, edited_at = now()
  where id = v_message.id
  returning * into v_message;

  perform direct_message_requote_notification(
    v_message, v_old_body, case when v_body = '' then 'Vedlegg' else left(v_body, 120) end
  );
  return v_message;
end;
$$;

create or replace function public.delete_direct_message(p_message_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_message direct_messages%rowtype;
  v_old_body text;
begin
  select * into v_message from direct_messages dm where dm.id = p_message_id for update;
  if v_user is null or not found
     or not direct_message_visible_to(v_user, v_message.conversation_id, v_message.seq)
  then
    raise exception 'message_error:not_found' using errcode = 'insufficient_privilege';
  end if;
  if v_message.author_id <> v_user then
    raise exception 'message_error:not_allowed' using errcode = 'insufficient_privilege';
  end if;
  if v_message.deleted_at is not null then
    return 'author';
  end if;

  v_old_body := v_message.body;
  delete from message_attachments a where a.direct_message_id = v_message.id;
  update direct_messages
     set body = '', has_attachments = false, edited_at = null, deleted_at = now()
   where id = v_message.id
   returning * into v_message;

  perform direct_message_requote_notification(v_message, v_old_body, 'Meldingen er slettet.');
  return 'author';
end;
$$;

-- The recipient's notice follows an edit — unless the recipient has cleared
-- that message: a newer notice that happens to quote the same words must
-- not start quoting a message that is gone for them. Otherwise identical to
-- 20261101100000.
create or replace function public.direct_message_requote_notification(
  p_message direct_messages,
  p_old_body text,
  p_new_quote text
)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_conversation direct_conversations%rowtype;
  v_recipient uuid;
  v_community_name text;
  v_prefix text;
begin
  select * into v_conversation from direct_conversations dc where dc.id = p_message.conversation_id;
  if not found then
    return;
  end if;

  v_recipient := case
    when v_conversation.participant_one_id = p_message.author_id then v_conversation.participant_two_id
    else v_conversation.participant_one_id
  end;
  if exists (
    select 1 from direct_conversation_states s
    where s.conversation_id = v_conversation.id
      and s.user_id = v_recipient
      and s.cleared_through_seq >= p_message.seq
  ) then
    return;
  end if;

  select c.name into v_community_name from communities c where c.id = v_conversation.community_id;
  v_prefix := coalesce(v_community_name, 'Fellesskapet') || ' · ';

  with gone as (
    delete from notifications n
    where n.user_id = v_recipient
      and n.kind = 'direct_message'
      and n.href = '/community/' || v_conversation.community_id || '/messages/' || v_conversation.id
      and n.created_at >= p_message.created_at
      and n.body = v_prefix || case
            when btrim(p_old_body) = '' then 'Vedlegg'
            else left(btrim(p_old_body), 120)
          end
    returning n.*
  )
  insert into notifications (id, user_id, kind, community_id, title, body, created_at, read, href, post_id, event_id)
  select g.id, g.user_id, g.kind, g.community_id, g.title, v_prefix || p_new_quote, g.created_at, g.read, g.href, g.post_id, g.event_id
  from gone g;
end;
$$;

revoke all on function public.direct_message_requote_notification(direct_messages, text, text)
  from public, anon, authenticated, service_role;
