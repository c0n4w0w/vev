-- Lokallagsledere: an explicit, per-lokallag grant to run that lokallag's
-- events, and one event-management rule for creating, editing, cancelling and
-- seeing who is coming.
--
-- ── What existed ────────────────────────────────────────────────────────
--
-- Nothing that grants anything. `community_people` has a `local_group_leader`
-- section, but it is the organisation's published contact list — a card that
-- may describe someone with no TING account at all, and is documented as
-- separate from memberships. Deriving permissions from it would let editing a
-- public contact card hand out write access. `memberships.role` is community
-- wide (admin / moderator / member) and cannot say "for FTR Trøndelag only".
--
-- So this adds `community_local_group_managers`, shaped like
-- `community_subgroup_managers`: one row per (lokallag, person), with the
-- community on the row so both composite foreign keys keep the lokallag and
-- the membership inside the same community.
--
-- ── When a grant counts ─────────────────────────────────────────────────
--
-- Checked on every use, not only when granted:
--
--   * the person's membership in that community is active, and
--   * their membership is in exactly that lokallag (memberships.local_group_id),
--   * and the lokallag is active.
--
-- And a grant does not outlive the situation it was given for. When the
-- leader's membership leaves that lokallag — moves to another one, clears it,
-- or stops being active — or the lokallag is retired, the row is deleted by a
-- trigger. Moving back, reactivating or un-retiring restores nothing: an
-- admin grants it again. Removing a row takes effect on the next request.
--
-- ── Who may manage an event ─────────────────────────────────────────────
--
-- can_create_event(community, lokallag, subgroup) — for the caller:
--
--   active admin of the community      any scope they can read (all of them)
--   effective lokallagsleder           that lokallag only, never community-wide,
--                                      another lokallag or a subgroup
--
-- Moderators and members: nothing, as before. Managing an existing event
-- (edit, cancel, see the roster) is the same question asked of the event's
-- current scope: can_manage_event(). Editing may not move an event to a scope
-- the caller could not have created it in.
--
-- The roster follows management, not authorship: whoever may manage the event
-- right now sees who is coming, so a lokallagsleder sees attendees of their
-- lokallag's events whoever created them. `host_id` alone grants nothing — a
-- host is always someone who could manage the event when they created it, and
-- sees the roster for exactly as long as that is still true. Still within one
-- community.

create table if not exists public.community_local_group_managers (
  local_group_id uuid not null,
  community_id text not null,
  user_id uuid not null,
  granted_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),

  primary key (local_group_id, user_id),
  foreign key (local_group_id, community_id)
    references public.community_local_groups (id, community_id) on delete cascade,
  foreign key (user_id, community_id)
    references public.memberships (user_id, community_id) on delete cascade
);

create index if not exists community_local_group_managers_user_idx
  on public.community_local_group_managers (user_id, community_id);

comment on table public.community_local_group_managers is
  'Lokallagsledere: explicit permission to create and manage events for one lokallag. Counts only while the person is an active member of that exact lokallag. Not derived from community_people (the public contact list) or from memberships.role.';

alter table public.community_local_group_managers enable row level security;

-- Your own grants, and every grant in a community you administer. Writes go
-- through the functions below only.
drop policy if exists community_local_group_managers_select on public.community_local_group_managers;
create policy community_local_group_managers_select on public.community_local_group_managers
  for select to authenticated
  using (user_id = auth.uid() or is_admin(community_id));

revoke all on public.community_local_group_managers from anon;
revoke insert, update, delete, truncate on public.community_local_group_managers from authenticated;

