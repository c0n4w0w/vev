-- Two additions to administrator-managed community channels (20261028100000):
-- who may write in a channel, and addresses that are never handed out again.
--
-- ── Who may write ───────────────────────────────────────────────────────
--
-- Nothing new is enforced here; the existing flag is exposed. `channels.
-- read_only` has meant "only the community's administrators and moderators
-- write here" since 20260906120000 (#kunngjoringer), and every write path
-- already asks it:
--
--   messages_insert                 author is the caller, the channel is
--                                   readable, and — on a read_only channel —
--                                   can_moderate(), i.e. an active admin or
--                                   moderator. A lokallagsleder's grant is not
--                                   a role and does not count.
--   message_attachment_policy_for   'read_only' for anyone but an admin or
--                                   moderator; begin_message_attachment() and
--                                   send_channel_message_with_attachments()
--                                   both ask it (community-wide channels are
--                                   'unsupported' for files altogether).
--   messages UPDATE / DELETE        no policy and no grant for any API role.
--   messages_not_archived           an archived channel takes nothing,
--                                   whatever read_only says.
--
-- So an administrator now chooses it when creating a channel and may change
-- it later, for the community's own channels only. Existing values are kept:
-- the demo #kunngjoringer channels stay restricted.
--
-- ── Addresses that were used stay used ──────────────────────────────────
--
-- A channel's id is its address. Deleting a channel used to free it, so a new
-- channel with the same name took the same URL and an old link, bookmark or
-- message mentioning it led somewhere it never pointed. Now every deleted
-- community channel leaves its id in `channel_retired_ids`, in the same
-- transaction as the deletion, and no channel can be inserted with an id
-- that is there — by any path, the service role included. A new channel with
-- the old name gets the next free address (`…-2`); the old address stays
-- "Kanalen finnes ikke". Nothing of the channel is kept but the id string:
-- its messages and attachments go exactly as before.

-- ── Retired addresses ───────────────────────────────────────────────────

create table public.channel_retired_ids (
  id text primary key,
  community_id text not null references public.communities (id) on delete cascade,
  retired_at timestamptz not null default now()
);

comment on table public.channel_retired_ids is
  'Ids (addresses) of deleted community channels. Never reused: no channel can be created with one. Holds nothing but the id. Written by delete_community_channel(); no client access.';

alter table public.channel_retired_ids enable row level security;
revoke all on public.channel_retired_ids from anon, authenticated;
grant select, insert, update, delete on public.channel_retired_ids to service_role;

create or replace function public.channels_refuse_retired_id()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from channel_retired_ids r where r.id = new.id) then
    raise exception 'channel_id_retired' using errcode = 'unique_violation';
  end if;
  return new;
end;
$$;

revoke all on function public.channels_refuse_retired_id() from public, anon, authenticated, service_role;

drop trigger if exists channels_refuse_retired_id on public.channels;
create trigger channels_refuse_retired_id
  before insert on public.channels
  for each row execute function public.channels_refuse_retired_id();

-- Recreated from 20261028100000: a retired id is as taken as a live one.
create or replace function public.community_channel_id(p_community_id text, p_name text)
returns text language plpgsql stable set search_path = public as $$
declare
  v_slug text := btrim(left(coalesce(local_group_slug(p_name), ''), 40), '-');
  v_base text;
  v_id text;
  v_n integer := 1;
begin
  if v_slug = '' then
    v_slug := 'kanal';
  end if;
  if v_slug ~ '^(lokallag|gruppe|privat)(-|$)' then
    v_slug := 'kanal-' || v_slug;
  end if;

  v_base := p_community_id || '--' || v_slug;
  v_id := v_base;
  while exists (select 1 from channels c where c.id = v_id)
     or exists (select 1 from channel_retired_ids r where r.id = v_id) loop
    v_n := v_n + 1;
    v_id := v_base || '-' || v_n;
  end loop;
  return v_id;
end;
$$;

revoke all on function public.community_channel_id(text, text) from public, anon, authenticated, service_role;

-- Recreated from 20261028100000 with one addition: the id is retired in the
-- same transaction. Everything else — who, the confirmation, what goes with
-- the channel — is unchanged.
create or replace function public.delete_community_channel(p_channel_id text, p_confirm_name text)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  v_channel channels%rowtype;
  v_href text;
  v_deleted text;
