-- Tells people what happened to an access request.
--
-- Two of the three transitions in this lifecycle currently reach nobody. A
-- request lands in a queue that an administrator only sees by going to look;
-- 20260908160000 dropped the old `approve_membership`, which had been the one
-- notifying path, and replaced the lifecycle without replacing the notice. A
-- rejection is silent in every channel there is.
--
-- ── Where the generation goes ───────────────────────────────────────────
--
-- Inside the existing lifecycle functions, not in a trigger and not in a new
-- RPC.
--
-- These functions are already the authoritative transition: each is SECURITY
-- DEFINER, each is the only way its transition can happen, and each already
-- decides authorization and idempotency for itself. Putting the notification
-- beside the write it belongs to means one transaction — a rejection that
-- fails to commit cannot leave a notice behind, and a rejection that commits
-- cannot fail to send one.
--
-- A trigger would be the wrong instrument here, which is worth stating since
-- announcements got one in 20260916180000. An announcement's transition *is*
-- an insert, so a trigger sits exactly on it. A rejection is a status update
-- among several possible status updates, and a new request is an insert that
-- may or may not have happened depending on a conflict clause — a trigger
-- would have to reconstruct from old and new what the function already knows.
--
-- No new function is created. Nothing new becomes callable, and there is still
-- no notify_user(user_id, ...) anywhere in this schema.
--
-- ── Who may process a request, and therefore who is told ────────────────
--
-- `is_admin()`, not `can_moderate()`. approve_access_request says why, and it
-- is not a naming accident:
--
--     -- Administrators of that one community. A moderator moderates; they do
--     -- not decide who is admitted.
--
-- The same predicate guards the `access_requests` SELECT policy, the
-- /requests page and the sidebar entry. Moderators cannot see the queue, so
-- notifying them would be a notice about work they cannot do, pointing at a
-- page that would refuse them.
--
-- ── Approval is deliberately not notified ───────────────────────────────
--
-- The brief asked for an approval notice for the applicant. Tracing the
-- lifecycle argues against it, so it is not here.
--
-- An applicant is an *email address*. access_requests has no user_id, by
-- design — the whole point of this generation of the access flow is that
-- somebody with no TING account can ask to join. `notifications.user_id` is
-- `not null references profiles(id)`, so for most applicants an approval
-- notification is not deliverable at all.
--
-- For the minority who do already have an account it would be worse than
-- undeliverable, because approval already has two channels: the invitation
-- email the action sends, and `accept_invitation_token()`, which on redemption
-- writes "Du er nå medlem av …". Adding a third would give account-holders two
-- in-app notices for one event and give everyone else none — inconsistent in
-- both directions. Approval keeps the email, and the existing membership
-- notification stays the one in-app record of the outcome.
--
-- Rejection is different and is notified below: it has no email, no redemption
-- and no other channel, so for an applicant with an account this is the only
-- way they ever learn. Nothing duplicates it.
--
-- ── Why no new column ───────────────────────────────────────────────────
--
-- An `access_request_id` target would make (request, event, recipient)
-- uniqueness structural. It is not added, because control flow already gives
-- the same guarantee at the only two places a notification is written:
--
--   new request — the insert carries `on conflict do nothing`, and the
--       fan-out now runs only when that insert actually produced a row
--       (`returning id into v_request_id`). A repeated request for an address
--       that already has one pending inserts nothing and notifies nobody.
--   rejection  — the update is `where status = 'pending'` and the function
--       already returns early when `not found`. A second rejection of the same
--       request changes nothing and notifies nobody.
--
-- What the column would additionally buy is the ability to find an
-- administrator's old notice when its request is resolved, in order to mark it
-- read. That is section G of the brief, and it is answered in the copy
-- instead: the notice is written as a past event ("ba om tilgang", "kom inn")
-- rather than a standing state, so it stays true after the request is handled
-- and there is nothing to go back and correct. A notification is a record that
-- something happened, and that is what this one says.

-- ── New request → the community's administrators ────────────────────────

