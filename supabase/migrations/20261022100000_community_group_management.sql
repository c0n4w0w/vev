-- Creating and running private organisation-wide groups ("grupper").
--
-- 20261005100000_community_subgroups built the group model — a group, its
-- explicit members, its explicit managers, one private chat channel, and
-- `subgroup_id` as a content scope on posts and events — and created one group,
-- Safe-Space frivillige, by migration. Nothing in the product could create a
-- second one. This adds the write paths on that same model: create, edit,
-- designate managers, archive/reopen and delete. No new group tables, and the
-- private lokallag channels of 20261020100000 are a different thing and are
-- not involved: a group spans the community, whatever lokallag its members
-- are in.
--
-- ── Who reads a group ───────────────────────────────────────────────────
--
-- Still one rule, content_scope_admits(), used by channels, messages, posts,
-- comments, reactions, events, RSVPs, announcement fan-out and profile
-- visibility. For an ACTIVE member of the group's own community:
--
--   explicit member of the group      yes
--   community admin                   yes — every group of that community
--   community moderator               only where the group says so:
--                                     `community_subgroups.moderators_read`
--
-- Until now every moderator read every group. That was written for Safe-Space
-- and stays true for it: every group that exists when this migration runs
-- keeps `moderators_read = true`, so nobody gains or loses anything there.
-- A group created from now on gets `false`: a moderator reads the groups they
-- are a member of, like anybody else, and a group they were never put in does
-- not exist for them — no row, no channel, no post, no event. The flag is set
-- at creation and no API role can change it.
--
-- ── Who creates, who manages ────────────────────────────────────────────
--
--   create     an active admin or moderator of the community
--              (subgroup_create_admits). The creator becomes a member and a
--              manager of the new group.
--   manage     unchanged (subgroup_manage_admits): an active admin of the
--              group's community, or someone holding an explicit manager row.
--              Being an ordinary participant gives nothing, and neither does
--              being a moderator: a moderator manages the groups they created
--              or were made manager of.
--
-- Managing means: name and description, adding and removing members,
-- archiving and reopening, deleting. Who ELSE manages a group is the
-- community's decision: only an admin gives or takes the manager mark
-- (set_subgroup_manager), and only gives it to a member of the group who is a
-- moderator or admin of the community. A manager who is not an admin cannot
-- remove another manager from the group.
--
-- ── Management ends with what it was given for ──────────────────────────
--
--   membership deleted                manager and member rows cascade
--   membership stops being active     manager rows deleted by trigger
--   demoted to ordinary member        manager rows deleted by trigger;
--                                     being promoted again restores nothing
--   removed from the group            the manager row goes with the member row
--   admin role removed                the oversight was the role
--
-- A group therefore can lose every manager — its creator leaves — and is still
-- run by the community's admins, who need no row.
--
-- ── Archiving ───────────────────────────────────────────────────────────
--
-- `community_subgroups.active` already meant "retired": no new members, no
-- new posts or events in its scope (ensure_active_content_subgroup). It now
-- also closes the group's chat the way an archived private channel is closed:
-- the channel gets `archived_at`, and the existing restrictive policy
-- messages_not_archived refuses new messages. Who can read is untouched in
-- both directions, so archiving neither hides history from the group nor opens
-- it to anyone.
--
-- ── Permanent deletion ──────────────────────────────────────────────────
--
-- Who: whoever may manage the group. What goes, read off the schema:
--
--   community_subgroup_members    composite key → the group, ON DELETE CASCADE
--   community_subgroup_managers   composite key → the group, ON DELETE CASCADE
--   channels (the group's chat)   NO ACTION key, so deleted here first
--   messages                      messages.channel_id → channels, CASCADE
--   notifications                 no key to a channel; rows addressed to the
--                                 chat's own URL are removed here
--
-- What does NOT go: posts and events in the group's scope. Their keys to the
-- group are ON DELETE RESTRICT, and there is no honest automatic answer for
-- them — keeping them needs the group, and clearing their scope would publish
-- private content to the whole community. Their scope column is frozen
-- (posts_guard_immutable, events_guard_immutable), so "the group's posts and
-- events" is exact; what is not decided is whether deleting a group should
-- silently destroy other people's posts, comments and an event's RSVPs.
-- delete_subgroup() refuses while any exist and says so; the people who may
-- delete them do that first, or the group is archived instead. Nothing is
-- ever left without its group.
--
-- People — profiles, memberships, lokallag, roles — are never touched.

-- ── Columns ─────────────────────────────────────────────────────────────

alter table public.community_subgroups
  add column if not exists moderators_read boolean not null default false,
  add column if not exists created_by uuid references public.profiles (id) on delete set null;

-- Every group that exists today keeps the rule it was created under.
update public.community_subgroups set moderators_read = true where not moderators_read;

comment on column public.community_subgroups.moderators_read is
  'Whether the community''s moderators read this group''s content by role alone (content_scope_admits). True for groups that predate group creation in the product (Safe-Space frivillige); false for every group created through create_subgroup(). Admins always read; members always read.';
comment on column public.community_subgroups.active is
  'False while the group is archived: no new members, posts, events or chat messages; everything stays readable to the people who could already read it.';
comment on table public.community_subgroups is
  'Private organisational groups inside one community (e.g. Safe-Space frivillige). Independent of lokallag: a member can be in a lokallag and any number of groups. Created with create_subgroup(), archived with active = false, deleted with delete_subgroup() once no post or event is scoped to it.';

-- A group's chat can be archived too, not only a private lokallag channel.
alter table public.channels drop constraint if exists channels_archive_private_only;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'channels_archive_scope') then
    alter table public.channels
      add constraint channels_archive_scope
        check (archived_at is null or is_private or subgroup_id is not null);
  end if;
