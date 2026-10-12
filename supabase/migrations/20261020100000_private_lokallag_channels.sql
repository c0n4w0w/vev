-- Private, invitation-only channels inside a lokallag.
--
-- A lokallag already has one chat that every member of the lokallag reads
-- (20261001100000, widened for admins in 20261005100000). This adds further
-- channels under the same lokallag that only the people chosen for them — and
-- the community's administrators — can see: planning, an event team, a board.
--
-- ── Where they live ─────────────────────────────────────────────────────
--
-- In `channels`, like every other community conversation, so messages, the
-- composer, emoji and the channel route are the ones that already exist. A
-- private channel is a `channels` row with
--
--   is_private       true
--   local_group_id   its parent lokallag — set, never null
--   community_id     the lokallag's community (the existing composite foreign
--                    key channels_local_group_fkey makes that structural)
--   group_id         'lokallag' (channels_local_group_section already ties the
--                    two together), so it is filed under the lokallag heading
--
-- Keeping the parent in `local_group_id` rather than a new column is the
-- conservative choice: every older rule that reads a channel's scope sees a
-- lokallag channel, never a community-wide one, so anything that were to miss
-- the new rule below would still be closed to the rest of the community.
--
-- Who is in a private channel is explicit: `channel_participants`, one row per
-- (channel, person). The row carries the channel's community and lokallag and
-- is tied to both the channel and the person's membership by composite foreign
-- keys, so a participant can only ever be a member of that same community.
--
-- ── The access rule ─────────────────────────────────────────────────────
--
-- Written once, in private_channel_access_admits(), and checked on every
-- query. For an ACTIVE member of the channel's own community:
--
--   community admin              every private channel of that community
--   anyone else                  only with a participant row AND a membership
--                                that is in exactly the channel's lokallag
--
-- Moderators get nothing from their role. Leading the lokallag gives nothing
-- by itself either: a lokallagsleder reads the private channels they are a
-- participant of, like anybody else. Nothing reaches across communities — the
-- admin override comes from the caller's membership row in the channel's own
-- community.
--
-- channel_access_admits() chooses between this rule and the existing
-- content_scope_admits() by the channel's `is_private`, and is what every
-- path uses:
--
--   channels_select              the sidebar, Overview, home, the direct
--                                channel route, raw PostgREST
--   can_read_channel()           messages_select, messages_insert and the
--                                restrictive messages_channel_access follow
--                                unchanged — so do realtime subscriptions,
--                                which are authorised by messages_select
--   can_view_community_profile(), shares_visible_authorship()
--                                "has written a message the caller can read"
--
-- For a channel that is not private it returns exactly what
-- content_scope_admits() returned before, so community-wide channels, the main
-- lokallag chats and team (Safe-Space) channels are untouched.
--
-- ── Who may create and manage ───────────────────────────────────────────
--
--   create      an active admin of the lokallag's community, under any of its
--               active lokallag; an effective lokallagsleder
--               (local_group_manage_admits), under their own lokallag only
--   manage      an active admin of the channel's community; or a participant
--               marked `is_manager` who is, right now, an effective
--               lokallagsleder of the channel's lokallag
--
-- The creator becomes a participant when they belong to the lokallag (an
-- admin creating for another lokallag does not, and needs no row: their
-- access is the admin rule). A lokallagsleder who creates a channel is its
-- manager. Only admins hand the manager mark to someone else, and only to a
-- participant who is an effective lokallagsleder of that lokallag.
--
-- Managing means: rename, describe, add and remove participants, see the
-- participant list, archive and reopen. Ordinary participants read and write.
--
-- ── Access ends with the situation it was given for ─────────────────────
--
-- Checked live, and cleaned up as well, the same way lokallagsleder grants
-- are (20261010100000):
--
--   * removed from the channel         row deleted; gone on the next request
--   * membership leaves the lokallag   moves, clears it, or stops being
--     or stops being active            active: rows deleted by trigger, so
--                                      moving back restores nothing
--   * membership deleted               rows cascade
--   * lokallagsleder grant removed     `is_manager` cleared by trigger; the
--                                      person stays an ordinary participant.
--                                      Being re-appointed restores nothing.
--   * admin role removed               the override was the role; whatever
--                                      participant row they have still counts
--
-- ── Archiving ───────────────────────────────────────────────────────────
--
-- The same promise as collaboration channels: an archived channel takes no new
-- messages and keeps its history for the people who could already read it.
-- Nothing here deletes a channel or a message.

-- ── Columns and invariants ──────────────────────────────────────────────

alter table public.channels
  add column if not exists is_private boolean not null default false,
  add column if not exists created_by uuid references public.profiles (id) on delete set null,
  add column if not exists archived_at timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'channels_private_scope') then
    alter table public.channels
      -- A private channel always has a parent lokallag, is never a team
      -- channel, and is never an announcements-only channel.
      add constraint channels_private_scope
        check (not is_private or (local_group_id is not null and subgroup_id is null and not read_only)),
      add constraint channels_archive_private_only
        check (archived_at is null or is_private),
      -- Lets a participant row reference (channel, community, lokallag) as one
      -- key, so "this participant row belongs to this channel's community and
      -- lokallag" is structural.
      add constraint channels_id_scope_key unique (id, community_id, local_group_id);
  end if;