create or replace function public.request_community_access(
  p_slug text,
  p_email text,
  p_display_name text default null
)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  v_community_id text;
  v_policy access_policy;
  v_email text := normalize_email(p_email);
  v_name text := nullif(btrim(coalesce(p_display_name, '')), '');
  v_recent int;
  v_request_id uuid;
begin
  if not looks_like_email(v_email) then
    return false;
  end if;

  -- Keep a name only if it is short enough to be a name.
  if v_name is not null and length(v_name) > 80 then
    v_name := left(v_name, 80);
  end if;

  select id, access_policy into v_community_id, v_policy
  from communities where slug = p_slug;

  -- Unknown community, or one that does not take open applications. Answer as
  -- if it had been accepted: otherwise this doubles as a probe for which
  -- slugs exist and which are invite-only.
  if v_community_id is null or v_policy <> 'request-to-join' then
    return true;
  end if;

  -- Rate limit, per address and per community. Silent, because saying "you
  -- are going too fast" would confirm the earlier attempts landed.
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

  -- Already inside, under any status: nothing to do, and nothing to say.
  if exists (
    select 1
    from memberships m
    join auth.users u on u.id = m.user_id
    where m.community_id = v_community_id
      and normalize_email(u.email) = v_email
  ) then
    return true;
  end if;

  -- A live invitation is already out, so a second request would be noise.
  if exists (
    select 1 from invitations
    where community_id = v_community_id and email = v_email
      and accepted_at is null and revoked_at is null and expires_at > now()
  ) then
    return true;
  end if;

  insert into access_requests (community_id, email, display_name)
  values (v_community_id, v_email, v_name)
  on conflict (community_id, email) where status = 'pending' do nothing
  returning id into v_request_id;

  -- The conflict clause absorbed it: a pending request for this address is
  -- already in the queue, and its administrators have already been told.
  if v_request_id is null then
    return true;
  end if;

  -- Recipients are derived here and cannot be supplied. The function's
  -- arguments are a slug, an address and a name; none of them names a person
  -- to notify, and this query is the only thing that decides who is told.
  --
  -- The `not exists` is belt and braces. An address belonging to any member of
  -- this community has already returned above, so an administrator cannot also
  -- be the requester — unless that earlier check is ever loosened, in which
  -- case they still will not notify themselves.
  insert into notifications (user_id, kind, community_id, title, body, href)
  select
    m.user_id,
    'membership',
    v_community_id,
    coalesce(v_name, v_email) || ' ba om tilgang',
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
$$;

-- ── Rejection → the applicant, when there is one to reach ───────────────

create or replace function public.reject_access_request(p_request_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  v_community text;
  v_email text;
begin
  select community_id, email into v_community, v_email from access_requests
  where id = p_request_id and status = 'pending';
  if v_community is null or not is_admin(v_community) then
    return false;
  end if;

  update access_requests
  set status = 'rejected', reviewed_at = now(), reviewed_by = auth.uid()
  where id = p_request_id and status = 'pending';

  if not found then
    return false;
  end if;

  -- Only if the address belongs to an account. Most applicants have none —
  -- that is what this flow is for — and there is no row to hang a
  -- notification on for them. They learn nothing, which is the behaviour
  -- rejection has always had.
  --
  -- The link is the community's public portal, never anything inside it. A
  -- person who was just refused entry must not be handed a path into member
  -- content, and the portal is the page they applied from.
  insert into notifications (user_id, kind, community_id, title, body, href)
  select
    p.id,
    'membership',
    v_community,
    'Forespørselen om tilgang ble ikke innvilget',
    c.name || ' har behandlet forespørselen din.',
    '/' || c.slug
  from auth.users u
  join profiles p on p.id = u.id
  join communities c on c.id = v_community
  where normalize_email(u.email) = v_email;

  return true;
end;
$$;

-- Grants are unchanged: both functions keep the ones 20260908150000 gave them.
-- Restating them so a reader of this file can see that nothing widened.
revoke execute on function public.request_community_access(text, text, text) from public;
grant execute on function public.request_community_access(text, text, text) to anon, authenticated;

revoke execute on function public.reject_access_request(uuid) from public, anon;
grant execute on function public.reject_access_request(uuid) to authenticated;
