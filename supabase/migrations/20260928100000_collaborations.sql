-- Cross-organisation collaborations — Step 1A: schema and authorisation only.
--
-- A collaboration is the private workspace a few organisations use to make
-- something happen together: a seminar co-organised by Tryggere Ungdom,
-- Tryggere Ruspolitikk's Oslo lokallag and a third organisation, say. It is a
-- first-class object, not a fake `communities` row: several independent
-- organisations take part, participation can be temporary, only selected
-- people enter, and each organisation stays authoritative over its own people.
--
-- ── Three things that must never be confused ────────────────────────────
--
--   1. PARTICIPANTS — which organisational units take part institutionally.
--      A unit is a whole community, or one local group inside a community.
--      (`collaboration_participants`, managed through the participants'
--      management seats in `collaboration_manager_participants`)
--
--   2. THE TEAM — which individual people have been selected by their own
--      organisation, have said yes, and have joined.
--      (`collaboration_member_sponsorships` + `collaboration_members`)
--
--   3. THE AUDIENCE — who may attend a public event the collaboration
--      produces. Not modelled here at all. Collaboration membership controls
--      the private organiser workspace and nothing else; it says nothing about
--      who may come to the seminar. That will be a separate feature.
--
-- ── The invariant everything below serves ───────────────────────────────
--
-- A participating unit decides which of ITS OWN people it contributes.
-- Organisation A can never ask "give me Organisation B's members" — nor "give
-- me Organisation B's local groups". It sees a person from B only once B has
-- sponsored that specific person, the person has accepted, and they have
-- joined — and even then only their (future) collaboration profile, never B's
-- membership row or community profile.
--
-- Organisational participation is therefore NOT individual access. No row in
-- this migration is ever populated from "every member of a participant", and
-- there is deliberately no function that lists a participant's members or a
-- community's local groups to anyone outside that community.
--
-- ── Representation is not membership ────────────────────────────────────
--
-- Two questions, two functions, never merged:
--
--   can_represent_collaboration_unit(unit, person)
--     AUTHORITY to act for the unit: accept or decline its invitation,
--     sponsor or revoke its people, withdraw it, and exercise the unit's
--     collaboration management seat.
--
--   collaboration_unit_includes(unit, person)
--     The actual ORGANISATIONAL RELATIONSHIP: is this person currently one of
--     the unit's people? Only this decides sponsorship eligibility and access.
--
-- TING has no authenticated local-group-manager model today. `community_people`
-- rows of section 'local_group_leader' are organisation-published contact
-- entries — a name and an email, optionally linked to an account by an admin —
-- and they carry no authority anywhere. Moderators moderate content. So in v1
-- the community's single active administrator represents the whole community
-- AND each of its local groups. That makes the FTR administrator able to act
-- for FTR Oslo; it does NOT make them an Oslo member. They get a seat on the
-- team through FTR Oslo only if they actually belong to FTR Oslo.
--
-- ── Institutional layer vs team layer ───────────────────────────────────
--
--   manager  := collaboration active
--               AND some participant P holds a management seat
--               AND P is in force (active, unit still valid)
--               AND the caller can CURRENTLY represent P's unit
--
--   access   := collaboration active
--               AND collaboration_members(c, u).status = 'active'
--               AND at least one sponsorship s of u in c where
--                     s.status = 'accepted'
--                 AND participant(s) is in force
--                 AND collaboration_unit_includes(unit(s), u)
--
-- The management seat belongs to the participating UNIT, not to whoever
-- represented it when it joined: when FTR changes administrator, the old one
-- stops being a manager and the new one becomes one on the next query, with no
-- row written. A manager coordinates the collaboration between organisations;
-- they need not be on the team. A team member works in the workspace; they
-- need not be a manager. Every clause is evaluated live, so losing the admin
-- role, leaving
-- the organisation, moving out of the lokallag, the lokallag being retired,
-- the unit withdrawing, or a revoked sponsorship all take effect on the next
-- query with no synchronisation job.
--
-- ── Surface ─────────────────────────────────────────────────────────────
--
-- Clients can SELECT these tables through RLS and nothing else. Every write is
-- one of the SECURITY DEFINER functions at the bottom, each of which takes the
-- actor from auth.uid() and never from an argument. Helpers that take a user id
-- are internal and not executable by any API role. There is no client path to
-- archive a collaboration: archiving governance across independent
-- organisations is a later design, and a single manager must not hold it.

-- ── Types ───────────────────────────────────────────────────────────────

create type public.collaboration_status as enum ('active', 'archived');
create type public.collaboration_participant_status as enum ('invited', 'active', 'declined', 'left');
create type public.collaboration_sponsorship_status as enum ('invited', 'accepted', 'declined', 'revoked');
create type public.collaboration_member_status as enum ('active', 'left');

-- ── collaborations ──────────────────────────────────────────────────────

create table public.collaborations (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  description text,
  status public.collaboration_status not null default 'active',
  created_by_user_id uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Set only by maintenance (service role) in Step 1A. There is no client
  -- archive function; see the note at the top.
  archived_at timestamptz,

  constraint collaborations_slug_shape check (
    slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(slug) between 3 and 80
  ),
  constraint collaborations_name_present check (
    name = public.normalize_display_name(name) and length(name) between 1 and 120
  ),
  constraint collaborations_description_length check (
    description is null or length(description) <= 2000
  ),
  constraint collaborations_archive_consistent check (
    (status = 'archived') = (archived_at is not null)
  )
);

comment on table public.collaborations is
  'A private cross-organisation workspace. Readable per can_view_collaboration(); written only through the collaboration RPCs. Not a community, and not an event audience. Archiving has no client path in Step 1A.';

-- ── collaboration_participants ──────────────────────────────────────────
--
-- One row per organisation's participation, from invitation to departure.
--
-- An INVITATION names a community and nothing more. The inviting side never
-- needs, and cannot supply, the other organisation's local-group ids — it
-- cannot even read them. The invited community's own representative chooses,
-- at acceptance, which of its units takes part: the whole community, or one of
-- its own local groups. So while a row is 'invited' or 'declined',
-- local_group_id is always null and means "no unit chosen"; once 'active' (and
-- afterwards, 'left') it is fixed: null for the whole community, set for that
-- one lokallag. The invitation, the choice and who made it survive on the same
-- row and in the audit log.
--
-- The local-group foreign key is composite, as on `memberships`: with MATCH
-- SIMPLE a null local_group_id is not checked, and when it is set the
-- (group, community) pair must exist — so a row claiming "FTR Oslo inside
-- Tryggere Ungdom" cannot be stored however the values got there.
--
-- At most one pending invitation per community, and at most one active row
-- per unit. Declined and left rows are history; a later re-invitation creates
-- a fresh row. That is deliberate: sponsorships hang off the participant row,
-- so a lokallag that withdraws and later comes back starts with no
-- sponsorships rather than silently resurrecting the people it had contributed.
--
-- A whole community and one of its local groups (FTR and FTR Oslo) are two
-- different units and may both be active. Each has its own sponsorships and
-- neither implies the other; access is "at least one valid sponsorship", a
-- boolean, so being sponsored by both grants nothing extra.