end $$;

comment on column public.channels.archived_at is
  'Set when a private lokallag channel is archived, or while a group''s chat belongs to an archived group: no new messages, history stays readable to those who already had access.';

-- ── The scope rule ──────────────────────────────────────────────────────
--
-- Recreated from 20261005100000. One change in each: a moderator's role opens
-- a group only where the group has `moderators_read`.

create or replace function public.content_scope_admits(
  p_user_id uuid,
  p_community_id text,
  p_local_group_id uuid,
  p_subgroup_id uuid
)
returns boolean language sql security definer stable set search_path = public as $$
  select p_user_id is not null and exists (
    select 1
    from memberships m
    where m.user_id = p_user_id
      and m.community_id = p_community_id
      and m.status = 'active'
      and (
        p_local_group_id is null
        or m.local_group_id = p_local_group_id
        or m.role = 'admin'
      )
      and (
        p_subgroup_id is null
        or m.role = 'admin'
        or (
          m.role = 'moderator'
          and exists (
            select 1 from community_subgroups s
            where s.id = p_subgroup_id
              and s.community_id = p_community_id
              and s.moderators_read
          )
        )
        or exists (
          select 1 from community_subgroup_members sm
          where sm.subgroup_id = p_subgroup_id
            and sm.community_id = p_community_id
            and sm.user_id = p_user_id
        )
      )
  );
$$;

revoke execute on function public.content_scope_admits(uuid, text, uuid, uuid) from public, anon, authenticated;

comment on function public.content_scope_admits(uuid, text, uuid, uuid) is
  'Whether a user may read content in this community/lokallag/group scope. Community-wide: active members. Lokallag: members of exactly that group, and the community''s admins. Group: its explicit members and the community''s admins, and the community''s moderators where the group has moderators_read. Internal; takes a user id.';

