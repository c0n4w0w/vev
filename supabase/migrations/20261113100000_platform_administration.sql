-- Platform administration: the people who run TING, and what they may do.
--
-- Until now every privilege in TING belonged to one community. An
-- administrator administers one organisation; nobody administers the
-- platform except whoever holds the service-role key on the server. This
-- migration adds a second, separate layer for the TING operators who create,
-- onboard and support organisations — without giving them any part of the
-- first:
--
--   platform_operators         who operates the platform, as owner or operator
--   platform_audit_log         an append-only record of everything they did
--   community_platform_state   per community: provisioned when and by whom,
--                              and whether it is suspended
--   platform_onboarding_requests  organisations asking to join TING
--
-- What a platform operator is NOT
-- -------------------------------
-- An operator is not a member of any community by being an operator. None of
-- the policies or predicates that decide who reads a conversation, a post, a
-- direct message or a member list mention platform_operators, so an operator
-- reads exactly what their own memberships let them read, like anybody else.
-- The functions below hand them metadata (names, slugs, status, the one
-- administrator, counts) and never content. There is no impersonation and no
-- "view as".
--
-- That is the application's boundary. Below it sits the database itself: the
-- `postgres` role and the service-role key bypass every rule here, and
-- whoever holds them can read everything. The operator role is deliberately
-- weaker than that, so that running the platform day to day never requires
-- the key.
--
-- How a caller becomes an operator
-- --------------------------------
-- Only through these functions: platform_bootstrap_owner() (service role, run
-- from the server's command line, once — or again as the documented recovery)
-- and platform_appoint_operator() (an owner, with fresh MFA). No API role has
-- any privilege on platform_operators itself. Every privileged function starts
-- with platform_require(), which asks four questions of the request's verified
-- JWT and the database, never of anything the client says:
--
--   1. Is auth.uid() an active (not revoked) operator?   → platform-forbidden
--   2. Is the session at AAL2 (verified MFA)?             → platform-mfa-required
--   3. Does the session still exist (not signed out)?     → platform-forbidden
--   4. For owner-only actions: owner?  For privilege changes: an MFA
--      verification in the last 10 minutes?               → platform-owner-required
--                                                           / platform-reauth-required
--
-- Revoking an operator takes effect on their next request: the row is read
-- every time, nothing is cached in a token.
--
-- Suspension
-- ----------
-- A suspended community keeps every row it has — members, messages, files —
-- and nobody can use it: reads of its content return nothing and every write
-- into it fails, whichever way it is attempted (pages, server actions, the
-- Data API directly, or any SECURITY DEFINER function). Three layers, because
-- the functions run as `postgres`, which row level security does not bind:
--
--   a. The membership predicates (is_member, is_admin, content_scope_admits
--      and the rest — every function that grants anything from an active
--      membership) now also require that the community is not suspended.
--      Every policy and every function that decides access goes through them.
--   b. Restrictive policies on the community's tables, as a second line that
--      does not depend on (a) staying intact in later migrations.
--   c. A trigger on every community-scoped table refuses inserts, updates and
--      deletes from API callers while the community is suspended. Triggers
--      fire inside SECURITY DEFINER functions too.
--
-- The public portal, its events and the access-request form behave as if the
-- community did not exist. Members who open it see that it is suspended and
-- nothing else. The service role (the attachment sweep, disappearing-message
-- purges) is not blocked: deleting what is due to be deleted keeps happening.

-- ── 1. Tables ────────────────────────────────────────────────────────────

create type public.platform_role as enum ('owner', 'operator');

create table public.platform_operators (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  role public.platform_role not null,
  appointed_at timestamptz not null default now(),
  -- null: appointed from the server's command line (platform_bootstrap_owner).
  appointed_by uuid references public.profiles(id) on delete set null,
  revoked_at timestamptz,
  revoked_by uuid references public.profiles(id) on delete set null
);

alter table public.platform_operators enable row level security;
-- No policy: no API role reads or writes this table. The functions below do.

create table public.platform_audit_log (
  id bigint generated always as identity primary key,
  occurred_at timestamptz not null default now(),
  -- Who, as they were at the time. No foreign key: an entry outlives the account.
  actor_id uuid,
  actor_email text,
  -- 'account': someone acting for themselves, such as accepting an
  -- administrator invitation. 'system': the server's command line.
  actor_role text not null check (actor_role in ('owner', 'operator', 'account', 'system')),
  action text not null check (action ~ '^[a-z][a-z_.]{2,63}$'),
  target_type text not null check (target_type in ('community', 'onboarding_request', 'platform_operator', 'invitation', 'platform')),
  target_id text,
  result text not null check (result in ('success', 'failure')),
  -- Short, non-sensitive facts only: ids, field names, old and new slugs,
  -- reason codes. Never a password, token, message or document.
  metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object' and length(metadata::text) <= 4000)
);

create index platform_audit_log_recent_idx on public.platform_audit_log (occurred_at desc, id desc);
create index platform_audit_log_target_idx on public.platform_audit_log (target_type, target_id, id desc);

alter table public.platform_audit_log enable row level security;

create table public.platform_onboarding_requests (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  organization_name text not null check (length(btrim(organization_name)) between 2 and 120),
  contact_name text not null check (length(btrim(contact_name)) between 1 and 120),
  contact_email text not null check (length(contact_email) <= 254),
  website text check (website is null or length(website) <= 300),
  member_estimate integer check (member_estimate is null or member_estimate between 1 and 10000000),
  message text not null check (length(btrim(message)) between 10 and 3000),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  review_note text check (review_note is null or length(review_note) <= 3000),
  reviewed_at timestamptz,
  reviewed_by uuid references public.profiles(id) on delete set null,
  community_id text references public.communities(id) on delete set null,
  updated_at timestamptz not null default now()
);

create index platform_onboarding_requests_queue_idx on public.platform_onboarding_requests (status, created_at desc);

alter table public.platform_onboarding_requests enable row level security;

-- Rate limiting for the public form: one row per submission, keyed on a hash
-- of the network address the server trusted, kept for a day and no longer.
create table public.platform_onboarding_attempts (
  key_hash text not null,
  attempted_at timestamptz not null default now()
);

create index platform_onboarding_attempts_idx on public.platform_onboarding_attempts (key_hash, attempted_at);

alter table public.platform_onboarding_attempts enable row level security;

create table public.community_platform_state (
  community_id text primary key references public.communities(id) on delete cascade,
  status text not null default 'active' check (status in ('active', 'suspended')),
  -- null for communities that existed before platform provisioning did.
  provisioned_at timestamptz,
  provisioned_by uuid references public.profiles(id) on delete set null,
  -- The wizard's one-time key: a second submission of the same form finds
  -- the community the first one created instead of creating another.
  creation_key uuid unique,
  onboarding_request_id uuid unique references public.platform_onboarding_requests(id) on delete set null,
  suspended_at timestamptz,
  suspended_by uuid references public.profiles(id) on delete set null,
  suspension_reason text check (suspension_reason is null or length(suspension_reason) <= 1000),
  updated_at timestamptz not null default now(),
  constraint community_platform_state_suspension_consistent
    check ((status = 'suspended') = (suspended_at is not null))
);

alter table public.community_platform_state enable row level security;

insert into public.community_platform_state (community_id)
select id from public.communities
on conflict (community_id) do nothing;

-- An invitation can make its recipient the community's administrator. Only
-- platform functions issue such invitations; everything else keeps issuing
-- member invitations, as before.
alter table public.invitations
  add column role public.community_role not null default 'member';
alter table public.invitations
  add constraint invitations_role_allowed check (role in ('member', 'admin'));

-- ── 2. Suspension: the one question ──────────────────────────────────────

create or replace function public.is_community_suspended(p_community_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $fn$
  select exists (
    select 1 from community_platform_state s
    where s.community_id = p_community_id and s.status = 'suspended'
  );
$fn$;

-- The caller's own view: suspended communities they have a membership row in.
-- Used by the restrictive policies (evaluated once per query as an initPlan)
-- and by the app to say "this community is suspended". It never lists a
-- community the caller has no relationship with.
create or replace function public.my_suspended_community_ids()
returns text[]
language sql
stable
security definer
set search_path = public
as $fn$
  select coalesce(array_agg(s.community_id), '{}'::text[])
  from community_platform_state s
  where s.status = 'suspended'
    and auth.uid() is not null
    and exists (
      select 1 from memberships m
      where m.community_id = s.community_id and m.user_id = auth.uid()
    );
$fn$;

create or replace function public.my_suspended_channel_ids()
returns text[]
language sql
stable
security definer
set search_path = public
as $fn$
  select coalesce(array_agg(c.id), '{}'::text[])
  from channels c
  where c.community_id = any (public.my_suspended_community_ids());
$fn$;

create or replace function public.my_suspended_conversation_ids()
returns uuid[]
language sql
stable
security definer
set search_path = public
as $fn$
  select coalesce(array_agg(dc.id), '{}'::uuid[])
  from direct_conversations dc
  where dc.community_id = any (public.my_suspended_community_ids())
    and auth.uid() in (dc.participant_one_id, dc.participant_two_id);
$fn$;

-- ── 3. Platform identity ─────────────────────────────────────────────────

-- The caller's platform role, or null. Not granted to any API role: callers
-- ask my_platform_access() about themselves, and privileged functions use
-- platform_require().
create or replace function public.platform_caller_role()
returns public.platform_role
language sql
stable
security definer
set search_path = public
as $fn$
  select o.role from platform_operators o
  where o.user_id = auth.uid() and o.revoked_at is null;
$fn$;

-- The session's verified assurance level, from the JWT PostgREST has already
-- checked the signature of. AAL2 means a second factor was verified.
create or replace function public.platform_session_is_aal2()
returns boolean
language sql
stable
set search_path = public
as $fn$
  select coalesce(auth.jwt() ->> 'aal', '') = 'aal2';
$fn$;

-- An MFA verification inside the window, from the session's own
-- authentication-method claims. Used for changes to who holds privileges.
create or replace function public.platform_session_mfa_within(p_window interval)
returns boolean
language sql
stable
set search_path = public
as $fn$
  select public.platform_session_is_aal2() and exists (
    select 1
    from jsonb_array_elements(
      case when jsonb_typeof(auth.jwt() -> 'amr') = 'array' then auth.jwt() -> 'amr' else '[]'::jsonb end
    ) a
    where a ->> 'method' in ('totp', 'webauthn', 'phone')
      and (a ->> 'timestamp') ~ '^[0-9]+(\.[0-9]+)?$'
      and to_timestamp((a ->> 'timestamp')::double precision) > now() - p_window
  );
$fn$;

-- A JWT outlives a sign-out until it expires. For platform operations the
-- session it names must still exist.
create or replace function public.platform_session_alive()
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $fn$
  select coalesce(auth.jwt() ->> 'session_id', '') ~ '^[0-9a-f-]{36}$'
    and exists (
      select 1 from auth.sessions s
      where s.id = (auth.jwt() ->> 'session_id')::uuid
        and s.user_id = auth.uid()
        and (s.not_after is null or s.not_after > now())
    );
$fn$;

create or replace function public.platform_require(p_owner boolean default false, p_fresh boolean default false)
returns public.platform_role
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_role public.platform_role;
begin
  v_role := public.platform_caller_role();
  if v_role is null or not public.platform_session_alive() then
    raise exception 'platform-forbidden' using errcode = '42501';
  end if;
  if not public.platform_session_is_aal2() then
    raise exception 'platform-mfa-required' using errcode = '42501';
  end if;
  if p_owner and v_role <> 'owner' then
    raise exception 'platform-owner-required' using errcode = '42501';
  end if;
  if p_fresh and not public.platform_session_mfa_within(interval '10 minutes') then
    raise exception 'platform-reauth-required' using errcode = '42501';
  end if;
  return v_role;
end;
$fn$;

-- What the caller may see about themselves: nothing if they are not an
-- operator. Enough for the dashboard to decide between "not found", "verify
-- your second factor" and the dashboard itself.
create or replace function public.my_platform_access()
returns table (role text, mfa_verified boolean, mfa_recent boolean, has_mfa_factor boolean)
language sql
stable
security definer
set search_path = public, auth
as $fn$
  select o.role::text,
         public.platform_session_is_aal2() and public.platform_session_alive(),
         public.platform_session_mfa_within(interval '10 minutes'),
         exists (select 1 from auth.mfa_factors f where f.user_id = o.user_id and f.status = 'verified')
  from platform_operators o
  where o.user_id = auth.uid() and o.revoked_at is null;
$fn$;

-- ── 4. The audit log ─────────────────────────────────────────────────────

create or replace function public.platform_audit(
  p_action text,
  p_target_type text,
  p_target_id text,
  p_result text,
  p_metadata jsonb default '{}'::jsonb
)
returns void
language sql
security definer
set search_path = public, auth
as $fn$
  insert into platform_audit_log (actor_id, actor_email, actor_role, action, target_type, target_id, result, metadata)
  values (
    auth.uid(),
    (select u.email from auth.users u where u.id = auth.uid()),
    coalesce(
      (select o.role::text from platform_operators o where o.user_id = auth.uid() and o.revoked_at is null),
      case when auth.uid() is null then 'system' else 'account' end
    ),
    p_action, p_target_type, p_target_id, p_result,
    coalesce(p_metadata, '{}'::jsonb)
  );
$fn$;

-- Append-only, for everyone the API serves and for the service role: no
-- update, no delete, no truncate. Only a database superuser who first drops
-- these triggers can change history, and that is outside the application.
create or replace function public.platform_audit_log_append_only()
returns trigger
language plpgsql
set search_path = public
as $fn$
begin
  raise exception 'platform_audit_log is append-only' using errcode = '42501';
end;
$fn$;

create trigger platform_audit_log_no_update
  before update or delete on public.platform_audit_log
  for each row execute function public.platform_audit_log_append_only();

create trigger platform_audit_log_no_truncate
  before truncate on public.platform_audit_log
  for each statement execute function public.platform_audit_log_append_only();

-- The server records an operator's failed attempt (validation, conflict,
-- missing MFA freshness) after the function that refused it rolled back.
-- Only an operator may record, only known actions, only a short reason code.
create or replace function public.platform_record_failure(
  p_action text,
  p_target_type text,
  p_target_id text,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
begin
  perform public.platform_require();
  if p_action not in (
       'community.create', 'community.update', 'community.suspend', 'community.reactivate',
       'community.admin.assign', 'community.admin.invite', 'community.admin.remove',
       'community.admin.invitation.revoke', 'community.admin.invitation.resend',
       'onboarding_request.approve', 'onboarding_request.reject', 'onboarding_request.note',
       'platform_operator.appoint', 'platform_operator.role', 'platform_operator.revoke'
     )
     or p_target_type not in ('community', 'onboarding_request', 'platform_operator', 'invitation', 'platform')
     or coalesce(p_reason, '') !~ '^[a-z0-9-]{1,60}$'
     or length(coalesce(p_target_id, '')) > 200 then
    raise exception 'invalid-input' using errcode = '22023';
  end if;
  perform public.platform_audit(p_action, p_target_type, nullif(p_target_id, ''), 'failure', jsonb_build_object('reason', p_reason));
end;
$fn$;

-- ── 5. Membership predicates: nothing is granted from a suspended community ──
--
-- Each is the definition it had, with `and not is_community_suspended(…)`
-- beside every `status = 'active'` on a membership row. Nothing else changed.
-- A later migration that redefines one of these must keep that condition;
-- `npm run check:platform-admin` fails if any of them grants access in a
-- suspended community.

create or replace function public.administers_pending_membership(other uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $fn$
  select exists (
    select 1
    from memberships pending
    join memberships mine
      on mine.community_id = pending.community_id
     and mine.user_id = auth.uid()
     and mine.status = 'active' and not public.is_community_suspended(mine.community_id)
     and mine.role = 'admin'
    where pending.user_id = other
      and pending.status <> 'active'
  );
$fn$;

create or replace function public.can_moderate(cid text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $fn$
  select exists (
    select 1 from memberships m
    where m.community_id = cid and m.user_id = auth.uid()
      and m.status = 'active' and not public.is_community_suspended(m.community_id) and m.role in ('admin', 'moderator')
  );
$fn$;

create or replace function public.can_moderate_post(pid uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $fn$
  select exists (
    select 1
    from posts p
    join memberships m on m.community_id = p.community_id
    where p.id = pid
      and m.user_id = auth.uid()
      and m.status = 'active' and not public.is_community_suspended(m.community_id)
      and m.role in ('admin', 'moderator')
  );
$fn$;

create or replace function public.can_reply_direct_conversation(p_conversation_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $fn$
  select exists (
    select 1
    from direct_conversations dc
    join memberships sender on sender.community_id = dc.community_id
    join memberships recipient on recipient.community_id = dc.community_id
    where dc.id = p_conversation_id
      and auth.uid() in (dc.participant_one_id, dc.participant_two_id)
      and sender.user_id = auth.uid()
      and sender.status = 'active' and not public.is_community_suspended(sender.community_id)
      and recipient.user_id = case
        when dc.participant_one_id = auth.uid() then dc.participant_two_id
        else dc.participant_one_id
      end
      and recipient.status = 'active' and not public.is_community_suspended(recipient.community_id)
  );
$fn$;

create or replace function public.can_represent_collaboration_unit(p_community_id text, p_local_group_id uuid, p_user_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $fn$
  select p_user_id is not null
    and exists (
      select 1
      from memberships m
      where m.community_id = p_community_id
        and m.user_id = p_user_id
        and m.status = 'active' and not public.is_community_suspended(m.community_id)
        and m.role = 'admin'
    )
    and (
      p_local_group_id is null
      or exists (
        select 1 from community_local_groups g
        where g.id = p_local_group_id and g.community_id = p_community_id
      )
    );
$fn$;

create or replace function public.can_send_dm(cid text, recipient uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $fn$
  select exists (
    select 1
    from memberships sender
    join memberships rec on rec.community_id = sender.community_id
    join communities c on c.id = sender.community_id
    where sender.community_id = cid
      and sender.user_id = auth.uid() and sender.status = 'active' and not public.is_community_suspended(sender.community_id)
      and rec.user_id = recipient and rec.status = 'active' and not public.is_community_suspended(rec.community_id)
      and recipient <> auth.uid()
      and (
        c.dm_policy = 'members'
        or (sender.role in ('admin', 'moderator') and rec.role in ('admin', 'moderator'))
        or (rec.role in ('admin', 'moderator') and rec.accepts_member_dms)
      )
  );
$fn$;

create or replace function public.can_view_community_profile(p_community_id text, p_user_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $fn$
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
              and m.status = 'active' and not public.is_community_suspended(m.community_id)
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
$fn$;

create or replace function public.can_view_member_directory(cid text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $fn$
  select exists (
    select 1
    from memberships m
    join communities c on c.id = m.community_id
    where m.community_id = cid
      and m.user_id = auth.uid()
      and m.status = 'active' and not public.is_community_suspended(m.community_id)
      and (m.role = 'admin' or c.member_directory_visibility = 'members')
  );
$fn$;

create or replace function public.channel_message_moderate_admits(p_user_id uuid, p_channel_id text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $fn$
  select p_user_id is not null and exists (
    select 1
    from channels c
    where c.id = p_channel_id
      and channel_access_admits(p_user_id, c.community_id, c.local_group_id, c.subgroup_id, c.id, c.is_private)
      and case
        when c.is_private then private_channel_manage_admits(p_user_id, c.id)
        when c.subgroup_id is not null then subgroup_manage_admits(p_user_id, c.subgroup_id)
        when c.local_group_id is not null then
          local_group_manage_admits(p_user_id, c.local_group_id)
          or exists (
            select 1 from memberships m
            where m.community_id = c.community_id and m.user_id = p_user_id
              and m.status = 'active' and not public.is_community_suspended(m.community_id) and m.role = 'admin'
          )
        else exists (
          select 1 from memberships m
          where m.community_id = c.community_id and m.user_id = p_user_id
            and m.status = 'active' and not public.is_community_suspended(m.community_id) and m.role in ('admin', 'moderator')
        )
      end
  );
$fn$;

create or replace function public.channel_poll_create_admits(p_user_id uuid, p_channel_id text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $fn$
  select p_user_id is not null and exists (
    select 1
    from channels c
    join memberships m
      on m.community_id = c.community_id and m.user_id = p_user_id and m.status = 'active' and not public.is_community_suspended(m.community_id)
    where c.id = p_channel_id
      and c.archived_at is null
      and channel_access_admits(p_user_id, c.community_id, c.local_group_id, c.subgroup_id, c.id, c.is_private)
      and (
        m.role in ('admin', 'moderator')
        or (
          c.subgroup_id is not null
          and not c.read_only
          and exists (
            select 1 from community_subgroup_managers mg
            where mg.subgroup_id = c.subgroup_id
              and mg.community_id = c.community_id
              and mg.user_id = p_user_id
          )
        )
        or (
          c.local_group_id is not null
          and not c.is_private
          and not c.read_only
          and local_group_manage_admits(p_user_id, c.local_group_id)
        )
      )
  );
$fn$;

create or replace function public.collaboration_unit_includes(p_community_id text, p_local_group_id uuid, p_user_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $fn$
  select p_user_id is not null
    and collaboration_unit_is_valid(p_community_id, p_local_group_id)
    and exists (
      select 1
      from memberships m
      where m.community_id = p_community_id
        and m.user_id = p_user_id
        and m.status = 'active' and not public.is_community_suspended(m.community_id)
        and (p_local_group_id is null or m.local_group_id = p_local_group_id)
    );
$fn$;

create or replace function public.community_identity_admits(p_viewer uuid, p_community_id text, p_user_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $fn$
  select p_viewer is not null and p_user_id is not null
    and exists (
      select 1 from memberships m
      where m.community_id = p_community_id and m.user_id = p_viewer and m.status = 'active' and not public.is_community_suspended(m.community_id)
    )
    and exists (
      select 1 from memberships m
      where m.community_id = p_community_id and m.user_id = p_user_id and m.status = 'active' and not public.is_community_suspended(m.community_id)
    )
    and (
      -- Mentioned in a message the viewer can read.
      exists (
        select 1 from message_mentions mm
        join messages msg on msg.id = mm.message_id
        join channels ch on ch.id = mm.channel_id
        where ch.community_id = p_community_id and mm.user_id = p_user_id and msg.deleted_at is null
          and channel_access_admits(p_viewer, ch.community_id, ch.local_group_id, ch.subgroup_id, ch.id, ch.is_private)
      )
      -- Both in a private lokallag channel, both still able to read it.
      or exists (
        select 1 from channel_participants cp
        join channels ch on ch.id = cp.channel_id
        where cp.community_id = p_community_id and cp.user_id = p_user_id
          and channel_access_admits(p_viewer, ch.community_id, ch.local_group_id, ch.subgroup_id, ch.id, ch.is_private)
          and channel_access_admits(p_user_id, ch.community_id, ch.local_group_id, ch.subgroup_id, ch.id, ch.is_private)
      )
      -- Both able to read a group's chat, the person as a member of the group.
      or exists (
        select 1 from community_subgroup_members sm
        join channels ch on ch.subgroup_id = sm.subgroup_id
        where sm.community_id = p_community_id and sm.user_id = p_user_id
          and channel_access_admits(p_viewer, ch.community_id, ch.local_group_id, ch.subgroup_id, ch.id, ch.is_private)
          and channel_access_admits(p_user_id, ch.community_id, ch.local_group_id, ch.subgroup_id, ch.id, ch.is_private)
      )
    );
$fn$;

create or replace function public.content_scope_admits(p_user_id uuid, p_community_id text, p_local_group_id uuid, p_subgroup_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $fn$
  select p_user_id is not null and exists (
    select 1
    from memberships m
    where m.user_id = p_user_id
      and m.community_id = p_community_id
      and m.status = 'active' and not public.is_community_suspended(m.community_id)
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
$fn$;

create or replace function public.is_admin(cid text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $fn$
  select exists (
    select 1 from memberships m
    where m.community_id = cid and m.user_id = auth.uid()
      and m.status = 'active' and not public.is_community_suspended(m.community_id) and m.role = 'admin'
  );
$fn$;

create or replace function public.is_direct_conversation_participant(p_conversation_id uuid, p_user_id uuid DEFAULT auth.uid())
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $fn$
  select exists (
    select 1
    from direct_conversations dc
    join memberships m on m.community_id = dc.community_id
    where dc.id = p_conversation_id
      and p_user_id in (dc.participant_one_id, dc.participant_two_id)
      and m.user_id = p_user_id
      and m.status = 'active' and not public.is_community_suspended(m.community_id)
  );
$fn$;

create or replace function public.is_member(cid text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $fn$
  select exists (
    select 1 from memberships m
    where m.community_id = cid and m.user_id = auth.uid() and m.status = 'active' and not public.is_community_suspended(m.community_id)
  );
$fn$;

create or replace function public.local_group_manage_admits(p_user_id uuid, p_local_group_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $fn$
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
      and m.status = 'active' and not public.is_community_suspended(m.community_id)
      and m.local_group_id = g.local_group_id
  );
$fn$;

create or replace function public.private_channel_access_admits(p_user_id uuid, p_community_id text, p_local_group_id uuid, p_channel_id text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $fn$
  select p_user_id is not null
    and p_local_group_id is not null
    and exists (
      select 1
      from memberships m
      where m.user_id = p_user_id
        and m.community_id = p_community_id
        and m.status = 'active' and not public.is_community_suspended(m.community_id)
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
$fn$;

create or replace function public.private_channel_create_admits(p_user_id uuid, p_local_group_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $fn$
  select p_user_id is not null and exists (
    select 1
    from community_local_groups lg
    join memberships m
      on m.community_id = lg.community_id and m.user_id = p_user_id and m.status = 'active' and not public.is_community_suspended(m.community_id)
    where lg.id = p_local_group_id
      and lg.active
      and (m.role = 'admin' or local_group_manage_admits(p_user_id, lg.id))
  );
$fn$;

create or replace function public.private_channel_manage_admits(p_user_id uuid, p_channel_id text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $fn$
  select p_user_id is not null and exists (
    select 1
    from channels c
    join memberships m
      on m.community_id = c.community_id and m.user_id = p_user_id and m.status = 'active' and not public.is_community_suspended(m.community_id)
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
$fn$;

create or replace function public.reaction_authors_admit(p_viewer uuid, p_kind text, p_target_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $fn$
  select reaction_target_readable(p_viewer, p_kind, p_target_id) and case p_kind
    when 'direct' then true
    when 'message' then exists (
      select 1 from messages m
      join channels c on c.id = m.channel_id
      join communities co on co.id = c.community_id
      where m.id = p_target_id
        and (
          c.is_private or c.local_group_id is not null or c.subgroup_id is not null
          or co.reaction_author_visibility = 'channel'
          or exists (
            select 1 from memberships mm
            where mm.community_id = c.community_id and mm.user_id = p_viewer
              and mm.status = 'active' and not public.is_community_suspended(mm.community_id) and mm.role in ('admin', 'moderator')
          )
        )
    )
    when 'post' then exists (
      select 1 from posts p
      join communities co on co.id = p.community_id
      where p.id = p_target_id
        and (
          p.local_group_id is not null or p.subgroup_id is not null
          or co.reaction_author_visibility = 'channel'
          or exists (
            select 1 from memberships mm
            where mm.community_id = p.community_id and mm.user_id = p_viewer
              and mm.status = 'active' and not public.is_community_suspended(mm.community_id) and mm.role in ('admin', 'moderator')
          )
        )
    )
    else false
  end;
$fn$;

create or replace function public.shares_community(other uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $fn$
  select exists (
    select 1 from memberships a
    join memberships b on a.community_id = b.community_id
    where a.user_id = auth.uid() and a.status = 'active' and not public.is_community_suspended(a.community_id)
      and b.user_id = other and b.status = 'active' and not public.is_community_suspended(b.community_id)
  );
$fn$;

create or replace function public.shares_direct_conversation(other uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $fn$
  select exists (
    select 1
    from direct_conversations dc
    join memberships mine on mine.community_id = dc.community_id
    where auth.uid() in (dc.participant_one_id, dc.participant_two_id)
      and other in (dc.participant_one_id, dc.participant_two_id)
      and other <> auth.uid()
      and mine.user_id = auth.uid()
      and mine.status = 'active' and not public.is_community_suspended(mine.community_id)
  );
$fn$;

create or replace function public.shares_visible_directory(other uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $fn$
  select exists (
    select 1
    from memberships mine
    join memberships theirs on theirs.community_id = mine.community_id
    join communities c on c.id = mine.community_id
    where mine.user_id = auth.uid() and mine.status = 'active' and not public.is_community_suspended(mine.community_id)
      and theirs.user_id = other and theirs.status = 'active' and not public.is_community_suspended(theirs.community_id)
      and (c.member_directory_visibility = 'members' or mine.role = 'admin')
  );
$fn$;

create or replace function public.subgroup_access_admits(p_user_id uuid, p_subgroup_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $fn$
  select p_user_id is not null and exists (
    select 1
    from community_subgroups s
    join memberships m on m.community_id = s.community_id
    where s.id = p_subgroup_id
      and m.user_id = p_user_id
      and m.status = 'active' and not public.is_community_suspended(m.community_id)
      and (
        m.role = 'admin'
        or (m.role = 'moderator' and s.moderators_read)
        or exists (
          select 1 from community_subgroup_members sm
          where sm.subgroup_id = s.id and sm.user_id = p_user_id
        )
      )
  );
$fn$;

create or replace function public.subgroup_create_admits(p_user_id uuid, p_community_id text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $fn$
  select p_user_id is not null and exists (
    select 1 from memberships m
    where m.user_id = p_user_id
      and m.community_id = p_community_id
      and m.status = 'active' and not public.is_community_suspended(m.community_id)
      and m.role in ('admin', 'moderator')
  );
$fn$;

create or replace function public.subgroup_manage_admits(p_user_id uuid, p_subgroup_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $fn$
  select p_user_id is not null and exists (
    select 1
    from community_subgroups s
    join memberships m on m.community_id = s.community_id
    where s.id = p_subgroup_id
      and m.user_id = p_user_id
      and m.status = 'active' and not public.is_community_suspended(m.community_id)
      and (
        m.role = 'admin'
        or exists (
          select 1 from community_subgroup_managers mg
          where mg.subgroup_id = s.id and mg.user_id = p_user_id
        )
      )
  );
$fn$;

-- ── 6. Restrictive policies: a second line for reads through the Data API ──
--
-- AND-ed with every existing SELECT policy (and so with the rows an UPDATE or
-- DELETE can see). Writes are refused by the triggers in section 7, so these
-- add no write policy to any table. The arrays are computed once per query
-- (the subselect becomes an initPlan), so the cost does not grow with rows.

create policy access_requests_not_suspended on public.access_requests as restrictive for select to authenticated
  using (not (community_id = any (coalesce((select public.my_suspended_community_ids()), '{}'))));
create policy channel_participants_not_suspended on public.channel_participants as restrictive for select to authenticated
  using (not (community_id = any (coalesce((select public.my_suspended_community_ids()), '{}'))));
create policy channel_sections_not_suspended on public.channel_sections as restrictive for select to authenticated
  using (not (community_id = any (coalesce((select public.my_suspended_community_ids()), '{}'))));
create policy channels_not_suspended on public.channels as restrictive for select to authenticated
  using (not (community_id = any (coalesce((select public.my_suspended_community_ids()), '{}'))));
create policy community_emojis_not_suspended on public.community_emojis as restrictive for select to authenticated
  using (not (community_id = any (coalesce((select public.my_suspended_community_ids()), '{}'))));
create policy community_local_group_managers_not_suspended on public.community_local_group_managers as restrictive for select to authenticated
  using (not (community_id = any (coalesce((select public.my_suspended_community_ids()), '{}'))));
create policy community_local_groups_not_suspended on public.community_local_groups as restrictive for select to authenticated
  using (not (community_id = any (coalesce((select public.my_suspended_community_ids()), '{}'))));
create policy community_people_not_suspended on public.community_people as restrictive for select to authenticated
  using (not (community_id = any (coalesce((select public.my_suspended_community_ids()), '{}'))));
create policy community_profiles_not_suspended on public.community_profiles as restrictive for select to authenticated
  using (not (community_id = any (coalesce((select public.my_suspended_community_ids()), '{}'))));
create policy community_subgroup_managers_not_suspended on public.community_subgroup_managers as restrictive for select to authenticated
  using (not (community_id = any (coalesce((select public.my_suspended_community_ids()), '{}'))));
create policy community_subgroup_members_not_suspended on public.community_subgroup_members as restrictive for select to authenticated
  using (not (community_id = any (coalesce((select public.my_suspended_community_ids()), '{}'))));
create policy community_subgroups_not_suspended on public.community_subgroups as restrictive for select to authenticated
  using (not (community_id = any (coalesce((select public.my_suspended_community_ids()), '{}'))));
create policy direct_conversations_not_suspended on public.direct_conversations as restrictive for select to authenticated
  using (not (community_id = any (coalesce((select public.my_suspended_community_ids()), '{}'))));
create policy events_not_suspended on public.events as restrictive for select to authenticated
  using (not (community_id = any (coalesce((select public.my_suspended_community_ids()), '{}'))));
create policy invitations_not_suspended on public.invitations as restrictive for select to authenticated
  using (not (community_id = any (coalesce((select public.my_suspended_community_ids()), '{}'))));
create policy message_attachments_not_suspended on public.message_attachments as restrictive for select to authenticated
  using (not (community_id = any (coalesce((select public.my_suspended_community_ids()), '{}'))));
create policy posts_not_suspended on public.posts as restrictive for select to authenticated
  using (not (community_id = any (coalesce((select public.my_suspended_community_ids()), '{}'))));

-- A member keeps seeing their own membership row, so the app can say the
-- community is suspended rather than pretend it is gone.
create policy memberships_not_suspended on public.memberships as restrictive for select to authenticated
  using (user_id = auth.uid() or not (community_id = any (coalesce((select public.my_suspended_community_ids()), '{}'))));

create policy notifications_not_suspended on public.notifications as restrictive for select to authenticated
  using (community_id is null or not (community_id = any (coalesce((select public.my_suspended_community_ids()), '{}'))));

create policy channel_attachment_placements_not_suspended on public.channel_attachment_placements as restrictive for select to authenticated
  using (not (channel_id = any (coalesce((select public.my_suspended_channel_ids()), '{}'))));
create policy channel_links_not_suspended on public.channel_links as restrictive for select to authenticated
  using (not (channel_id = any (coalesce((select public.my_suspended_channel_ids()), '{}'))));
create policy channel_pinned_messages_not_suspended on public.channel_pinned_messages as restrictive for select to authenticated
  using (not (channel_id = any (coalesce((select public.my_suspended_channel_ids()), '{}'))));
create policy channel_polls_not_suspended on public.channel_polls as restrictive for select to authenticated
  using (not (channel_id = any (coalesce((select public.my_suspended_channel_ids()), '{}'))));
create policy channel_resource_folders_not_suspended on public.channel_resource_folders as restrictive for select to authenticated
  using (not (channel_id = any (coalesce((select public.my_suspended_channel_ids()), '{}'))));
create policy channel_resource_pins_not_suspended on public.channel_resource_pins as restrictive for select to authenticated
  using (not (channel_id = any (coalesce((select public.my_suspended_channel_ids()), '{}'))));
create policy messages_not_suspended on public.messages as restrictive for select to authenticated
  using (not (channel_id = any (coalesce((select public.my_suspended_channel_ids()), '{}'))));

create policy direct_conversation_notices_not_suspended on public.direct_conversation_notices as restrictive for select to authenticated
  using (not (conversation_id = any (coalesce((select public.my_suspended_conversation_ids()), '{}'))));
create policy direct_conversation_reads_not_suspended on public.direct_conversation_reads as restrictive for select to authenticated
  using (not (conversation_id = any (coalesce((select public.my_suspended_conversation_ids()), '{}'))));
create policy direct_conversation_states_not_suspended on public.direct_conversation_states as restrictive for select to authenticated
  using (not (conversation_id = any (coalesce((select public.my_suspended_conversation_ids()), '{}'))));
create policy direct_messages_not_suspended on public.direct_messages as restrictive for select to authenticated
  using (not (conversation_id = any (coalesce((select public.my_suspended_conversation_ids()), '{}'))));

-- A person's own reactions are readable on their own; tie them to the
-- message, whose policies above decide.
create policy message_reactions_not_suspended on public.message_reactions as restrictive for select to authenticated
  using (exists (select 1 from public.messages m where m.id = message_reactions.message_id));
create policy direct_message_reactions_not_suspended on public.direct_message_reactions as restrictive for select to authenticated
  using (exists (select 1 from public.direct_messages dm where dm.id = direct_message_reactions.direct_message_id));

-- ── 7. Writes into a suspended community fail, whatever the path ─────────

-- Set (transaction-local) by the platform functions that change a suspended
-- community on purpose. Honoured only together with an active operator, so
-- the setting alone grants nothing.
create or replace function public.platform_write_bypass()
returns boolean
language sql
stable
security definer
set search_path = public
as $fn$
  select coalesce(current_setting('ting.platform_write', true), '') = 'on'
     and public.platform_caller_role() is not null;
$fn$;

create or replace function public.suspension_community_of(p_kind text, p_key text)
returns text
language plpgsql
stable
security definer
set search_path = public
as $fn$
begin
  if p_key is null then
    return null;
  end if;
  case p_kind
    when 'community' then
      return p_key;
    when 'channel' then
      return (select c.community_id from channels c where c.id = p_key);
    when 'poll' then
      return (select c.community_id from channel_polls p join channels c on c.id = p.channel_id where p.message_id = p_key::uuid);
    when 'post' then
      return (select p.community_id from posts p where p.id = p_key::uuid);
    when 'message' then
      return (select c.community_id from messages m join channels c on c.id = m.channel_id where m.id = p_key::uuid);
    when 'conversation' then
      return (select dc.community_id from direct_conversations dc where dc.id = p_key::uuid);
    when 'direct_message' then
      return (
        select dc.community_id from direct_messages dm
        join direct_conversations dc on dc.id = dm.conversation_id
        where dm.id = p_key::uuid
      );
    when 'event' then
      return (select e.community_id from events e where e.id = p_key::uuid);
    else
      raise exception 'unknown suspension scope %', p_kind;
  end case;
end;
$fn$;

create or replace function public.refuse_write_in_suspended_community()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_new text;
  v_old text;
begin
  -- Only API callers. The service role keeps purging what is due, and the
  -- database's own maintenance (migrations, cascades from Auth) is not an
  -- API request at all.
  if coalesce(auth.jwt() ->> 'role', '') in ('authenticated', 'anon') then
    if tg_op <> 'DELETE' then
      v_new := public.suspension_community_of(tg_argv[0], to_jsonb(new) ->> tg_argv[1]);
    end if;
    if tg_op <> 'INSERT' then
      v_old := public.suspension_community_of(tg_argv[0], to_jsonb(old) ->> tg_argv[1]);
    end if;
    if ((v_new is not null and public.is_community_suspended(v_new))
        or (v_old is not null and public.is_community_suspended(v_old)))
       and not public.platform_write_bypass() then
      raise exception 'community-suspended'
        using errcode = '42501',
              hint = 'TING has suspended this community. Its data is kept, unchanged, until it is reactivated.';
    end if;
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$fn$;

do $do$
declare
  v_spec text[];
begin
  foreach v_spec slice 1 in array array[
    ['access_requests', 'community', 'community_id'],
    ['channel_participants', 'community', 'community_id'],
    ['channel_retired_ids', 'community', 'community_id'],
    ['channel_sections', 'community', 'community_id'],
    ['channels', 'community', 'community_id'],
    ['community_emojis', 'community', 'community_id'],
    ['community_local_group_managers', 'community', 'community_id'],
    ['community_local_groups', 'community', 'community_id'],
    ['community_people', 'community', 'community_id'],
    ['community_profiles', 'community', 'community_id'],
    ['community_subgroup_managers', 'community', 'community_id'],
    ['community_subgroup_members', 'community', 'community_id'],
    ['community_subgroups', 'community', 'community_id'],
    ['direct_conversations', 'community', 'community_id'],
    ['events', 'community', 'community_id'],
    ['invitations', 'community', 'community_id'],
    ['memberships', 'community', 'community_id'],
    ['message_attachments', 'community', 'community_id'],
    ['message_moderation_log', 'community', 'community_id'],
    ['posts', 'community', 'community_id'],
    ['collaboration_participants', 'community', 'community_id'],
    ['channel_attachment_placements', 'channel', 'channel_id'],
    ['channel_links', 'channel', 'channel_id'],
    ['channel_pinned_messages', 'channel', 'channel_id'],
    ['channel_polls', 'channel', 'channel_id'],
    ['channel_resource_folders', 'channel', 'channel_id'],
    ['channel_resource_pins', 'channel', 'channel_id'],
    ['messages', 'channel', 'channel_id'],
    ['message_mentions', 'channel', 'channel_id'],
    ['channel_poll_options', 'poll', 'poll_id'],
    ['channel_poll_votes', 'poll', 'poll_id'],
    ['comments', 'post', 'post_id'],
    ['post_reactions', 'post', 'post_id'],
    ['message_reactions', 'message', 'message_id'],
    ['direct_conversation_notices', 'conversation', 'conversation_id'],
    ['direct_conversation_reads', 'conversation', 'conversation_id'],
    ['direct_conversation_states', 'conversation', 'conversation_id'],
    ['direct_messages', 'conversation', 'conversation_id'],
    ['direct_message_reactions', 'direct_message', 'direct_message_id'],
    ['event_attendees', 'event', 'event_id']
  ] loop
    execute format(
      'create trigger %I before insert or update or delete on public.%I for each row execute function public.refuse_write_in_suspended_community(%L, %L)',
      v_spec[1] || '_refuse_when_suspended', v_spec[1], v_spec[2], v_spec[3]
    );
  end loop;
end;
$do$;

-- The community row itself: an API caller cannot change a suspended
-- community (its About text, avatar, settings) except through the platform.
create or replace function public.communities_guard_suspension()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if coalesce(auth.jwt() ->> 'role', '') in ('authenticated', 'anon')
     and public.is_community_suspended(old.id)
     and not public.platform_write_bypass() then
    raise exception 'community-suspended' using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$fn$;

create trigger communities_guard_suspension
  before update or delete on public.communities
  for each row execute function public.communities_guard_suspension();

-- ── 8. The public side of a suspended community: as if it did not exist ──

create or replace function public.portal_by_slug(p_slug text)
returns table (id text, slug text, name text, tagline text, public_description text, location text, founded_year integer, accent text, accent_soft text, monogram text, mark_style text, access_policy access_policy, links jsonb, default_locale text)
language sql
stable
security definer
set search_path = public
as $fn$
  select c.id, c.slug, c.name, c.tagline, c.public_description, c.location,
         c.founded_year, c.accent, c.accent_soft, c.monogram, c.mark_style,
         c.access_policy, c.links, c.default_locale
  from communities c
  where c.slug = p_slug
    and not public.is_community_suspended(c.id);
$fn$;

create or replace function public.portal_events(p_slug text)
returns table (id uuid, title text, description text, starts_at timestamptz, ends_at timestamptz, location text)
language sql
stable
security definer
set search_path = public
as $fn$
  select e.id, e.title, e.description, e.starts_at, e.ends_at, e.location
  from events e
  join communities c on c.id = e.community_id
  where c.slug = p_slug
    and not public.is_community_suspended(c.id)
    and e.is_public
    and e.local_group_id is null
    and e.subgroup_id is null
    and e.cancelled_at is null
    and e.ends_at >= now()
  order by e.starts_at;
$fn$;

create or replace function public.portal_slug_by_id(p_community_id text)
returns text
language sql
stable
security definer
set search_path = public
as $fn$
  select slug from communities
  where id = p_community_id and not public.is_community_suspended(id);
$fn$;

-- Unchanged except for the lookup: a suspended community answers like an
-- unknown one, so the form neither records anything nor reveals the state.
create or replace function public.request_community_access(p_slug text, p_email text, p_display_name text default null::text)
returns boolean
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_community_id text;
  v_policy access_policy;
  v_email text := normalize_email(p_email);
  -- Trimmed of ordinary whitespace and of characters that draw nothing.
  v_name text := regexp_replace(
    coalesce(p_display_name, ''),
    '^[\s ​-‍⁠﻿]+|[\s ​-‍⁠﻿]+$',
    '',
    'g'
  );
  v_recent int;
  v_request_id uuid;
  v_user_id uuid;
begin
  if not looks_like_email(v_email) then
    return false;
  end if;

  if v_name = '' or length(v_name) > 80 then
    return false;
  end if;

  select id, access_policy into v_community_id, v_policy
  from communities
  where slug = p_slug and not public.is_community_suspended(id);

  if v_community_id is null or v_policy <> 'request-to-join' then
    return true;
  end if;

  select count(*) into v_recent
  from access_requests
  where email = v_email and created_at > now() - interval '1 hour';
  if v_recent >= 3 then
    return true;
  end if;

  select count(*) into v_recent
  from access_requests
  where community_id = v_community_id and created_at > now() - interval '1 hour';
  if v_recent >= 50 then
    return true;
  end if;

  if exists (
    select 1
    from memberships m
    join auth.users u on u.id = m.user_id
    where m.community_id = v_community_id
      and normalize_email(u.email) = v_email
  ) then
    return true;
  end if;

  if exists (
    select 1 from invitations
    where community_id = v_community_id and email = v_email
      and accepted_at is null and revoked_at is null and expires_at > now()
  ) then
    return true;
  end if;

  if auth.uid() is not null then
    select u.id into v_user_id
    from auth.users u
    where u.id = auth.uid() and normalize_email(u.email) = v_email;
  end if;

  insert into access_requests (community_id, email, display_name, user_id)
  values (v_community_id, v_email, v_name, v_user_id)
  on conflict (community_id, email) where status = 'pending' do nothing
  returning id into v_request_id;

  if v_request_id is null then
    return true;
  end if;

  insert into notifications (user_id, kind, community_id, title, body, href)
  select
    m.user_id,
    'membership',
    v_community_id,
    v_name || ' ba om tilgang',
    'Forespørselen kom inn til ' || c.name || '. Du er administrator der.',
    '/community/' || v_community_id || '/requests'
  from memberships m
  join communities c on c.id = v_community_id
  where m.community_id = v_community_id
    and m.status = 'active'
    and m.role = 'admin'
    and not exists (
      select 1 from auth.users u
      where u.id = m.user_id and normalize_email(u.email) = v_email
    );

  return true;
end;
$fn$;

-- The invitation page learns which role the invitation carries. A suspended
-- community's invitations do not open.
drop function public.invitation_preview(text);

create function public.invitation_preview(p_token text)
returns table (community_id text, community_name text, community_slug text, email text, expires_at timestamptz, auto_activate boolean, community_default_locale text, invited_role text)
language sql
stable
security definer
set search_path = public, extensions
as $fn$
  select c.id, c.name, c.slug, i.email, i.expires_at,
         -- Already decided: an administrator approved the request, or TING
         -- appointed the administrator.
         i.request_id is not null or i.role = 'admin',
         c.default_locale,
         i.role::text
  from invitations i
  join communities c on c.id = i.community_id
  where i.token_hash = hash_invitation_token(p_token)
    and i.accepted_at is null
    and i.revoked_at is null
    and i.expires_at > now()
    and not public.is_community_suspended(c.id);
$fn$;

-- Accepting: as before, plus the administrator invitation. The address check,
-- the single use and the password requirement are untouched; an
-- administrator invitation additionally refuses when someone else became the
-- community's administrator in the meantime, before the invitation is spent.
create or replace function public.accept_invitation_token_for_account(p_token text)
returns table (ok boolean, community_id text, reason text)
language plpgsql
security definer
set search_path = public, extensions
as $fn$
declare
  v_invite invitations;
  v_email text;
  v_name text;
begin
  if auth.uid() is null then
    return query select false, null::text, 'not-authenticated';
    return;
  end if;

  select normalize_email(u.email) into v_email from auth.users u where u.id = auth.uid();

  select * into v_invite from invitations inv
  where inv.token_hash = hash_invitation_token(p_token);

  if v_invite.id is null or public.is_community_suspended(v_invite.community_id) then
    return query select false, null::text, 'invalid';
    return;
  end if;
  if v_invite.accepted_at is not null then
    return query select false, null::text, 'already-used';
    return;
  end if;
  if v_invite.revoked_at is not null then
    return query select false, null::text, 'revoked';
    return;
  end if;
  if v_invite.expires_at <= now() then
    return query select false, null::text, 'expired';
    return;
  end if;

  -- The invitation is for one address. Signing in as somebody else does not
  -- transfer it, and neither does being an admin somewhere.
  if v_email is distinct from v_invite.email then
    return query select false, null::text, 'email-mismatch';
    return;
  end if;

  if v_invite.role = 'admin' and exists (
    select 1 from memberships m
    where m.community_id = v_invite.community_id
      and m.status = 'active' and m.role = 'admin'
      and m.user_id <> auth.uid()
  ) then
    return query select false, null::text, 'admin-taken';
    return;
  end if;

  -- Consume first. If another request got here in the same moment this updates
  -- no rows and we stop, so two clicks cannot both create a membership.
  update invitations inv
  set accepted_at = now(), accepted_by = auth.uid()
  where inv.id = v_invite.id
    and inv.accepted_at is null and inv.revoked_at is null and inv.expires_at > now();

  if not found then
    return query select false, null::text, 'already-used';
    return;
  end if;

  select c.name into v_name from communities c where c.id = v_invite.community_id;

  if v_invite.role = 'admin' then
    insert into memberships (user_id, community_id, role, status, joined_at)
    values (auth.uid(), v_invite.community_id, 'admin', 'active', current_date)
    on conflict on constraint memberships_user_id_community_id_key do update
      set role = 'admin',
          status = 'active',
          joined_at = case when memberships.status = 'active' then memberships.joined_at else current_date end;

    insert into notifications (user_id, kind, community_id, title, body, href)
    values (
      auth.uid(), 'membership', v_invite.community_id,
      'Du er nå administrator for ' || v_name,
      'Invitasjonen fra TING er tatt i bruk. Du kan sette opp fellesskapet og invitere medlemmer.',
      '/community/' || v_invite.community_id
    );

    perform public.platform_audit(
      'community.admin.accept', 'community', v_invite.community_id, 'success',
      jsonb_build_object('user_id', auth.uid(), 'invitation_id', v_invite.id)
    );
    return query select true, v_invite.community_id, 'joined';
    return;
  end if;

  -- Already a member for some other reason: the invitation is spent, and
  -- nothing needs creating.
  if exists (
    select 1 from memberships m
    where m.user_id = auth.uid()
      and m.community_id = v_invite.community_id
      and m.status = 'active'
  ) then
    return query select true, v_invite.community_id, 'already-member';
    return;
  end if;

  insert into memberships (user_id, community_id, role, status, joined_at)
  values (auth.uid(), v_invite.community_id, 'member', 'active', current_date)
  -- Named constraint rather than a column list: `community_id` is also an
  -- output parameter of this function, and a bare column list resolves to the
  -- parameter instead of the column.
  on conflict on constraint memberships_user_id_community_id_key do update
    set status = 'active', joined_at = current_date;

  update access_requests ar set status = 'approved'
  where ar.id = v_invite.request_id and ar.status <> 'approved';

  insert into notifications (user_id, kind, community_id, title, body, href)
  values (
    auth.uid(), 'membership', v_invite.community_id,
    'Du er nå medlem av ' || v_name,
    'Invitasjonen er tatt i bruk. Du kan lese og delta i fellesskapet.',
    '/community/' || v_invite.community_id
  );

  return query select true, v_invite.community_id, 'joined';
end;
$fn$;

-- A community admin's "resend" keeps the invitation's role. Without this an
-- administrator invitation resent from a community's own queue would quietly
-- become a member invitation.
create or replace function public.resend_invitation(p_invitation_id uuid)
returns table (token text, email text, community_id text, expires_at timestamptz)
language plpgsql
security definer
set search_path = public, extensions
as $fn$
declare
  v_invite invitations;
  v_token text;
  v_recent int;
begin
  select * into v_invite from invitations inv where inv.id = p_invitation_id;
  if v_invite.id is null or not is_admin(v_invite.community_id) then
    return;
  end if;
  if v_invite.accepted_at is not null then
    return;
  end if;
  -- Administrator invitations are TING's to issue and resend.
  if v_invite.role <> 'member' then
    return;
  end if;

  select count(*) into v_recent from invitations inv
  where inv.community_id = v_invite.community_id and inv.email = v_invite.email
    and inv.created_at > now() - interval '1 hour';
  if v_recent >= 5 then
    return;
  end if;

  update invitations inv set revoked_at = now()
   where inv.id = v_invite.id and inv.revoked_at is null;

  v_token := encode(extensions.gen_random_bytes(32), 'hex');

  insert into invitations (community_id, email, token_hash, request_id, invited_by, expires_at)
  values (
    v_invite.community_id, v_invite.email, hash_invitation_token(v_token),
    v_invite.request_id, auth.uid(), now() + invitation_lifetime()
  );

  return query select v_token, v_invite.email, v_invite.community_id, (now() + invitation_lifetime());
end;
$fn$;

-- ── 9. Platform functions ────────────────────────────────────────────────

-- Identifiers and portal slugs: lowercase, digits and single hyphens, 3–50
-- characters, and never a word the site itself uses at the top level (a
-- portal lives at /<slug>, so "login" would shadow the login page).
create or replace function public.platform_identifier_is_valid(p_value text)
returns boolean
language sql
immutable
set search_path = public
as $fn$
  select p_value is not null
    and p_value ~ '^[a-z0-9](?:[a-z0-9-]{1,48}[a-z0-9])$'
    and p_value !~ '--'
    and p_value not in (
      'admin', 'api', 'app', 'apple-icon', 'arrangement', 'auth', 'bekreft-e-post', 'brand',
      'collaboration', 'collaborations', 'communities', 'community', 'demo', 'emoji-catalog',
      'events', 'favicon', 'glemt-passord', 'hjelp', 'home', 'icon', 'invitasjon', 'kontakt',
      'login', 'logout', 'manifest', 'next', 'notifications', 'nytt-passord', 'om',
      'opprett-passord', 'personvern', 'platform', 'platform-admin', 'profile', 'robots',
      'samarbeid', 'settings', 'sitemap', 'static', 'support', 'ting', 'velkommen', 'vilkar', 'www'
    );
$fn$;

create or replace function public.platform_color_is_valid(p_value text)
returns boolean
language sql
immutable
set search_path = public
as $fn$
  select p_value is not null and p_value ~ '^#[0-9a-f]{6}$';
$fn$;

create or replace function public.platform_overview()
returns table (
  communities_total bigint,
  communities_active bigint,
  communities_suspended bigint,
  requests_pending bigint,
  operators_active bigint
)
language plpgsql
stable
security definer
set search_path = public
as $fn$
begin
  perform public.platform_require();
  return query
    select
      (select count(*) from communities),
      (select count(*) from communities c where not public.is_community_suspended(c.id)),
      (select count(*) from community_platform_state s where s.status = 'suspended'),
      (select count(*) from platform_onboarding_requests r where r.status = 'pending'),
      (select count(*) from platform_operators o where o.revoked_at is null);
end;
$fn$;

-- The list: metadata, the one administrator, and an aggregate count of
-- active members. No member names, no content.
create or replace function public.platform_list_communities(p_search text default null, p_status text default null)
returns table (
  id text,
  slug text,
  name text,
  status text,
  provisioned_at timestamptz,
  member_count bigint,
  admin_name text,
  admin_email text,
  pending_admin_email text,
  accent text,
  monogram text,
  mark_style text
)
language plpgsql
stable
security definer
set search_path = public, auth
as $fn$
declare
  v_search text := nullif(lower(btrim(coalesce(p_search, ''))), '');
begin
  perform public.platform_require();
  if p_status is not null and p_status not in ('active', 'suspended') then
    raise exception 'invalid-input' using errcode = '22023';
  end if;
  return query
    select c.id, c.slug, c.name,
           coalesce(s.status, 'active'),
           s.provisioned_at,
           (select count(*) from memberships m where m.community_id = c.id and m.status = 'active'),
           ap.name,
           au.email::text,
           (select i.email from invitations i
             where i.community_id = c.id and i.role = 'admin'
               and i.accepted_at is null and i.revoked_at is null and i.expires_at > now()
             order by i.created_at desc limit 1),
           c.accent, c.monogram, c.mark_style
    from communities c
    left join community_platform_state s on s.community_id = c.id
    left join memberships am on am.community_id = c.id and am.status = 'active' and am.role = 'admin'
    left join profiles ap on ap.id = am.user_id
    left join auth.users au on au.id = am.user_id
    where (p_status is null or coalesce(s.status, 'active') = p_status)
      and (
        v_search is null
        or position(v_search in lower(c.name)) > 0
        or position(v_search in c.slug) > 0
        or position(v_search in c.id) > 0
      )
    order by lower(c.name);
end;
$fn$;

create or replace function public.platform_get_community(p_community_id text)
returns table (
  id text,
  slug text,
  name text,
  tagline text,
  public_description text,
  location text,
  founded_year integer,
  accent text,
  accent_soft text,
  monogram text,
  mark_style text,
  access_policy public.access_policy,
  default_locale text,
  member_directory_visibility public.member_directory_visibility,
  dm_policy public.dm_policy,
  has_avatar boolean,
  status text,
  provisioned_at timestamptz,
  provisioned_by_email text,
  onboarding_request_id uuid,
  suspended_at timestamptz,
  suspended_by_email text,
  suspension_reason text,
  member_count bigint,
  moderator_count bigint,
  admin_user_id uuid,
  admin_name text,
  admin_email text,
  admin_since date
)
language plpgsql
stable
security definer
set search_path = public, auth
as $fn$
begin
  perform public.platform_require();
  return query
    select c.id, c.slug, c.name, c.tagline, c.public_description, c.location, c.founded_year,
           c.accent, c.accent_soft, c.monogram, c.mark_style, c.access_policy, c.default_locale,
           c.member_directory_visibility, c.dm_policy,
           c.avatar_path is not null,
           coalesce(s.status, 'active'),
           s.provisioned_at,
           (select u.email::text from auth.users u where u.id = s.provisioned_by),
           s.onboarding_request_id,
           s.suspended_at,
           (select u.email::text from auth.users u where u.id = s.suspended_by),
           s.suspension_reason,
           (select count(*) from memberships m where m.community_id = c.id and m.status = 'active'),
           (select count(*) from memberships m where m.community_id = c.id and m.status = 'active' and m.role = 'moderator'),
           am.user_id,
           ap.name,
           au.email::text,
           am.joined_at
    from communities c
    left join community_platform_state s on s.community_id = c.id
    left join memberships am on am.community_id = c.id and am.status = 'active' and am.role = 'admin'
    left join profiles ap on ap.id = am.user_id
    left join auth.users au on au.id = am.user_id
    where c.id = p_community_id;
end;
$fn$;

create or replace function public.platform_community_admin_invitations(p_community_id text)
returns table (id uuid, email text, created_at timestamptz, expires_at timestamptz, invited_by_email text)
language plpgsql
stable
security definer
set search_path = public, auth
as $fn$
begin
  perform public.platform_require();
  return query
    select i.id, i.email, i.created_at, i.expires_at,
           (select u.email::text from auth.users u where u.id = i.invited_by)
    from invitations i
    where i.community_id = p_community_id and i.role = 'admin'
      and i.accepted_at is null and i.revoked_at is null and i.expires_at > now()
    order by i.created_at desc;
end;
$fn$;

-- Makes `p_email` the community's administrator. Internal: called by the
-- functions below after platform_require().
--
-- Identity comes from Auth, never from the address alone. A *confirmed*
-- account that has chosen a password is made administrator on the spot —
-- the person proved the address when they confirmed it, and the database
-- would refuse an active membership without a password anyway. Anything
-- else — no account, an unconfirmed one, one without a password — gets an
-- administrator invitation, which only the owner of that address can accept
-- (accept_invitation_token checks the signed-in address and, first, the
-- password).
--
-- One administrator per community (memberships_one_active_admin_per_community_idx).
-- If there is one, this refuses unless `p_replace`, which only applies to a
-- ready account: the previous administrator stays a member.
create or replace function public.platform_designate_admin(p_community_id text, p_email text, p_replace boolean)
returns table (outcome text, token text, email text, expires_at timestamptz)
language plpgsql
security definer
set search_path = public, extensions, auth
as $fn$
declare
  v_email text := normalize_email(p_email);
  v_user_id uuid;
  v_banned_until timestamptz;
  v_current memberships;
  v_token text;
  v_expires timestamptz;
  v_name text;
begin
  if v_email is null or not looks_like_email(v_email) or length(v_email) > 254 then
    raise exception 'invalid-email' using errcode = '22023';
  end if;

  select c.name into v_name from communities c where c.id = p_community_id;
  if v_name is null then
    raise exception 'community-not-found' using errcode = 'P0002';
  end if;
  -- An appointment in a suspended community could not be used anyway (the
  -- invitation does not open, the role grants nothing); reactivate first.
  if public.is_community_suspended(p_community_id) then
    raise exception 'community-suspended' using errcode = 'P0001';
  end if;

  perform set_config('ting.platform_write', 'on', true);
  perform pg_advisory_xact_lock(hashtextextended('platform-admin:' || p_community_id, 0));

  select * into v_current from memberships m
  where m.community_id = p_community_id and m.status = 'active' and m.role = 'admin';

  select u.id, u.banned_until into v_user_id, v_banned_until
  from auth.users u
  where normalize_email(u.email) = v_email
    and u.email_confirmed_at is not null
    and u.deleted_at is null
  limit 1;

  if v_user_id is not null and v_banned_until is not null and v_banned_until > now() then
    raise exception 'account-unavailable' using errcode = 'P0001';
  end if;

  if v_user_id is not null and v_current.user_id = v_user_id then
    return query select 'already-admin'::text, null::text, v_email, null::timestamptz;
    return;
  end if;

  if v_user_id is not null and public.account_has_password(v_user_id) then
    if v_current.id is not null then
      if not coalesce(p_replace, false) then
        raise exception 'admin-exists' using errcode = 'P0001';
      end if;
      update memberships m set role = 'member' where m.id = v_current.id;
      perform public.platform_audit(
        'community.admin.remove', 'community', p_community_id, 'success',
        jsonb_build_object('user_id', v_current.user_id, 'replaced_by', v_user_id)
      );
    end if;

    insert into memberships (user_id, community_id, role, status, joined_at)
    values (v_user_id, p_community_id, 'admin', 'active', current_date)
    on conflict on constraint memberships_user_id_community_id_key do update
      set role = 'admin',
          status = 'active',
          joined_at = case when memberships.status = 'active' then memberships.joined_at else current_date end;

    -- Nothing else is a way in for this person any more: open invitations
    -- stop working, and a request of their own waiting in the queue is done.
    update invitations inv set revoked_at = now()
    where inv.community_id = p_community_id
      and (inv.email = v_email or inv.role = 'admin')
      and inv.accepted_at is null and inv.revoked_at is null;
    update access_requests ar
       set status = 'approved', reviewed_at = now(), reviewed_by = auth.uid()
     where ar.community_id = p_community_id and ar.email = v_email and ar.status = 'pending';

    insert into notifications (user_id, kind, community_id, title, body, href)
    values (
      v_user_id, 'membership', p_community_id,
      'Du er nå administrator for ' || v_name,
      'TING har gitt deg administratorrollen. Du kan sette opp fellesskapet og invitere medlemmer.',
      '/community/' || p_community_id
    );

    perform public.platform_audit(
      'community.admin.assign', 'community', p_community_id, 'success',
      jsonb_build_object('user_id', v_user_id, 'email', v_email, 'replaced', v_current.id is not null)
    );
    return query select 'assigned'::text, null::text, v_email, null::timestamptz;
    return;
  end if;

  if v_current.id is not null then
    -- An invitation cannot be accepted while someone else administers the
    -- community; say so now rather than send a link that will not work.
    raise exception 'admin-exists' using errcode = 'P0001';
  end if;

  -- One designated administrator at a time: earlier administrator
  -- invitations, and any other open invitation for this address, stop working.
  update invitations inv set revoked_at = now()
  where inv.community_id = p_community_id
    and (inv.role = 'admin' or inv.email = v_email)
    and inv.accepted_at is null and inv.revoked_at is null;

  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  v_expires := now() + invitation_lifetime();

  insert into invitations (community_id, email, token_hash, request_id, invited_by, expires_at, role)
  values (p_community_id, v_email, hash_invitation_token(v_token), null, auth.uid(), v_expires, 'admin');

  perform public.platform_audit(
    'community.admin.invite', 'community', p_community_id, 'success',
    jsonb_build_object('email', v_email, 'expires_at', v_expires)
  );
  return query select 'invited'::text, v_token, v_email, v_expires;
end;
$fn$;

-- Creates a community and everything it needs to work, in one transaction:
-- the community row with its settings, its platform record, the link to the
-- onboarding request it answers, and — when an address is given — its first
-- administrator or the invitation for them. A failure anywhere leaves nothing
-- behind. A community needs no channel, section or profile to exist: it starts
-- empty by design (see lib/bootstrap/definition.ts), the platform headings for
-- lokallag and group chats are global rows the migrations create, and a
-- member's community profile is made when their membership becomes active.
--
-- `p_creation_key` is generated once per form. The same key a second time —
-- a double click, a resubmitted page — returns the community the first call
-- created, with `created` false, and creates nothing.
create or replace function public.platform_create_community(
  p_id text,
  p_slug text,
  p_name text,
  p_tagline text,
  p_public_description text,
  p_location text,
  p_founded_year integer,
  p_accent text,
  p_accent_soft text,
  p_monogram text,
  p_mark_style text,
  p_access_policy public.access_policy,
  p_default_locale text,
  p_member_directory_visibility public.member_directory_visibility,
  p_dm_policy public.dm_policy,
  p_admin_email text,
  p_onboarding_request_id uuid,
  p_creation_key uuid
)
returns table (
  community_id text,
  slug text,
  created boolean,
  admin_outcome text,
  admin_token text,
  admin_email text,
  admin_expires_at timestamptz
)
language plpgsql
security definer
set search_path = public, extensions
as $fn$
declare
  v_existing text;
  v_request platform_onboarding_requests;
  v_name text := btrim(coalesce(p_name, ''));
  v_tagline text := btrim(coalesce(p_tagline, ''));
  v_description text := btrim(coalesce(p_public_description, ''));
  v_location text := btrim(coalesce(p_location, ''));
  v_monogram text := upper(btrim(coalesce(p_monogram, '')));
  v_admin record;
begin
  perform public.platform_require();

  if p_creation_key is null then
    raise exception 'invalid-input' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('platform-create:' || p_creation_key::text, 0));
  select s.community_id into v_existing from community_platform_state s where s.creation_key = p_creation_key;
  if v_existing is not null then
    return query
      select c.id, c.slug, false, null::text, null::text, null::text, null::timestamptz
      from communities c where c.id = v_existing;
    return;
  end if;

  if not public.platform_identifier_is_valid(p_id) then
    raise exception 'invalid-id' using errcode = '22023';
  end if;
  if not public.platform_identifier_is_valid(p_slug) then
    raise exception 'invalid-slug' using errcode = '22023';
  end if;
  if length(v_name) not between 2 and 80 then
    raise exception 'invalid-name' using errcode = '22023';
  end if;
  if length(v_tagline) > 140 or length(v_description) > 1000 or length(v_location) > 80 then
    raise exception 'invalid-text' using errcode = '22023';
  end if;
  if p_founded_year is null or p_founded_year not between 1800 and extract(year from now())::int then
    raise exception 'invalid-year' using errcode = '22023';
  end if;
  if not public.platform_color_is_valid(p_accent) or not public.platform_color_is_valid(p_accent_soft) then
    raise exception 'invalid-color' using errcode = '22023';
  end if;
  if v_monogram !~ '^[A-ZÆØÅ0-9]{1,3}$' then
    raise exception 'invalid-monogram' using errcode = '22023';
  end if;
  if coalesce(p_mark_style, '') not in ('sans', 'serif', 'mono')
     or coalesce(p_default_locale, '') not in ('nb', 'en')
     or p_access_policy is null or p_member_directory_visibility is null or p_dm_policy is null then
    raise exception 'invalid-input' using errcode = '22023';
  end if;

  if exists (select 1 from communities c where c.id = p_id) then
    raise exception 'id-taken' using errcode = '23505';
  end if;
  if exists (select 1 from communities c where c.slug = p_slug) then
    raise exception 'slug-taken' using errcode = '23505';
  end if;

  if p_onboarding_request_id is not null then
    select * into v_request from platform_onboarding_requests r where r.id = p_onboarding_request_id for update;
    if v_request.id is null then
      raise exception 'request-not-found' using errcode = 'P0002';
    end if;
    if v_request.status = 'rejected' then
      raise exception 'request-rejected' using errcode = 'P0001';
    end if;
    if v_request.community_id is not null then
      raise exception 'request-already-provisioned' using errcode = 'P0001';
    end if;
  end if;

  insert into communities (
    id, slug, name, tagline, public_description, about, location, founded_year,
    accent, accent_soft, monogram, mark_style, access_policy, links,
    member_directory_visibility, dm_policy, default_locale
  )
  values (
    p_id, p_slug, v_name, v_tagline, v_description, '', v_location, p_founded_year,
    p_accent, p_accent_soft, v_monogram, p_mark_style, p_access_policy, '[]'::jsonb,
    p_member_directory_visibility, p_dm_policy, p_default_locale
  );

  insert into community_platform_state (community_id, status, provisioned_at, provisioned_by, creation_key, onboarding_request_id)
  values (p_id, 'active', now(), auth.uid(), p_creation_key, p_onboarding_request_id);

  perform public.platform_audit(
    'community.create', 'community', p_id, 'success',
    jsonb_build_object(
      'slug', p_slug,
      'name', v_name,
      'access_policy', p_access_policy,
      'member_directory_visibility', p_member_directory_visibility,
      'dm_policy', p_dm_policy,
      'default_locale', p_default_locale,
      'onboarding_request_id', p_onboarding_request_id
    )
  );

  if v_request.id is not null then
    update platform_onboarding_requests r
       set status = 'approved',
           reviewed_at = coalesce(r.reviewed_at, now()),
           reviewed_by = coalesce(r.reviewed_by, auth.uid()),
           community_id = p_id,
           updated_at = now()
     where r.id = v_request.id;
    if v_request.status = 'pending' then
      perform public.platform_audit(
        'onboarding_request.approve', 'onboarding_request', v_request.id::text, 'success',
        jsonb_build_object('community_id', p_id)
      );
    end if;
  end if;

  if nullif(btrim(coalesce(p_admin_email, '')), '') is not null then
    select * into v_admin from public.platform_designate_admin(p_id, p_admin_email, false);
    return query select p_id, p_slug, true, v_admin.outcome, v_admin.token, v_admin.email, v_admin.expires_at;
    return;
  end if;

  return query select p_id, p_slug, true, null::text, null::text, null::text, null::timestamptz;
end;
$fn$;

-- Edits what TING may edit: identity, branding, the portal address, the
-- access settings. Not the organisation's own About text, links, channels,
-- groups or anything else its administrators manage.
create or replace function public.platform_update_community(
  p_community_id text,
  p_slug text,
  p_name text,
  p_tagline text,
  p_public_description text,
  p_location text,
  p_founded_year integer,
  p_accent text,
  p_accent_soft text,
  p_monogram text,
  p_mark_style text,
  p_access_policy public.access_policy,
  p_default_locale text,
  p_member_directory_visibility public.member_directory_visibility,
  p_dm_policy public.dm_policy
)
returns boolean
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_old communities;
  v_name text := btrim(coalesce(p_name, ''));
  v_tagline text := btrim(coalesce(p_tagline, ''));
  v_description text := btrim(coalesce(p_public_description, ''));
  v_location text := btrim(coalesce(p_location, ''));
  v_monogram text := upper(btrim(coalesce(p_monogram, '')));
  v_changed text[] := '{}';
  v_meta jsonb := '{}'::jsonb;
begin
  perform public.platform_require();

  select * into v_old from communities c where c.id = p_community_id for update;
  if v_old.id is null then
    raise exception 'community-not-found' using errcode = 'P0002';
  end if;

  if not public.platform_identifier_is_valid(p_slug) then
    raise exception 'invalid-slug' using errcode = '22023';
  end if;
  if length(v_name) not between 2 and 80 then
    raise exception 'invalid-name' using errcode = '22023';
  end if;
  if length(v_tagline) > 140 or length(v_description) > 1000 or length(v_location) > 80 then
    raise exception 'invalid-text' using errcode = '22023';
  end if;
  if p_founded_year is null or p_founded_year not between 1800 and extract(year from now())::int then
    raise exception 'invalid-year' using errcode = '22023';
  end if;
  if not public.platform_color_is_valid(p_accent) or not public.platform_color_is_valid(p_accent_soft) then
    raise exception 'invalid-color' using errcode = '22023';
  end if;
  if v_monogram !~ '^[A-ZÆØÅ0-9]{1,3}$' then
    raise exception 'invalid-monogram' using errcode = '22023';
  end if;
  if coalesce(p_mark_style, '') not in ('sans', 'serif', 'mono')
     or coalesce(p_default_locale, '') not in ('nb', 'en')
     or p_access_policy is null or p_member_directory_visibility is null or p_dm_policy is null then
    raise exception 'invalid-input' using errcode = '22023';
  end if;
  if p_slug <> v_old.slug and exists (select 1 from communities c where c.slug = p_slug) then
    raise exception 'slug-taken' using errcode = '23505';
  end if;

  if p_slug <> v_old.slug then
    v_changed := v_changed || 'slug'::text;
    v_meta := v_meta || jsonb_build_object('slug', jsonb_build_object('from', v_old.slug, 'to', p_slug));
  end if;
  if v_name <> v_old.name then
    v_changed := v_changed || 'name'::text;
    v_meta := v_meta || jsonb_build_object('name', jsonb_build_object('from', v_old.name, 'to', v_name));
  end if;
  if v_tagline <> v_old.tagline then v_changed := v_changed || 'tagline'::text; end if;
  if v_description <> v_old.public_description then v_changed := v_changed || 'public_description'::text; end if;
  if v_location <> v_old.location then v_changed := v_changed || 'location'::text; end if;
  if p_founded_year <> v_old.founded_year then v_changed := v_changed || 'founded_year'::text; end if;
  if p_accent <> v_old.accent or p_accent_soft <> v_old.accent_soft then v_changed := v_changed || 'accent'::text; end if;
  if v_monogram <> v_old.monogram or p_mark_style <> v_old.mark_style then v_changed := v_changed || 'mark'::text; end if;
  if p_access_policy <> v_old.access_policy then
    v_changed := v_changed || 'access_policy'::text;
    v_meta := v_meta || jsonb_build_object('access_policy', jsonb_build_object('from', v_old.access_policy, 'to', p_access_policy));
  end if;
  if p_default_locale <> v_old.default_locale then v_changed := v_changed || 'default_locale'::text; end if;
  if p_member_directory_visibility <> v_old.member_directory_visibility then
    v_changed := v_changed || 'member_directory_visibility'::text;
    v_meta := v_meta || jsonb_build_object('member_directory_visibility', jsonb_build_object('from', v_old.member_directory_visibility, 'to', p_member_directory_visibility));
  end if;
  if p_dm_policy <> v_old.dm_policy then
    v_changed := v_changed || 'dm_policy'::text;
    v_meta := v_meta || jsonb_build_object('dm_policy', jsonb_build_object('from', v_old.dm_policy, 'to', p_dm_policy));
  end if;

  if cardinality(v_changed) = 0 then
    return false;
  end if;

  perform set_config('ting.platform_write', 'on', true);
  update communities c set
    slug = p_slug,
    name = v_name,
    tagline = v_tagline,
    public_description = v_description,
    location = v_location,
    founded_year = p_founded_year,
    accent = p_accent,
    accent_soft = p_accent_soft,
    monogram = v_monogram,
    mark_style = p_mark_style,
    access_policy = p_access_policy,
    default_locale = p_default_locale,
    member_directory_visibility = p_member_directory_visibility,
    dm_policy = p_dm_policy
  where c.id = p_community_id;

  insert into community_platform_state (community_id) values (p_community_id) on conflict (community_id) do nothing;
  update community_platform_state s set updated_at = now() where s.community_id = p_community_id;

  perform public.platform_audit(
    'community.update', 'community', p_community_id, 'success',
    v_meta || jsonb_build_object('changed', to_jsonb(v_changed))
  );
  return true;
end;
$fn$;

create or replace function public.platform_assign_community_admin(p_community_id text, p_email text, p_replace boolean default false)
returns table (outcome text, token text, email text, expires_at timestamptz)
language plpgsql
security definer
set search_path = public
as $fn$
begin
  perform public.platform_require();
  return query select * from public.platform_designate_admin(p_community_id, p_email, p_replace);
end;
$fn$;

-- The administrator goes back to being a member. Their membership, their
-- posts and everything else stay; only the role changes.
create or replace function public.platform_remove_community_admin(p_community_id text)
returns boolean
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_current memberships;
begin
  perform public.platform_require();
  perform set_config('ting.platform_write', 'on', true);
  perform pg_advisory_xact_lock(hashtextextended('platform-admin:' || p_community_id, 0));

  select * into v_current from memberships m
  where m.community_id = p_community_id and m.status = 'active' and m.role = 'admin';
  if v_current.id is null then
    raise exception 'no-admin' using errcode = 'P0002';
  end if;

  update memberships m set role = 'member' where m.id = v_current.id;
  perform public.platform_audit(
    'community.admin.remove', 'community', p_community_id, 'success',
    jsonb_build_object('user_id', v_current.user_id)
  );
  return true;
end;
$fn$;

create or replace function public.platform_revoke_admin_invitation(p_invitation_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_invite invitations;
begin
  perform public.platform_require();
  perform set_config('ting.platform_write', 'on', true);
  select * into v_invite from invitations i where i.id = p_invitation_id and i.role = 'admin';
  if v_invite.id is null or v_invite.accepted_at is not null or v_invite.revoked_at is not null then
    raise exception 'invitation-not-open' using errcode = 'P0002';
  end if;
  update invitations i set revoked_at = now() where i.id = v_invite.id;
  perform public.platform_audit(
    'community.admin.invitation.revoke', 'community', v_invite.community_id, 'success',
    jsonb_build_object('invitation_id', v_invite.id, 'email', v_invite.email)
  );
  return true;
end;
$fn$;

-- A fresh link for the same address; the old one stops working. Limited to
-- five an hour per address, so this cannot be used to mail someone repeatedly.
create or replace function public.platform_resend_admin_invitation(p_invitation_id uuid)
returns table (token text, email text, community_id text, expires_at timestamptz)
language plpgsql
security definer
set search_path = public, extensions
as $fn$
declare
  v_invite invitations;
  v_token text;
  v_expires timestamptz;
  v_recent int;
begin
  perform public.platform_require();
  perform set_config('ting.platform_write', 'on', true);

  select * into v_invite from invitations i where i.id = p_invitation_id and i.role = 'admin';
  if v_invite.id is null or v_invite.accepted_at is not null then
    raise exception 'invitation-not-open' using errcode = 'P0002';
  end if;
  if exists (
    select 1 from memberships m
    where m.community_id = v_invite.community_id and m.status = 'active' and m.role = 'admin'
  ) then
    raise exception 'admin-exists' using errcode = 'P0001';
  end if;

  select count(*) into v_recent from invitations i
  where i.community_id = v_invite.community_id and i.email = v_invite.email
    and i.created_at > now() - interval '1 hour';
  if v_recent >= 5 then
    raise exception 'rate-limited' using errcode = 'P0001';
  end if;

  update invitations i set revoked_at = now()
  where i.community_id = v_invite.community_id and i.role = 'admin'
    and i.accepted_at is null and i.revoked_at is null;

  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  v_expires := now() + invitation_lifetime();
  insert into invitations (community_id, email, token_hash, request_id, invited_by, expires_at, role)
  values (v_invite.community_id, v_invite.email, hash_invitation_token(v_token), null, auth.uid(), v_expires, 'admin');

  perform public.platform_audit(
    'community.admin.invitation.resend', 'community', v_invite.community_id, 'success',
    jsonb_build_object('previous_invitation_id', v_invite.id, 'email', v_invite.email, 'expires_at', v_expires)
  );
  return query select v_token, v_invite.email, v_invite.community_id, v_expires;
end;
$fn$;

create or replace function public.platform_suspend_community(p_community_id text, p_reason text)
returns boolean
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  perform public.platform_require();
  if length(v_reason) not between 3 and 1000 then
    raise exception 'invalid-reason' using errcode = '22023';
  end if;
  if not exists (select 1 from communities c where c.id = p_community_id) then
    raise exception 'community-not-found' using errcode = 'P0002';
  end if;

  insert into community_platform_state (community_id) values (p_community_id) on conflict (community_id) do nothing;
  update community_platform_state s
     set status = 'suspended', suspended_at = now(), suspended_by = auth.uid(),
         suspension_reason = v_reason, updated_at = now()
   where s.community_id = p_community_id and s.status = 'active';
  if not found then
    raise exception 'already-suspended' using errcode = 'P0001';
  end if;

  perform public.platform_audit('community.suspend', 'community', p_community_id, 'success', jsonb_build_object('reason', v_reason));
  return true;
end;
$fn$;

create or replace function public.platform_reactivate_community(p_community_id text, p_note text)
returns boolean
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_note text := btrim(coalesce(p_note, ''));
begin
  perform public.platform_require();
  if length(v_note) > 1000 then
    raise exception 'invalid-reason' using errcode = '22023';
  end if;
  update community_platform_state s
     set status = 'active', suspended_at = null, suspended_by = null,
         suspension_reason = null, updated_at = now()
   where s.community_id = p_community_id and s.status = 'suspended';
  if not found then
    raise exception 'not-suspended' using errcode = 'P0001';
  end if;

  perform public.platform_audit('community.reactivate', 'community', p_community_id, 'success', jsonb_build_object('note', nullif(v_note, '')));
  return true;
end;
$fn$;

-- ── Onboarding requests ──

-- The public form, through the server only (service role): the server knows
-- the caller's network address and passes a hash of it for rate limiting.
-- Every well-formed submission answers true, whether it was stored, a
-- duplicate or over a limit, so the form cannot be used to learn anything.
create or replace function public.submit_onboarding_request(
  p_organization_name text,
  p_contact_name text,
  p_contact_email text,
  p_website text,
  p_member_estimate integer,
  p_message text,
  p_client_key text
)
returns boolean
language plpgsql
security definer
set search_path = public, extensions
as $fn$
declare
  v_org text := btrim(coalesce(p_organization_name, ''));
  v_contact text := btrim(coalesce(p_contact_name, ''));
  v_email text := normalize_email(p_contact_email);
  v_website text := nullif(btrim(coalesce(p_website, '')), '');
  v_message text := btrim(coalesce(p_message, ''));
  v_key text := case when nullif(btrim(coalesce(p_client_key, '')), '') is null then null
                     else encode(extensions.digest('onboarding:' || p_client_key, 'sha256'), 'hex') end;
begin
  if v_email is null or not looks_like_email(v_email) or length(v_email) > 254
     or length(v_org) not between 2 and 120
     or length(v_contact) not between 1 and 120
     or length(v_message) not between 10 and 3000
     or (v_website is not null and (length(v_website) > 300 or v_website !~* '^https?://[^\s/]+\.[^\s]+$'))
     or (p_member_estimate is not null and p_member_estimate not between 1 and 10000000) then
    return false;
  end if;

  delete from platform_onboarding_attempts a where a.attempted_at < now() - interval '1 day';

  if v_key is not null then
    if (select count(*) from platform_onboarding_attempts a
        where a.key_hash = v_key and a.attempted_at > now() - interval '1 hour') >= 3 then
      return true;
    end if;
    insert into platform_onboarding_attempts (key_hash) values (v_key);
  end if;

  if (select count(*) from platform_onboarding_requests r where r.created_at > now() - interval '1 hour') >= 30 then
    return true;
  end if;
  if exists (select 1 from platform_onboarding_requests r where r.contact_email = v_email and r.status = 'pending') then
    return true;
  end if;

  insert into platform_onboarding_requests (organization_name, contact_name, contact_email, website, member_estimate, message)
  values (v_org, v_contact, v_email, v_website, p_member_estimate, v_message);
  return true;
end;
$fn$;

create or replace function public.platform_list_onboarding_requests(p_status text default null)
returns table (
  id uuid,
  created_at timestamptz,
  organization_name text,
  contact_name text,
  contact_email text,
  member_estimate integer,
  status text,
  reviewed_at timestamptz,
  community_id text
)
language plpgsql
stable
security definer
set search_path = public
as $fn$
begin
  perform public.platform_require();
  if p_status is not null and p_status not in ('pending', 'approved', 'rejected') then
    raise exception 'invalid-input' using errcode = '22023';
  end if;
  return query
    select r.id, r.created_at, r.organization_name, r.contact_name, r.contact_email,
           r.member_estimate, r.status, r.reviewed_at, r.community_id
    from platform_onboarding_requests r
    where p_status is null or r.status = p_status
    order by case r.status when 'pending' then 0 else 1 end, r.created_at desc
    limit 500;
end;
$fn$;

create or replace function public.platform_get_onboarding_request(p_request_id uuid)
returns table (
  id uuid,
  created_at timestamptz,
  organization_name text,
  contact_name text,
  contact_email text,
  website text,
  member_estimate integer,
  message text,
  status text,
  review_note text,
  reviewed_at timestamptz,
  reviewed_by_email text,
  community_id text,
  community_name text
)
language plpgsql
stable
security definer
set search_path = public, auth
as $fn$
begin
  perform public.platform_require();
  return query
    select r.id, r.created_at, r.organization_name, r.contact_name, r.contact_email, r.website,
           r.member_estimate, r.message, r.status, r.review_note, r.reviewed_at,
           (select u.email::text from auth.users u where u.id = r.reviewed_by),
           r.community_id,
           (select c.name from communities c where c.id = r.community_id)
    from platform_onboarding_requests r
    where r.id = p_request_id;
end;
$fn$;

-- Approving here records the decision; it creates nothing. The community is
-- created separately, with platform_create_community(), which links it.
create or replace function public.platform_review_onboarding_request(p_request_id uuid, p_decision text, p_note text)
returns boolean
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  perform public.platform_require();
  if p_decision not in ('approved', 'rejected') or length(coalesce(v_note, '')) > 3000 then
    raise exception 'invalid-input' using errcode = '22023';
  end if;
  update platform_onboarding_requests r
     set status = p_decision,
         review_note = coalesce(v_note, r.review_note),
         reviewed_at = now(),
         reviewed_by = auth.uid(),
         updated_at = now()
   where r.id = p_request_id and r.status = 'pending';
  if not found then
    raise exception 'request-not-pending' using errcode = 'P0001';
  end if;
  perform public.platform_audit(
    case p_decision when 'approved' then 'onboarding_request.approve' else 'onboarding_request.reject' end,
    'onboarding_request', p_request_id::text, 'success', '{}'::jsonb
  );
  return true;
end;
$fn$;

create or replace function public.platform_set_onboarding_note(p_request_id uuid, p_note text)
returns boolean
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  perform public.platform_require();
  if length(coalesce(v_note, '')) > 3000 then
    raise exception 'invalid-input' using errcode = '22023';
  end if;
  update platform_onboarding_requests r set review_note = v_note, updated_at = now() where r.id = p_request_id;
  if not found then
    raise exception 'request-not-found' using errcode = 'P0002';
  end if;
  perform public.platform_audit('onboarding_request.note', 'onboarding_request', p_request_id::text, 'success', '{}'::jsonb);
  return true;
end;
$fn$;

-- ── Platform operators ──

-- At least one active owner, whatever an API caller does. AFTER, with a lock
-- every change to an owner takes, so two owners demoting each other at the
-- same moment cannot both succeed. The server's own key (and Auth deleting an
-- account) is not held to it: that is the infrastructure level, which can
-- already do anything, and the recovery command restores an owner from there.
create or replace function public.platform_operators_keep_an_owner()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if coalesce(auth.jwt() ->> 'role', '') in ('authenticated', 'anon')
     and old.role = 'owner' and old.revoked_at is null
     and (tg_op = 'DELETE' or new.role <> 'owner' or new.revoked_at is not null) then
    perform pg_advisory_xact_lock(hashtextextended('platform-owners', 0));
    if not exists (
      select 1 from platform_operators o
      where o.role = 'owner' and o.revoked_at is null and o.user_id <> old.user_id
    ) then
      raise exception 'last-owner' using errcode = 'P0001',
        hint = 'TING must always have an active platform owner. Appoint another owner first.';
    end if;
  end if;
  return null;
end;
$fn$;

create trigger platform_operators_keep_an_owner
  after update or delete on public.platform_operators
  for each row execute function public.platform_operators_keep_an_owner();

create or replace function public.platform_list_operators()
returns table (
  user_id uuid,
  name text,
  email text,
  role text,
  appointed_at timestamptz,
  appointed_by_email text,
  revoked_at timestamptz,
  revoked_by_email text,
  has_mfa boolean,
  is_self boolean
)
language plpgsql
stable
security definer
set search_path = public, auth
as $fn$
begin
  perform public.platform_require(true, false);
  return query
    select o.user_id, p.name, u.email::text, o.role::text, o.appointed_at,
           (select a.email::text from auth.users a where a.id = o.appointed_by),
           o.revoked_at,
           (select a.email::text from auth.users a where a.id = o.revoked_by),
           exists (select 1 from auth.mfa_factors f where f.user_id = o.user_id and f.status = 'verified'),
           o.user_id = auth.uid()
    from platform_operators o
    left join profiles p on p.id = o.user_id
    left join auth.users u on u.id = o.user_id
    order by o.revoked_at is not null, o.role, lower(coalesce(p.name, u.email));
end;
$fn$;

-- Appoints an existing account. The account must have confirmed its address
-- and chosen a password; it cannot use the dashboard until it has also set up
-- a second factor. Owners only, with an MFA verification in the last ten
-- minutes. Nobody appoints themselves.
create or replace function public.platform_appoint_operator(p_email text, p_role public.platform_role)
returns uuid
language plpgsql
security definer
set search_path = public, auth
as $fn$
declare
  v_email text := normalize_email(p_email);
  v_user_id uuid;
  v_existing platform_operators;
begin
  perform public.platform_require(true, true);
  if v_email is null or not looks_like_email(v_email) or p_role is null then
    raise exception 'invalid-input' using errcode = '22023';
  end if;

  select u.id into v_user_id from auth.users u
  where normalize_email(u.email) = v_email and u.email_confirmed_at is not null and u.deleted_at is null
    and (u.banned_until is null or u.banned_until <= now())
  limit 1;
  if v_user_id is null or not public.account_has_password(v_user_id) then
    raise exception 'account-not-ready' using errcode = 'P0002';
  end if;
  if v_user_id = auth.uid() then
    raise exception 'self' using errcode = 'P0001';
  end if;

  select * into v_existing from platform_operators o where o.user_id = v_user_id for update;
  if v_existing.user_id is not null and v_existing.revoked_at is null then
    raise exception 'already-operator' using errcode = 'P0001';
  end if;

  insert into platform_operators (user_id, role, appointed_at, appointed_by)
  values (v_user_id, p_role, now(), auth.uid())
  on conflict (user_id) do update
    set role = excluded.role, appointed_at = now(), appointed_by = auth.uid(),
        revoked_at = null, revoked_by = null;

  perform public.platform_audit(
    'platform_operator.appoint', 'platform_operator', v_user_id::text, 'success',
    jsonb_build_object('email', v_email, 'role', p_role)
  );
  return v_user_id;
end;
$fn$;

create or replace function public.platform_set_operator_role(p_user_id uuid, p_role public.platform_role)
returns boolean
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_existing platform_operators;
begin
  perform public.platform_require(true, true);
  if p_user_id = auth.uid() then
    raise exception 'self' using errcode = 'P0001';
  end if;
  select * into v_existing from platform_operators o where o.user_id = p_user_id and o.revoked_at is null for update;
  if v_existing.user_id is null then
    raise exception 'operator-not-found' using errcode = 'P0002';
  end if;
  if v_existing.role = p_role then
    return false;
  end if;
  update platform_operators o set role = p_role where o.user_id = p_user_id;
  perform public.platform_audit(
    'platform_operator.role', 'platform_operator', p_user_id::text, 'success',
    jsonb_build_object('from', v_existing.role, 'to', p_role)
  );
  return true;
end;
$fn$;

create or replace function public.platform_revoke_operator(p_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_existing platform_operators;
begin
  perform public.platform_require(true, true);
  if p_user_id = auth.uid() then
    raise exception 'self' using errcode = 'P0001';
  end if;
  select * into v_existing from platform_operators o where o.user_id = p_user_id and o.revoked_at is null for update;
  if v_existing.user_id is null then
    raise exception 'operator-not-found' using errcode = 'P0002';
  end if;
  update platform_operators o set revoked_at = now(), revoked_by = auth.uid() where o.user_id = p_user_id;
  perform public.platform_audit(
    'platform_operator.revoke', 'platform_operator', p_user_id::text, 'success',
    jsonb_build_object('role', v_existing.role)
  );
  return true;
end;
$fn$;

-- The first owner, and the recovery path when no owner can sign in any more.
-- Service role only: run from the server's command line
-- (`npm run platform:owner`), by whoever already holds the key that bypasses
-- every rule. Without `p_recovery` it refuses once any active owner exists,
-- so it cannot quietly add owners to a running platform. Both are recorded.
create or replace function public.platform_bootstrap_owner(p_email text, p_recovery boolean default false)
returns uuid
language plpgsql
security definer
set search_path = public, auth
as $fn$
declare
  v_email text := normalize_email(p_email);
  v_user_id uuid;
begin
  if v_email is null or not looks_like_email(v_email) then
    raise exception 'invalid-input' using errcode = '22023';
  end if;
  select u.id into v_user_id from auth.users u
  where normalize_email(u.email) = v_email and u.email_confirmed_at is not null and u.deleted_at is null
    and (u.banned_until is null or u.banned_until <= now())
  limit 1;
  if v_user_id is null or not public.account_has_password(v_user_id) then
    raise exception 'account-not-ready' using errcode = 'P0002';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('platform-owners', 0));
  if not coalesce(p_recovery, false)
     and exists (select 1 from platform_operators o where o.role = 'owner' and o.revoked_at is null) then
    raise exception 'owner-exists' using errcode = 'P0001';
  end if;

  insert into platform_operators (user_id, role, appointed_at, appointed_by)
  values (v_user_id, 'owner', now(), null)
  on conflict (user_id) do update
    set role = 'owner', appointed_at = now(), appointed_by = null, revoked_at = null, revoked_by = null;

  perform public.platform_audit(
    case when coalesce(p_recovery, false) then 'platform_operator.recover' else 'platform_operator.bootstrap' end,
    'platform_operator', v_user_id::text, 'success',
    jsonb_build_object('email', v_email, 'role', 'owner')
  );
  return v_user_id;
end;
$fn$;

-- ── Reading the audit log ──
--
-- Owners read all of it. Operators read the operational part — communities,
-- requests, invitations — but not who was appointed or removed as an operator.
create or replace function public.platform_audit_entries(
  p_limit integer default 50,
  p_before_id bigint default null,
  p_target_type text default null,
  p_target_id text default null
)
returns table (
  id bigint,
  occurred_at timestamptz,
  actor_email text,
  actor_role text,
  action text,
  target_type text,
  target_id text,
  result text,
  metadata jsonb
)
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_role public.platform_role;
begin
  v_role := public.platform_require();
  return query
    select l.id, l.occurred_at, l.actor_email, l.actor_role, l.action, l.target_type, l.target_id, l.result, l.metadata
    from platform_audit_log l
    where (p_before_id is null or l.id < p_before_id)
      and (p_target_type is null or l.target_type = p_target_type)
      and (p_target_id is null or l.target_id = p_target_id)
      and (v_role = 'owner' or l.target_type not in ('platform_operator', 'platform'))
    order by l.id desc
    limit least(greatest(coalesce(p_limit, 50), 1), 200);
end;
$fn$;

-- ── 10. Privileges ───────────────────────────────────────────────────────

revoke all on table public.platform_operators from public, anon, authenticated, service_role;
revoke all on table public.platform_audit_log from public, anon, authenticated, service_role;
revoke all on table public.platform_onboarding_requests from public, anon, authenticated, service_role;
revoke all on table public.platform_onboarding_attempts from public, anon, authenticated, service_role;
revoke all on table public.community_platform_state from public, anon, authenticated, service_role;
revoke all on sequence public.platform_audit_log_id_seq from public, anon, authenticated, service_role;

-- The server's key reads and writes like everywhere else, except that the
-- audit log only grows.
grant select, insert, update, delete on public.platform_operators to service_role;
grant select, insert, update, delete on public.platform_onboarding_requests to service_role;
grant select, insert, update, delete on public.platform_onboarding_attempts to service_role;
grant select, insert, update, delete on public.community_platform_state to service_role;
grant select on public.platform_audit_log to service_role;

do $do$
declare
  v_fn text;
begin
  foreach v_fn in array array[
    'public.is_community_suspended(text)',
    'public.my_suspended_community_ids()',
    'public.my_suspended_channel_ids()',
    'public.my_suspended_conversation_ids()',
    'public.platform_caller_role()',
    'public.platform_session_is_aal2()',
    'public.platform_session_mfa_within(interval)',
    'public.platform_session_alive()',
    'public.platform_require(boolean, boolean)',
    'public.my_platform_access()',
    'public.platform_audit(text, text, text, text, jsonb)',
    'public.platform_audit_log_append_only()',
    'public.platform_record_failure(text, text, text, text)',
    'public.platform_write_bypass()',
    'public.suspension_community_of(text, text)',
    'public.refuse_write_in_suspended_community()',
    'public.communities_guard_suspension()',
    'public.invitation_preview(text)',
    'public.platform_identifier_is_valid(text)',
    'public.platform_color_is_valid(text)',
    'public.platform_overview()',
    'public.platform_list_communities(text, text)',
    'public.platform_get_community(text)',
    'public.platform_community_admin_invitations(text)',
    'public.platform_designate_admin(text, text, boolean)',
    'public.platform_create_community(text, text, text, text, text, text, integer, text, text, text, text, public.access_policy, text, public.member_directory_visibility, public.dm_policy, text, uuid, uuid)',
    'public.platform_update_community(text, text, text, text, text, text, integer, text, text, text, text, public.access_policy, text, public.member_directory_visibility, public.dm_policy)',
    'public.platform_assign_community_admin(text, text, boolean)',
    'public.platform_remove_community_admin(text)',
    'public.platform_revoke_admin_invitation(uuid)',
    'public.platform_resend_admin_invitation(uuid)',
    'public.platform_suspend_community(text, text)',
    'public.platform_reactivate_community(text, text)',
    'public.submit_onboarding_request(text, text, text, text, integer, text, text)',
    'public.platform_list_onboarding_requests(text)',
    'public.platform_get_onboarding_request(uuid)',
    'public.platform_review_onboarding_request(uuid, text, text)',
    'public.platform_set_onboarding_note(uuid, text)',
    'public.platform_operators_keep_an_owner()',
    'public.platform_list_operators()',
    'public.platform_appoint_operator(text, public.platform_role)',
    'public.platform_set_operator_role(uuid, public.platform_role)',
    'public.platform_revoke_operator(uuid)',
    'public.platform_bootstrap_owner(text, boolean)',
    'public.platform_audit_entries(integer, bigint, text, text)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', v_fn);
  end loop;
end;
$do$;

-- What the portal and the invitation page need, as before.
grant execute on function public.invitation_preview(text) to anon, authenticated;

-- A member's own view of suspension (also what the restrictive policies call).
grant execute on function public.my_suspended_community_ids() to authenticated;
grant execute on function public.my_suspended_channel_ids() to authenticated;
grant execute on function public.my_suspended_conversation_ids() to authenticated;

-- Everyone signed in may ask whether they are an operator. Everything else
-- below refuses unless they are, with MFA.
grant execute on function public.my_platform_access() to authenticated;
grant execute on function public.platform_record_failure(text, text, text, text) to authenticated;
grant execute on function public.platform_overview() to authenticated;
grant execute on function public.platform_list_communities(text, text) to authenticated;
grant execute on function public.platform_get_community(text) to authenticated;
grant execute on function public.platform_community_admin_invitations(text) to authenticated;
grant execute on function public.platform_create_community(text, text, text, text, text, text, integer, text, text, text, text, public.access_policy, text, public.member_directory_visibility, public.dm_policy, text, uuid, uuid) to authenticated;
grant execute on function public.platform_update_community(text, text, text, text, text, text, integer, text, text, text, text, public.access_policy, text, public.member_directory_visibility, public.dm_policy) to authenticated;
grant execute on function public.platform_assign_community_admin(text, text, boolean) to authenticated;
grant execute on function public.platform_remove_community_admin(text) to authenticated;
grant execute on function public.platform_revoke_admin_invitation(uuid) to authenticated;
grant execute on function public.platform_resend_admin_invitation(uuid) to authenticated;
grant execute on function public.platform_suspend_community(text, text) to authenticated;
grant execute on function public.platform_reactivate_community(text, text) to authenticated;
grant execute on function public.platform_list_onboarding_requests(text) to authenticated;
grant execute on function public.platform_get_onboarding_request(uuid) to authenticated;
grant execute on function public.platform_review_onboarding_request(uuid, text, text) to authenticated;
grant execute on function public.platform_set_onboarding_note(uuid, text) to authenticated;
grant execute on function public.platform_list_operators() to authenticated;
grant execute on function public.platform_appoint_operator(text, public.platform_role) to authenticated;
grant execute on function public.platform_set_operator_role(uuid, public.platform_role) to authenticated;
grant execute on function public.platform_revoke_operator(uuid) to authenticated;
grant execute on function public.platform_audit_entries(integer, bigint, text, text) to authenticated;

-- The server alone: the public form (it supplies the address hash) and the
-- command-line bootstrap.
grant execute on function public.submit_onboarding_request(text, text, text, text, integer, text, text) to service_role;
grant execute on function public.platform_bootstrap_owner(text, boolean) to service_role;

-- ── 11. A community's logo, set by TING ──
--
-- The same rules as set_community_avatar(): a path under the community's own
-- prefix, of the one shape the bucket accepts, for an object that exists. The
-- server stores the object with the service role only after the operator
-- check has passed, and removes it again if this refuses.
create or replace function public.platform_set_community_avatar(p_community_id text, p_path text)
returns table (applied boolean, previous_path text)
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_previous text;
begin
  perform public.platform_require();
  select c.avatar_path into v_previous from communities c where c.id = p_community_id for update;
  if not found then
    raise exception 'community-not-found' using errcode = 'P0002';
  end if;
  if p_path is not null and (
       split_part(p_path, '/', 1) <> p_community_id
       or p_path !~ '^[^/]+/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpg|webp)$'
       or not exists (select 1 from storage.objects o where o.bucket_id = 'community-avatars' and o.name = p_path)
     ) then
    raise exception 'invalid-input' using errcode = '22023';
  end if;

  perform set_config('ting.platform_write', 'on', true);
  update communities c set avatar_path = p_path where c.id = p_community_id;
  perform public.platform_audit(
    'community.update', 'community', p_community_id, 'success',
    jsonb_build_object('changed', jsonb_build_array(case when p_path is null then 'avatar_removed' else 'avatar' end))
  );
  return query select true, v_previous;
end;
$fn$;

revoke all on function public.platform_set_community_avatar(text, text) from public, anon, authenticated, service_role;
grant execute on function public.platform_set_community_avatar(text, text) to authenticated;