create table public.collaboration_participants (
  id uuid primary key default gen_random_uuid(),
  collaboration_id uuid not null references public.collaborations (id) on delete cascade,
  community_id text not null references public.communities (id) on delete cascade,
  local_group_id uuid,
  status public.collaboration_participant_status not null default 'invited',
  invited_by_user_id uuid references public.profiles (id) on delete set null,
  invited_at timestamptz not null default now(),
  responded_by_user_id uuid references public.profiles (id) on delete set null,
  responded_at timestamptz,
  joined_at timestamptz,
  left_at timestamptz,
  left_by_user_id uuid references public.profiles (id) on delete set null,

  -- Lets sponsorships and management seats reference (participant,
  -- collaboration) as a pair, so neither can name a participant of another
  -- collaboration.
  unique (id, collaboration_id),

  constraint collaboration_participants_local_group_fkey
    foreign key (local_group_id, community_id)
    references public.community_local_groups (id, community_id)
    on delete restrict,

  constraint collaboration_participants_lifecycle check (
    case status
      when 'invited'  then local_group_id is null and responded_at is null and joined_at is null and left_at is null
      when 'declined' then local_group_id is null and responded_at is not null and joined_at is null and left_at is null
      when 'active'   then responded_at is not null and joined_at is not null and left_at is null
      when 'left'     then joined_at is not null and left_at is not null
    end
  )
);

create unique index collaboration_participants_one_pending_invitation_idx
  on public.collaboration_participants (collaboration_id, community_id)
  where status = 'invited';

create unique index collaboration_participants_one_active_unit_idx
  on public.collaboration_participants (collaboration_id, community_id, local_group_id)
  nulls not distinct
  where status = 'active';

create index collaboration_participants_community_idx
  on public.collaboration_participants (community_id, status);

comment on table public.collaboration_participants is
  'Organisational units (a community, or one local group of it) taking part in a collaboration. An invitation names only the community; the invited community chooses its unit at acceptance. Participation never exposes or admits the unit''s members.';
comment on column public.collaboration_participants.local_group_id is
  'Null while invited/declined (no unit chosen yet). Once active: null for the whole community, set for that local group. Constrained to a group of community_id by a composite foreign key.';

-- ── collaboration_manager_participants ─────────────────────────────────
--
-- Management seats, held by PARTICIPANTS. There is deliberately no user_id:
-- the seat belongs to the organisational unit, and whoever can currently
-- represent that unit exercises it (is_collaboration_manager()). Succession is
-- therefore automatic — a new FTR administrator can use FTR Oslo's seat the
-- moment they become administrator, and the previous one loses it at the same
-- moment — and a stale person cannot linger in a row that grants them anything.
--
-- granted_by_user_id is audit provenance only (who caused the seat to exist:
-- the creator, or the representative who accepted). Nothing reads it for
-- authorisation.
--
-- In v1 every unit that creates or accepts receives a seat. A seat is only
-- usable while its participant is in force, so withdrawal or a retired
-- lokallag disables it without deleting it.
--
-- Future delegated, personal managers are a different kind of authority —
-- a named person, granted by the participating units, with its own validity
-- rule — and belong in their own table, OR-ed into is_collaboration_manager().
-- They are not modelled here, and nothing about this table anticipates them.

create table public.collaboration_manager_participants (
  collaboration_id uuid not null references public.collaborations (id) on delete cascade,
  participant_id uuid not null,
  created_at timestamptz not null default now(),
  granted_by_user_id uuid references public.profiles (id) on delete set null,
  primary key (collaboration_id, participant_id),

  constraint collaboration_manager_participants_participant_fkey
    foreign key (participant_id, collaboration_id)
    references public.collaboration_participants (id, collaboration_id)
    on delete cascade
);

comment on table public.collaboration_manager_participants is
  'Collaboration management seats held by participating units. Exercised by whoever can currently represent the unit; see is_collaboration_manager(). granted_by_user_id is audit provenance, never authorisation.';

-- ── collaboration_member_sponsorships ───────────────────────────────────
--
-- The critical table. A participant unit's representative names one known
-- person who actually belongs to that unit; the person accepts or declines
-- themselves. This is the only route by which a person becomes eligible to
-- join, and it is always one unit vouching for one of its own people.
--
-- At most one LIVE sponsorship (invited or accepted) per (participant,
-- person); declined and revoked rows remain as history.

create table public.collaboration_member_sponsorships (
  id uuid primary key default gen_random_uuid(),
  collaboration_id uuid not null,
  participant_id uuid not null,
  user_id uuid not null references public.profiles (id) on delete cascade,
  status public.collaboration_sponsorship_status not null default 'invited',
  invited_by_user_id uuid references public.profiles (id) on delete set null,
  invited_at timestamptz not null default now(),
  responded_at timestamptz,
  revoked_at timestamptz,
  revoked_by_user_id uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint collaboration_member_sponsorships_participant_fkey
    foreign key (participant_id, collaboration_id)
    references public.collaboration_participants (id, collaboration_id)
    on delete cascade,

  constraint collaboration_member_sponsorships_lifecycle check (
    case status
      when 'invited'  then responded_at is null and revoked_at is null
      when 'accepted' then responded_at is not null and revoked_at is null
      when 'declined' then responded_at is not null and revoked_at is null
      when 'revoked'  then revoked_at is not null
    end
  )
);

create unique index collaboration_member_sponsorships_one_live_idx
  on public.collaboration_member_sponsorships (collaboration_id, participant_id, user_id)
  where status in ('invited', 'accepted');

create index collaboration_member_sponsorships_user_idx
  on public.collaboration_member_sponsorships (user_id, collaboration_id, status);

create index collaboration_member_sponsorships_participant_idx
  on public.collaboration_member_sponsorships (participant_id, status);

