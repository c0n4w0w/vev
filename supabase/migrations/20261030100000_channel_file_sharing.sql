-- File sharing in a community's own channels and lokallag chats, and a file
-- library for every channel that has or takes files.
--
-- ── What changes ────────────────────────────────────────────────────────
--
-- Until now a community-wide channel and a lokallag's main chat took no files
-- at all: message_attachment_policy_for() answered 'unsupported' for them,
-- and every step of an upload and a send asks that function
-- (20261024100000). Now both carry `file_sharing_enabled`, off by default:
-- for a community's own channel its administrators choose it when they
-- create or edit the channel; for a lokallag's main chat its community's
-- administrators or that lokallag's own leaders choose it
-- (set_channel_file_sharing). While it is on, the channel takes files exactly as a private
-- group's chat does — the same bucket, the same rows, the same 25 MiB and
-- five files, the same server-side type and metadata handling — and while it
-- is off the answer is 'unsupported' again, at upload and at send alike.
--
-- Nothing else about attachments changes, and no new way in is added:
--
--   * the flag is read only inside message_attachment_policy_for(), which
--     begin_message_attachment() and send_channel_message_with_attachments()
--     already consult for the caller's own session. Who may write
--     (`read_only` → admins and moderators), whether the channel is archived
--     and whether the caller can read it at all are still decided there, in
--     the same order, before the flag is ever reached;
--   * switching it off refuses new uploads and sends from that moment —
--     including files already uploaded but not yet sent, which the send
--     re-check refuses and the existing sweep removes — and leaves every sent
--     file where it is, readable as before;
--   * private lokallag channels and group chats keep taking files as they
--     always have, and do not carry the flag (it is refused on them);
--   * the feed, events and direct messages are as they were.
--
-- ── The library ─────────────────────────────────────────────────────────
--
-- channel_files() lists one channel's sent attachments, searched by file
-- name, filtered by kind and uploader, sorted by date or name, a page at a
-- time with a keyset cursor. channel_file_count() and channel_file_uploaders()
-- answer whether there is anything to list and who shared it.
--
-- All three ask one question first, for the caller and now:
-- can_read_channel(p_channel_id). A channel they cannot read — never in it,
-- removed from it, no longer a member, another community's — is an empty
-- answer, the same as one that does not exist. Then they read only that
-- channel's rows with status 'sent'. That is exactly what
-- message_attachments_select admits for a sent row
-- (can_read_message_attachment: status 'sent' and can_read_channel of its
-- channel), asked once instead of once per row: SECURITY DEFINER, so that a
-- channel with thousands of files is searched and counted in milliseconds
-- rather than re-deciding the same channel's access for every file. Nothing
-- else differs from a direct table read by the same person; unsent uploads,
-- which that policy shows their own uploader, are not part of the library.
--
-- ── Signed links ────────────────────────────────────────────────────────
--
-- A member who can read a file could until now also ask Storage directly to
-- sign a link to it — with any lifetime — and the link would keep working
-- after their access ended. TING itself never signs these objects: every
-- read goes through the attachment route, decided again per request. The
-- bucket's read policy now admits an authenticated read and nothing else, so
-- Storage refuses to sign, list or describe these objects for a client. See
-- the last section.
--
-- Nothing here deletes, moves or edits an attachment. A file leaves the
-- library the way it leaves the conversation: its message, channel, author or
-- community is deleted, the row cascades, and its objects are queued in
-- message_attachment_purges.

-- ── The setting ─────────────────────────────────────────────────────────

alter table public.channels
  add column file_sharing_enabled boolean not null default false;

-- A community's own channels and lokallag main chats have the choice.
-- Private lokallag channels and group chats take files regardless.
alter table public.channels
  add constraint channels_file_sharing_scope
    check (not file_sharing_enabled or (not is_private and subgroup_id is null));

comment on column public.channels.file_sharing_enabled is
  'Community-wide channels and lokallag main chats: members who may write here may also attach files (message_attachment_policy_for). Off by default. Chosen by the community''s administrators, and for a lokallag''s main chat also by that lokallag''s leaders (set_channel_file_sharing). Switching it off refuses new files and keeps every file already sent.';

