-- Collaborations — Step 1B: what the product needs to run the Step 1A model.
--
-- Step 1A (20260928100000) settled who may do what. This migration adds only
-- the narrow surfaces the first usable flow needs, and changes none of those
-- rules:
--
--   1. collaborations.default_locale — which language a collaboration's own
--      screens speak, inherited from the source community at creation.
--   2. collaboration_units() — display names for the participating units the
--      caller may already see, because `communities` and
--      `community_local_groups` are (rightly) unreadable across organisations;
--      plus one documented exception for a pending invitee (see below).
--   2b. collaboration_sponsored_team_state() — Joined/Left for a person the
--      caller's OWN unit sponsored, one sponsorship at a time.
--   3. invite_collaboration_participant_by_slug() — invite an organisation by
--      its exact public slug, the one identifier a manager can know without a
--      directory. No search, no near matches, no lists.
--   4. accept_collaboration_sponsorship_and_join() — "Accept and join" as one
--      transaction instead of two calls that could half-succeed.
--   5. upsert_my_collaboration_profile() — the first write path for the
--      collaboration persona, for the caller's own row only.
--
-- What is deliberately NOT here: any function that lists a community's or a
-- participant's members. Choosing organisers reuses the representative's
-- existing authority over their own organisation's registry (the
-- `memberships` and `community_profiles` policies), so a collaboration never
-- becomes a way to read another organisation's people.

-- ── 1. Locale ───────────────────────────────────────────────────────────
--
-- A collaboration spans communities that may speak different languages, so
-- it needs its own answer. Step 1B: the source community's language, fixed at
-- creation. A local group cannot invent a different one; there is no settings
-- UI yet. Presentation only — nothing authorises on it.

alter table public.collaborations
  add column default_locale text not null default 'nb',
  add constraint collaborations_default_locale_allowed
    check (default_locale in ('nb', 'en'));

comment on column public.collaborations.default_locale is
  'Language of the collaboration''s own screens: nb or en. Inherited from the source community at creation. Presentation only — never consulted for access.';

-- Existing rows (local test data only; none are seeded) take their source
-- community's language: the first participant, which is the source unit.
update public.collaborations c
   set default_locale = src.default_locale
  from (
    select distinct on (p.collaboration_id) p.collaboration_id, cm.default_locale
    from public.collaboration_participants p
    join public.communities cm on cm.id = p.community_id
    order by p.collaboration_id, p.invited_at, p.id
  ) src
 where src.collaboration_id = c.id;

-- Restated from 20260928100000 with one change: the new row takes the source
-- community's default_locale. Everything else — authority, validation, slug
-- handling, enrolment — is unchanged.
create or replace function public.create_collaboration(
  p_source_community_id text,
  p_source_local_group_id uuid,
  p_name text,
  p_slug text,
  p_description text
)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_name text := normalize_display_name(p_name);
  v_description text := nullif(btrim(coalesce(p_description, '')), '');
  v_base text;
  v_slug text;
  v_locale text;
  v_collaboration uuid;
  v_participant uuid;
begin
  if auth.uid() is null then
    return null;
  end if;

  if not can_represent_collaboration_unit(p_source_community_id, p_source_local_group_id, auth.uid())
     or not collaboration_unit_is_valid(p_source_community_id, p_source_local_group_id)
  then
    return null;
  end if;

  if v_name = '' or length(v_name) > 120 then
    return null;
  end if;
  if v_description is not null and length(v_description) > 2000 then
    return null;
  end if;

  -- Truncated before the suffix so a long name still yields a valid slug.
  v_base := btrim(left(local_group_slug(
    coalesce(nullif(btrim(coalesce(p_slug, '')), ''), v_name)
  ), 72), '-');
  if v_base is null or length(v_base) < 3 then
    return null;
  end if;
  v_slug := v_base;
  while exists (select 1 from collaborations c where c.slug = v_slug) loop
    v_slug := v_base || '-' || substr(md5(gen_random_uuid()::text), 1, 6);
  end loop;

  -- The community's language, never the local group's: groups have none.
  select c.default_locale into v_locale from communities c where c.id = p_source_community_id;

  insert into collaborations (slug, name, description, created_by_user_id, default_locale)
  values (v_slug, v_name, v_description, auth.uid(), coalesce(v_locale, 'nb'))
  returning id into v_collaboration;
  perform collaboration_log(v_collaboration, 'collaboration_created');

  insert into collaboration_participants (
    collaboration_id, community_id, local_group_id, status,
    invited_by_user_id, invited_at, responded_by_user_id, responded_at, joined_at
  )
  values (
    v_collaboration, p_source_community_id, p_source_local_group_id, 'active',
    auth.uid(), now(), auth.uid(), now(), now()
  )
  returning id into v_participant;
  perform collaboration_log(v_collaboration, 'participant_accepted', v_participant);

  perform collaboration_enrol_representative(v_collaboration, v_participant);

  return v_collaboration;