comment on table public.collaboration_member_sponsorships is
  'One participant unit vouching for one of its own people. Issued and revoked only by that unit''s representative; accepted or declined only by the person. Provenance is private to the person and the sponsoring unit.';

-- ── collaboration_members ───────────────────────────────────────────────
--
-- People who deliberately joined. Never populated from an organisation's
-- membership. A row here is necessary for access but not sufficient: see
-- has_collaboration_access().

create table public.collaboration_members (
  collaboration_id uuid not null references public.collaborations (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  status public.collaboration_member_status not null default 'active',
  joined_at timestamptz not null default now(),
  left_at timestamptz,
  primary key (collaboration_id, user_id),

  constraint collaboration_members_lifecycle check (
    (status = 'left') = (left_at is not null)
  )
);

create index collaboration_members_user_idx
  on public.collaboration_members (user_id, status);

comment on table public.collaboration_members is
  'People who opted in and joined. Not the membership of any participating organisation. joined_at is the most recent join; the full history is in collaboration_audit_log.';

-- ── collaboration_profiles ──────────────────────────────────────────────
--
-- Foundation only. Nothing creates these rows in Step 1A: no trigger, no copy
-- from `profiles` or from any `community_profiles` row. A person who appears as
-- "Omar Nawaz" in FTR, "Omar" in TU and "Night Owl" in UTR must be able to
-- join a collaboration of FTR and UTR without either name following them in.
-- Step 1B defines explicit persona onboarding; until then a joined member
-- simply has no collaboration profile.
--
-- The composite foreign key to collaboration_members means a profile can only
-- exist for someone who has actually joined.

create table public.collaboration_profiles (
  collaboration_id uuid not null,
  user_id uuid not null,
  display_name text,
  bio text,
  avatar_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (collaboration_id, user_id),

  constraint collaboration_profiles_member_fkey
    foreign key (collaboration_id, user_id)
    references public.collaboration_members (collaboration_id, user_id)
    on delete cascade,

  constraint collaboration_profiles_display_name_shape check (
    display_name is null
    or (display_name = public.normalize_display_name(display_name) and length(display_name) between 1 and 80)
  ),
  constraint collaboration_profiles_bio_length check (bio is null or length(bio) <= 500),
  -- `<collaboration_id>/<user_id>/<uuid>.<ext>`, the same shape as member
  -- avatars, so a future upload flow can only point at the person's own files.
  constraint collaboration_profiles_avatar_path_shape check (
    avatar_path is null
    or (
      avatar_path ~ '^[0-9a-f-]{36}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpg|webp)$'
      and split_part(avatar_path, '/', 1) = collaboration_id::text
      and split_part(avatar_path, '/', 2) = user_id::text
    )
  )
);

comment on table public.collaboration_profiles is
  'How a person appears inside one collaboration. Never copied from profiles or community_profiles. Empty in Step 1A; explicit onboarding arrives in Step 1B.';

-- ── collaboration_audit_log ─────────────────────────────────────────────
--
-- Append-only history of every transition, written only by the functions
-- below with the actor taken from auth.uid(). The row tables carry the latest
-- actor and time for each step; this keeps the ones a later step overwrites
-- (a member leaving and rejoining) and records, for participant events, which
-- unit was concerned at that moment. No client can read or write it.

create table public.collaboration_audit_log (
  id bigint generated always as identity primary key,
  collaboration_id uuid not null references public.collaborations (id) on delete cascade,
  actor_user_id uuid references public.profiles (id) on delete set null,
  action text not null,
  participant_id uuid references public.collaboration_participants (id) on delete cascade,
  -- The unit at the time of the event. Plain columns, not foreign keys: this
  -- is history and must say what was true then.
  community_id text,
  local_group_id uuid,
  sponsorship_id uuid references public.collaboration_member_sponsorships (id) on delete cascade,
  subject_user_id uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),

  constraint collaboration_audit_log_action_known check (action in (
    'collaboration_created',
    'participant_invited',
    'participant_accepted',
    'participant_declined',
    'participant_left',
    'sponsorship_invited',
    'sponsorship_accepted',
    'sponsorship_declined',
    'sponsorship_revoked',
    'member_joined',
    'member_left',
    'manager_seat_granted'
  ))
);

create index collaboration_audit_log_collaboration_idx
  on public.collaboration_audit_log (collaboration_id, created_at);

comment on table public.collaboration_audit_log is
  'Append-only transition history for collaborations. Service role only.';

-- ── Grants on tables ────────────────────────────────────────────────────
--
-- Supabase's default privileges hand every new table to anon and authenticated
-- with full DML. Take all of it back, then give authenticated SELECT only; RLS
-- decides which rows. anon gets nothing at all. The audit log gets no client
-- grant of any kind.

revoke all on public.collaborations from anon, authenticated;
revoke all on public.collaboration_participants from anon, authenticated;
revoke all on public.collaboration_manager_participants from anon, authenticated;
revoke all on public.collaboration_member_sponsorships from anon, authenticated;
revoke all on public.collaboration_members from anon, authenticated;
revoke all on public.collaboration_profiles from anon, authenticated;
revoke all on public.collaboration_audit_log from anon, authenticated;

grant select on public.collaborations to authenticated;
grant select on public.collaboration_participants to authenticated;
grant select on public.collaboration_manager_participants to authenticated;
grant select on public.collaboration_member_sponsorships to authenticated;
grant select on public.collaboration_members to authenticated;
grant select on public.collaboration_profiles to authenticated;

alter table public.collaborations enable row level security;
alter table public.collaboration_participants enable row level security;
alter table public.collaboration_manager_participants enable row level security;
alter table public.collaboration_member_sponsorships enable row level security;
alter table public.collaboration_members enable row level security;
alter table public.collaboration_profiles enable row level security;
alter table public.collaboration_audit_log enable row level security;

-- ═══════════════════════════════════════════════════════════════════════
-- Internal helpers. Not executable by any API role. Those taking a user id
-- would otherwise be oracles for "is person X in unit Y?"; the rest are
-- building blocks with no reason to be reachable. They are called only from
-- the SECURITY DEFINER functions further down, which run as the owner and
-- pass auth.uid().
-- ═══════════════════════════════════════════════════════════════════════

-- Whether a unit is organisationally valid at all, right now: the community
-- exists, and a named local group belongs to it and has not been retired
-- (`community_local_groups.active`). The ONE place the retirement rule lives;
-- every "does this unit still count" question below goes through it.
create or replace function public.collaboration_unit_is_valid(
  p_community_id text,
  p_local_group_id uuid
)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (select 1 from communities c where c.id = p_community_id)
    and (
      p_local_group_id is null
      or exists (
        select 1 from community_local_groups g
        where g.id = p_local_group_id
          and g.community_id = p_community_id
          and g.active
      )
    );