-- ── The leadership rule ─────────────────────────────────────────────────
--
-- Internal: takes a user id.
create or replace function public.local_group_manage_admits(p_user_id uuid, p_local_group_id uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select p_user_id is not null and exists (
    select 1
    from community_local_group_managers g
    join community_local_groups lg
      on lg.id = g.local_group_id and lg.community_id = g.community_id
    join memberships m
      on m.user_id = g.user_id and m.community_id = g.community_id
    where g.local_group_id = p_local_group_id
      and g.user_id = p_user_id
      and lg.active
      and m.status = 'active'
      and m.local_group_id = g.local_group_id
  );
$$;

revoke execute on function public.local_group_manage_admits(uuid, uuid) from public, anon, authenticated;

-- Caller-bound: what the lokallag page asks before offering the composer.
create or replace function public.can_lead_local_group(p_local_group_id uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select local_group_manage_admits(auth.uid(), p_local_group_id);
$$;

revoke execute on function public.can_lead_local_group(uuid) from public, anon;
grant execute on function public.can_lead_local_group(uuid) to authenticated;

-- ── The event-management rule ───────────────────────────────────────────

create or replace function public.can_create_event(
  p_community_id text,
  p_local_group_id uuid,
  p_subgroup_id uuid
)
returns boolean language sql security definer stable set search_path = public as $$
  select can_read_content_scope(p_community_id, p_local_group_id, p_subgroup_id)
    and (
      is_admin(p_community_id)
      or (
        p_local_group_id is not null
        and p_subgroup_id is null
        and exists (
          select 1 from community_local_groups lg
          where lg.id = p_local_group_id and lg.community_id = p_community_id
        )
        and local_group_manage_admits(auth.uid(), p_local_group_id)
      )
    );
$$;

revoke execute on function public.can_create_event(text, uuid, uuid) from public, anon;
grant execute on function public.can_create_event(text, uuid, uuid) to authenticated;

comment on function public.can_create_event(text, uuid, uuid) is
  'Whether the caller may create (and therefore manage) an event in this scope: an active admin of the community in any scope; an effective lokallagsleder for their own lokallag only.';

create or replace function public.can_manage_event(p_event_id uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from events e
    where e.id = p_event_id
      and can_create_event(e.community_id, e.local_group_id, e.subgroup_id)
  );
$$;

revoke execute on function public.can_manage_event(uuid) from public, anon;
grant execute on function public.can_manage_event(uuid) to authenticated;

comment on function public.can_manage_event(uuid) is
  'Whether the caller may edit, cancel and see the roster of this event: can_create_event() for its current scope.';

-- ── Events: create, edit, cancel ────────────────────────────────────────
--
-- The host is still the caller: host_id defaults to auth.uid() and the policy
-- requires it, so it is always the authorized actor who created the event.
drop policy if exists events_insert on public.events;
create policy events_insert on public.events for insert to authenticated
with check (
  host_id = auth.uid()
  and can_create_event(community_id, local_group_id, subgroup_id)
  and btrim(title) <> ''
  and btrim(location) <> ''
  and length(title) <= 120
  and length(location) <= 120
  and length(description) <= 4000
  and ends_at > starts_at
);

-- Editing: only an event you manage, and only into a scope you could have
-- created it in — a lokallagsleder cannot widen their event to the whole
-- community or move it to another lokallag.
drop policy if exists events_update on public.events;
create policy events_update on public.events for update to authenticated
using (can_manage_event(id))
with check (
  can_create_event(community_id, local_group_id, subgroup_id)
  and btrim(title) <> ''
  and btrim(location) <> ''
  and length(title) <= 120
  and length(location) <= 120
  and length(description) <= 4000
  and ends_at > starts_at
);

-- Cancelling removes the event, and its RSVPs with it (on delete cascade).
-- There is no separate cancelled state for the interface to render.
drop policy if exists events_delete on public.events;
create policy events_delete on public.events for delete to authenticated
using (can_manage_event(id));

-- Which community an event belongs to and who created it are facts, not
-- settings: an edit cannot move an event to another organisation or rewrite
-- its host. The service role (seed, operators) is exempt.
create or replace function public.events_guard_immutable()
returns trigger language plpgsql set search_path = public as $$
begin
  if coalesce(auth.role(), '') = 'service_role' then
    return new;
  end if;

  if new.id is distinct from old.id
     or new.community_id is distinct from old.community_id
     or new.host_id is distinct from old.host_id then
    raise exception 'Fellesskap og vert kan ikke endres på et arrangement'
      using errcode = 'insufficient_privilege';
  end if;

  return new;
end;
$$;

revoke execute on function public.events_guard_immutable() from public, anon, authenticated;

drop trigger if exists events_guard_immutable on public.events;
create trigger events_guard_immutable
  before update on public.events
  for each row execute function public.events_guard_immutable();

-- ── The roster ──────────────────────────────────────────────────────────
--
-- Recreated from 20261009100000, where the host saw the roster on authorship
-- alone. That let a historical host_id outlive the access that justified it:
-- a lokallagsleder whose grant was revoked kept seeing every attendee of the
-- events they had created. Now it is exactly can_manage_event(), which already
-- requires current read access to the event's scope (can_read_content_scope)
-- and a current management right in its community. event_attendees_select,
-- event_attendee_roster() and the attendee clause of
-- can_view_community_profile() all call this, so they follow without change.
create or replace function public.can_view_event_roster(p_event_id uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select can_manage_event(p_event_id);
$$;

comment on function public.can_view_event_roster(uuid) is
  'Whether the caller may see who is attending this event: exactly can_manage_event() — an active admin of its community, or an effective lokallagsleder of its lokallag — under current access. Being its host grants nothing by itself.';

-- ── Granting and revoking ───────────────────────────────────────────────
--
-- Admins of the lokallag's community only. The person must be an active
-- member of that community and of that lokallag; the grant changes nothing
-- else about them — not their role, not their lokallag.
create or replace function public.add_local_group_manager(p_local_group_id uuid, p_user_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  v_community text;
begin
  select lg.community_id into v_community
  from community_local_groups lg
  where lg.id = p_local_group_id and lg.active;

  if v_community is null or auth.uid() is null or not is_admin(v_community) then
    return false;
  end if;

  if not exists (
    select 1 from memberships m
    where m.community_id = v_community
      and m.user_id = p_user_id
      and m.status = 'active'
      and m.local_group_id = p_local_group_id
  ) then
    return false;
  end if;

  insert into community_local_group_managers (local_group_id, community_id, user_id, granted_by)
  values (p_local_group_id, v_community, p_user_id, auth.uid())
  on conflict (local_group_id, user_id) do nothing;

  return true;
end;
$$;

create or replace function public.remove_local_group_manager(p_local_group_id uuid, p_user_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  v_community text;
begin
  select lg.community_id into v_community
  from community_local_groups lg
  where lg.id = p_local_group_id;

  if v_community is null or auth.uid() is null or not is_admin(v_community) then
    return false;
  end if;

  delete from community_local_group_managers
  where local_group_id = p_local_group_id and user_id = p_user_id;

  return found;
end;
$$;

revoke execute on function public.add_local_group_manager(uuid, uuid) from public, anon;
revoke execute on function public.remove_local_group_manager(uuid, uuid) from public, anon;
grant execute on function public.add_local_group_manager(uuid, uuid) to authenticated;
grant execute on function public.remove_local_group_manager(uuid, uuid) to authenticated;

comment on function public.add_local_group_manager(uuid, uuid) is
  'Admin-only. Makes an active member of this lokallag its lokallagsleder. Returns false when the caller is not an admin of its community, the lokallag is retired, or the person is not an active member of it.';
-- ── Grants end with the situation they were given for ──────────────────
--
-- A membership that moves to another lokallag, clears its lokallag or stops
-- being active loses every lokallagsleder grant it no longer fits — only that
-- person's, only in that community. Role changes do not touch grants: leading
-- a lokallag is independent of being a moderator.
create or replace function public.local_group_managers_follow_membership()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status is distinct from old.status
     or new.local_group_id is distinct from old.local_group_id then
    delete from community_local_group_managers g
    where g.user_id = new.user_id
      and g.community_id = new.community_id
      and (
        new.status <> 'active'
        or new.local_group_id is null
        or g.local_group_id <> new.local_group_id
      );
  end if;
  return null;
end;
$$;

revoke execute on function public.local_group_managers_follow_membership() from public, anon, authenticated;

drop trigger if exists memberships_local_group_managers on public.memberships;
create trigger memberships_local_group_managers
  after update of status, local_group_id on public.memberships
  for each row execute function public.local_group_managers_follow_membership();

-- Retiring a lokallag ends its grants too, so reactivating it later does not
-- quietly hand the old leaders their rights back.
create or replace function public.local_group_managers_follow_group()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.active and not new.active then
    delete from community_local_group_managers g where g.local_group_id = new.id;
  end if;
  return null;
end;
$$;

revoke execute on function public.local_group_managers_follow_group() from public, anon, authenticated;

drop trigger if exists community_local_groups_managers on public.community_local_groups;
create trigger community_local_groups_managers
  after update of active on public.community_local_groups
  for each row execute function public.local_group_managers_follow_group();

comment on function public.remove_local_group_manager(uuid, uuid) is
  'Admin-only. Removes a lokallagsleder grant; effective on the next request. Returns whether a grant was removed.';