end $$;

-- "Exactly one channel per group" becomes "exactly one MAIN channel per
-- group". Same index name; ensure_local_group_channel() below names the new
-- predicate in its ON CONFLICT.
drop index if exists public.channels_local_group_key;
create unique index channels_local_group_key
  on public.channels (local_group_id) where local_group_id is not null and not is_private;

-- Two private channels of one lokallag cannot share a name.
create unique index if not exists channels_private_name_key
  on public.channels (local_group_id, lower(name)) where is_private;

comment on column public.channels.is_private is
  'True for an invitation-only channel under a lokallag: readable by its explicit participants who are still members of that lokallag, and by the community''s admins (private_channel_access_admits). Never changes after creation.';
comment on column public.channels.local_group_id is
  'The lokallag a channel belongs to. For the main lokallag chat (is_private false): readable by members of exactly that local group and the community''s admins; one per group, name follows the group. For a private channel (is_private true): the parent lokallag, with access limited to channel_participants and admins. Null means a community-wide (or subgroup) channel.';
comment on column public.channels.archived_at is
  'Set when a private channel is archived: no new messages, history stays readable to those who already had access.';

-- ── Participants ────────────────────────────────────────────────────────

create table if not exists public.channel_participants (
  channel_id text not null,
  community_id text not null,
  local_group_id uuid not null,
  user_id uuid not null,
  is_manager boolean not null default false,
  added_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),

  primary key (channel_id, user_id),
  foreign key (channel_id, community_id, local_group_id)
    references public.channels (id, community_id, local_group_id) on delete cascade,
  foreign key (user_id, community_id)
    references public.memberships (user_id, community_id) on delete cascade
);

create index if not exists channel_participants_user_idx
  on public.channel_participants (user_id, community_id);

comment on table public.channel_participants is
  'Explicit participants of a private lokallag channel. Counts only while the person is an active member of exactly that lokallag; rows are deleted when that stops being true. is_manager counts only while the person is an effective lokallagsleder of that lokallag. Community admins need no row.';

alter table public.channel_participants enable row level security;

-- Every write goes through the functions below.
revoke all on public.channel_participants from anon;
revoke insert, update, delete, truncate on public.channel_participants from authenticated;

-- ── The access rule ─────────────────────────────────────────────────────
--
-- Internal: these take a user id, so they are never granted to an API role.
-- Policies reach them through the caller-bound wrappers further down.

create or replace function public.private_channel_access_admits(
  p_user_id uuid,
  p_community_id text,
  p_local_group_id uuid,
  p_channel_id text
)
returns boolean language sql security definer stable set search_path = public as $$
  select p_user_id is not null
    and p_local_group_id is not null
    and exists (
      select 1
      from memberships m
      where m.user_id = p_user_id
        and m.community_id = p_community_id
        and m.status = 'active'
        and (
          m.role = 'admin'
          or (
            m.local_group_id = p_local_group_id
            and exists (
              select 1 from channel_participants cp
              where cp.channel_id = p_channel_id
                and cp.user_id = p_user_id
                and cp.community_id = p_community_id
                and cp.local_group_id = p_local_group_id
            )
          )
        )
    );
$$;

revoke execute on function public.private_channel_access_admits(uuid, text, uuid, text) from public, anon, authenticated;

comment on function public.private_channel_access_admits(uuid, text, uuid, text) is
  'Whether a user may read/write a private lokallag channel: an active admin of its community, or an active member of exactly its lokallag who has a participant row. No moderator or lokallagsleder override. Internal; takes a user id.';

-- A null `is_private` is treated as private: an unknown answer is the closed one.
create or replace function public.channel_access_admits(
  p_user_id uuid,
  p_community_id text,
  p_local_group_id uuid,
  p_subgroup_id uuid,
  p_channel_id text,
  p_is_private boolean
)
returns boolean language sql security definer stable set search_path = public as $$
  select case
    when coalesce(p_is_private, true)
      then private_channel_access_admits(p_user_id, p_community_id, p_local_group_id, p_channel_id)
    else content_scope_admits(p_user_id, p_community_id, p_local_group_id, p_subgroup_id)
  end;
$$;

revoke execute on function public.channel_access_admits(uuid, text, uuid, uuid, text, boolean) from public, anon, authenticated;

comment on function public.channel_access_admits(uuid, text, uuid, uuid, text, boolean) is
  'The one channel access rule: private_channel_access_admits() for a private channel, content_scope_admits() for every other channel (unchanged). Internal; takes a user id.';