$$;

-- AUTHORITY to act for a unit. v1: the parent community's single active
-- administrator, for the whole community and for each of its own local
-- groups alike. Moderators, ordinary members and `community_people` contacts
-- are not representatives. The group only has to belong to the community, not
-- be active: a representative must still be able to withdraw a retired unit
-- or revoke its sponsorships. What a retired unit can no longer do is decided
-- by collaboration_unit_is_valid(), not here.
--
-- This is the single place to change when delegated lokallag administration
-- arrives: add "or p_user_id is an authenticated manager of p_local_group_id".
--
-- Says nothing about whether the person BELONGS to the unit. See
-- collaboration_unit_includes().
create or replace function public.can_represent_collaboration_unit(
  p_community_id text,
  p_local_group_id uuid,
  p_user_id uuid
)
returns boolean language sql security definer stable set search_path = public as $$
  select p_user_id is not null
    and exists (
      select 1
      from memberships m
      where m.community_id = p_community_id
        and m.user_id = p_user_id
        and m.status = 'active'
        and m.role = 'admin'
    )
    and (
      p_local_group_id is null
      or exists (
        select 1 from community_local_groups g
        where g.id = p_local_group_id and g.community_id = p_community_id
      )
    );
$$;

-- Whether a person CURRENTLY belongs to a unit — the actual organisational
-- relationship, and the only thing sponsorship eligibility and access rest on.
--
--   whole community: an active membership of it.
--   local group:     an active membership of the parent community whose
--                    local_group_id is that group, and the group is not
--                    retired.
--
-- Representation plays no part: the FTR administrator is not an FTR Oslo
-- person unless their own membership says so.
--
-- This is also the trust seam. Today the answer comes from TING's own tables;
-- a later phase can answer it from an organisation-issued attestation instead,
-- and every policy that depends on it keeps working unchanged.
create or replace function public.collaboration_unit_includes(
  p_community_id text,
  p_local_group_id uuid,
  p_user_id uuid
)
returns boolean language sql security definer stable set search_path = public as $$
  select p_user_id is not null
    and collaboration_unit_is_valid(p_community_id, p_local_group_id)
    and exists (
      select 1
      from memberships m
      where m.community_id = p_community_id
        and m.user_id = p_user_id
        and m.status = 'active'
        and (p_local_group_id is null or m.local_group_id = p_local_group_id)
    );
$$;

-- Whether a participant row can currently confer anything — sponsorship
-- validity or manager authority: it is active, and its unit is still valid.
-- A retired lokallag's participant keeps its row and its history and simply
-- stops counting; reinstating the group restores it, live.
create or replace function public.collaboration_participant_in_force(p_participant_id uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from collaboration_participants p
    where p.id = p_participant_id
      and p.status = 'active'
      and collaboration_unit_is_valid(p.community_id, p.local_group_id)
  );
$$;

-- At least one sponsorship of this person that grants access right now.
create or replace function public.collaboration_has_valid_sponsorship(
  p_collaboration_id uuid,
  p_user_id uuid
)
returns boolean language sql security definer stable set search_path = public as $$
  select p_user_id is not null and exists (
    select 1
    from collaboration_member_sponsorships s
    join collaboration_participants p
      on p.id = s.participant_id and p.collaboration_id = s.collaboration_id
    where s.collaboration_id = p_collaboration_id
      and s.user_id = p_user_id
      and s.status = 'accepted'
      and collaboration_participant_in_force(p.id)
      and collaboration_unit_includes(p.community_id, p.local_group_id, p_user_id)
  );
$$;

-- The effective-access formula, for any person. Internal twin of
-- has_collaboration_access(), which is the only form a client can call.
create or replace function public.collaboration_user_has_access(
  p_collaboration_id uuid,
  p_user_id uuid
)
returns boolean language sql security definer stable set search_path = public as $$
  select p_user_id is not null
    and exists (
      select 1 from collaborations c
      where c.id = p_collaboration_id and c.status = 'active'
    )
    and exists (
      select 1 from collaboration_members cm
      where cm.collaboration_id = p_collaboration_id
        and cm.user_id = p_user_id
        and cm.status = 'active'
    )
    and collaboration_has_valid_sponsorship(p_collaboration_id, p_user_id);
$$;

create or replace function public.collaboration_log(
  p_collaboration_id uuid,
  p_action text,
  p_participant_id uuid default null,
  p_sponsorship_id uuid default null,
  p_subject_user_id uuid default null
)
returns void language sql security definer set search_path = public as $$
  insert into collaboration_audit_log (
    collaboration_id, actor_user_id, action, participant_id,
    community_id, local_group_id, sponsorship_id, subject_user_id
  )
  select
    p_collaboration_id, auth.uid(), p_action, p_participant_id,
    p.community_id, p.local_group_id, p_sponsorship_id, p_subject_user_id
  from (select 1) as one
  left join collaboration_participants p on p.id = p_participant_id;
$$;

-- The setup step for a unit's own representative, run transactionally by the
-- two functions that bring a unit in (create, accept). Both have already
-- checked that auth.uid() can represent p_participant_id. Never granted: it is
-- the "auto-enrolment exception" and exists so those two cannot drift apart.
--
--   * Always: a management seat for the PARTICIPANT (not for the caller).
--     The caller can use it because they represent the unit right now; so
--     can whoever represents it next.
--   * Only if the representative actually BELONGS to the unit: their own
--     accepted sponsorship through it and an active team membership. The FTR
--     administrator accepting on behalf of FTR Oslo without being an Oslo
--     member manages FTR Oslo's participation and is not put on the team
--     through Oslo — no sponsorship is fabricated to make that work.
create or replace function public.collaboration_enrol_representative(
  p_collaboration_id uuid,
  p_participant_id uuid
)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_p collaboration_participants%rowtype;
  v_sponsorship uuid;
