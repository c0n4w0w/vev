-- Organisers removing a registration.
--
-- Someone who may manage an event (can_manage_event: an active admin of its
-- community, or the lokallag's current lokallagsleder) can take one person's
-- RSVP off a scheduled, upcoming event, and that person is told.
--
-- One narrow function rather than a wider delete policy. event_attendees_delete
-- still lets people withdraw only themselves; there is no path by which a
-- client deletes somebody else's row except this one, and it checks the caller,
-- the event's state and the RSVP itself before touching anything.
--
-- Not a ban. The row is simply gone: if sign-up is open and the person can
-- still read the event, they may sign up again exactly as before. No list of
-- removed people is kept.
--
-- History stays intact: a cancelled event's RSVPs are frozen
-- (20261012100000) and a past event's are its attendance record, so neither
-- can be removed here.
--
-- Answers with a short code the interface turns into a sentence:
--   ok | refused | cancelled | ended | not_attending
-- `refused` covers "not yours to manage" and "no such event" alike, and is
-- decided before anything about attendance is looked at, so the function tells
-- an outsider nothing about who is signed up. `not_attending` (no current RSVP
-- for that person) only ever reaches someone who can see the roster anyway.

create or replace function public.remove_event_attendee(p_event_id uuid, p_user_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_event events%rowtype;
  v_community communities%rowtype;
begin
  if auth.uid() is null or not can_manage_event(p_event_id) then
    return 'refused';
  end if;

  -- Locked like a sign-up, so a removal and a sign-up for the freed place are
  -- serialised by the capacity trigger's own lock.
  select * into v_event from events where id = p_event_id for update;

  if v_event.cancelled_at is not null then
    return 'cancelled';
  end if;
  if v_event.ends_at <= now() then
    return 'ended';
  end if;

  -- Only a current RSVP — the ones the roster shows and capacity counts.
  if not exists (
    select 1 from event_attendees a
    where a.event_id = p_event_id and a.user_id = p_user_id
  ) or not rsvp_is_current(p_event_id, p_user_id) then
    return 'not_attending';
  end if;

  delete from event_attendees
  where event_id = p_event_id and user_id = p_user_id;

  -- Tied to the event like the cancellation notices, so it is readable only
  -- while its recipient can read the event (notifications_select), and goes
  -- with the event if it is deleted. Someone removing their own RSVP this way
  -- is not told about it.
  if p_user_id <> auth.uid() then
    select * into v_community from communities where id = v_event.community_id;

    insert into notifications (user_id, kind, community_id, title, body, href, event_id)
    values (
      p_user_id,
      'event',
      v_event.community_id,
      case when v_community.default_locale = 'en' then 'Registration removed: ' else 'Påmelding fjernet: ' end
        || v_event.title,
      case
        when v_community.default_locale = 'en' then
          'An organiser removed your registration for an event in ' || v_community.name
          || '. You can sign up again if there is still room.'
        else
          'En arrangør har fjernet påmeldingen din til et arrangement i ' || v_community.name
          || '. Du kan melde deg på igjen hvis det fortsatt er plass.'
      end,
      '/community/' || v_event.community_id || '/events/' || v_event.id,
      v_event.id
    );
  end if;

  return 'ok';
end;
$$;

revoke execute on function public.remove_event_attendee(uuid, uuid) from public, anon;
grant execute on function public.remove_event_attendee(uuid, uuid) to authenticated;

comment on function public.remove_event_attendee(uuid, uuid) is
  'Removes one person''s current RSVP from a scheduled, upcoming event the caller may manage (can_manage_event) and notifies them. Not a ban. Returns ok | refused | cancelled | ended | not_attending.';
