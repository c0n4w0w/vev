-- Editing, cancelling and deleting events.
--
-- ── Lifecycle ───────────────────────────────────────────────────────────
--
-- An event is either scheduled or cancelled. Cancelled is a state, not a
-- deletion: `cancelled_at` records when, `cancelled_by` who. Title,
-- description, time, place, host, scope and every RSVP row stay exactly as
-- they were, so the event's history survives and it can be restored.
--
-- Two columns rather than a status enum: there is one non-default state, and
-- "when and by whom" is what anyone asks about it. Both are null for a
-- scheduled event.
--
-- ── Who may do what (all reuse can_manage_event / can_create_event) ─────
--
--   edit       can_manage_event — an active admin of the community, or an
--              effective lokallagsleder for that lokallag. Unchanged policy.
--              Title, description, time, place and capacity only: an event's
--              community, host and audience (lokallag, subgroup, public) are
--              fixed when it is created, for everyone, admins included.
--   cancel     cancel_event(): can_manage_event.
--   restore    restore_event(): can_manage_event, and only if the current
--              RSVPs still fit the capacity.
--   delete     admins of the event's community only. A lokallagsleder may
--              cancel but never permanently delete.
--
-- Being the host grants nothing by itself (20261010100000), so a revoked
-- leader or demoted admin loses all of this on the next request.
--
-- Cancelling and restoring happen only through the two functions: a direct
-- update of the lifecycle columns is refused, so the state cannot be flipped
-- around the checks they make (capacity on restore, notifying attendees).

alter table public.events
  add column if not exists cancelled_at timestamptz,
  add column if not exists cancelled_by uuid references public.profiles (id) on delete set null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'events_cancelled_by_requires_cancelled_at') then
    alter table public.events
      add constraint events_cancelled_by_requires_cancelled_at
        check (cancelled_by is null or cancelled_at is not null);
  end if;
end $$;

-- Upcoming-event queries all ask for scheduled events.
create index if not exists events_scheduled_idx
  on public.events (community_id, starts_at)
  where cancelled_at is null;

comment on column public.events.cancelled_at is
  'Set when the event was cancelled (cancel_event); null while scheduled. A cancelled event keeps its details, scope and RSVP rows, accepts no RSVP changes, and is left out of upcoming lists and the public portal.';
comment on column public.events.cancelled_by is
  'Who cancelled the event. Null while scheduled.';

-- ── Facts an edit cannot change ─────────────────────────────────────────
--
-- Recreated from 20261010100000, which froze community and host.
--
-- Audience is frozen too: lokallag, subgroup and public. events_update's
-- `with check` (can_create_event) only asked whether the caller could have
-- created the event in its *new* scope, and an admin can create in any scope —
-- so an admin could turn a Safe-Space or lokallag event, with its private RSVPs
-- and description, into a community-wide or public one by updating a column.
-- Who was told about an event, and who signed up for it, was decided under its
-- original audience; widening it afterwards would expose that to people it
-- was never meant for. To reach a different audience, create a new event.
--
-- These apply to every caller except the service role (seed, operators):
-- admins, lokallagsledere, members, and the SECURITY DEFINER functions
-- alike — none of which has any reason to change them.
--
-- The lifecycle columns are refused only for requests straight from the API
-- (current_user is the API role); cancel_event() and restore_event() run as
-- their owner and are the one way to change them.
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

  if new.local_group_id is distinct from old.local_group_id
     or new.subgroup_id is distinct from old.subgroup_id
     or new.is_public is distinct from old.is_public then
    raise exception 'Hvem et arrangement er for, kan ikke endres etter at det er opprettet'
      using errcode = 'insufficient_privilege';
  end if;

  if current_user in ('authenticated', 'anon')
     and (new.cancelled_at is distinct from old.cancelled_at
          or new.cancelled_by is distinct from old.cancelled_by) then
    raise exception 'Bruk avlys eller gjenopprett for å endre arrangementets status'
      using errcode = 'insufficient_privilege';
  end if;

  return new;
end;
$$;

revoke execute on function public.events_guard_immutable() from public, anon, authenticated;

-- ── Capacity cannot be set below who is already coming ──────────────────
--
-- Counted with rsvp_is_current(), the rule the capacity trigger and the
-- roster use. Only checked when capacity changes, so an event that a restored
-- RSVP left above capacity (20261005100000) can still have its title fixed.
create or replace function public.events_capacity_floor()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_taken int;
begin
  if coalesce(auth.role(), '') = 'service_role' then
    return new;
  end if;

  if new.capacity is null or new.capacity is not distinct from old.capacity then
    return new;
  end if;

  select count(*) into v_taken
  from event_attendees a
  where a.event_id = new.id
    and rsvp_is_current(a.event_id, a.user_id);

  if new.capacity < v_taken then
    raise exception 'capacity_below_attendees' using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

revoke execute on function public.events_capacity_floor() from public, anon, authenticated;