begin
  select * into v_p from collaboration_participants
  where id = p_participant_id and collaboration_id = p_collaboration_id;

  insert into collaboration_manager_participants
    (collaboration_id, participant_id, granted_by_user_id)
  values
    (p_collaboration_id, p_participant_id, auth.uid())
  on conflict (collaboration_id, participant_id) do nothing;
  if found then
    perform collaboration_log(p_collaboration_id, 'manager_seat_granted', p_participant_id);
  end if;

  if not collaboration_unit_includes(v_p.community_id, v_p.local_group_id, auth.uid()) then
    return;
  end if;

  -- A live invitation already addressed to them through this unit is accepted
  -- rather than duplicated.
  update collaboration_member_sponsorships
     set status = 'accepted', responded_at = now(), updated_at = now()
   where collaboration_id = p_collaboration_id
     and participant_id = p_participant_id
     and user_id = auth.uid()
     and status = 'invited'
  returning id into v_sponsorship;

  if v_sponsorship is null and not exists (
    select 1 from collaboration_member_sponsorships
    where collaboration_id = p_collaboration_id
      and participant_id = p_participant_id
      and user_id = auth.uid()
      and status = 'accepted'
  ) then
    insert into collaboration_member_sponsorships
      (collaboration_id, participant_id, user_id, status, invited_by_user_id, responded_at)
    values
      (p_collaboration_id, p_participant_id, auth.uid(), 'accepted', auth.uid(), now())
    returning id into v_sponsorship;
  end if;

  if v_sponsorship is not null then
    perform collaboration_log(p_collaboration_id, 'sponsorship_accepted', p_participant_id, v_sponsorship, auth.uid());
  end if;

  insert into collaboration_members (collaboration_id, user_id, status, joined_at)
  values (p_collaboration_id, auth.uid(), 'active', now())
  on conflict (collaboration_id, user_id) do update
    set status = 'active', joined_at = now(), left_at = null
    where collaboration_members.status <> 'active';
  if found then
    perform collaboration_log(p_collaboration_id, 'member_joined', p_participant_id, null, auth.uid());
  end if;
end;
$$;

