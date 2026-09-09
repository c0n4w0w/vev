-- The functions behind requests, approval and invitation redemption.
--
-- Every one of these is SECURITY DEFINER with a pinned search_path, because
-- each has to look at rows the caller cannot see — a community's access
-- policy, an invitation belonging to an address, a membership that does not
-- exist yet. The authorisation is inside the function, never assumed from
-- whoever called it.

-- ── Submitting a request ────────────────────────────────────────────────
--
-- Callable anonymously, and this is the one place the whole feature is exposed
-- to the public, so it is written to give away nothing.
--
-- It returns the same value whether the address was accepted, is already
-- pending, already belongs to a member, is being rate-limited, or belongs to
-- a community that does not take applications. A caller cannot use it to
-- learn whether an address has a VEV account, is already a member, or has
-- asked before. The only thing it distinguishes is a malformed address, which
-- reveals nothing about anyone.

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
  on conflict (community_id, email) where status = 'pending' do nothing;

  return true;
end;
$$;

-- ── Approving ───────────────────────────────────────────────────────────
--
-- Approval marks the request and mints an invitation. It does *not* create a
-- membership: that only happens when the invited address proves it controls
-- the mailbox by redeeming the token.
--
-- Returns the raw token so the caller can put it in an email. It is returned
-- exactly once and never stored — only its hash is.

create or replace function public.approve_access_request(p_request_id uuid)
returns table (token text, email text, community_id text, expires_at timestamptz)
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_request access_requests;
  v_token text;
  v_existing invitations;
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

  -- Idempotent. A second click finds the request already approved and returns
  -- the invitation that exists rather than minting a competing one.
  if v_request.status = 'approved' then
    select * into v_existing from invitations inv
    where inv.request_id = v_request.id
      and inv.accepted_at is null and inv.revoked_at is null
    limit 1;
    if v_existing.id is not null then
      return query select null::text, v_existing.email, v_existing.community_id, v_existing.expires_at;
    end if;
    return;
  end if;

  if v_request.status <> 'pending' then
    -- Rejected or cancelled requests do not become invitations.
    return;
  end if;

  update access_requests
  set status = 'approved', reviewed_at = now(), reviewed_by = auth.uid()
  where id = v_request.id and status = 'pending';

  if not found then
    -- Someone else got there first in a concurrent click.
    return;
  end if;

  -- Supersede any live invitation for this address, so only one link works.
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
    select v_token, v_request.email, v_request.community_id, (now() + invitation_lifetime());
end;
$$;

create or replace function public.reject_access_request(p_request_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_community text;
begin
  select community_id into v_community from access_requests
  where id = p_request_id and status = 'pending';
  if v_community is null or not is_admin(v_community) then
    return false;
  end if;

  update access_requests
  set status = 'rejected', reviewed_at = now(), reviewed_by = auth.uid()
  where id = p_request_id and status = 'pending';

  return found;
end;
$$;

-- ── Resending ───────────────────────────────────────────────────────────
--
-- Issues a fresh token for an invitation that already exists, revoking the old
-- one so a forwarded copy of the previous email stops working. Same community,
-- same address — this cannot be used to redirect an invitation elsewhere.

create or replace function public.resend_invitation(p_invitation_id uuid)
returns table (token text, email text, community_id text, expires_at timestamptz)
language plpgsql security definer set search_path = public, extensions as $$
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
    -- Already redeemed: there is nothing to resend, and reissuing would create
    -- a second route into a seat that is already filled.
    return;
  end if;

  -- Rate limit resends so this cannot be turned into a way to mail someone
  -- repeatedly through us.
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
$$;

-- ── Looking at an invitation before signing in ──────────────────────────
--
-- The acceptance page has to say which community the visitor was invited to
-- before they have authenticated. It returns the community's name and the
-- invited address and nothing else — no member list, no counts, no id of the
-- person who invited them, and nothing at all about other communities.
--
-- A wrong or spent token returns no rows, so the page cannot be used to test
-- tokens for validity beyond the single guess already made.

create or replace function public.invitation_preview(p_token text)
returns table (community_id text, community_name text, community_slug text, email text, expires_at timestamptz)
language sql security definer stable set search_path = public, extensions as $$
  select c.id, c.name, c.slug, i.email, i.expires_at
  from invitations i
  join communities c on c.id = i.community_id
  where i.token_hash = hash_invitation_token(p_token)
    and i.accepted_at is null
    and i.revoked_at is null
    and i.expires_at > now();
$$;

-- ── Redeeming ───────────────────────────────────────────────────────────
--
-- The only path from an invitation to a membership.
--
-- Requires an authenticated session whose verified email equals the invited
-- address, so holding the link is not enough — you must also control the
-- mailbox it was sent to. The membership is created in the same statement that
-- consumes the invitation, so a replay finds nothing left to consume.

create or replace function public.accept_invitation_token(p_token text)
returns table (ok boolean, community_id text, reason text)
language plpgsql security definer set search_path = public, extensions as $$
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

  if v_invite.id is null then
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

  select c.name into v_name from communities c where c.id = v_invite.community_id;
  insert into notifications (user_id, kind, community_id, title, body, href)
  values (
    auth.uid(), 'membership', v_invite.community_id,
    'Du er nå medlem av ' || v_name,
    'Invitasjonen er tatt i bruk. Du kan lese og delta i fellesskapet.',
    '/community/' || v_invite.community_id
  );

  return query select true, v_invite.community_id, 'joined';
end;
$$;

-- ── Grants ──────────────────────────────────────────────────────────────

revoke execute on function public.request_community_access(text, text, text) from public;
revoke execute on function public.approve_access_request(uuid) from public, anon;
revoke execute on function public.reject_access_request(uuid) from public, anon;
revoke execute on function public.resend_invitation(uuid) from public, anon;
revoke execute on function public.invitation_preview(text) from public;
revoke execute on function public.accept_invitation_token(text) from public, anon;

-- Anyone may ask, and anyone holding a link may see who it is for. Everything
-- that changes a membership requires a session.
grant execute on function public.request_community_access(text, text, text) to anon, authenticated;
grant execute on function public.invitation_preview(text) to anon, authenticated;
grant execute on function public.approve_access_request(uuid) to authenticated;
grant execute on function public.reject_access_request(uuid) to authenticated;
grant execute on function public.resend_invitation(uuid) to authenticated;
grant execute on function public.accept_invitation_token(text) to authenticated;