drop trigger if exists events_capacity_floor on public.events;
create trigger events_capacity_floor
  before update of capacity on public.events
  for each row execute function public.events_capacity_floor();

-- Editing keeps its policy (can_manage_event, validation in with check). The
-- check constraint below backs up the capacity rule for every writer.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'events_capacity_positive') then
    alter table public.events
      add constraint events_capacity_positive check (capacity is null or capacity >= 1);
  end if;
end $$;

-- ── Permanent deletion: admins only ─────────────────────────────────────
--
-- An admin of the event's community reads every scope in it, so no separate
-- read check is needed. RSVPs cascade with the event; notifications that
-- point at it cascade too (event_id below), so nothing is left dangling.
create or replace function public.can_delete_event(p_event_id uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from events e
    where e.id = p_event_id
      and is_admin(e.community_id)
  );
$$;

revoke execute on function public.can_delete_event(uuid) from public, anon;
grant execute on function public.can_delete_event(uuid) to authenticated;

comment on function public.can_delete_event(uuid) is
  'Whether the caller may permanently delete this event: an active admin of its community. Lokallagsledere may cancel (cancel_event) but not delete.';

drop policy if exists events_delete on public.events;
create policy events_delete on public.events for delete to authenticated
using (can_delete_event(id));

-- ── RSVPs are frozen on a cancelled event ───────────────────────────────
--
-- No new sign-ups, and no withdrawals either: the rows are the attendance
-- history, and a restore should find them exactly as they were.
create or replace function public.event_open_for_rsvp(p_event_id uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from events e
    where e.id = p_event_id
      and e.cancelled_at is null
      and content_scope_admits(auth.uid(), e.community_id, e.local_group_id, e.subgroup_id)
  );
$$;

revoke execute on function public.event_open_for_rsvp(uuid) from public, anon;
grant execute on function public.event_open_for_rsvp(uuid) to authenticated;

drop policy if exists event_attendees_insert on public.event_attendees;
create policy event_attendees_insert on public.event_attendees for insert to authenticated
with check (user_id = auth.uid() and event_open_for_rsvp(event_id));

drop policy if exists event_attendees_delete on public.event_attendees;
create policy event_attendees_delete on public.event_attendees for delete to authenticated
using (user_id = auth.uid() and event_open_for_rsvp(event_id));

-- ── Notifications about an event follow access to it ────────────────────
--
-- Same arrangement as post_id (20261005100000): a notification tied to an
-- event is readable only while its recipient can read the event, so a member
-- who later leaves the team or lokallag cannot keep reading a private title.
-- Deleting the event deletes its notifications.
alter table public.notifications
  add column if not exists event_id uuid references public.events (id) on delete cascade;

create index if not exists notifications_event_idx
  on public.notifications (event_id) where event_id is not null;

comment on column public.notifications.event_id is
  'The event a notification is about (cancelled or restored). When set, the notification is readable only while its recipient can read that event (notifications_select).';

drop policy if exists notifications_select on public.notifications;
create policy notifications_select on public.notifications for select to authenticated
using (
  user_id = auth.uid()
  and (post_id is null or can_access_post(post_id))
  and (event_id is null or can_read_event(event_id))
);

-- Recreated from 20261005100000 with event_id frozen as well: a recipient who
-- could clear it would make a revoked notification readable.
create or replace function public.notifications_guard_immutable()
returns trigger language plpgsql set search_path = public as $$
begin
  if coalesce(auth.role(), '') = 'service_role' then
    return new;
  end if;

  if new.id is distinct from old.id
     or new.user_id is distinct from old.user_id
     or new.kind is distinct from old.kind
     or new.community_id is distinct from old.community_id
     or new.title is distinct from old.title
     or new.body is distinct from old.body
     or new.href is distinct from old.href
     or new.created_at is distinct from old.created_at
     or new.post_id is distinct from old.post_id
     or new.event_id is distinct from old.event_id then
    raise exception 'Et varsel kan bare markeres som lest eller ulest'
      using errcode = 'insufficient_privilege';
  end if;

  return new;
end $$;

