-- Access requests and email invitations.
--
-- Until now an "access request" was a memberships row with status 'requested',
-- which meant only someone who already had a VEV account could ask to join,
-- and approving it made them a member on the spot. Neither matches how an
-- organisation actually admits people: the person asking is usually a member
-- of the *organisation* who has never heard of VEV, and being approved should
-- send them an invitation rather than silently create an account membership.
--
-- So there are two new tables. A request is a question from an email address.
-- An invitation is a signed answer to it, good once, for one community, for
-- one address, for a limited time. Membership is created only when that
-- invitation is redeemed by someone authenticated as that address.
--
-- Nothing here weakens the existing rule that `memberships` has no INSERT
-- policy at all: every membership still comes from a SECURITY DEFINER function
-- that checks its own preconditions.

-- ── Requests ────────────────────────────────────────────────────────────

create type access_request_status as enum ('pending', 'approved', 'rejected', 'cancelled');

create table access_requests (
  id uuid primary key default gen_random_uuid(),
  community_id text not null references communities (id) on delete cascade,
  -- Normalised by `normalize_email()` on the way in. Stored lowercase and
  -- trimmed so "Ola@Example.NO " and "ola@example.no" are one address.
  email text not null,
  -- Optional, and the only free text kept. The old portal asked for a written
  -- introduction; an admin deciding on a membership does not need one, and it
  -- is personal data we would then have to look after.
  display_name text,
  status access_request_status not null default 'pending',
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references profiles (id) on delete set null
);

create index access_requests_queue_idx on access_requests (community_id, status, created_at);

-- One open question per address per community. Partial, so a rejected request
-- does not block someone asking again later.
create unique index access_requests_one_pending
  on access_requests (community_id, email)
  where status = 'pending';

alter table access_requests enable row level security;

-- Only administrators of that community, and only through this. There is
-- deliberately no policy for anon or for ordinary members: a pending request
-- names someone who is not in the community yet, and the queue is not
-- something the membership at large should be able to read.
create policy access_requests_select on access_requests for select to authenticated
using (is_admin(community_id));

-- No INSERT/UPDATE/DELETE policies. Submitting goes through
-- request_community_access(), which is callable anonymously and answers the
-- same way regardless of what it finds; reviewing goes through
-- approve_access_request() / reject_access_request().

-- ── Invitations ─────────────────────────────────────────────────────────

create table invitations (
  id uuid primary key default gen_random_uuid(),
  community_id text not null references communities (id) on delete cascade,
  email text not null,
  -- Only the SHA-256 of the token is kept. The token itself exists in the
  -- email and nowhere else, so a leaked database backup cannot be used to
  -- accept invitations.
  token_hash text not null unique,
  request_id uuid references access_requests (id) on delete set null,
  invited_by uuid references profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  accepted_at timestamptz,
  accepted_by uuid references profiles (id) on delete set null,
  -- Set when a resend supersedes this one, so the old link stops working.
  revoked_at timestamptz
);

create index invitations_community_idx on invitations (community_id, email);

-- One live invitation per address per community, so a double-click or a
-- resend cannot leave two working links pointing at the same seat.
create unique index invitations_one_live
  on invitations (community_id, email)
  where accepted_at is null and revoked_at is null;

alter table invitations enable row level security;

-- Administrators may see that an invitation exists and what state it is in.
-- token_hash is in the row, which is why it is a hash and not the token.
create policy invitations_select on invitations for select to authenticated
using (is_admin(community_id));

-- No write policies. Everything goes through the functions below.

-- ── Helpers ─────────────────────────────────────────────────────────────

create or replace function public.normalize_email(p_email text)
returns text language sql immutable set search_path = public as $$
  select lower(btrim(coalesce(p_email, '')));
$$;

-- A deliberately loose check. The point is to reject obvious nonsense before
-- it reaches a queue, not to adjudicate RFC 5322.
create or replace function public.looks_like_email(p_email text)
returns boolean language sql immutable set search_path = public as $$
  select p_email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
     and length(p_email) between 6 and 254;
$$;

create or replace function public.hash_invitation_token(p_token text)
returns text language sql immutable set search_path = public, extensions as $$
  select encode(extensions.digest(p_token, 'sha256'), 'hex');
$$;

revoke execute on function public.normalize_email(text) from public, anon, authenticated;
revoke execute on function public.looks_like_email(text) from public, anon, authenticated;
revoke execute on function public.hash_invitation_token(text) from public, anon, authenticated;

-- How long an invitation stays good. Long enough that someone can act on it
-- after a weekend or a holiday, short enough that a forwarded mailbox does not
-- carry a working key indefinitely.
create or replace function public.invitation_lifetime()
returns interval language sql immutable set search_path = public as $$
  select interval '14 days';
$$;

revoke execute on function public.invitation_lifetime() from public, anon, authenticated;
