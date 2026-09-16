-- Lets administrators create events, and makes capacity mean something.
--
-- Attendance was already fully modelled: `event_attendees` has a
-- (event_id, user_id) primary key, so a double RSVP is impossible rather than
-- merely discouraged, and `event_attendees_write` pins the row to auth.uid()
-- and requires membership of the event's own community. Nothing there needed
-- changing; what was missing is that `events` had no write policy at all, so
-- there was no way for an organisation to add one of its own events.
--
-- Two things are added here, and nothing else is touched.

-- ── Who is signing up ───────────────────────────────────────────────────
--
-- `event_attendees.user_id` had no default, so an RSVP had to name the person
-- signing up. `event_attendees_write` always refused a forged one, but a write
-- path that has to supply an owner is a write path where a client-supplied
-- value can later be threaded through by mistake. Posts, comments and messages
-- all take their owner from the session this way; attendance now does too, and
-- an insert simply does not carry a user_id.
alter table event_attendees alter column user_id set default auth.uid();

-- ── Who may create an event ─────────────────────────────────────────────
--
-- Administrators of that one community. Moderators are deliberately excluded:
-- they follow up conversations and content, while putting the organisation's
-- name on a date and a place is administration. This mirrors the membership
-- queue, which is admin-only for the same reason.
--
-- The host is taken from the session rather than the request. With a default
-- of auth.uid() an insert simply does not carry a host_id, so there is no
-- client-supplied value for the policy to have to reject — the same
-- arrangement posts, comments and messages already use. The policy still
-- checks it, for any caller that sends one anyway.
alter table events alter column host_id set default auth.uid();

create policy events_insert on events for insert to authenticated
with check (
  host_id = auth.uid()
  and is_admin(community_id)
  and btrim(title) <> ''
  and btrim(location) <> ''
  and length(title) <= 120
  and length(location) <= 120
  and length(description) <= 4000
  -- An event that ends before it starts is not a shape the UI should have to
  -- render, and a zero-length one is almost always a mistake.
  and ends_at > starts_at
);

-- No update or delete policy. Editing and cancelling events are real features
-- with their own questions — what happens to the people already signed up —
-- and inventing half of that here would be worse than leaving it out. An event
-- created by mistake is currently an administrator's problem to raise, which
-- is the honest state rather than a hidden one.

-- ── Capacity ────────────────────────────────────────────────────────────
--
-- `capacity` has been on the table since the start but never meant anything: a
-- card could read "6 påmeldte av 6" and still accept a seventh. Showing a
-- "fullt" state in the interface without this would be a client-side check
-- wearing a server-side face.
--
-- A trigger rather than a policy, because the rule is about how many rows
-- already exist, which `with check` cannot see. Null capacity means unlimited
-- and is the common case.
create or replace function public.enforce_event_capacity()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_capacity int;
  v_taken int;
begin
  select capacity into v_capacity from events where id = new.event_id;

  if v_capacity is null then
    return new;
  end if;

  -- Counted inside the statement that is inserting, so two people taking the
  -- last seat at the same moment cannot both succeed: the row lock the primary
  -- key takes serialises them.
  select count(*) into v_taken from event_attendees where event_id = new.event_id;

  if v_taken >= v_capacity then
    raise exception 'event_full' using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

create trigger event_attendees_capacity
  before insert on event_attendees
  for each row execute function public.enforce_event_capacity();

revoke execute on function public.enforce_event_capacity() from public, anon, authenticated;