-- Internal: tells everyone with a current RSVP, except whoever acted. Text in
-- the community's own language, like the rest of what it shows.
create or replace function public.notify_event_attendees(p_event_id uuid, p_cancelled boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into notifications (user_id, kind, community_id, title, body, href, event_id)
  select
    a.user_id,
    'event',
    e.community_id,
    case
      when c.default_locale = 'en' then (case when p_cancelled then 'Cancelled: ' else 'Back on: ' end)
      else (case when p_cancelled then 'Avlyst: ' else 'Gjennomføres likevel: ' end)
    end || e.title,
    case
      when c.default_locale = 'en' then
        (case when p_cancelled
          then 'An event you signed up for in ' || c.name || ' has been cancelled.'
          else 'An event you signed up for in ' || c.name || ' is going ahead after all. Your registration still stands.'
        end)
      else
        (case when p_cancelled
          then 'Et arrangement du er påmeldt i ' || c.name || ' er avlyst.'
          else 'Et arrangement du er påmeldt i ' || c.name || ' blir likevel gjennomført. Påmeldingen din gjelder fortsatt.'
        end)
    end,
    '/community/' || e.community_id || '/events/' || e.id,
    e.id
  from events e
  join communities c on c.id = e.community_id
  join event_attendees a on a.event_id = e.id
  where e.id = p_event_id
    and a.user_id <> auth.uid()
    and rsvp_is_current(a.event_id, a.user_id);
end;
$$;

revoke execute on function public.notify_event_attendees(uuid, boolean) from public, anon, authenticated;

-- ── Cancelling and restoring ────────────────────────────────────────────
--
-- Both answer with a short code the interface turns into a sentence:
--   ok | refused | already_cancelled | not_cancelled | ended | over_capacity
-- `refused` covers "not yours to manage" and "no such event" alike.

create or replace function public.cancel_event(p_event_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_event events%rowtype;
begin
  if auth.uid() is null or not can_manage_event(p_event_id) then
    return 'refused';
  end if;

  select * into v_event from events where id = p_event_id for update;

  if v_event.cancelled_at is not null then
    return 'already_cancelled';
  end if;
  if v_event.ends_at <= now() then
    return 'ended';
  end if;

  update events
     set cancelled_at = now(), cancelled_by = auth.uid()
   where id = p_event_id;

  perform notify_event_attendees(p_event_id, true);
  return 'ok';
end;
$$;

create or replace function public.restore_event(p_event_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_event events%rowtype;
  v_taken int;
begin
  if auth.uid() is null or not can_manage_event(p_event_id) then
    return 'refused';
  end if;

  select * into v_event from events where id = p_event_id for update;

  if v_event.cancelled_at is null then
    return 'not_cancelled';
  end if;
  if v_event.ends_at <= now() then
    return 'ended';
  end if;

  -- Eligibility is re-evaluated now: only RSVPs that are still current count,
  -- and if they no longer fit, the event stays cancelled until capacity is
  -- raised. Restoring never quietly overbooks.
  if v_event.capacity is not null then
    select count(*) into v_taken
    from event_attendees a
    where a.event_id = p_event_id
      and rsvp_is_current(a.event_id, a.user_id);
    if v_taken > v_event.capacity then
      return 'over_capacity';
    end if;
  end if;

  update events
     set cancelled_at = null, cancelled_by = null
   where id = p_event_id;

  perform notify_event_attendees(p_event_id, false);
  return 'ok';
end;
$$;

revoke execute on function public.cancel_event(uuid) from public, anon;
revoke execute on function public.restore_event(uuid) from public, anon;
grant execute on function public.cancel_event(uuid) to authenticated;
grant execute on function public.restore_event(uuid) to authenticated;

comment on function public.cancel_event(uuid) is
  'Cancels an event the caller may manage (can_manage_event): keeps every detail and RSVP, freezes RSVPs, notifies current attendees. Returns ok | refused | already_cancelled | ended.';
comment on function public.restore_event(uuid) is
  'Restores a cancelled event the caller may manage, only if its current RSVPs fit its capacity. Returns ok | refused | not_cancelled | ended | over_capacity.';

-- ── The public portal never advertises a cancelled event ────────────────
create or replace function public.portal_events(p_slug text)
returns table (id uuid, title text, description text, starts_at timestamptz, ends_at timestamptz, location text)
language sql stable security definer set search_path = public as $$
  select e.id, e.title, e.description, e.starts_at, e.ends_at, e.location
  from events e
  join communities c on c.id = e.community_id
  where c.slug = p_slug
    and e.is_public
    and e.local_group_id is null
    and e.subgroup_id is null
    and e.cancelled_at is null
    and e.ends_at >= now()
  order by e.starts_at;
$$;

revoke execute on function public.portal_events(text) from public;
grant execute on function public.portal_events(text) to anon, authenticated;

-- ── Capacity says nothing about a cancelled event ───────────────────────
--
-- The capacity trigger runs before row level security, so a sign-up to a
-- cancelled event that happened to be full was answered "event_full" instead
-- of being refused for what it is. A cancelled event now passes through here
-- untouched and event_attendees_insert refuses it. Otherwise recreated from
-- 20261009100000 unchanged.
create or replace function public.enforce_event_capacity()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_capacity int;
  v_cancelled timestamptz;
  v_taken int;
begin
  if auth.uid() is not null and not can_read_event(new.event_id) then
    return new;
  end if;

  -- Locks the event row, so two people taking the last seat at the same moment
  -- are serialised even though they insert different attendee rows.
  select capacity, cancelled_at into v_capacity, v_cancelled from events where id = new.event_id for update;

  if v_capacity is null or v_cancelled is not null then
    return new;
  end if;

  select count(*) into v_taken
  from event_attendees a
  where a.event_id = new.event_id
    and rsvp_is_current(a.event_id, a.user_id);

  if v_taken >= v_capacity then
    raise exception 'event_full' using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

revoke execute on function public.enforce_event_capacity() from public, anon, authenticated;
