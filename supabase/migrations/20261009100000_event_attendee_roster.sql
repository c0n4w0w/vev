-- Who is coming: a private attendee roster for the people running an event.
--
-- ── What was wrong ──────────────────────────────────────────────────────
--
-- Two things, pointing in opposite directions.
--
--   * A host could not see who had signed up. The event page only ever
--     rendered a count, and nothing resolved an RSVP to a name.
--
--   * Everybody else could. `event_attendees_select` (20261005100000) admitted
--     every current RSVP row to anyone who could read the event, so any member
--     could list the user ids of everyone attending, and the app loaded that
--     list into every event it rendered just to count it.
--
-- Both are fixed by one rule about *who may see the people*, separate from
-- who may see the event.
--
-- ── Who may see the roster ──────────────────────────────────────────────
--
-- For one event, a caller who can read that event (its scope rule still
-- applies, so a host who has left the team or the community loses it) and
-- who is either
--
--   * the event's host, or
--   * an active admin of the event's own community.
--
-- That is the whole event-management model as it stands: `events_insert` is
-- admin-only and there is no update, delete or delegation policy, so nobody
-- else holds management rights over an event. Moderators are deliberately not
-- included — they cannot create events either. A moderator who hosts an event
-- sees its roster as its host. Every check names the event's own community,
-- so an admin elsewhere has nothing to apply.
--
-- ── Who counts ──────────────────────────────────────────────────────────
--
-- Exactly the RSVPs the capacity trigger counts: rsvp_is_current(). A person
-- who has left the subgroup, moved lokallag or lost their membership keeps
-- their row as history but is not on the roster, not in the count and does
-- not hold a seat.

-- ── The rule ────────────────────────────────────────────────────────────
--
-- Answers only about the caller. For an event the caller cannot read it is
-- false, which is the same answer as for an event that does not exist.
create or replace function public.can_view_event_roster(p_event_id uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1
    from events e
    where e.id = p_event_id
      and content_scope_admits(auth.uid(), e.community_id, e.local_group_id, e.subgroup_id)
      and (e.host_id = auth.uid() or is_admin(e.community_id))
  );
$$;

revoke execute on function public.can_view_event_roster(uuid) from public, anon;
grant execute on function public.can_view_event_roster(uuid) to authenticated;

comment on function public.can_view_event_roster(uuid) is
  'Whether the caller may see who is attending this event: its host or an active admin of its community, and only while the caller can read the event under its scope rule.';

-- ── Attendance rows ─────────────────────────────────────────────────────
--
-- Tighter, not wider: a current RSVP is visible to its owner and to the
-- event's roster viewers, and to nobody else. An ordinary member reads their
-- own row (am I going?) and gets the count from event_attendance() below.
drop policy if exists event_attendees_select on public.event_attendees;
create policy event_attendees_select on public.event_attendees for select to authenticated
using (
  can_see_rsvp(event_id, user_id)
  and (user_id = auth.uid() or can_view_event_roster(event_id))
);

comment on policy event_attendees_select on public.event_attendees is
  'A current RSVP (rsvp_is_current) on an event the caller can read, and only the caller''s own unless can_view_event_roster(). Members get counts from event_attendance().';

-- ── Counts for everyone who can read the event ──────────────────────────
--
-- What a member's event card needs and nothing more: how many current RSVPs,
-- and whether one of them is theirs. Events the caller cannot read are left
-- out rather than reported as zero.
create or replace function public.event_attendance(p_event_ids uuid[])
returns table (event_id uuid, attendee_count int, attending boolean)
language sql stable security definer set search_path = public as $$
  select
    e.id,
    (
      select count(*)::int
      from event_attendees a
      where a.event_id = e.id
        and rsvp_is_current(a.event_id, a.user_id)
    ),
    -- The caller can read the event, so their own RSVP is current by the same
    -- rule; no second check needed.
    exists (
      select 1 from event_attendees a
      where a.event_id = e.id and a.user_id = auth.uid()
    )
  from events e
  where e.id = any (p_event_ids)
    and content_scope_admits(auth.uid(), e.community_id, e.local_group_id, e.subgroup_id);
$$;

revoke execute on function public.event_attendance(uuid[]) from public, anon;
grant execute on function public.event_attendance(uuid[]) to authenticated;

comment on function public.event_attendance(uuid[]) is
  'Per readable event: number of current RSVPs (the same rsvp_is_current() the capacity trigger counts) and whether the caller has one. No identities.';

-- ── The roster ──────────────────────────────────────────────────────────
--
-- The current attendees of one event, as they appear in that event's
-- community: user id (the key the app uses for a person), community display
-- name and community profile photo path. Never the account row — no email,
-- handle, account name or bio — and no role or membership details. Returns no
-- rows when the caller may not see the roster, which is indistinguishable
-- from an event nobody has signed up for, or one that does not exist.
create or replace function public.event_attendee_roster(p_event_id uuid)
returns table (user_id uuid, display_name text, avatar_path text)
language sql stable security definer set search_path = public as $$
  select a.user_id, cp.display_name, cp.avatar_path
  from event_attendees a
  join events e on e.id = a.event_id
  left join community_profiles cp
    on cp.community_id = e.community_id and cp.user_id = a.user_id
  where a.event_id = p_event_id
    and can_view_event_roster(p_event_id)
    and rsvp_is_current(a.event_id, a.user_id)
  order by lower(cp.display_name) nulls last, a.user_id;
$$;

revoke execute on function public.event_attendee_roster(uuid) from public, anon;
grant execute on function public.event_attendee_roster(uuid) to authenticated;

comment on function public.event_attendee_roster(uuid) is
  'Current attendees of one event (user_id, community display_name, community avatar_path) for its host and its community''s admins; no rows for anyone else.';

-- ── Profile photos on the roster ────────────────────────────────────────
--
-- The roster shows each attendee's community photo through the member-avatar
-- route, which reads the profile and the object under the caller's own
-- session. Admins already see every active member's community profile; a
-- host who is not an admin needs one more reason: this person is currently
-- attending an event whose roster the caller may see. Same community, same
-- current-RSVP rule, nothing from the account. Recreated from 20261005100000
-- with that one clause added.
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
            and content_scope_admits(auth.uid(), ch.community_id, ch.local_group_id, ch.subgroup_id)
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

-- ── Capacity says nothing to outsiders ──────────────────────────────────
--
-- The capacity trigger runs before row level security checks the new row, so
-- someone who could not read an event but knew its id was told "event_full"
-- rather than refused — enough to learn that a private event exists and is
-- full. A caller who cannot read the event now passes through untouched and
-- is refused by `event_attendees_insert` like any other outsider. Service-role
-- writes (no auth.uid()) are still held to capacity. Otherwise recreated from
-- 20261005100000 unchanged: the same rsvp_is_current() count as the roster.
create or replace function public.enforce_event_capacity()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_capacity int;
  v_taken int;
begin
  if auth.uid() is not null and not can_read_event(new.event_id) then
    return new;
  end if;

  -- Locks the event row, so two people taking the last seat at the same moment
  -- are serialised even though they insert different attendee rows.
  select capacity into v_capacity from events where id = new.event_id for update;

  if v_capacity is null then
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