end;
$$;

revoke execute on function public.create_collaboration(text, uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.create_collaboration(text, uuid, text, text, text) to authenticated;

-- ── 2. Unit labels ──────────────────────────────────────────────────────
--
-- A TU organiser must be able to read "Tryggere Ruspolitikk – FTR Oslo" on
-- the collaboration page, but cannot read FTR's `communities` row or its local
-- groups, and must not be able to. This returns the NAME of each unit the
-- caller may see — never a member count, never a person, never another local
-- group of that organisation.
--
-- Two branches, and they are deliberately different in what they return:
--
--   A. PARTICIPANT ROWS the caller may already read under Step 1A
--      (can_view_collaboration_participant): effective members and managers,
--      the caller's own organisation's rows, the unit sponsoring them. Full
--      row, except that local_group_id is returned only on units the caller
--      represents — their own organisation's.
--
--   B. THE PENDING-INVITEE EXCEPTION. The representative of an organisation
--      with a PENDING invitation to an ACTIVE collaboration sees the display
--      labels of the units ALREADY TAKING PART, because an organisation has to
--      know who it is being asked to work with before it says yes. This is
--      intentional, and it is narrow:
--        * status = 'active' units only — never other pending invitations,
--          never declined or withdrawn ones;
--        * labels only: organisation name, the unit's own local-group name
--          (the human-readable "Tryggere Ruspolitikk – FTR Oslo" and nothing
--          about that organisation's other groups), and its public portal
--          monogram and colour;
--        * participant_id, community_id and local_group_id are NULL, so the
--          row carries no handle to look anything else up with;
--        * nothing about members, counts, sponsorships or management seats —
--          there is no column for any of it.
--      Rows already returned by A are not repeated here.
--
-- Set-returning, and the only collaboration function that is. The security
-- suites pin that: any other one would be a new lookup surface.
create or replace function public.collaboration_units(p_collaboration_id uuid)
returns table (
  participant_id uuid,
  status public.collaboration_participant_status,
  community_id text,
  community_name text,
  local_group_id uuid,
  local_group_name text,
  accent text,
  monogram text,
  mark_style text,
  represented boolean
)
language sql security definer stable set search_path = public as $$
  with visible as (
    select p.*, can_represent_collaboration_unit(p.community_id, p.local_group_id, auth.uid()) as rep
    from collaboration_participants p
    where p.collaboration_id = p_collaboration_id
      and auth.uid() is not null
      and can_view_collaboration_participant(p.id)
  ),
  pending_invitee as (
    select exists (
      select 1
      from collaboration_participants ip
      join collaborations c on c.id = ip.collaboration_id and c.status = 'active'
      where ip.collaboration_id = p_collaboration_id
        and ip.status = 'invited'
        and can_represent_collaboration_unit(ip.community_id, null, auth.uid())
    ) as yes
  )
  -- A. Rows the caller may already read.
  select
    v.id,
    v.status,
    v.community_id,
    cm.name,
    case when v.rep then v.local_group_id end,
    g.name,
    cm.accent,
    cm.monogram,
    cm.mark_style,
    v.rep
  from visible v
  join communities cm on cm.id = v.community_id
  left join community_local_groups g
    on g.id = v.local_group_id and g.community_id = v.community_id

  union all

  -- B. The pending-invitee exception: labels of active units, nothing else.
  select
    null::uuid,
    p.status,
    null::text,
    cm.name,
    null::uuid,
    g.name,
    cm.accent,
    cm.monogram,
    cm.mark_style,
    false
  from collaboration_participants p
  join communities cm on cm.id = p.community_id
  left join community_local_groups g
    on g.id = p.local_group_id and g.community_id = p.community_id
  where p.collaboration_id = p_collaboration_id
    and p.status = 'active'
    and (select yes from pending_invitee)
    and not exists (select 1 from visible v where v.id = p.id);
$$;

comment on function public.collaboration_units(uuid) is
  'Display labels of the units the caller may see in one collaboration. Branch A: participant rows Step 1A already lets the caller read. Branch B (intentional exception): for the representative of a pending invitation, labels of ACTIVE units only, with participant, community and local-group ids nulled. Never people, counts, sponsorships or seats.';

revoke execute on function public.collaboration_units(uuid) from public, anon, authenticated;
grant execute on function public.collaboration_units(uuid) to authenticated;

-- ── 2b. Your own unit's organisers: are they on the team? ───────────────
--
-- The organiser picker shows, for each person a unit sponsored, whether they
-- are on the team now, have left, declined, or were revoked. The last two are
-- on the sponsorship row the representative can already read. "Joined" versus
-- "Left" lives in `collaboration_members`, which Step 1A shows only to people
-- on the team — and rightly: a representative is not thereby entitled to the
-- team list.
--
-- So this answers exactly one question about exactly one sponsorship, and
-- only for the representative of the SAME participant that issued it:
--
--   * the caller must currently be able to represent that participant;
--   * the sponsorship must be 'accepted' — for any other status the answer is
--     already on the row, and a revoked or declined sponsorship must not become
--     a way to learn whether the person is on the team through someone else;
--   * the person must still belong to the unit — the picker lists only current
--     members, and a former member's activity is none of the unit's business;
--   * the collaboration must be active.
--
-- Returns 'joined', 'left' or 'not_joined', and NULL for every refusal alike.
-- Takes a sponsorship id, which only the person and the issuing unit's
-- representative can read, so it cannot be pointed at anyone else's people and
-- enumerates nothing. Returns a scalar, not rows, and no profile data.
create or replace function public.collaboration_sponsored_team_state(p_sponsorship_id uuid)
returns text
language sql security definer stable set search_path = public as $$
  select case cm.status
           when 'active' then 'joined'
           when 'left' then 'left'
           else 'not_joined'
         end
  from collaboration_member_sponsorships s
  join collaboration_participants p
    on p.id = s.participant_id and p.collaboration_id = s.collaboration_id
  join collaborations c on c.id = s.collaboration_id and c.status = 'active'
  left join collaboration_members cm
    on cm.collaboration_id = s.collaboration_id and cm.user_id = s.user_id
  where s.id = p_sponsorship_id
    and s.status = 'accepted'
    and auth.uid() is not null
    and can_represent_collaboration_unit(p.community_id, p.local_group_id, auth.uid())
    and collaboration_unit_includes(p.community_id, p.local_group_id, s.user_id);
$$;

comment on function public.collaboration_sponsored_team_state(uuid) is
  'For the representative of the issuing participant only: whether the person behind one ACCEPTED sponsorship, still in the unit, is on the team (joined / left / not_joined). NULL otherwise. Scalar; no profile data.';

revoke execute on function public.collaboration_sponsored_team_state(uuid) from public, anon, authenticated;
grant execute on function public.collaboration_sponsored_team_state(uuid) to authenticated;

-- ── 3. Invite by exact slug ─────────────────────────────────────────────
--
-- The manager types what they already know — a community's public slug (the
-- server action also accepts its portal URL and reduces it to the slug). This
-- resolves EXACTLY one community or nothing: no prefix match, no case folding
-- beyond lower(), no suggestions. The manager check runs first, so a
-- non-manager learns nothing about whether a slug exists.
--
-- The name comes back only after the invitation was actually created, which
-- is the one moment the manager has earned it. On every refusal — not a
-- manager, malformed, unknown, already invited, already taking part — both
-- columns are null: one generic answer. Returns a single row, not a set.
create or replace function public.invite_collaboration_participant_by_slug(
  p_collaboration_id uuid,
  p_slug text,
  out participant_id uuid,
  out community_name text
)
language plpgsql security definer set search_path = public as $$
declare
  v_slug text := lower(btrim(coalesce(p_slug, '')));
  v_community communities%rowtype;
begin
  if not is_collaboration_manager(p_collaboration_id) then
    return;
  end if;

  if v_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' or length(v_slug) > 80 then
    return;
  end if;

  select * into v_community from communities c where c.slug = v_slug;
  if v_community.id is null then
    return;
  end if;

  participant_id := invite_collaboration_participant(p_collaboration_id, v_community.id);
  if participant_id is not null then
    community_name := v_community.name;
  end if;
end;
$$;

revoke execute on function public.invite_collaboration_participant_by_slug(uuid, text) from public, anon, authenticated;
grant execute on function public.invite_collaboration_participant_by_slug(uuid, text) to authenticated;

-- ── 4. Accept and join, atomically ──────────────────────────────────────
--
-- The two Step 1A steps, unchanged, in one transaction. Composing them from
-- the application would leave an accepted-but-not-joined sponsorship whenever
-- the second call failed; here either both happen or neither does.
--
-- The sponsorship is found by (id, auth.uid()) inside
-- respond_to_collaboration_sponsorship(), so nobody can accept for someone
-- else; join_collaboration() re-checks that the sponsorship grants access
-- right now. Retrying after success returns true and changes nothing, since
-- both inner steps are idempotent.
create or replace function public.accept_collaboration_sponsorship_and_join(p_sponsorship_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  v_collaboration uuid;
begin
  if auth.uid() is null then
    return false;
  end if;

  select s.collaboration_id into v_collaboration
  from collaboration_member_sponsorships s
  where s.id = p_sponsorship_id and s.user_id = auth.uid();
  if v_collaboration is null then
    return false;
  end if;

  -- A block with an exception handler is a subtransaction: raising inside it
  -- undoes the acceptance if the join is refused.
  begin
    if not respond_to_collaboration_sponsorship(p_sponsorship_id, true) then
      return false;
    end if;
    if not join_collaboration(v_collaboration) then
      raise exception using errcode = 'TC001', message = 'join refused';
    end if;
  exception when sqlstate 'TC001' then
    return false;
  end;

  return true;
end;
$$;

revoke execute on function public.accept_collaboration_sponsorship_and_join(uuid) from public, anon, authenticated;
grant execute on function public.accept_collaboration_sponsorship_and_join(uuid) to authenticated;

-- ── 5. Your collaboration persona ───────────────────────────────────────
--
-- The caller's own row only — whose row comes from auth.uid(), never from an
-- argument — and only with effective access right now: a manager without a
-- team seat, a sponsored person who has not joined, or someone whose
-- sponsorship lapsed cannot create or change one.
--
-- Same rules as update_my_community_profile(): normalize_display_name() (which
-- strips edge whitespace and characters that draw nothing), 1–80 characters,
-- bio trimmed and at most 500. Nothing is read from `profiles` or
-- `community_profiles`: a "start from my profile in X" choice is made in the
-- interface and arrives here as ordinary text, after which the two are
-- unrelated rows.
create or replace function public.upsert_my_collaboration_profile(
  p_collaboration_id uuid,
  p_display_name text,
  p_bio text
)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  v_name text := normalize_display_name(p_display_name);
  v_bio text := btrim(coalesce(p_bio, ''));
begin
  if auth.uid() is null or not has_collaboration_access(p_collaboration_id) then
    return false;
  end if;

  if v_name = '' or length(v_name) > 80 or length(v_bio) > 500 then
    return false;
  end if;

  insert into collaboration_profiles (collaboration_id, user_id, display_name, bio)
  values (p_collaboration_id, auth.uid(), v_name, v_bio)
  on conflict (collaboration_id, user_id) do update
    set display_name = excluded.display_name,
        bio = excluded.bio,
        updated_at = now();

  return true;
end;
$$;

revoke execute on function public.upsert_my_collaboration_profile(uuid, text, text) from public, anon, authenticated;
grant execute on function public.upsert_my_collaboration_profile(uuid, text, text) to authenticated;