-- ── Who may attach ──────────────────────────────────────────────────────
--
-- Recreated from 20261024100000 with one change in the channel branch: a
-- community-wide channel or a lokallag's main chat with file_sharing_enabled
-- is supported. Who may read the chat (only that lokallag's members and the
-- community's administrators) is channel_access_admits, asked first as
-- before. The direct-message branch is unchanged, word for word.

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

    -- Private lokallag channels and group chats always; a community's own
    -- channel or a lokallag's main chat while file sharing is switched on
    -- (channels_file_sharing_scope keeps the flag off everything else).
    if not (
      v_channel.is_private
      or v_channel.subgroup_id is not null
      or v_channel.file_sharing_enabled
    ) then
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

revoke execute on function public.message_attachment_policy_for(uuid, text, uuid)
  from public, anon, authenticated;

-- ── Creating and editing, with file sharing ─────────────────────────────
--
-- Recreated from 20261029100000 with `p_file_sharing`. Who may call them,
-- the name rules and everything else are unchanged. The old signatures are
-- dropped so there is exactly one of each for the Data API to resolve.

drop function if exists public.create_community_channel(text, text, text, uuid, uuid, boolean);
drop function if exists public.update_community_channel(text, text, text, boolean);

create or replace function public.create_community_channel(
  p_community_id text,
  p_name text,
  p_purpose text,
  p_section_id uuid,
  p_creation_key uuid,
  p_read_only boolean,
  p_file_sharing boolean
)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_name text := btrim(coalesce(p_name, ''));
  v_purpose text := btrim(coalesce(p_purpose, ''));
  v_id text;
  v_position integer;
begin
  if v_uid is null or not is_admin(p_community_id) or p_read_only is null or p_file_sharing is null then
    return null;
  end if;
  if length(v_name) not between 1 and 40 or v_name ~ '[[:cntrl:]]' then
    return null;
  end if;
  if length(v_purpose) > 200 or v_purpose ~ '[[:cntrl:]]' then
    return null;
  end if;

  perform lock_channel_layout(p_community_id);

  if p_creation_key is not null then
    select c.id into v_id
    from channels c
    where c.community_id = p_community_id and c.creation_key = p_creation_key;
    if found then
      return case when exists (select 1 from channels c where c.id = v_id and c.created_by = v_uid) then v_id end;
    end if;
  end if;

  if p_section_id is not null and not exists (
    select 1 from channel_sections s where s.id = p_section_id and s.community_id = p_community_id
  ) then
    return null;
  end if;

  if exists (
    select 1 from channels c
    where c.community_id = p_community_id
      and c.local_group_id is null
      and c.subgroup_id is null
      and lower(c.name) = lower(v_name)
  ) then
    raise exception 'channel_name_taken' using errcode = 'unique_violation';
  end if;

  select coalesce(max(c.position) + 1, 0) into v_position
  from channels c
  where c.community_id = p_community_id
    and c.local_group_id is null
    and c.subgroup_id is null
    and c.archived_at is null
    and c.section_id is not distinct from p_section_id;

  v_id := community_channel_id(p_community_id, v_name);

  insert into channels (
    id, community_id, group_id, section_id, name, purpose, read_only,
    file_sharing_enabled, position, created_by, creation_key
  )
  values (
    v_id, p_community_id, null, p_section_id, v_name, v_purpose, p_read_only,
    p_file_sharing, v_position, v_uid, p_creation_key
  );

  perform renumber_community_channels(p_community_id, p_section_id);
  return v_id;
end;
$$;

create or replace function public.update_community_channel(
  p_channel_id text,
  p_name text,
  p_purpose text,
  p_read_only boolean,
  p_file_sharing boolean
)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  v_channel channels%rowtype;
  v_name text := btrim(coalesce(p_name, ''));
  v_purpose text := btrim(coalesce(p_purpose, ''));
begin
  if auth.uid() is null or p_read_only is null or p_file_sharing is null then
    return false;
  end if;

  select * into v_channel
  from channels c
  where c.id = p_channel_id and c.local_group_id is null and c.subgroup_id is null;
  if not found or not is_admin(v_channel.community_id) then
    return false;
  end if;

  if length(v_name) not between 1 and 40 or v_name ~ '[[:cntrl:]]' then
    return false;
  end if;
  if length(v_purpose) > 200 or v_purpose ~ '[[:cntrl:]]' then
    return false;
  end if;

  if exists (
    select 1 from channels other
    where other.community_id = v_channel.community_id
      and other.local_group_id is null
      and other.subgroup_id is null
      and other.id <> v_channel.id
      and lower(other.name) = lower(v_name)
  ) then
    raise exception 'channel_name_taken' using errcode = 'unique_violation';
  end if;

  -- Only this channel's row. Its sent files are not touched either way.
  update channels c
     set name = v_name,
         purpose = v_purpose,
         read_only = p_read_only,
         file_sharing_enabled = p_file_sharing
   where c.id = v_channel.id;
  return found;
end;
$$;

revoke all on function public.create_community_channel(text, text, text, uuid, uuid, boolean, boolean) from public, anon;
revoke all on function public.update_community_channel(text, text, text, boolean, boolean) from public, anon;
grant execute on function public.create_community_channel(text, text, text, uuid, uuid, boolean, boolean) to authenticated;
grant execute on function public.update_community_channel(text, text, text, boolean, boolean) to authenticated;

comment on function public.create_community_channel(text, text, text, uuid, uuid, boolean, boolean) is
  'Community admins only. Creates a community-wide channel, optionally in one of that community''s sections, writable by every member (p_read_only false) or by admins and moderators only (true), with or without file attachments (p_file_sharing), and returns its id; never an id a deleted channel had. The same caller repeating a creation key gets the same channel. Raises channel_name_taken. Null when the caller may not, the input is invalid or the section is not the community''s.';
comment on function public.update_community_channel(text, text, text, boolean, boolean) is
  'Community admins only. Sets name, purpose, who may write (read_only: admins and moderators only) and whether files may be attached (file_sharing_enabled) of one community-wide channel; the id and every sent file stay as they are. Raises channel_name_taken. False when the caller may not or the input is invalid.';

-- ── File sharing in a lokallag's main chat ──────────────────────────────
--
-- A lokallag's main chat has no edit dialog — its name follows the lokallag —
-- so its file sharing has a function of its own. Who: an active
-- administrator of the community, or a leader of exactly that lokallag
-- (local_group_manage_admits: an active lokallag, and the leader's own
-- membership in it). A community's own channel is also accepted here, for
-- its administrators only, so both kinds answer to the same call; private
-- channels and group chats take files regardless and are refused. Only the
-- flag changes; every sent file stays where it is.
create or replace function public.set_channel_file_sharing(p_channel_id text, p_enabled boolean)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  v_channel channels%rowtype;
begin
  if auth.uid() is null or p_enabled is null then
    return false;
  end if;

  select * into v_channel from channels c where c.id = p_channel_id;
  if not found or v_channel.is_private or v_channel.subgroup_id is not null then
    return false;
  end if;

  if not (
    is_admin(v_channel.community_id)
    or (
      v_channel.local_group_id is not null
      and local_group_manage_admits(auth.uid(), v_channel.local_group_id)
    )
  ) then
    return false;
  end if;

  if v_channel.archived_at is not null then
    return false;
  end if;

  update channels c set file_sharing_enabled = p_enabled where c.id = v_channel.id;
  return found;
end;
$$;

revoke all on function public.set_channel_file_sharing(text, boolean) from public, anon;
grant execute on function public.set_channel_file_sharing(text, boolean) to authenticated;

comment on function public.set_channel_file_sharing(text, boolean) is
  'Switches file attachments on or off in a lokallag''s main chat (its community''s administrators or that lokallag''s leaders) or a community-wide channel (its community''s administrators). Never for a private channel or group chat. Sent files are kept. False when the caller may not.';

-- ── Library indexes ─────────────────────────────────────────────────────
--
-- One channel's sent files, in the two orders the library pages through.
-- Name search is a substring match within a single channel's files, which
-- these already narrow to that channel; no trigram index is needed for it.

create index message_attachments_channel_library_date_idx
  on public.message_attachments (channel_id, attached_at, id)
  where status = 'sent' and channel_id is not null;

create index message_attachments_channel_library_name_idx
  on public.message_attachments (channel_id, (display_name collate "nb-x-icu"), id)
  where status = 'sent' and channel_id is not null;

-- ── Library: what kind a file is ────────────────────────────────────────
--
-- 'document' is what reads as a document: PDF, Word, Excel, PowerPoint, text
-- and CSV. 'image' is every image type. 'other' is the rest (audio today).

create or replace function public.message_attachment_library_kind(p_mime_type text)
returns text language sql immutable set search_path = public as $$
  select case
    when p_mime_type like 'image/%' then 'image'
    when p_mime_type in (
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'text/plain',
      'text/csv'
    ) then 'document'
    else 'other'
  end;
$$;

revoke execute on function public.message_attachment_library_kind(text) from public, anon;
grant execute on function public.message_attachment_library_kind(text) to authenticated;

-- ── Library: one page of files ──────────────────────────────────────────
--
--   p_search    part of a file name, case-insensitive; null or blank: all
--   p_kind      'document', 'image', 'other'; null: all
--   p_uploader  one uploader's files; null: everyone's
--   p_sort      'newest' (default), 'oldest', 'name_asc', 'name_desc'
--   p_after_*   the cursor: the last row of the previous page, as returned
--               in sort_key and id. Null for the first page.
--   p_limit     1–100 (default 30)
--
-- Name order is Norwegian (æ, ø, å after z) and ignores letter case.

create or replace function public.channel_files(
  p_channel_id text,
  p_search text default null,
  p_kind text default null,
  p_uploader uuid default null,
  p_sort text default 'newest',
  p_after_key text default null,
  p_after_id uuid default null,
  p_limit integer default 30
)
returns table (
  id uuid,
  community_id text,
  message_id uuid,
  uploader_id uuid,
  display_name text,
  mime_type text,
  size_bytes bigint,
  width integer,
  height integer,
  has_thumbnail boolean,
  attached_at timestamptz,
  sort_key text
)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare
  v_limit integer := least(greatest(coalesce(p_limit, 30), 1), 100);
  v_search text := nullif(btrim(left(coalesce(p_search, ''), 100)), '');
  v_pattern text;
  v_kind text := case when p_kind in ('document', 'image', 'other') then p_kind end;
  v_sort text := case when p_sort in ('oldest', 'name_asc', 'name_desc') then p_sort else 'newest' end;
  v_after_time timestamptz;
begin
  if auth.uid() is null or p_channel_id is null or not can_read_channel(p_channel_id) then
    return;
  end if;

  if v_search is not null then
    v_pattern := '%' || replace(replace(replace(v_search, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  end if;

  -- A cursor that does not belong to this sort order starts from the top.
  if p_after_id is not null and p_after_key is null then
    p_after_id := null;
  end if;
  if p_after_id is not null and v_sort in ('newest', 'oldest') then
    begin
      v_after_time := p_after_key::timestamptz;
    exception when others then
      v_after_time := null;
    end;
  end if;

  -- One plain query per order, so each walks its own index and stops at the
  -- page size instead of sorting the channel's every file.
  if v_sort = 'newest' then
    return query
    select a.id, a.community_id, a.message_id, a.uploader_id, a.display_name, a.mime_type,
           a.size_bytes, a.width, a.height, a.thumb_path is not null, a.attached_at,
           to_char(a.attached_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
    from message_attachments a
    where a.channel_id = p_channel_id
      and a.status = 'sent'
      and (v_pattern is null or a.display_name ilike v_pattern)
      and (v_kind is null or message_attachment_library_kind(a.mime_type) = v_kind)
      and (p_uploader is null or a.uploader_id = p_uploader)
      and (v_after_time is null or (a.attached_at, a.id) < (v_after_time, p_after_id))
    order by a.attached_at desc, a.id desc
    limit v_limit;
  elsif v_sort = 'oldest' then
    return query
    select a.id, a.community_id, a.message_id, a.uploader_id, a.display_name, a.mime_type,
           a.size_bytes, a.width, a.height, a.thumb_path is not null, a.attached_at,
           to_char(a.attached_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
    from message_attachments a
    where a.channel_id = p_channel_id
      and a.status = 'sent'
      and (v_pattern is null or a.display_name ilike v_pattern)
      and (v_kind is null or message_attachment_library_kind(a.mime_type) = v_kind)
      and (p_uploader is null or a.uploader_id = p_uploader)
      and (v_after_time is null or (a.attached_at, a.id) > (v_after_time, p_after_id))
    order by a.attached_at asc, a.id asc
    limit v_limit;
  elsif v_sort = 'name_asc' then
    return query
    select a.id, a.community_id, a.message_id, a.uploader_id, a.display_name, a.mime_type,
           a.size_bytes, a.width, a.height, a.thumb_path is not null, a.attached_at,
           a.display_name
    from message_attachments a
    where a.channel_id = p_channel_id
      and a.status = 'sent'
      and (v_pattern is null or a.display_name ilike v_pattern)
      and (v_kind is null or message_attachment_library_kind(a.mime_type) = v_kind)
      and (p_uploader is null or a.uploader_id = p_uploader)
      and (
        p_after_id is null
        or (a.display_name collate "nb-x-icu") > (p_after_key collate "nb-x-icu")
        or ((a.display_name collate "nb-x-icu") = (p_after_key collate "nb-x-icu") and a.id > p_after_id)
      )
    order by a.display_name collate "nb-x-icu" asc, a.id asc
    limit v_limit;
  else
    return query
    select a.id, a.community_id, a.message_id, a.uploader_id, a.display_name, a.mime_type,
           a.size_bytes, a.width, a.height, a.thumb_path is not null, a.attached_at,
           a.display_name
    from message_attachments a
    where a.channel_id = p_channel_id
      and a.status = 'sent'
      and (v_pattern is null or a.display_name ilike v_pattern)
      and (v_kind is null or message_attachment_library_kind(a.mime_type) = v_kind)
      and (p_uploader is null or a.uploader_id = p_uploader)
      and (
        p_after_id is null
        or (a.display_name collate "nb-x-icu") < (p_after_key collate "nb-x-icu")
        or ((a.display_name collate "nb-x-icu") = (p_after_key collate "nb-x-icu") and a.id < p_after_id)
      )
    order by a.display_name collate "nb-x-icu" desc, a.id desc
    limit v_limit;
  end if;
end;
$$;

revoke execute on function public.channel_files(text, text, text, uuid, text, text, uuid, integer) from public, anon;
grant execute on function public.channel_files(text, text, text, uuid, text, text, uuid, integer) to authenticated;

comment on function public.channel_files(text, text, text, uuid, text, text, uuid, integer) is
  'One page of a channel''s sent attachments for the caller: searched by file name, filtered by kind (document, image, other) and uploader, sorted newest, oldest, name_asc or name_desc, continued from the previous page''s last sort_key and id. Nothing unless can_read_channel() admits the caller now — the same rule message_attachments_select applies to a sent row.';

-- ── Library: is there anything, and who shared it ───────────────────────

create or replace function public.channel_file_count(p_channel_id text)
returns integer language sql stable security definer set search_path = public as $$
  select case
    when auth.uid() is null or p_channel_id is null or not can_read_channel(p_channel_id) then 0
    else (
      select count(*)::integer from message_attachments a
      where a.channel_id = p_channel_id and a.status = 'sent'
    )
  end;
$$;

revoke execute on function public.channel_file_count(text) from public, anon;
grant execute on function public.channel_file_count(text) to authenticated;

comment on function public.channel_file_count(text) is
  'How many sent attachments the caller can see in one channel; 0 for a channel they cannot read now (can_read_channel).';

create or replace function public.channel_file_uploaders(p_channel_id text)
returns table (uploader_id uuid, file_count integer)
language sql stable security definer set search_path = public as $$
  select a.uploader_id, count(*)::integer
  from message_attachments a
  where auth.uid() is not null
    and p_channel_id is not null
    and can_read_channel(p_channel_id)
    and a.channel_id = p_channel_id
    and a.status = 'sent'
  group by a.uploader_id;
$$;

revoke execute on function public.channel_file_uploaders(text) from public, anon;
grant execute on function public.channel_file_uploaders(text) to authenticated;

comment on function public.channel_file_uploaders(text) is
  'Who has shared files in one channel, with how many; nothing for a channel the caller cannot read now (can_read_channel).';

comment on table public.message_attachments is
  'Files sent in conversations: group chats, private lokallag channels, community channels and lokallag chats with file sharing switched on, and direct messages. Objects live in the private message-attachments bucket; rows are written only by the functions in 20261024100000 and nothing about a sent attachment can change.';

-- ── Storage: an authenticated read, and nothing else ────────────────────
--
-- Recreated from 20261024100000. Who may read an object is unchanged:
-- whoever can read its attachment row right now. What changes is which
-- Storage operation that admits. Storage names each request in the setting
-- `storage.operation` ('storage.object.get_authenticated' for the download
-- the attachment route makes; '…sign', '…sign_many', '…list', '…info_…' for
-- the rest), and this policy now admits only an authenticated download or its
-- HEAD. So a member can no longer mint a signed link — which would outlive
-- their access — nor list the bucket. A Storage server that does not name
-- its operations leaves the setting empty, and is treated exactly as before.

create or replace function public.message_attachment_storage_read_allowed()
returns boolean language sql stable set search_path = public as $$
  select regexp_replace(coalesce(current_setting('storage.operation', true), ''), '^storage\.', '')
    in ('', 'object.get_authenticated', 'object.get_authenticated_info', 'object.head_authenticated_info', 'object.info_authenticated');
$$;

revoke execute on function public.message_attachment_storage_read_allowed() from public, anon;
grant execute on function public.message_attachment_storage_read_allowed() to authenticated;

comment on function public.message_attachment_storage_read_allowed() is
  'Whether the current Storage request is an authenticated download (or its HEAD) — the only way a client may read a message attachment object. Signing, listing and other operations are refused. True when Storage does not name the operation.';

drop policy if exists message_attachments_read on storage.objects;
create policy message_attachments_read on storage.objects for select to authenticated
using (
  bucket_id = 'message-attachments'
  and message_attachment_storage_read_allowed()
  and can_read_message_attachment_object(name)
);