revoke execute on function public.collaboration_unit_is_valid(text, uuid) from public, anon, authenticated;
revoke execute on function public.can_represent_collaboration_unit(text, uuid, uuid) from public, anon, authenticated;
revoke execute on function public.collaboration_unit_includes(text, uuid, uuid) from public, anon, authenticated;
revoke execute on function public.collaboration_participant_in_force(uuid) from public, anon, authenticated;
revoke execute on function public.collaboration_has_valid_sponsorship(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.collaboration_user_has_access(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.collaboration_log(uuid, text, uuid, uuid, uuid) from public, anon, authenticated;
revoke execute on function public.collaboration_enrol_representative(uuid, uuid) from public, anon, authenticated;

-- ═══════════════════════════════════════════════════════════════════════
-- Caller-scoped helpers. Each answers only about auth.uid(); none takes a
-- person to ask about except can_view_collaboration_member(), which answers
-- only inside a collaboration the caller already has access to. Executable by
-- authenticated because RLS policies run as the caller.
-- ═══════════════════════════════════════════════════════════════════════

create or replace function public.has_collaboration_access(p_collaboration_id uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select collaboration_user_has_access(p_collaboration_id, auth.uid());
$$;

-- Management, derived entirely from the present: the collaboration is
-- active, and some participant holding a management seat is in force and is
-- one the caller can CURRENTLY represent. No user id is stored or consulted,
-- so administrator succession needs no write, and a former administrator is
-- refused on the next call. Team membership is neither required nor
-- sufficient — management is institutional.
--
-- Extension point: a future delegated personal manager is a second, separate
-- clause OR-ed in here, with its own table and its own rule.
create or replace function public.is_collaboration_manager(p_collaboration_id uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select auth.uid() is not null and exists (
    select 1
    from collaboration_manager_participants seat
    join collaborations c on c.id = seat.collaboration_id
    join collaboration_participants p
      on p.id = seat.participant_id and p.collaboration_id = seat.collaboration_id
    where seat.collaboration_id = p_collaboration_id
      and c.status = 'active'
      and collaboration_participant_in_force(p.id)
      and can_represent_collaboration_unit(p.community_id, p.local_group_id, auth.uid())
  );
$$;

-- Whether the caller represents the unit behind one participant row.
create or replace function public.represents_collaboration_participant(p_participant_id uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from collaboration_participants p
    where p.id = p_participant_id
      and can_represent_collaboration_unit(p.community_id, p.local_group_id, auth.uid())
  );
$$;

-- Who may read a collaboration row at all. No discovery: nothing here is true
-- for someone without a specific, current relationship to this collaboration.
--
--   * effective access;
--   * representative of a unit that is invited or active in it — enough to
--     answer the invitation, and to manage its own participation (this
--     includes every effective manager);
--   * a person with a live sponsorship in it — enough to know what they are
--     being asked to join.
--
-- An archived collaboration is visible to none of these in Step 1A.
create or replace function public.can_view_collaboration(p_collaboration_id uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select auth.uid() is not null
    and exists (
      select 1 from collaborations c
      where c.id = p_collaboration_id and c.status = 'active'
    )
    and (
      collaboration_user_has_access(p_collaboration_id, auth.uid())
      or exists (
        select 1 from collaboration_participants p
        where p.collaboration_id = p_collaboration_id
          and p.status in ('invited', 'active')
          and can_represent_collaboration_unit(p.community_id, p.local_group_id, auth.uid())
      )
      or exists (
        select 1
        from collaboration_member_sponsorships s
        join collaboration_participants p on p.id = s.participant_id
        where s.collaboration_id = p_collaboration_id
          and s.user_id = auth.uid()
          and s.status in ('invited', 'accepted')
          and p.status = 'active'
      )
    );
$$;

-- Which participant rows the caller may read. Effective members see which
-- ORGANISATIONAL UNITS take (or took) part — never their members. Effective
-- managers additionally see pending and declined invitations; ordinary members
-- do not learn that an organisation was asked and said no. A representative
-- sees their own community's rows (including a pending invitation). A
-- sponsored person sees the unit sponsoring them, and no other.
create or replace function public.can_view_collaboration_participant(p_participant_id uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from collaboration_participants p
    where p.id = p_participant_id
      and (
        (
          p.status in ('active', 'left')
          and collaboration_user_has_access(p.collaboration_id, auth.uid())
        )
        or is_collaboration_manager(p.collaboration_id)
        or can_represent_collaboration_unit(p.community_id, p.local_group_id, auth.uid())
        or exists (
          select 1 from collaboration_member_sponsorships s
          where s.participant_id = p.id
            and s.user_id = auth.uid()
            and s.status in ('invited', 'accepted')
        )
      )
  );
$$;

-- Whether the caller may see one team member. Yourself always; anyone else
-- only if you have effective access AND they do. Someone whose sponsorship has
-- lapsed simply drops out of the visible team — the viewer cannot tell why,
-- which is the point: a lapsed sponsorship may mean they left their
-- organisation, and that is not the team's business.
create or replace function public.can_view_collaboration_member(
  p_collaboration_id uuid,
  p_user_id uuid
)
returns boolean language sql security definer stable set search_path = public as $$
  select auth.uid() is not null and (
    p_user_id = auth.uid()
    or (
      collaboration_user_has_access(p_collaboration_id, auth.uid())
      and collaboration_user_has_access(p_collaboration_id, p_user_id)
    )
  );
$$;

revoke execute on function public.has_collaboration_access(uuid) from public, anon, authenticated;
revoke execute on function public.is_collaboration_manager(uuid) from public, anon, authenticated;
revoke execute on function public.represents_collaboration_participant(uuid) from public, anon, authenticated;
revoke execute on function public.can_view_collaboration(uuid) from public, anon, authenticated;
revoke execute on function public.can_view_collaboration_participant(uuid) from public, anon, authenticated;
revoke execute on function public.can_view_collaboration_member(uuid, uuid) from public, anon, authenticated;
grant execute on function public.has_collaboration_access(uuid) to authenticated;
grant execute on function public.is_collaboration_manager(uuid) to authenticated;
grant execute on function public.represents_collaboration_participant(uuid) to authenticated;
grant execute on function public.can_view_collaboration(uuid) to authenticated;
grant execute on function public.can_view_collaboration_participant(uuid) to authenticated;
grant execute on function public.can_view_collaboration_member(uuid, uuid) to authenticated;

-- ── Policies (SELECT only; there are no write policies) ─────────────────

create policy collaborations_select on public.collaborations
  for select to authenticated
  using (can_view_collaboration(id));

create policy collaboration_participants_select on public.collaboration_participants
  for select to authenticated
  using (can_view_collaboration_participant(id));

-- Effective managers only. Which units hold seats, and who caused each, is
-- internal authorisation metadata; ordinary team members do not need it, and
-- a future UI can present human-readable collaboration contacts separately.
create policy collaboration_manager_participants_select on public.collaboration_manager_participants
  for select to authenticated
  using (is_collaboration_manager(collaboration_id));

-- Provenance is private. The person sees their own sponsorships; the
-- sponsoring unit's representative sees the ones that unit issued. Nobody
-- else — not other team members, not managers from other organisations —
-- learns which organisation vouched for whom.
create policy collaboration_member_sponsorships_select on public.collaboration_member_sponsorships
  for select to authenticated
  using (
    user_id = auth.uid()
    or represents_collaboration_participant(participant_id)
  );

create policy collaboration_members_select on public.collaboration_members
  for select to authenticated
  using (can_view_collaboration_member(collaboration_id, user_id));

create policy collaboration_profiles_select on public.collaboration_profiles
  for select to authenticated
  using (can_view_collaboration_member(collaboration_id, user_id));

-- No policy on collaboration_audit_log: RLS with no policy and no grant.

-- ═══════════════════════════════════════════════════════════════════════
-- Transitions. The only writers. Every one:
--   * takes the actor from auth.uid() and has no argument naming an actor;
--   * re-derives authority from current rows, never from a client claim;
--   * returns null / false for every refusal alike, so a refusal cannot be
--     used to learn why (e.g. "not in your unit" versus "no such person");
--   * records the transition in collaboration_audit_log.
-- ═══════════════════════════════════════════════════════════════════════

-- ── Create ──────────────────────────────────────────────────────────────
--
-- The caller must be able to represent the source unit, and the unit must be
-- valid (a retired lokallag cannot start anything). In one transaction: the
-- collaboration, the source unit as an ACTIVE participant, and the creator's
-- enrolment — always a management seat for the source PARTICIPANT; a
-- sponsorship and team seat only if they actually belong to the source unit.
--
-- The slug is normalised like a local-group slug (derived from the name when
-- none is given). A slug already taken gets a short random suffix rather than
-- an error or a counter.
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

  insert into collaborations (slug, name, description, created_by_user_id)
  values (v_slug, v_name, v_description, auth.uid())
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

comment on function public.create_collaboration(text, uuid, text, text, text) is
  'Creates a collaboration from a unit the caller represents (v1: community admin, also for its local groups). The source unit receives a management seat, which the caller exercises while they represent it; the caller becomes a sponsored team member only if they belong to the unit. Returns the id, or null on any refusal.';

-- ── Invite an organisation ──────────────────────────────────────────────
--
-- Effective managers only, and the target is a COMMUNITY — there is no
-- local-group argument. The inviter neither needs nor gets the other
-- organisation's local groups; that organisation picks its own unit when it
-- accepts. Reveals nothing about who is in the community; creates no
-- sponsorship and no membership.
--
-- Refused while the community already has a pending invitation here, or is
-- already taking part as a whole. A community taking part only through a
-- local group may be invited again, so it can add another of its units.
create or replace function public.invite_collaboration_participant(
  p_collaboration_id uuid,
  p_community_id text
)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_participant uuid;
begin
  if not is_collaboration_manager(p_collaboration_id) then
    return null;
  end if;

  if not exists (select 1 from communities c where c.id = p_community_id) then
    return null;
  end if;

  -- Serialise invitations to one collaboration so the checks below and the
  -- partial unique indexes agree.
  perform 1 from collaborations c where c.id = p_collaboration_id for update;

  if exists (
    select 1 from collaboration_participants p
    where p.collaboration_id = p_collaboration_id
      and p.community_id = p_community_id
      and (p.status = 'invited' or (p.status = 'active' and p.local_group_id is null))
  ) then
    return null;
  end if;

  insert into collaboration_participants
    (collaboration_id, community_id, local_group_id, status, invited_by_user_id)
  values
    (p_collaboration_id, p_community_id, null, 'invited', auth.uid())
  returning id into v_participant;

  perform collaboration_log(p_collaboration_id, 'participant_invited', v_participant);
  return v_participant;
end;
$$;

-- ── The invited organisation accepts, choosing its own unit ─────────────
--
-- Only someone who can represent the chosen unit of THIS community:
--   p_local_group_id null → the whole community takes part;
--   p_local_group_id set  → that local group takes part. It must be one of
--                           this community's own groups (checked here, by the
--                           representation rule, and by the composite foreign
--                           key) and not retired.
--
-- The chosen unit must not already be active in the collaboration. Accepting
-- activates only that unit and enrols the accepting representative (see
-- collaboration_enrol_representative). Repeating the same acceptance reports
-- success; accepting again as a different unit, or accepting a declined
-- invitation, is refused.
create or replace function public.accept_collaboration_participant_invite(
  p_participant_id uuid,
  p_local_group_id uuid
)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  v_p collaboration_participants%rowtype;
begin
  if auth.uid() is null then
    return false;
  end if;

  select * into v_p from collaboration_participants
  where id = p_participant_id
  for update;

  if v_p.id is null
     or not can_represent_collaboration_unit(v_p.community_id, p_local_group_id, auth.uid())
     or not exists (
       select 1 from collaborations c
       where c.id = v_p.collaboration_id and c.status = 'active'
     )
  then
    return false;
  end if;

  if v_p.status = 'active' then
    return v_p.local_group_id is not distinct from p_local_group_id;
  end if;
  if v_p.status <> 'invited' then
    return false;
  end if;

  if not collaboration_unit_is_valid(v_p.community_id, p_local_group_id) then
    return false;
  end if;

  if exists (
    select 1 from collaboration_participants p
    where p.collaboration_id = v_p.collaboration_id
      and p.community_id = v_p.community_id
      and p.local_group_id is not distinct from p_local_group_id
      and p.status = 'active'
  ) then
    return false;
  end if;

  update collaboration_participants
     set status = 'active',
         local_group_id = p_local_group_id,
         responded_by_user_id = auth.uid(),
         responded_at = now(),
         joined_at = now()
   where id = v_p.id;
  perform collaboration_log(v_p.collaboration_id, 'participant_accepted', v_p.id);

  perform collaboration_enrol_representative(v_p.collaboration_id, v_p.id);
  return true;
end;
$$;

-- ── The invited organisation declines ───────────────────────────────────
create or replace function public.decline_collaboration_participant_invite(p_participant_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  v_p collaboration_participants%rowtype;
begin
  if auth.uid() is null then
    return false;
  end if;

  select * into v_p from collaboration_participants
  where id = p_participant_id
  for update;

  -- An invitation names only a community, so the whole-community
  -- representative is the one who can turn it down.
  if v_p.id is null
     or not can_represent_collaboration_unit(v_p.community_id, null, auth.uid())
  then
    return false;
  end if;

  if v_p.status = 'declined' then
    return true;
  end if;
  if v_p.status <> 'invited' then
    return false;
  end if;

  update collaboration_participants
     set status = 'declined', responded_by_user_id = auth.uid(), responded_at = now()
   where id = v_p.id;
  perform collaboration_log(v_p.collaboration_id, 'participant_declined', v_p.id);
  return true;
end;
$$;

-- ── A unit withdraws ────────────────────────────────────────────────────
--
-- Only that unit's representative. Every sponsorship through this unit, and
-- its management seat, stops counting at once, because both
-- require the participant to be in force; the rows are kept. Nothing outside
-- the collaboration — memberships, community profiles, the account — is
-- touched.
create or replace function public.leave_collaboration_as_participant(p_participant_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  v_p collaboration_participants%rowtype;
begin
  if auth.uid() is null then
    return false;
  end if;

  select * into v_p from collaboration_participants
  where id = p_participant_id
  for update;

  if v_p.id is null
     or not can_represent_collaboration_unit(v_p.community_id, v_p.local_group_id, auth.uid())
  then
    return false;
  end if;

  if v_p.status = 'left' then
    return true;
  end if;
  if v_p.status <> 'active' then
    return false;
  end if;

  update collaboration_participants
     set status = 'left', left_at = now(), left_by_user_id = auth.uid()
   where id = v_p.id;
  perform collaboration_log(v_p.collaboration_id, 'participant_left', v_p.id);
  return true;
end;
$$;

-- ── A unit sponsors one of its own people ───────────────────────────────
--
-- The caller must be able to represent the participant, the participant must
-- be in force, and the target must CURRENTLY belong to that exact unit —
-- including when the target is the caller: representing FTR Oslo does not
-- make its representative sponsorable through it. The target is a known user
-- id; this function never lists anyone, and there is deliberately no function
-- anywhere that lists a participant's members to a collaboration manager.
-- Choosing whom to sponsor happens in the originating organisation's own
-- admin context.
--
-- Collaboration management confers nothing here: a manager from TU is not
-- FTR Oslo's representative and is refused for FTR Oslo's participant row.
--
-- Returns the live sponsorship id (an existing live one is returned as is),
-- or null for every refusal — including a user id that does not exist, which
-- is indistinguishable from one that is simply not in the unit.
create or replace function public.invite_collaboration_member(
  p_collaboration_id uuid,
  p_participant_id uuid,
  p_target_user_id uuid
)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_p collaboration_participants%rowtype;
  v_sponsorship uuid;
begin
  if auth.uid() is null or p_target_user_id is null then
    return null;
  end if;

  select * into v_p from collaboration_participants
  where id = p_participant_id and collaboration_id = p_collaboration_id
  for update;

  if v_p.id is null
     or not collaboration_participant_in_force(v_p.id)
     or not exists (
       select 1 from collaborations c
       where c.id = p_collaboration_id and c.status = 'active'
     )
     or not can_represent_collaboration_unit(v_p.community_id, v_p.local_group_id, auth.uid())
     or not collaboration_unit_includes(v_p.community_id, v_p.local_group_id, p_target_user_id)
  then
    return null;
  end if;

  select s.id into v_sponsorship
  from collaboration_member_sponsorships s
  where s.participant_id = v_p.id
    and s.user_id = p_target_user_id
    and s.status in ('invited', 'accepted');
  if v_sponsorship is not null then
    return v_sponsorship;
  end if;

  insert into collaboration_member_sponsorships
    (collaboration_id, participant_id, user_id, status, invited_by_user_id)
  values
    (p_collaboration_id, v_p.id, p_target_user_id, 'invited', auth.uid())
  returning id into v_sponsorship;

  perform collaboration_log(p_collaboration_id, 'sponsorship_invited', v_p.id, v_sponsorship, p_target_user_id);
  return v_sponsorship;
end;
$$;

-- ── The person answers ──────────────────────────────────────────────────
--
-- Only the sponsored person; the row is found by (id, auth.uid()), so nobody
-- can answer for someone else — not the sponsoring administrator either.
-- Accepting requires the sponsorship to be able to grant access right now
-- (collaboration active, participant in force, person still in the unit).
-- Accepting is consent to be ELIGIBLE; joining is a separate step.
create or replace function public.respond_to_collaboration_sponsorship(
  p_sponsorship_id uuid,
  p_accept boolean
)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  v_s collaboration_member_sponsorships%rowtype;
  v_p collaboration_participants%rowtype;
begin
  if auth.uid() is null or p_accept is null then
    return false;
  end if;

  select * into v_s from collaboration_member_sponsorships
  where id = p_sponsorship_id and user_id = auth.uid()
  for update;

  if v_s.id is null then
    return false;
  end if;

  if v_s.status = 'accepted' and p_accept then
    return true;
  end if;
  if v_s.status = 'declined' and not p_accept then
    return true;
  end if;
  if v_s.status <> 'invited' then
    return false;
  end if;

  if not p_accept then
    update collaboration_member_sponsorships
       set status = 'declined', responded_at = now(), updated_at = now()
     where id = v_s.id;
    perform collaboration_log(v_s.collaboration_id, 'sponsorship_declined', v_s.participant_id, v_s.id, auth.uid());
    return true;
  end if;

  select * into v_p from collaboration_participants where id = v_s.participant_id;

  if not collaboration_participant_in_force(v_p.id)
     or not exists (
       select 1 from collaborations c
       where c.id = v_s.collaboration_id and c.status = 'active'
     )
     or not collaboration_unit_includes(v_p.community_id, v_p.local_group_id, auth.uid())
  then
    return false;
  end if;

  update collaboration_member_sponsorships
     set status = 'accepted', responded_at = now(), updated_at = now()
   where id = v_s.id;
  perform collaboration_log(v_s.collaboration_id, 'sponsorship_accepted', v_s.participant_id, v_s.id, auth.uid());
  return true;
end;
$$;

-- ── The unit withdraws one person ───────────────────────────────────────
--
-- Only the representative of the SAME unit that issued the sponsorship. A
-- manager from another organisation cannot touch it. Revoking an invitation
-- that was never answered and revoking an accepted one are the same act.
-- Allowed on an archived collaboration, a withdrawn unit or a retired
-- lokallag: it only ever removes access.
create or replace function public.revoke_collaboration_sponsorship(p_sponsorship_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  v_s collaboration_member_sponsorships%rowtype;
begin
  if auth.uid() is null then
    return false;
  end if;

  select * into v_s from collaboration_member_sponsorships
  where id = p_sponsorship_id
  for update;

  if v_s.id is null or not represents_collaboration_participant(v_s.participant_id) then
    return false;
  end if;

  if v_s.status = 'revoked' then
    return true;
  end if;
  if v_s.status not in ('invited', 'accepted') then
    return false;
  end if;

  update collaboration_member_sponsorships
     set status = 'revoked', revoked_at = now(), revoked_by_user_id = auth.uid(), updated_at = now()
   where id = v_s.id;
  perform collaboration_log(v_s.collaboration_id, 'sponsorship_revoked', v_s.participant_id, v_s.id, v_s.user_id);
  return true;
end;
$$;

-- ── A person joins, or rejoins ──────────────────────────────────────────
--
-- Requires a sponsorship that grants access right now. Rejoining after
-- leaving is allowed on the same terms and is idempotent: joining while
-- already active changes nothing and reports success.
create or replace function public.join_collaboration(p_collaboration_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    return false;
  end if;

  if not exists (
    select 1 from collaborations c
    where c.id = p_collaboration_id and c.status = 'active'
  ) or not collaboration_has_valid_sponsorship(p_collaboration_id, auth.uid()) then
    return false;
  end if;

  insert into collaboration_members (collaboration_id, user_id, status, joined_at)
  values (p_collaboration_id, auth.uid(), 'active', now())
  on conflict (collaboration_id, user_id) do update
    set status = 'active', joined_at = now(), left_at = null
    where collaboration_members.status <> 'active';

  if found then
    perform collaboration_log(p_collaboration_id, 'member_joined', null, null, auth.uid());
  end if;
  return true;
end;
$$;

-- ── A person leaves ─────────────────────────────────────────────────────
--
-- Only yourself. Sponsorship history is left alone, and management is not
-- affected: it is institutional and does not depend on a team seat.
create or replace function public.leave_collaboration(p_collaboration_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    return false;
  end if;

  update collaboration_members
     set status = 'left', left_at = now()
   where collaboration_id = p_collaboration_id
     and user_id = auth.uid()
     and status = 'active';

  if found then
    perform collaboration_log(p_collaboration_id, 'member_left', null, null, auth.uid());
    return true;
  end if;

  return exists (
    select 1 from collaboration_members
    where collaboration_id = p_collaboration_id and user_id = auth.uid() and status = 'left'
  );
end;
$$;

-- ── Grants on transitions ───────────────────────────────────────────────
--
-- Note what is absent: no archive function. `collaborations.status` keeps its
-- 'archived' value and every function above honours it, but setting it is a
-- maintenance act for now.

revoke execute on function public.create_collaboration(text, uuid, text, text, text) from public, anon, authenticated;
revoke execute on function public.invite_collaboration_participant(uuid, text) from public, anon, authenticated;
revoke execute on function public.accept_collaboration_participant_invite(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.decline_collaboration_participant_invite(uuid) from public, anon, authenticated;
revoke execute on function public.leave_collaboration_as_participant(uuid) from public, anon, authenticated;
revoke execute on function public.invite_collaboration_member(uuid, uuid, uuid) from public, anon, authenticated;
revoke execute on function public.respond_to_collaboration_sponsorship(uuid, boolean) from public, anon, authenticated;
revoke execute on function public.revoke_collaboration_sponsorship(uuid) from public, anon, authenticated;
revoke execute on function public.join_collaboration(uuid) from public, anon, authenticated;
revoke execute on function public.leave_collaboration(uuid) from public, anon, authenticated;

grant execute on function public.create_collaboration(text, uuid, text, text, text) to authenticated;
grant execute on function public.invite_collaboration_participant(uuid, text) to authenticated;
grant execute on function public.accept_collaboration_participant_invite(uuid, uuid) to authenticated;
grant execute on function public.decline_collaboration_participant_invite(uuid) to authenticated;
grant execute on function public.leave_collaboration_as_participant(uuid) to authenticated;
grant execute on function public.invite_collaboration_member(uuid, uuid, uuid) to authenticated;
grant execute on function public.respond_to_collaboration_sponsorship(uuid, boolean) to authenticated;
grant execute on function public.revoke_collaboration_sponsorship(uuid) to authenticated;
grant execute on function public.join_collaboration(uuid) to authenticated;
grant execute on function public.leave_collaboration(uuid) to authenticated;