create or replace function public.subgroup_access_admits(p_user_id uuid, p_subgroup_id uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select p_user_id is not null and exists (
    select 1
    from community_subgroups s
    join memberships m on m.community_id = s.community_id
    where s.id = p_subgroup_id
      and m.user_id = p_user_id
      and m.status = 'active'
      and (
        m.role = 'admin'
        or (m.role = 'moderator' and s.moderators_read)
        or exists (
          select 1 from community_subgroup_members sm
          where sm.subgroup_id = s.id and sm.user_id = p_user_id
        )
      )
  );
$$;

revoke execute on function public.subgroup_access_admits(uuid, uuid) from public, anon, authenticated;

-- ── Who may create ──────────────────────────────────────────────────────

create or replace function public.subgroup_create_admits(p_user_id uuid, p_community_id text)
returns boolean language sql security definer stable set search_path = public as $$
  select p_user_id is not null and exists (
    select 1 from memberships m
    where m.user_id = p_user_id
      and m.community_id = p_community_id
      and m.status = 'active'
      and m.role in ('admin', 'moderator')
  );
$$;

revoke execute on function public.subgroup_create_admits(uuid, text) from public, anon, authenticated;

comment on function public.subgroup_create_admits(uuid, text) is
  'Whether a user may create a group in this community: an active admin or moderator of it. Internal; takes a user id.';

create or replace function public.can_create_subgroup(p_community_id text)
returns boolean language sql security definer stable set search_path = public as $$
  select subgroup_create_admits(auth.uid(), p_community_id);
$$;

revoke execute on function public.can_create_subgroup(text) from public, anon;
grant execute on function public.can_create_subgroup(text) to authenticated;

-- ── The group's chat follows the group ──────────────────────────────────
--
-- What the chat says about itself: the group's own description when it has
-- one, otherwise who can read it — worded for the rule the group has.
create or replace function public.subgroup_channel_purpose(p_description text, p_moderators_read boolean)
returns text language sql immutable set search_path = public as $$
  select case
    when btrim(coalesce(p_description, '')) <> '' then btrim(left(btrim(p_description), 200))
    when p_moderators_read then
      'Samtaler i gruppen. Bare gruppens medlemmer og fellesskapets moderatorer og administratorer kan se og skrive her.'
    else
      'Samtaler i gruppen. Bare gruppens medlemmer og fellesskapets administratorer kan se og skrive her.'
  end;
$$;

revoke execute on function public.subgroup_channel_purpose(text, boolean) from public, anon, authenticated;

-- Recreated from 20261005100000. Existing channels are returned as they are:
-- Safe-Space's chat keeps its id, name, description and messages. Only a
-- channel created from here on takes its description from the group.
create or replace function public.ensure_subgroup_channel(p_subgroup_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_subgroup community_subgroups%rowtype;
  v_id text;
begin
  select * into v_subgroup from community_subgroups s where s.id = p_subgroup_id;
  if not found then
    return null;
  end if;

  select c.id into v_id from channels c where c.subgroup_id = v_subgroup.id;
  if v_id is not null or not v_subgroup.active then
    return v_id;
  end if;

  insert into channel_groups (id, label, position)
  values ('grupper', 'Mine grupper', coalesce((select max(position) + 1 from channel_groups), 0))
  on conflict (id) do nothing;

  insert into channels (id, community_id, group_id, subgroup_id, name, purpose, read_only, position, created_by)
  values (
    v_subgroup.community_id || '--gruppe-' || v_subgroup.slug,
    v_subgroup.community_id,
    'grupper',
    v_subgroup.id,
    local_group_channel_name(v_subgroup.name),
    subgroup_channel_purpose(v_subgroup.description, v_subgroup.moderators_read),
    false,
    2000,
    v_subgroup.created_by
  )
  on conflict (subgroup_id) where subgroup_id is not null do nothing;

  select c.id into v_id from channels c where c.subgroup_id = v_subgroup.id;
  return v_id;
end;
$$;

revoke execute on function public.ensure_subgroup_channel(uuid) from public, anon, authenticated;

-- Recreated from 20261005100000, which followed the name only. The chat now
-- also follows the description, and is closed while the group is archived and
-- reopened with it.
create or replace function public.subgroup_channel_sync()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' or (new.active and not old.active) then
    perform ensure_subgroup_channel(new.id);
  end if;

  if tg_op = 'UPDATE' then
    if new.name is distinct from old.name then
      update channels c
         set name = local_group_channel_name(new.name)
       where c.subgroup_id = new.id;
    end if;

    if new.description is distinct from old.description then
      update channels c
         set purpose = subgroup_channel_purpose(new.description, new.moderators_read)
       where c.subgroup_id = new.id;
    end if;

    if new.active is distinct from old.active then
      update channels c
         set archived_at = case when new.active then null else coalesce(c.archived_at, now()) end
       where c.subgroup_id = new.id;
    end if;
  end if;

  return null;
end;
$$;

revoke execute on function public.subgroup_channel_sync() from public, anon, authenticated;

drop trigger if exists community_subgroups_channel on public.community_subgroups;
create trigger community_subgroups_channel
  after insert or update of name, description, active on public.community_subgroups
  for each row execute function public.subgroup_channel_sync();

-- A group's community, handle and read rule are facts, not settings. No API
-- role can update the table at all; this holds for every other path too.
create or replace function public.community_subgroups_guard()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.id is distinct from old.id
     or new.community_id is distinct from old.community_id
     or new.slug is distinct from old.slug then
    raise exception 'En gruppe kan ikke flyttes til et annet fellesskap eller bytte nøkkel'
      using errcode = 'check_violation';
  end if;

  if new.moderators_read is distinct from old.moderators_read
     and coalesce(auth.role(), '') in ('authenticated', 'anon') then
    raise exception 'Hvem som leser en gruppe kan ikke endres'
      using errcode = 'insufficient_privilege';
  end if;

  return new;
end;
$$;

revoke execute on function public.community_subgroups_guard() from public, anon, authenticated;

drop trigger if exists community_subgroups_guard on public.community_subgroups;
create trigger community_subgroups_guard
  before update on public.community_subgroups
  for each row execute function public.community_subgroups_guard();

-- ── Creating ────────────────────────────────────────────────────────────
--
-- Returns the new group's id, or null when the caller may not create a group
-- in this community or the name or description is not acceptable. One refusal
-- carries a reason the form can show, because the caller is authorised and it
-- is their own input: a chosen member who is not (or no longer) an active
-- member of this community. Nothing is created unless everything is.
--
-- The slug is random, so the chat's id (`<community>--gruppe-<slug>`) and URL
-- say nothing about what the group is called and survive a rename. Names are
-- deliberately not unique: refusing a taken name would tell a moderator that a
-- group they cannot see exists.
create or replace function public.create_subgroup(
  p_community_id text,
  p_name text,
  p_description text,
  p_member_ids uuid[]
)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_name text := btrim(coalesce(p_name, ''));
  v_description text := btrim(coalesce(p_description, ''));
  v_ids uuid[];
  v_id uuid;
begin
  if v_uid is null or not subgroup_create_admits(v_uid, p_community_id) then
    return null;
  end if;

  -- The chat is named after the group, and a channel name holds 40 characters.
  if length(v_name) not between 1 and 40 or v_name ~ '[[:cntrl:]]' then
    return null;
  end if;
  if length(v_description) > 200 or v_description ~ '[[:cntrl:]]' then
    return null;
  end if;

  -- The creator is added separately below; listing them changes nothing.
  v_ids := array(
    select distinct x from unnest(coalesce(p_member_ids, '{}'::uuid[])) as x
    where x is not null and x <> v_uid
  );
  if cardinality(v_ids) > 200 then
    return null;
  end if;

  if exists (
    select 1 from unnest(v_ids) as x
    where not exists (
      select 1 from memberships m
      where m.user_id = x
        and m.community_id = p_community_id
        and m.status = 'active'
    )
  ) then
    raise exception 'subgroup_member_ineligible' using errcode = 'check_violation';
  end if;

  -- The insert creates the group's chat (community_subgroups_channel).
  insert into community_subgroups (community_id, slug, name, description, moderators_read, created_by)
  values (p_community_id, replace(gen_random_uuid()::text, '-', ''), v_name, v_description, false, v_uid)
  returning id into v_id;

  insert into community_subgroup_members (subgroup_id, community_id, user_id, added_by)
  select v_id, p_community_id, x, v_uid
  from unnest(array_append(v_ids, v_uid)) as x;

  insert into community_subgroup_managers (subgroup_id, community_id, user_id)
  values (v_id, p_community_id, v_uid);

  return v_id;
end;
$$;

revoke execute on function public.create_subgroup(text, text, text, uuid[]) from public, anon;
grant execute on function public.create_subgroup(text, text, text, uuid[]) to authenticated;

comment on function public.create_subgroup(text, text, text, uuid[]) is
  'Creates a private group in a community with the given members and returns its id. Active admins and moderators of that community. The creator becomes a member and a manager; every chosen member must be an active member of the same community. The group''s chat is created with it. Null when the caller may not, or the name/description is invalid.';

-- Choosing members for a group about to be created. Deliberately as narrow as
-- search_subgroup_candidates(): only someone who may create a group in this
-- community is answered, a person appears only as their display name here,
-- and nobody is handed the community roster — at least two characters, at
-- most ten matches. The caller is added by the create itself, so not offered.
create or replace function public.search_new_subgroup_candidates(p_community_id text, p_query text)
returns table (user_id uuid, display_name text)
language sql stable security definer set search_path = public as $$
  with q as (
    select btrim(coalesce(p_query, '')) as term
  )
  select m.user_id, cp.display_name
  from q,
       memberships m
  join community_profiles cp on cp.community_id = m.community_id and cp.user_id = m.user_id
  where m.community_id = p_community_id
    and m.status = 'active'
    and m.user_id <> auth.uid()
    and length(q.term) between 2 and 80
    and subgroup_create_admits(auth.uid(), p_community_id)
    and cp.display_name ilike
      '%' || replace(replace(replace(q.term, '\', '\\'), '%', '\%'), '_', '\_') || '%'
  order by lower(cp.display_name)
  limit 10;
$$;

revoke execute on function public.search_new_subgroup_candidates(text, text) from public, anon;
grant execute on function public.search_new_subgroup_candidates(text, text) to authenticated;

-- ── Name and description ────────────────────────────────────────────────
--
-- The chat is renamed and re-described by the trigger; its id, and so its URL
-- and every message, stay.
create or replace function public.set_subgroup_details(p_subgroup_id uuid, p_name text, p_description text)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  v_name text := btrim(coalesce(p_name, ''));
  v_description text := btrim(coalesce(p_description, ''));
  v_changed uuid;
begin
  if auth.uid() is null or not subgroup_manage_admits(auth.uid(), p_subgroup_id) then
    return false;
  end if;

  if length(v_name) not between 1 and 40 or v_name ~ '[[:cntrl:]]' then
    return false;
  end if;
  if length(v_description) > 200 or v_description ~ '[[:cntrl:]]' then
    return false;
  end if;

  update community_subgroups s
     set name = v_name, description = v_description
   where s.id = p_subgroup_id
  returning s.id into v_changed;

  return v_changed is not null;
end;
$$;

-- ── Archiving ───────────────────────────────────────────────────────────

create or replace function public.set_subgroup_archived(p_subgroup_id uuid, p_archived boolean)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  v_changed uuid;
begin
  if auth.uid() is null
     or p_archived is null
     or not subgroup_manage_admits(auth.uid(), p_subgroup_id) then
    return false;
  end if;

  update community_subgroups s
     set active = not p_archived
   where s.id = p_subgroup_id
  returning s.id into v_changed;

  return v_changed is not null;
end;
$$;

-- ── The manager mark ────────────────────────────────────────────────────
--
-- Admins only. Given to a member of the group who is a moderator or admin of
-- its community; taking it away needs nothing.
create or replace function public.set_subgroup_manager(
  p_subgroup_id uuid,
  p_user_id uuid,
  p_is_manager boolean
)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  v_community text;
  v_changed uuid;
begin
  if auth.uid() is null or p_user_id is null or p_is_manager is null then
    return false;
  end if;

  select s.community_id into v_community from community_subgroups s where s.id = p_subgroup_id;
  if v_community is null or not is_admin(v_community) then
    return false;
  end if;

  if not p_is_manager then
    delete from community_subgroup_managers mg
     where mg.subgroup_id = p_subgroup_id and mg.user_id = p_user_id
    returning mg.user_id into v_changed;
    return v_changed is not null;
  end if;

  if not exists (
    select 1 from memberships m
    where m.user_id = p_user_id
      and m.community_id = v_community
      and m.status = 'active'
      and m.role in ('admin', 'moderator')
  ) or not exists (
    select 1 from community_subgroup_members sm
    where sm.subgroup_id = p_subgroup_id and sm.user_id = p_user_id
  ) then
    return false;
  end if;

  insert into community_subgroup_managers (subgroup_id, community_id, user_id)
  values (p_subgroup_id, v_community, p_user_id)
  on conflict (subgroup_id, user_id) do nothing
  returning user_id into v_changed;

  return v_changed is not null;
end;
$$;

-- Recreated from 20261005100000 with two additions. A manager who is not an
-- admin cannot remove another manager — that would be taking the manager mark
-- by another name. And the manager row leaves with the member row, so someone
-- removed from a group cannot put themselves back.
create or replace function public.remove_subgroup_member(p_subgroup_id uuid, p_user_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  v_community text;
  v_removed uuid;
begin
  if not can_manage_subgroup(p_subgroup_id) then
    return false;
  end if;

  select s.community_id into v_community from community_subgroups s where s.id = p_subgroup_id;

  if p_user_id is distinct from auth.uid()
     and not is_admin(v_community)
     and exists (
       select 1 from community_subgroup_managers mg
       where mg.subgroup_id = p_subgroup_id and mg.user_id = p_user_id
     ) then
    return false;
  end if;

  delete from community_subgroup_members sm
   where sm.subgroup_id = p_subgroup_id and sm.user_id = p_user_id
  returning sm.user_id into v_removed;

  if v_removed is not null then
    delete from community_subgroup_managers mg
     where mg.subgroup_id = p_subgroup_id and mg.user_id = p_user_id;
  end if;

  return v_removed is not null;
end;
$$;

-- A manager grant ends when the membership it rests on stops being active, or
-- its holder becomes an ordinary member. Only that person's grants, only in
-- that community. Group membership itself is a separate fact and stays.
create or replace function public.subgroup_managers_follow_membership()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (new.role = 'member' and old.role <> 'member')
     or (new.status <> 'active' and old.status = 'active') then
    delete from community_subgroup_managers mg
     where mg.user_id = new.user_id
       and mg.community_id = new.community_id;
  end if;
  return null;
end;
$$;

revoke execute on function public.subgroup_managers_follow_membership() from public, anon, authenticated;

drop trigger if exists memberships_subgroup_managers on public.memberships;
create trigger memberships_subgroup_managers
  after update of role, status on public.memberships
  for each row execute function public.subgroup_managers_follow_membership();

-- ── Deleting ────────────────────────────────────────────────────────────

-- How much post and event content is scoped to a group — what stands between
-- it and deletion. For its managers only; no row for anyone else.
create or replace function public.subgroup_content_counts(p_subgroup_id uuid)
returns table (post_count integer, event_count integer)
language sql stable security definer set search_path = public as $$
  select
    (select count(*)::integer from posts p where p.subgroup_id = p_subgroup_id),
    (select count(*)::integer from events e where e.subgroup_id = p_subgroup_id)
  where subgroup_manage_admits(auth.uid(), p_subgroup_id);
$$;

-- One call is one transaction: either the group, its chat, the chat's
-- messages and every member and manager row are gone, or nothing is. There is
-- no undelete.
create or replace function public.delete_subgroup(p_subgroup_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  v_subgroup community_subgroups%rowtype;
  v_channel record;
  v_href text;
  v_deleted uuid;
begin
  if auth.uid() is null or not subgroup_manage_admits(auth.uid(), p_subgroup_id) then
    return false;
  end if;

  -- Locked, so an archive, a rename or a second delete arriving at the same
  -- moment waits for this one.
  select * into v_subgroup from community_subgroups s where s.id = p_subgroup_id for update;
  if not found then
    return false;
  end if;

  if exists (select 1 from posts p where p.subgroup_id = v_subgroup.id)
     or exists (select 1 from events e where e.subgroup_id = v_subgroup.id) then
    raise exception 'subgroup_has_content' using errcode = 'restrict_violation';
  end if;

  for v_channel in select c.id from channels c where c.subgroup_id = v_subgroup.id loop
    v_href := '/community/' || v_subgroup.community_id || '/channel/' || v_channel.id;
    delete from notifications n
    where n.community_id = v_subgroup.community_id
      and (
        n.href = v_href
        or starts_with(n.href, v_href || '?')
        or starts_with(n.href, v_href || '#')
        or starts_with(n.href, v_href || '/')
      );
  end loop;

  -- Messages follow by their ON DELETE CASCADE key.
  delete from channels c where c.subgroup_id = v_subgroup.id;

  -- Member and manager rows follow by theirs. A post or event that arrived
  -- since the check above stops this with its RESTRICT key, and with it the
  -- whole call.
  delete from community_subgroups s where s.id = v_subgroup.id returning s.id into v_deleted;

  return v_deleted is not null;
end;
$$;

revoke execute on function public.set_subgroup_details(uuid, text, text) from public, anon;
revoke execute on function public.set_subgroup_archived(uuid, boolean) from public, anon;
revoke execute on function public.set_subgroup_manager(uuid, uuid, boolean) from public, anon;
revoke execute on function public.remove_subgroup_member(uuid, uuid) from public, anon;
revoke execute on function public.subgroup_content_counts(uuid) from public, anon;
revoke execute on function public.delete_subgroup(uuid) from public, anon;
grant execute on function public.set_subgroup_details(uuid, text, text) to authenticated;
grant execute on function public.set_subgroup_archived(uuid, boolean) to authenticated;
grant execute on function public.set_subgroup_manager(uuid, uuid, boolean) to authenticated;
grant execute on function public.remove_subgroup_member(uuid, uuid) to authenticated;
grant execute on function public.subgroup_content_counts(uuid) to authenticated;
grant execute on function public.delete_subgroup(uuid) to authenticated;

comment on function public.set_subgroup_details(uuid, text, text) is
  'Group managers only (community admin, or an explicit manager). Sets the name and description; the group''s chat follows. False when the caller may not or the input is invalid.';
comment on function public.set_subgroup_archived(uuid, boolean) is
  'Group managers only. Archives (no new members, posts, events or messages; history kept) or reopens a group.';
comment on function public.set_subgroup_manager(uuid, uuid, boolean) is
  'Community admins only. Gives or takes the manager mark; it can only be given to a member of the group who is an active moderator or admin of its community.';
comment on function public.remove_subgroup_member(uuid, uuid) is
  'Group managers only. Removes a member, and their manager mark with it; effective on the next request. A manager who is not an admin cannot remove another manager. Returns whether a member was removed.';
comment on function public.delete_subgroup(uuid) is
  'Group managers only. Permanently deletes a group, active or archived, with its chat, the chat''s messages, member and manager rows and any notifications addressed to the chat. Raises subgroup_has_content while a post or event is scoped to the group. False when the caller may not or the group does not exist.';