-- What channels_select calls, with the row's own columns — so it also answers
-- correctly for a row the statement itself has just written.
create or replace function public.can_access_channel_row(
  p_community_id text,
  p_local_group_id uuid,
  p_subgroup_id uuid,
  p_channel_id text,
  p_is_private boolean
)
returns boolean language sql security definer stable set search_path = public as $$
  select channel_access_admits(auth.uid(), p_community_id, p_local_group_id, p_subgroup_id, p_channel_id, p_is_private);
$$;

revoke execute on function public.can_access_channel_row(text, uuid, uuid, text, boolean) from public, anon;
grant execute on function public.can_access_channel_row(text, uuid, uuid, text, boolean) to authenticated;

-- Same signature as before: messages_select, messages_insert and the
-- restrictive messages_channel_access policy follow without being recreated.
create or replace function public.can_read_channel(chid text)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1
    from channels c
    where c.id = chid
      and channel_access_admits(auth.uid(), c.community_id, c.local_group_id, c.subgroup_id, c.id, c.is_private)
  );
$$;

revoke execute on function public.can_read_channel(text) from public, anon;
grant execute on function public.can_read_channel(text) to authenticated;

drop policy if exists channels_select on public.channels;
create policy channels_select on public.channels for select to authenticated
using (can_access_channel_row(community_id, local_group_id, subgroup_id, id, is_private));

comment on policy channels_select on public.channels is
  'channel_access_admits(): the content scope rule for ordinary channels, explicit participants and admins for private lokallag channels. A channel the caller cannot read does not exist for them: no name, purpose or id.';

-- ── Who may create, who may manage ──────────────────────────────────────

