-- Collapses the request-to-join flow's second decision.
--
-- 20260908140000 modelled a request as a question from an email address, on
-- purpose: the person asking is usually new to TING and should not need an
-- account to ask. That is still true and nothing here changes it. What it
-- got wrong is what happens next for the *other* case — someone who already
-- has a TING account, perhaps from another community, asking to join this
-- one. Today they go through the exact same door as a stranger: approval
-- mints an invitation, and they have to open a link and click "Fortsett" to
-- accept it, even though they already told this system what they want (the
-- request) and an administrator already agreed (the approval). That third
-- step is a decision nobody is actually making — it is friction wearing the
-- shape of a decision.
--
-- The fix is narrow. It does not touch the proactive path: an administrator
-- inviting someone who never asked still requires that person's explicit
-- "Godta" before anything is created, because in that case the acceptance
-- *is* the first and only decision the recipient has made. Every invitation
-- that exists today is request-derived (there is still no proactive-invite
-- entry point in the product), so in practice this changes what approval
-- does without touching how `accept_invitation_token()` or the acceptance
-- page work.
--
-- ── What changes ────────────────────────────────────────────────────────
--
-- 1. `access_requests` gains a nullable `user_id`. It is set at submission
--    time, and only when the caller was authenticated *and* asking for their
--    own verified address — never from a client-supplied value, never by
--    matching a name, never for an address someone else typed while signed
--    in as themselves. A signed-in caller who types a different address
--    falls through to the email-only path below, exactly as an anonymous
--    caller would.
--
-- 2. `approve_access_request()` resolves an identity — the request's own
--    `user_id` if it has one, otherwise a *confirmed* account matching the
--    request's address, looked up fresh so an account created after the
--    request was filed is still found. If that resolves to somebody, their
--    membership is activated in the same transaction as the approval: no
--    invitation, nothing left to accept. If it resolves to nobody, behaviour
--    is what it was — a token is minted and a claim link is the next step.
--
-- 3. `invitation_preview()` gains `auto_activate`, true when the invitation
--    traces back to a request (`request_id is not null`). The application
--    uses it to decide whether landing on the link with a matching signed-in
--    session should act immediately or wait for an explicit accept — the
--    database still enforces the address match and idempotency either way,
--    through the unchanged `accept_invitation_token()`.
--
-- 4. A new read-only function, `access_request_history()`, so an
--    administrator's queue can show what became of a request it approved —
--    activated on the spot, waiting on a claim link, or rejected — instead
--    of a request simply vanishing from the pending list.
--
-- Nothing here adds a policy to `memberships`, `access_requests` or
-- `invitations`. Every new and changed code path is inside the existing
-- SECURITY DEFINER functions, which is where authorisation for all three
-- tables has always lived.

-- ── 1. Identity captured at submission, when it is already known ─────────

alter table access_requests
  add column user_id uuid references profiles (id) on delete set null;

comment on column access_requests.user_id is
  'Set only when the request was submitted by an authenticated session asking '
  'for that session''s own verified address. Null for every anonymous request '
  'and for a signed-in caller who typed a different address — the identity a '
  'request carries is never looser than how it was actually obtained.';

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
  v_user_id uuid;
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

  -- An authenticated caller asking for their own address gets that identity
  -- recorded now, from the session, not from anything they typed. A signed-in
  -- caller asking on behalf of some other address gets none of this — v_email
  -- came from the form, and only a caller's *own* verified address earns the
  -- shortcut approval later takes.
  if auth.uid() is not null then
    select u.id into v_user_id
    from auth.users u
    where u.id = auth.uid() and normalize_email(u.email) = v_email;
  end if;

  insert into access_requests (community_id, email, display_name, user_id)
  values (v_community_id, v_email, v_name, v_user_id)
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

-- ── 2. Approval: activate on the spot, or mint a claim link ──────────────
--
-- The old function only ever minted an invitation. This one resolves an
-- identity first and branches on it. Either branch is transactional with the
-- `pending → approved` update, and both are idempotent: a repeat call (a
-- double-click, a retried request) finds the same outcome it already
-- produced and reports it again rather than acting a second time.

drop function if exists public.approve_access_request(uuid);

create function public.approve_access_request(p_request_id uuid)
returns table (
  -- 'activated': membership exists now, nothing left for anyone to accept.
  -- 'invited': a claim link exists (freshly minted or, on replay, the live
  --   one already out); `token` is the raw value only when freshly minted.
  outcome text,
  token text,
  email text,
  community_id text,
  expires_at timestamptz
)
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_request access_requests;
  v_user_id uuid;
  v_token text;
  v_existing invitations;
  v_just_approved boolean := false;