begin
  if auth.uid() is null then
    return false;
  end if;

  select * into v_channel
  from channels c
  where c.id = p_channel_id and c.local_group_id is null and c.subgroup_id is null;
  if not found or not is_admin(v_channel.community_id) then
    return false;
  end if;

  perform lock_channel_layout(v_channel.community_id);

  select * into v_channel from channels c where c.id = v_channel.id for update;
  if not found then
    return false;
  end if;

  if exists (select 1 from messages m where m.channel_id = v_channel.id)
     and btrim(coalesce(p_confirm_name, '')) is distinct from v_channel.name then
    raise exception 'channel_delete_unconfirmed' using errcode = 'check_violation';
  end if;

  v_href := '/community/' || v_channel.community_id || '/channel/' || v_channel.id;
  delete from notifications n
  where n.community_id = v_channel.community_id
    and (
      n.href = v_href
      or starts_with(n.href, v_href || '?')
      or starts_with(n.href, v_href || '#')
      or starts_with(n.href, v_href || '/')
    );

  delete from channels c
  where c.id = v_channel.id and c.local_group_id is null and c.subgroup_id is null
  returning c.id into v_deleted;

  if v_deleted is not null then
    insert into channel_retired_ids (id, community_id)
    values (v_deleted, v_channel.community_id)
    on conflict (id) do nothing;
  end if;

  perform renumber_community_channels(v_channel.community_id, v_channel.section_id);
  return v_deleted is not null;
end;
$$;

-- ── Creating, with who may write ────────────────────────────────────────
--
-- Recreated from 20261028100000 with `p_read_only`: true for "Administratorer
-- og moderatorer", false for "Alle medlemmer". Same checks otherwise.
drop function if exists public.create_community_channel(text, text, text, uuid, uuid);

create or replace function public.create_community_channel(
  p_community_id text,
  p_name text,
  p_purpose text,
  p_section_id uuid,
  p_creation_key uuid,
  p_read_only boolean
)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_name text := btrim(coalesce(p_name, ''));
  v_purpose text := btrim(coalesce(p_purpose, ''));
  v_id text;
  v_position integer;
begin
  if v_uid is null or not is_admin(p_community_id) or p_read_only is null then
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

  insert into channels (id, community_id, group_id, section_id, name, purpose, read_only, position, created_by, creation_key)
  values (v_id, p_community_id, null, p_section_id, v_name, v_purpose, p_read_only, v_position, v_uid, p_creation_key);

  perform renumber_community_channels(p_community_id, p_section_id);
  return v_id;
end;
$$;

-- ── Editing name, description and who may write, at once ────────────────
--
-- One community-wide channel, its community's admins only. The name rules
-- and name uniqueness are set_channel_details()'s; the id never changes.
-- Raises channel_name_taken; false when the caller may not or the input is
-- invalid.
create or replace function public.update_community_channel(
  p_channel_id text,
  p_name text,
  p_purpose text,
  p_read_only boolean
)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  v_channel channels%rowtype;
  v_name text := btrim(coalesce(p_name, ''));
  v_purpose text := btrim(coalesce(p_purpose, ''));
begin
  if auth.uid() is null or p_read_only is null then
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

  update channels c
     set name = v_name, purpose = v_purpose, read_only = p_read_only
   where c.id = v_channel.id;
  return found;
end;
$$;

revoke all on function public.create_community_channel(text, text, text, uuid, uuid, boolean) from public, anon;
revoke all on function public.update_community_channel(text, text, text, boolean) from public, anon;
grant execute on function public.create_community_channel(text, text, text, uuid, uuid, boolean) to authenticated;
grant execute on function public.update_community_channel(text, text, text, boolean) to authenticated;

comment on function public.create_community_channel(text, text, text, uuid, uuid, boolean) is
  'Community admins only. Creates a community-wide channel, optionally in one of that community''s sections, writable by every member (p_read_only false) or by admins and moderators only (true), and returns its id; never an id a deleted channel had. The same caller repeating a creation key gets the same channel. Raises channel_name_taken. Null when the caller may not, the input is invalid or the section is not the community''s.';
comment on function public.update_community_channel(text, text, text, boolean) is
  'Community admins only. Sets name, purpose and who may write (read_only: admins and moderators only) of one community-wide channel; the id never changes. Raises channel_name_taken. False when the caller may not or the input is invalid.';
comment on function public.delete_community_channel(text, text) is
  'Community admins only. Permanently deletes one community-wide channel with its messages, their attachments (objects queued for removal) and notifications addressed to it, and retires its id so it is never used again. A channel with messages needs its exact name as confirmation (channel_delete_unconfirmed otherwise). Never deletes another kind of channel. False when the caller may not.';
comment on column public.channels.read_only is
  'Only the community''s active administrators and moderators may write (messages_insert, message_attachment_policy_for). For a community-wide channel its administrators choose it; never set on a private channel.';