create or replace function public.private_channel_create_admits(p_user_id uuid, p_local_group_id uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select p_user_id is not null and exists (
    select 1
    from community_local_groups lg
    join memberships m
      on m.community_id = lg.community_id and m.user_id = p_user_id and m.status = 'active'
    where lg.id = p_local_group_id
      and lg.active
      and (m.role = 'admin' or local_group_manage_admits(p_user_id, lg.id))
  );
$$;

create or replace function public.private_channel_manage_admits(p_user_id uuid, p_channel_id text)
returns boolean language sql security definer stable set search_path = public as $$
  select p_user_id is not null and exists (
    select 1
    from channels c
    join memberships m
      on m.community_id = c.community_id and m.user_id = p_user_id and m.status = 'active'
    where c.id = p_channel_id
      and c.is_private
      and (
        m.role = 'admin'
        or (
          local_group_manage_admits(p_user_id, c.local_group_id)
          and exists (
            select 1 from channel_participants cp
            where cp.channel_id = c.id and cp.user_id = p_user_id and cp.is_manager
          )
        )
      )
  );
$$;

revoke execute on function public.private_channel_create_admits(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.private_channel_manage_admits(uuid, text) from public, anon, authenticated;

comment on function public.private_channel_create_admits(uuid, uuid) is
  'Whether a user may create a private channel under this lokallag: an active admin of its community, or an effective lokallagsleder of exactly this lokallag. The lokallag must be active. Internal; takes a user id.';
comment on function public.private_channel_manage_admits(uuid, text) is
  'Whether a user may rename, archive and change the participants of this private channel: an active admin of its community, or a participant marked is_manager who is currently an effective lokallagsleder of its lokallag. Internal; takes a user id.';

create or replace function public.can_create_private_channel(p_local_group_id uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select private_channel_create_admits(auth.uid(), p_local_group_id);
$$;

create or replace function public.can_manage_private_channel(p_channel_id text)
returns boolean language sql security definer stable set search_path = public as $$
  select private_channel_manage_admits(auth.uid(), p_channel_id);
$$;

revoke execute on function public.can_create_private_channel(uuid) from public, anon;
revoke execute on function public.can_manage_private_channel(text) from public, anon;
grant execute on function public.can_create_private_channel(uuid) to authenticated;
grant execute on function public.can_manage_private_channel(text) to authenticated;

-- ── Participants: reading ───────────────────────────────────────────────
--
-- The participant list names people, so it is visible to the channel's
-- managers only. Each person sees their own row, and only while they can
-- still read the channel.
drop policy if exists channel_participants_select on public.channel_participants;
create policy channel_participants_select on public.channel_participants
  for select to authenticated
  using (
    can_manage_private_channel(channel_id)
    or (user_id = auth.uid() and can_read_channel(channel_id))
  );

-- ── Structural guards ───────────────────────────────────────────────────
--
-- A private channel's identity and parents are facts, not settings. There is
-- no UPDATE policy on channels, so no API role could change them anyway; this
-- holds for every path, the service role and future functions included. An
-- ordinary channel cannot be turned into a private one either.
create or replace function public.channels_guard_private()
returns trigger language plpgsql set search_path = public as $$
begin
  if (old.is_private or new.is_private)
     and (new.id is distinct from old.id
       or new.community_id is distinct from old.community_id
       or new.local_group_id is distinct from old.local_group_id
       or new.subgroup_id is distinct from old.subgroup_id
       or new.group_id is distinct from old.group_id
       or new.is_private is distinct from old.is_private) then
    raise exception 'En privat kanal kan ikke flyttes til et annet fellesskap eller lokallag'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

revoke execute on function public.channels_guard_private() from public, anon, authenticated;

drop trigger if exists channels_guard_private on public.channels;
create trigger channels_guard_private
  before update on public.channels
  for each row execute function public.channels_guard_private();

-- A participant row can only exist for a private channel, for an active member
-- of exactly that channel's lokallag, and never changes who or what it is
-- about. The manager mark needs an effective lokallagsleder at the moment it
-- is given.
create or replace function public.channel_participants_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE'
     and (new.channel_id is distinct from old.channel_id
       or new.community_id is distinct from old.community_id
       or new.local_group_id is distinct from old.local_group_id
       or new.user_id is distinct from old.user_id) then
    raise exception 'En kanaldeltakelse kan ikke flyttes'
      using errcode = 'check_violation';
  end if;

  if tg_op = 'INSERT' then
    if not exists (
      select 1 from channels c
      where c.id = new.channel_id
        and c.is_private
        and c.community_id = new.community_id
        and c.local_group_id = new.local_group_id
    ) then
      raise exception 'Deltakere kan bare legges til i private lokallagskanaler'
        using errcode = 'check_violation';
    end if;

    if not exists (
      select 1 from memberships m
      where m.user_id = new.user_id
        and m.community_id = new.community_id
        and m.status = 'active'
        and m.local_group_id = new.local_group_id
    ) then
      raise exception 'Deltakeren må være aktivt medlem av kanalens lokallag'
        using errcode = 'check_violation';
    end if;
  end if;

  if new.is_manager
     and (tg_op = 'INSERT' or not old.is_manager)
     and not local_group_manage_admits(new.user_id, new.local_group_id) then
    raise exception 'Bare en lokallagsleder for dette lokallaget kan være kanalansvarlig'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

revoke execute on function public.channel_participants_guard() from public, anon, authenticated;

drop trigger if exists channel_participants_guard on public.channel_participants;
create trigger channel_participants_guard
  before insert or update on public.channel_participants
  for each row execute function public.channel_participants_guard();

-- ── Access ends with the situation it was given for ─────────────────────
--
-- A membership that moves to another lokallag, clears its lokallag or stops
-- being active loses every participant row it no longer fits — only that
-- person's, only in that community. Role changes do not touch participation.
create or replace function public.channel_participants_follow_membership()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status is distinct from old.status
     or new.local_group_id is distinct from old.local_group_id then
    delete from channel_participants cp
    where cp.user_id = new.user_id
      and cp.community_id = new.community_id
      and (
        new.status <> 'active'
        or new.local_group_id is null
        or cp.local_group_id <> new.local_group_id
      );
  end if;
  return null;
end;
$$;

revoke execute on function public.channel_participants_follow_membership() from public, anon, authenticated;

drop trigger if exists memberships_channel_participants on public.memberships;
create trigger memberships_channel_participants
  after update of status, local_group_id on public.memberships
  for each row execute function public.channel_participants_follow_membership();

-- A lokallagsleder grant that ends — removed by an admin, or deleted because
-- the leader left the lokallag or the lokallag was retired — takes the manager
-- mark with it. Participation itself is a separate fact and stays.
create or replace function public.channel_managers_follow_leadership()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update channel_participants cp
     set is_manager = false
   where cp.user_id = old.user_id
     and cp.local_group_id = old.local_group_id
     and cp.is_manager;
  return null;
end;
$$;

revoke execute on function public.channel_managers_follow_leadership() from public, anon, authenticated;

drop trigger if exists community_local_group_managers_channels on public.community_local_group_managers;
create trigger community_local_group_managers_channels
  after delete on public.community_local_group_managers
  for each row execute function public.channel_managers_follow_leadership();

-- ── Messages ────────────────────────────────────────────────────────────
--
-- messages_select, messages_insert and messages_channel_access are unchanged
-- and already require can_read_channel(). One addition: an archived channel
-- takes no new messages. Restrictive, so it is ANDed with every existing rule
-- and cannot open anything. For a channel the caller cannot read it answers
-- "accepts" — the other policies refuse that write, and this one must not be
-- usable to learn that an archived channel exists.
create or replace function public.channel_accepts_messages(chid text)
returns boolean language sql security definer stable set search_path = public as $$
  select not exists (
    select 1 from channels c
    where c.id = chid
      and c.archived_at is not null
      and channel_access_admits(auth.uid(), c.community_id, c.local_group_id, c.subgroup_id, c.id, c.is_private)
  );
$$;

revoke execute on function public.channel_accepts_messages(text) from public, anon;
grant execute on function public.channel_accepts_messages(text) to authenticated;

drop policy if exists messages_not_archived on public.messages;
create policy messages_not_archived on public.messages
  as restrictive for insert to authenticated
  with check (channel_accepts_messages(channel_id));

-- ── The main lokallag channel stays the only one that follows the group ──
--
-- Recreated from 20261005100000 with one change each: "the lokallag's channel"
-- now means its main, non-private channel. Without this a rename of the
-- lokallag would rename every private channel under it, and the idempotent
-- lookup could return a private channel's id.
create or replace function public.ensure_local_group_channel(p_local_group_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_group community_local_groups%rowtype;
  v_id text;
begin
  select * into v_group from community_local_groups g where g.id = p_local_group_id;
  if not found then
    return null;
  end if;

  select c.id into v_id from channels c where c.local_group_id = v_group.id and not c.is_private;
  if v_id is not null or not v_group.active then
    return v_id;
  end if;

  insert into channel_groups (id, label, position)
  values ('lokallag', 'Mitt lokallag', coalesce((select max(position) + 1 from channel_groups), 0))
  on conflict (id) do nothing;

  insert into channels (id, community_id, group_id, local_group_id, name, purpose, read_only, position)
  values (
    v_group.community_id || '--lokallag-' || v_group.slug,
    v_group.community_id,
    'lokallag',
    v_group.id,
    local_group_channel_name(v_group.name),
    'Samtaler i lokallaget. Bare medlemmer av lokallaget og fellesskapets administratorer kan se og skrive her.',
    false,
    1000 + v_group.sort_order
  )
  on conflict (local_group_id) where local_group_id is not null and not is_private do nothing;

  select c.id into v_id from channels c where c.local_group_id = v_group.id and not c.is_private;
  return v_id;
end;
$$;

revoke execute on function public.ensure_local_group_channel(uuid) from public, anon, authenticated;

create or replace function public.local_group_channel_sync()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' or (new.active and not old.active) then
    perform ensure_local_group_channel(new.id);
  end if;

  if tg_op = 'UPDATE' and new.name is distinct from old.name then
    update channels c
       set name = local_group_channel_name(new.name)
     where c.local_group_id = new.id
       and not c.is_private;
  end if;

  return null;
end;
$$;

revoke execute on function public.local_group_channel_sync() from public, anon, authenticated;

-- ── Creating ────────────────────────────────────────────────────────────
--
-- Returns the new channel's id, or null when the caller may not create one
-- here or the name or description is not acceptable. Two refusals carry a
-- reason the form can show, because the caller is authorised and it is their
-- own input: a name already used in this lokallag, and a chosen participant
-- who is not (or no longer) an active member of it. Nothing is created unless
-- everything is.
--
-- The id is `<community>--privat-<random>`: not derived from the name, so a
-- rename keeps the URL, and neither the URL nor a guess says what a channel
-- is called.
create or replace function public.create_private_channel(
  p_local_group_id uuid,
  p_name text,
  p_purpose text,
  p_participant_ids uuid[]
)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_group community_local_groups%rowtype;
  v_name text := btrim(coalesce(p_name, ''));
  v_purpose text := btrim(coalesce(p_purpose, ''));
  v_ids uuid[];
  v_id text;
begin
  if v_uid is null or not private_channel_create_admits(v_uid, p_local_group_id) then
    return null;
  end if;

  select * into v_group from community_local_groups g where g.id = p_local_group_id;

  if length(v_name) not between 1 and 40 or v_name ~ '[[:cntrl:]]' then
    return null;
  end if;
  if length(v_purpose) > 200 or v_purpose ~ '[[:cntrl:]]' then
    return null;
  end if;

  -- The creator is handled separately below; listing them changes nothing.
  v_ids := array(
    select distinct x from unnest(coalesce(p_participant_ids, '{}'::uuid[])) as x
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
        and m.community_id = v_group.community_id
        and m.status = 'active'
        and m.local_group_id = v_group.id
    )
  ) then
    raise exception 'private_channel_participant_ineligible' using errcode = 'check_violation';
  end if;

  if exists (
    select 1 from channels c
    where c.local_group_id = v_group.id and c.is_private and lower(c.name) = lower(v_name)
  ) then
    raise exception 'private_channel_name_taken' using errcode = 'unique_violation';
  end if;

  v_id := v_group.community_id || '--privat-' || replace(gen_random_uuid()::text, '-', '');

  insert into channels (id, community_id, group_id, local_group_id, name, purpose, read_only, position, is_private, created_by)
  values (v_id, v_group.community_id, 'lokallag', v_group.id, v_name, v_purpose, false, 1000 + v_group.sort_order, true, v_uid);

  -- The creator, when they belong to this lokallag. A lokallagsleder who
  -- creates the channel manages it; an admin manages it through their role.
  insert into channel_participants (channel_id, community_id, local_group_id, user_id, is_manager, added_by)
  select v_id, v_group.community_id, v_group.id, v_uid, local_group_manage_admits(v_uid, v_group.id), v_uid
  where exists (
    select 1 from memberships m
    where m.user_id = v_uid
      and m.community_id = v_group.community_id
      and m.status = 'active'
      and m.local_group_id = v_group.id
  );

  insert into channel_participants (channel_id, community_id, local_group_id, user_id, added_by)
  select v_id, v_group.community_id, v_group.id, x, v_uid
  from unnest(v_ids) as x;

  return v_id;
end;
$$;

revoke execute on function public.create_private_channel(uuid, text, text, uuid[]) from public, anon;
grant execute on function public.create_private_channel(uuid, text, text, uuid[]) to authenticated;

comment on function public.create_private_channel(uuid, text, text, uuid[]) is
  'Creates a private channel under a lokallag with the given participants and returns its id. Admins of the community (any active lokallag) and effective lokallagsledere (their own lokallag). Every participant must be an active member of that lokallag. Null when the caller may not, or the name/description is invalid.';

-- ── Name and description ────────────────────────────────────────────────
--
-- Recreated from 20261005100000. Community-wide channels: unchanged, admins
-- only, and the main lokallag chat and team channels are still refused (their
-- name follows their group). New: a private channel may be edited by whoever
-- may manage it. Same return shape, so the channel page's editor is the same
-- editor.
create or replace function public.set_channel_details(
  p_community_id text,
  p_channel_id text,
  p_name text,
  p_purpose text
)
returns table (name text, purpose text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_channel public.channels%rowtype;
  v_name text := btrim(coalesce(p_name, ''));
  v_purpose text := btrim(coalesce(p_purpose, ''));
begin
  if auth.uid() is null then
    return;
  end if;

  select c.* into v_channel
  from public.channels c
  where c.id = p_channel_id and c.community_id = p_community_id;
  if not found then
    return;
  end if;

  if v_channel.is_private then
    if not public.private_channel_manage_admits(auth.uid(), v_channel.id) then
      return;
    end if;
  elsif not public.is_admin(p_community_id)
     or v_channel.local_group_id is not null
     or v_channel.subgroup_id is not null then
    return;
  end if;

  if length(v_name) not between 1 and 40 or v_name ~ '[[:cntrl:]]' then
    return;
  end if;

  if length(v_purpose) > 200 or v_purpose ~ '[[:cntrl:]]' then
    return;
  end if;

  if v_channel.is_private and exists (
    select 1 from public.channels other
    where other.local_group_id = v_channel.local_group_id
      and other.is_private
      and other.id <> v_channel.id
      and lower(other.name) = lower(v_name)
  ) then
    raise exception 'private_channel_name_taken' using errcode = 'unique_violation';
  end if;

  return query
    update public.channels c
       set name = v_name, purpose = v_purpose
     where c.id = v_channel.id
    returning c.name, c.purpose;
end;
$$;

comment on function public.set_channel_details(text, text, text, text) is
  'Sets name and purpose of one channel of the given community and returns the stored values. Community-wide channels: active admins of that community. Private lokallag channels: whoever may manage the channel. Returns no row when the caller may not, the channel is not in that community, the channel is a main lokallag or subgroup channel, or the input is invalid.';

revoke execute on function public.set_channel_details(text, text, text, text) from public, anon;
grant execute on function public.set_channel_details(text, text, text, text) to authenticated;

-- ── Participants: adding, removing, the manager mark ────────────────────
--
-- The acting person is always auth.uid() and must be able to manage the
-- channel — so nobody adds themselves to a channel they are not already
-- running. Adding never touches the target's role, lokallag or membership;
-- removing deletes the participant row and nothing else.

create or replace function public.add_private_channel_participant(p_channel_id text, p_user_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  v_channel channels%rowtype;
  v_added boolean;
begin
  if auth.uid() is null or not private_channel_manage_admits(auth.uid(), p_channel_id) then
    return false;
  end if;

  select * into v_channel from channels c where c.id = p_channel_id and c.is_private;
  if not found then
    return false;
  end if;

  if not exists (
    select 1 from memberships m
    where m.user_id = p_user_id
      and m.community_id = v_channel.community_id
      and m.status = 'active'
      and m.local_group_id = v_channel.local_group_id
  ) then
    return false;
  end if;

  insert into channel_participants (channel_id, community_id, local_group_id, user_id, added_by)
  values (v_channel.id, v_channel.community_id, v_channel.local_group_id, p_user_id, auth.uid())
  on conflict (channel_id, user_id) do nothing
  returning true into v_added;

  -- Already a participant: refused rather than reported as a change.
  return coalesce(v_added, false);
end;
$$;

create or replace function public.remove_private_channel_participant(p_channel_id text, p_user_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  v_removed uuid;
begin
  if auth.uid() is null or not private_channel_manage_admits(auth.uid(), p_channel_id) then
    return false;
  end if;

  delete from channel_participants cp
   where cp.channel_id = p_channel_id and cp.user_id = p_user_id
  returning cp.user_id into v_removed;

  return v_removed is not null;
end;
$$;

-- Admins only: who else manages a channel is the community's decision, not a
-- manager's. The mark can only be given to a participant who is an effective
-- lokallagsleder of the channel's lokallag; taking it away needs nothing.
create or replace function public.set_private_channel_manager(
  p_channel_id text,
  p_user_id uuid,
  p_is_manager boolean
)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  v_channel channels%rowtype;
  v_changed uuid;
begin
  if auth.uid() is null or p_is_manager is null then
    return false;
  end if;

  select * into v_channel from channels c where c.id = p_channel_id and c.is_private;
  if not found or not is_admin(v_channel.community_id) then
    return false;
  end if;

  if p_is_manager and not local_group_manage_admits(p_user_id, v_channel.local_group_id) then
    return false;
  end if;

  update channel_participants cp
     set is_manager = p_is_manager
   where cp.channel_id = v_channel.id and cp.user_id = p_user_id
  returning cp.user_id into v_changed;

  return v_changed is not null;
end;
$$;

create or replace function public.set_private_channel_archived(p_channel_id text, p_archived boolean)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  v_changed text;
begin
  if auth.uid() is null
     or p_archived is null
     or not private_channel_manage_admits(auth.uid(), p_channel_id) then
    return false;
  end if;

  update channels c
     set archived_at = case when p_archived then coalesce(c.archived_at, now()) end
   where c.id = p_channel_id and c.is_private
  returning c.id into v_changed;

  return v_changed is not null;
end;
$$;

-- The participant list and the member search name people, so they answer only
-- for someone who may manage the channel (or, for the search before a channel
-- exists, create one under that lokallag). Deliberately narrow, as for teams
-- (subgroup_roster / search_subgroup_candidates):
--
--   * a person appears only as their display name in this community;
--   * nobody is handed the lokallag's roster. Adding someone means searching
--     for them: at least two characters, at most ten matches, active members
--     of exactly this lokallag who are not in the channel already;
--   * whether a participant leads the lokallag is returned to admins only —
--     they are the ones who can act on it.
create or replace function public.private_channel_roster(p_channel_id text)
returns table (user_id uuid, display_name text, is_manager boolean, is_leader boolean, added_at timestamptz)
language sql stable security definer set search_path = public as $$
  select
    cp.user_id,
    coalesce(prof.display_name, 'Medlem'),
    cp.is_manager and local_group_manage_admits(cp.user_id, cp.local_group_id),
    case when is_admin(cp.community_id) then local_group_manage_admits(cp.user_id, cp.local_group_id) end,
    cp.created_at
  from channel_participants cp
  join memberships m
    on m.user_id = cp.user_id
   and m.community_id = cp.community_id
   and m.status = 'active'
   and m.local_group_id = cp.local_group_id
  left join community_profiles prof
    on prof.community_id = cp.community_id and prof.user_id = cp.user_id
  where cp.channel_id = p_channel_id
    and private_channel_manage_admits(auth.uid(), p_channel_id)
  order by lower(coalesce(prof.display_name, 'Medlem'));
$$;

-- `p_channel_id` null: choosing participants for a channel about to be
-- created under `p_local_group_id` (the caller is added by the create itself,
-- so they are not offered). Otherwise: adding to that existing channel, whose
-- lokallag must be `p_local_group_id`.
create or replace function public.search_private_channel_candidates(
  p_local_group_id uuid,
  p_channel_id text,
  p_query text
)
returns table (user_id uuid, display_name text)
language sql stable security definer set search_path = public as $$
  with q as (
    select btrim(coalesce(p_query, '')) as term
  )
  select m.user_id, prof.display_name
  from q,
       community_local_groups lg
  join memberships m
    on m.community_id = lg.community_id and m.status = 'active' and m.local_group_id = lg.id
  join community_profiles prof
    on prof.community_id = lg.community_id and prof.user_id = m.user_id
  where lg.id = p_local_group_id
    and length(q.term) between 2 and 80
    and (
      (
        p_channel_id is null
        and private_channel_create_admits(auth.uid(), lg.id)
        and m.user_id <> auth.uid()
      )
      or (
        p_channel_id is not null
        and private_channel_manage_admits(auth.uid(), p_channel_id)
        and exists (
          select 1 from channels c
          where c.id = p_channel_id and c.is_private and c.local_group_id = lg.id
        )
        and not exists (
          select 1 from channel_participants cp
          where cp.channel_id = p_channel_id and cp.user_id = m.user_id
        )
      )
    )
    and prof.display_name ilike
      '%' || replace(replace(replace(q.term, '\', '\\'), '%', '\%'), '_', '\_') || '%'
  order by lower(prof.display_name)
  limit 10;
$$;

revoke execute on function public.add_private_channel_participant(text, uuid) from public, anon;
revoke execute on function public.remove_private_channel_participant(text, uuid) from public, anon;
revoke execute on function public.set_private_channel_manager(text, uuid, boolean) from public, anon;
revoke execute on function public.set_private_channel_archived(text, boolean) from public, anon;
revoke execute on function public.private_channel_roster(text) from public, anon;
revoke execute on function public.search_private_channel_candidates(uuid, text, text) from public, anon;
grant execute on function public.add_private_channel_participant(text, uuid) to authenticated;
grant execute on function public.remove_private_channel_participant(text, uuid) to authenticated;
grant execute on function public.set_private_channel_manager(text, uuid, boolean) to authenticated;
grant execute on function public.set_private_channel_archived(text, boolean) to authenticated;
grant execute on function public.private_channel_roster(text) to authenticated;
grant execute on function public.search_private_channel_candidates(uuid, text, text) to authenticated;

comment on function public.add_private_channel_participant(text, uuid) is
  'Channel managers only. Adds an active member of the channel''s lokallag as a participant. False when the caller may not manage the channel, the person is not an active member of that lokallag, or is already a participant.';
comment on function public.remove_private_channel_participant(text, uuid) is
  'Channel managers only. Removes a participant; effective on the next request. Returns whether a participant was removed.';
comment on function public.set_private_channel_manager(text, uuid, boolean) is
  'Community admins only. Gives or takes the manager mark of a participant; it can only be given to an effective lokallagsleder of the channel''s lokallag.';
comment on function public.set_private_channel_archived(text, boolean) is
  'Channel managers only. Archives (no new messages, history kept) or reopens a private channel.';

-- ── Profile visibility derived from messages ────────────────────────────
--
-- Recreated from 20261009100000 (can_view_community_profile) and
-- 20261005100000 (shares_visible_authorship). The only change in each is the
-- message clause: authorship counts only in a channel the caller can read
-- under channel_access_admits(), so a message in a private channel does not
-- surface its author to the rest of the lokallag.
create or replace function public.can_view_community_profile(p_community_id text, p_user_id uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select auth.uid() is not null and (
    p_user_id = auth.uid()
    or (
      is_member(p_community_id)
      and (
        (
          can_view_member_directory(p_community_id)
          and exists (
            select 1 from memberships m
            where m.community_id = p_community_id
              and m.user_id = p_user_id
              and m.status = 'active'
          )
        )
        or exists (
          select 1 from posts p
          where p.community_id = p_community_id and p.author_id = p_user_id
            and content_scope_admits(auth.uid(), p.community_id, p.local_group_id, p.subgroup_id)
        )
        or exists (
          select 1 from comments c
          join posts p on p.id = c.post_id
          where p.community_id = p_community_id and c.author_id = p_user_id
            and content_scope_admits(auth.uid(), p.community_id, p.local_group_id, p.subgroup_id)
        )
        or exists (
          select 1 from messages msg
          join channels ch on ch.id = msg.channel_id
          where ch.community_id = p_community_id and msg.author_id = p_user_id
            and channel_access_admits(auth.uid(), ch.community_id, ch.local_group_id, ch.subgroup_id, ch.id, ch.is_private)
        )
        or exists (
          select 1 from events e
          where e.community_id = p_community_id and e.host_id = p_user_id
            and content_scope_admits(auth.uid(), e.community_id, e.local_group_id, e.subgroup_id)
        )
        or exists (
          select 1 from event_attendees a
          join events e on e.id = a.event_id
          where e.community_id = p_community_id and a.user_id = p_user_id
            and can_view_event_roster(e.id)
            and rsvp_is_current(e.id, p_user_id)
        )
        or exists (
          select 1 from direct_conversations dc
          where dc.community_id = p_community_id
            and auth.uid() in (dc.participant_one_id, dc.participant_two_id)
            and p_user_id in (dc.participant_one_id, dc.participant_two_id)
        )
      )
    )
  );
$$;

revoke execute on function public.can_view_community_profile(text, uuid) from public, anon;
grant execute on function public.can_view_community_profile(text, uuid) to authenticated;

create or replace function public.shares_visible_authorship(other uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from posts p
    where p.author_id = other
      and content_scope_admits(auth.uid(), p.community_id, p.local_group_id, p.subgroup_id)
  ) or exists (
    select 1 from comments cm
    join posts p on p.id = cm.post_id
    where cm.author_id = other
      and content_scope_admits(auth.uid(), p.community_id, p.local_group_id, p.subgroup_id)
  ) or exists (
    select 1 from messages msg
    join channels ch on ch.id = msg.channel_id
    where msg.author_id = other
      and channel_access_admits(auth.uid(), ch.community_id, ch.local_group_id, ch.subgroup_id, ch.id, ch.is_private)
  ) or exists (
    select 1 from events e
    where e.host_id = other
      and content_scope_admits(auth.uid(), e.community_id, e.local_group_id, e.subgroup_id)
  );
$$;

revoke execute on function public.shares_visible_authorship(uuid) from public, anon;
grant execute on function public.shares_visible_authorship(uuid) to authenticated;