begin
  select * into v_request from access_requests where id = p_request_id;
  if v_request.id is null then
    return;
  end if;

  -- Administrators of that one community. A moderator moderates; they do not
  -- decide who is admitted.
  if not is_admin(v_request.community_id) then
    return;
  end if;

  if v_request.status not in ('pending', 'approved') then
    -- Rejected or cancelled requests do not become anything.
    return;
  end if;

  -- Resolve identity the same way regardless of which branch below runs: the
  -- request's own explicit identity if it has one, otherwise a *confirmed*
  -- account under the requested address. Confirmed, not merely existing —
  -- `sendMagicLink` creates an unconfirmed row for any address on request,
  -- so existence alone is not proof anyone has ever controlled that mailbox.
  -- Looked up fresh rather than cached anywhere, so an account created after
  -- the request was filed is still found on a later, idempotent call.
  v_user_id := v_request.user_id;
  if v_user_id is null then
    select u.id into v_user_id
    from auth.users u
    where normalize_email(u.email) = v_request.email
      and u.email_confirmed_at is not null
    limit 1;
  end if;

  if v_request.status = 'pending' then
    update access_requests
    set status = 'approved', reviewed_at = now(), reviewed_by = auth.uid()
    where id = v_request.id and status = 'pending';

    if not found then
      -- Someone else got there first in a concurrent click.
      return;
    end if;
    v_just_approved := true;
  end if;

  if v_user_id is not null then
    insert into memberships (user_id, community_id, role, status, joined_at)
    values (v_user_id, v_request.community_id, 'member', 'active', current_date)
    -- Named constraint rather than a column list: `community_id` is also an
    -- output parameter of this function, and a bare column list resolves to
    -- the parameter instead of the column.
    on conflict on constraint memberships_user_id_community_id_key do update
      set status = 'active', joined_at = current_date;

    -- Anything still open for this address — an invitation from before this
    -- account existed, or from a race with another approval — is no longer
    -- the way in. Revoking it means the admin queue does not go on showing a
    -- "waiting to be accepted" link for someone who is already a member.
    update invitations inv
    set revoked_at = now()
    where inv.community_id = v_request.community_id
      and inv.email = v_request.email
      and inv.accepted_at is null and inv.revoked_at is null;

    if v_just_approved then
      -- Mirrors the notification `accept_invitation_token()` writes on
      -- redemption. This is that same moment, just reached by a shorter path.
      insert into notifications (user_id, kind, community_id, title, body, href)
      select v_user_id, 'membership', v_request.community_id,
             'Du er nå medlem av ' || c.name,
             'Forespørselen din om tilgang ble godkjent.',
             '/community/' || v_request.community_id
      from communities c where c.id = v_request.community_id;
    end if;

    return query select 'activated'::text, null::text, v_request.email, v_request.community_id, null::timestamptz;
    return;
  end if;

  -- No confirmed account for this address. A live invitation from an earlier
  -- call on this same request (idempotent replay) is reused rather than
  -- superseded, so a second click cannot invalidate a link already sent.
  select * into v_existing from invitations inv
  where inv.request_id = v_request.id
    and inv.accepted_at is null and inv.revoked_at is null
  limit 1;

  if v_existing.id is not null then
    return query select 'invited'::text, null::text, v_existing.email, v_existing.community_id, v_existing.expires_at;
    return;
  end if;

  if not v_just_approved then
    -- Already approved, no live invitation left (expired or revoked), and
    -- still no account: nothing safe to hand back here. An administrator can
    -- reach the same request through resend_invitation() instead, which is
    -- built for exactly this.
    return;
  end if;

  -- Supersede any other live invitation for this address, so only one link
  -- works. In the ordinary case there is none — the check above would have
  -- found it — this only matters for a stray row from outside this request.
  update invitations inv
  set revoked_at = now()
  where inv.community_id = v_request.community_id
    and inv.email = v_request.email
    and inv.accepted_at is null and inv.revoked_at is null;

  v_token := encode(extensions.gen_random_bytes(32), 'hex');

  insert into invitations (community_id, email, token_hash, request_id, invited_by, expires_at)
  values (
    v_request.community_id,
    v_request.email,
    hash_invitation_token(v_token),
    v_request.id,
    auth.uid(),
    now() + invitation_lifetime()
  );

  return query
    select 'invited'::text, v_token, v_request.email, v_request.community_id, (now() + invitation_lifetime());
end;
$$;

-- ── Rejection: prefer the request's own identity when it has one ─────────
--
-- Behaviour is unchanged for every request submitted anonymously (still the
-- large majority): the notification is sent only when the address happens to
-- belong to an account, found by the same email join as before. The only
-- difference is for a request that already carries `user_id` — there is no
-- reason to rediscover that identity by joining on email when the row already
-- names it explicitly.

create or replace function public.reject_access_request(p_request_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  v_community text;
  v_email text;
  v_user_id uuid;
begin
  select community_id, email, user_id into v_community, v_email, v_user_id from access_requests
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
  from profiles p
  join communities c on c.id = v_community
  where p.id = coalesce(
    v_user_id,
    (select u.id from auth.users u where normalize_email(u.email) = v_email limit 1)
  );

  return true;
end;
$$;

-- ── 3. The acceptance page's other question: is this a decision at all ───

drop function if exists public.invitation_preview(text);

create function public.invitation_preview(p_token text)
returns table (
  community_id text,
  community_name text,
  community_slug text,
  email text,
  expires_at timestamptz,
  -- True when this invitation traces back to a request the person already
  -- made (`request_id is not null`). Every invitation minted today is one of
  -- these — there is still no separate proactive-invite entry point — so this
  -- is currently equivalent to "was this invitation approve_access_request's
  -- doing", but it is named for what the page does with it rather than for
  -- today's one source, so a future proactive-invite path does not have to
  -- touch this function to keep meaning the right thing.
  auto_activate boolean
)
language sql security definer stable set search_path = public, extensions as $$
  select c.id, c.name, c.slug, i.email, i.expires_at, i.request_id is not null
  from invitations i
  join communities c on c.id = i.community_id
  where i.token_hash = hash_invitation_token(p_token)
    and i.accepted_at is null
    and i.revoked_at is null
    and i.expires_at > now();
$$;

-- ── 4. What an administrator's queue shows after a decision ──────────────
--
-- `access_requests` and `invitations` are both admin-select-only, so this
-- does not widen what an administrator can see — it just answers a question
-- neither row answers alone: what actually happened after "approved".

create or replace function public.access_request_history(p_community_id text, p_limit int default 20)
returns table (
  id uuid,
  email text,
  display_name text,
  status access_request_status,
  created_at timestamptz,
  reviewed_at timestamptz,
  -- 'activated'           — membership is active; nothing pending.
  -- 'invitation_pending'  — a live claim link is still out.
  -- 'invitation_accepted' — the claim link was used (implies 'activated' too,
  --                         but distinguishes "via the link" for the queue).
  -- 'invitation_expired'  — approved, but the link ran out and was not
  --                         resent, and no account has since appeared.
  -- 'rejected'
  resolution text
)
language sql security definer stable set search_path = public as $$
  select
    ar.id, ar.email, ar.display_name, ar.status, ar.created_at, ar.reviewed_at,
    case
      when ar.status = 'rejected' then 'rejected'
      when ar.status = 'approved' and exists (
        select 1 from memberships m
        where m.community_id = ar.community_id
          and m.status = 'active'
          and (
            (ar.user_id is not null and m.user_id = ar.user_id)
            or (
              ar.user_id is null and exists (
                select 1 from auth.users u
                where u.id = m.user_id and normalize_email(u.email) = ar.email
              )
            )
          )
      ) then 'activated'
      when ar.status = 'approved' and exists (
        select 1 from invitations inv
        where inv.request_id = ar.id and inv.accepted_at is not null
      ) then 'invitation_accepted'
      when ar.status = 'approved' and exists (
        select 1 from invitations inv
        where inv.request_id = ar.id
          and inv.accepted_at is null and inv.revoked_at is null and inv.expires_at > now()
      ) then 'invitation_pending'
      when ar.status = 'approved' then 'invitation_expired'
      else null
    end as resolution
  from access_requests ar
  where ar.community_id = p_community_id
    and is_admin(p_community_id)
    and ar.status in ('approved', 'rejected')
  order by ar.reviewed_at desc nulls last
  limit greatest(1, least(coalesce(p_limit, 20), 100));
$$;

-- ── Grants ──────────────────────────────────────────────────────────────
--
-- Restated in full for every touched function, so a reader of this file can
-- see the whole grant surface without cross-referencing 20260908150000.

revoke execute on function public.request_community_access(text, text, text) from public;
revoke execute on function public.approve_access_request(uuid) from public, anon;
revoke execute on function public.reject_access_request(uuid) from public, anon;
revoke execute on function public.invitation_preview(text) from public;
revoke execute on function public.access_request_history(text, int) from public, anon;

grant execute on function public.request_community_access(text, text, text) to anon, authenticated;
grant execute on function public.invitation_preview(text) to anon, authenticated;
grant execute on function public.approve_access_request(uuid) to authenticated;
grant execute on function public.reject_access_request(uuid) to authenticated;
grant execute on function public.access_request_history(text, int) to authenticated;
