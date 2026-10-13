-- Account security: passwords the owner chose, email changes the owner
-- authorised, and a limit on guessing.
--
-- TING signs people in with Supabase Auth. Passwords are stored, hashed and
-- verified there and nowhere else; nothing in this file holds a password or a
-- hash. What lives here is the small amount of state Auth does not keep, and
-- the rules Auth does not enforce by itself. The rules sit on auth.users and
-- on the one function that turns an invitation into a membership, in the
-- database, so they hold for every caller — the app's server actions and
-- anyone talking to the Auth API directly with a session they should not have.
--
-- 1. A password exists only if the confirmed owner chose it.
--
--    Auth gives accounts it creates a random password nobody knows, and will
--    create an unconfirmed account, with a password, for any address a
--    stranger types into its sign-up endpoint. If that account were later
--    confirmed — by the real owner opening a sign-in or approval email — the
--    stranger's password would become a working key to it.
--
--    So an account is never born with a password, and whatever password an
--    address carries when it is first proven through an emailed link is thrown
--    away at that moment. After this, "has a password" means one thing, to
--    Auth and to TING alike.
--
-- 2. An existing password is replaced only by someone who can prove more than
--    a session.
--
--    Auth changes a password for any session that asks. Its own "require
--    current password" setting helps, but exempts every session that began
--    with an emailed link, however long ago. Here, Auth may replace a
--    password only in the minutes after the account's session proved the
--    current password, or came fresh from the account's inbox (which is what
--    a reset is). A session that was merely stolen can do neither.
--
-- 3. An email change needs the password, the new inbox and the owner's session.
--
--    The project lets an address change be confirmed from the new address
--    alone (auth.email.double_confirm_changes = false), because a member who
--    has lost their old inbox must still be able to move their account. Here,
--    Auth may complete a change only to an address the owner authorised —
--    with a session that proved the current password moments before, and a
--    password at least a day old — and only while the owner has armed it,
--    which takes that account's own session and is done by the button on the
--    page the new address was sent. The emailed link alone changes nothing.
--
--    Changes made with the service role (the dashboard, a support fix) do not
--    go through a pending change and are not affected.
--
-- 4. A membership becomes active only for an account with a password.
--
--    Two functions activate memberships. `accept_invitation_token()` refuses,
--    with its own reason, until the account has chosen a password.
--    `approve_access_request()` activates an existing account on the spot
--    only if it has one, and otherwise issues the invitation. A rule on the
--    memberships table holds the same line for anything else done in a
--    person's name. So there is no active membership to use, by any route,
--    before that step is done — and an account that has a password is never
--    asked for another, in this community or the next.
--
-- 5. Password guessing is slowed per account and per address it comes from.
--
--    Counted in the database, by the server, around every password check TING
--    makes. See the last section.

create table public.account_security (
  user_id uuid primary key references auth.users (id) on delete cascade,
  password_set_at timestamptz,
  password_setup_required_at timestamptz,
  password_change_authorized_at timestamptz,
  email_change_to text,
  email_change_authorized_at timestamptz,
  email_change_requested_at timestamptz,
  email_change_armed_until timestamptz
);

comment on table public.account_security is
  'One row per account that has needed one. Readable by its owner only; written only by the functions and the auth.users trigger in 20261025100000. Holds no credential.';
comment on column public.account_security.password_set_at is
  'When the confirmed owner last set a password through Supabase Auth. NULL means the account has no password.';
comment on column public.account_security.password_setup_required_at is
  'Set when the account tried to accept an invitation without a password. While password_set_at is NULL the app sends the person to choose one before anything else.';
comment on column public.account_security.password_change_authorized_at is
  'A few minutes'' permission for Auth to replace the password, written only by authorize_password_change() and spent by the change.';
comment on column public.account_security.email_change_to is
  'The address the owner last asked to move to (normalised), or NULL. Shown to the owner as pending; it is not the login address until Auth confirms it.';

alter table public.account_security enable row level security;

create policy account_security_select_own on public.account_security
  for select to authenticated
  using (user_id = auth.uid());

revoke all on public.account_security from anon, authenticated;
grant select on public.account_security to authenticated;

create or replace function public.account_has_password(p_user_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.account_security s
    where s.user_id = p_user_id and s.password_set_at is not null
  );
$$;

revoke execute on function public.account_has_password(uuid) from public, anon, authenticated;

-- ── What a session has proven, and how long ago ─────────────────────────
--
-- Read from the access token's `amr` claim. Auth writes it when the session
-- is created and signs it, a refresh keeps the original time, and nothing the
-- caller sends can change it.

create or replace function public.session_proved_within(p_methods text[], p_window interval)
returns boolean language sql stable set search_path = public as $$
  select exists (
    select 1
    from jsonb_array_elements(
      case when jsonb_typeof(auth.jwt() -> 'amr') = 'array' then auth.jwt() -> 'amr' else '[]'::jsonb end
    ) as claim
    where claim ->> 'method' = any (p_methods)
      and (claim ->> 'timestamp') ~ '^[0-9]+$'
      and to_timestamp((claim ->> 'timestamp')::bigint) > now() - p_window
  );
$$;

revoke execute on function public.session_proved_within(text[], interval) from public, anon, authenticated;

-- Signed in with the account's password within the last five minutes.
create or replace function public.password_proven_recently()
returns boolean language sql stable set search_path = public as $$
  select public.session_proved_within(array['password'], interval '5 minutes');
$$;

revoke execute on function public.password_proven_recently() from public, anon, authenticated;

-- Signed in through a link emailed to the account within the last fifteen
-- minutes: a reset link, or a sign-in link, which prove the same thing.
create or replace function public.inbox_proven_recently()
returns boolean language sql stable set search_path = public as $$
  select public.session_proved_within(array['otp', 'magiclink', 'recovery'], interval '15 minutes');
$$;

revoke execute on function public.inbox_proven_recently() from public, anon, authenticated;

-- How long a password must have existed before it can authorise an email
-- change. A password set a minute ago proves only that someone held a session
-- a minute ago; Auth emails the account when its password changes, and this is
-- the time the owner has to react to that before the address can follow.
create or replace function public.email_change_cooldown()
returns interval language sql immutable set search_path = public as $$
  select interval '24 hours';
$$;

revoke execute on function public.email_change_cooldown() from public, anon, authenticated;

-- ── Guessing ────────────────────────────────────────────────────────────
--
-- One row per thing being counted: an account (by a hash of the address that
-- was typed, so the table is not a list of addresses and a row exists whether
-- or not the address has an account) or a network address. Only the server
-- reads or writes it, through the two functions further down.

create table public.auth_throttle (
  key text primary key,
  attempts integer not null default 0,
  last_attempt_at timestamptz not null default now(),
  blocked_until timestamptz
);

comment on table public.auth_throttle is
  'Counters behind begin_password_attempt(). No policies and no grants: reachable with the service role only.';

alter table public.auth_throttle enable row level security;
revoke all on public.auth_throttle from anon, authenticated;

create or replace function public.password_throttle_key(p_email text)
returns text language sql immutable set search_path = public, extensions as $$
  select 'password:account:' || encode(extensions.digest(public.normalize_email(p_email), 'sha256'), 'hex');
$$;

revoke execute on function public.password_throttle_key(text) from public, anon, authenticated;

-- ── The rules on auth.users ─────────────────────────────────────────────

create or replace function public.guard_auth_user_credentials()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_old_email text;
  v_new_email text;
  v_old_pending text;
  v_new_pending text;
begin
  -- No account starts with a password. Auth's own placeholder goes, and so
  -- does one a stranger supplied when signing up over somebody's address.
  -- (The service role sets a password by updating the account afterwards.)
  if tg_op = 'INSERT' then
    new.encrypted_password := null;
    return new;
  end if;

  v_old_email := public.normalize_email(old.email);
  v_new_email := public.normalize_email(new.email);
  v_old_pending := public.normalize_email(old.email_change);
  v_new_pending := public.normalize_email(new.email_change);

  -- An address proven for the first time by an emailed link: whatever password
  -- the row carries was set before anyone had shown the inbox was theirs.
  if old.email_confirmed_at is null
     and new.email_confirmed_at is not null
     and (coalesce(old.confirmation_token, '') <> '' or coalesce(old.recovery_token, '') <> '') then
    new.encrypted_password := null;
  end if;

  -- Auth is issuing a confirmation for a new address (a new request, or the
  -- same one sent again). By now it has already emailed the link — Auth sends
  -- before it saves — so refusing here would not stop the email, only stop
  -- Auth from recording that it sent one, and with that its own limit on how
  -- often an account may ask. So the request is let through and what is
  -- decided here is whether the link can ever be used: it can only if this is
  -- the address the owner authorised a moment ago.
  if v_new_pending <> ''
     and coalesce(new.email_change_token_new, '') <> ''
     and (v_new_pending is distinct from v_old_pending
          or new.email_change_token_new is distinct from old.email_change_token_new) then
    update public.account_security
       set email_change_requested_at = now(),
           email_change_armed_until = null
     where user_id = new.id
       and email_change_to = v_new_pending
       and email_change_authorized_at > now() - interval '10 minutes';
    if not found then
      update public.account_security
         set email_change_requested_at = null,
             email_change_armed_until = null
       where user_id = new.id;
    end if;
  end if;

  -- Auth is completing a pending change: the login address becomes the one
  -- that was waiting.
  if new.deleted_at is null
     and v_new_email is distinct from v_old_email
     and v_old_pending <> ''
     and v_new_email = v_old_pending then
    update public.account_security
       set email_change_to = null,
           email_change_authorized_at = null,
           email_change_requested_at = null,
           email_change_armed_until = null
     where user_id = new.id
       and email_change_to = v_new_email
       and email_change_requested_at is not null
       and email_change_armed_until > now();
    if not found then
      raise exception 'email change not authorised and confirmed by the account owner'
        using errcode = '42501',
              hint = 'The owner authorises the address (public.authorize_email_change) and confirms it signed in (public.arm_email_change) immediately before the link is used.';
    end if;
  end if;

  -- A password set, replaced or removed on an account whose address is proven.
  if old.email_confirmed_at is not null
     and new.encrypted_password is distinct from old.encrypted_password then
    if coalesce(new.encrypted_password, '') = '' then
      update public.account_security set password_set_at = null where user_id = new.id;
    elsif public.account_has_password(new.id) then
      -- Replacing a password the owner chose.
      update public.account_security
         set password_set_at = now(),
             password_change_authorized_at = null
       where user_id = new.id
         and password_change_authorized_at > now() - interval '5 minutes';
      if not found then
        raise exception 'password change not authorised for this account'
          using errcode = '42501',
                hint = 'An existing password is replaced only after public.authorize_password_change(), which needs a session that just proved the current password or came from an emailed link.';
      end if;
    else
      -- The account's first password.
      insert into public.account_security (user_id, password_set_at)
      values (new.id, now())
      on conflict (user_id) do update
        set password_set_at = excluded.password_set_at,
            password_change_authorized_at = null;
    end if;

    -- A new password is a fresh start for whoever had been guessing the old one.
    delete from public.auth_throttle where key = public.password_throttle_key(new.email);
  end if;

  return new;
end;
$$;

revoke execute on function public.guard_auth_user_credentials() from public, anon, authenticated;

create trigger on_auth_user_created_without_password
before insert on auth.users
for each row
when (new.encrypted_password is not null)
execute function public.guard_auth_user_credentials();

-- Fires only for the handful of updates that touch a credential; Auth updates
-- this table on every sign-in and token refresh.
create trigger on_auth_user_credentials_changed
before update on auth.users
for each row
when (
  old.email is distinct from new.email
  or old.email_change is distinct from new.email_change
  or old.email_change_token_new is distinct from new.email_change_token_new
  or old.encrypted_password is distinct from new.encrypted_password
  or (old.email_confirmed_at is null and new.email_confirmed_at is not null)
)
execute function public.guard_auth_user_credentials();

-- The placeholders already there. Nobody has chosen a password before this
-- migration — the product had no way to — so every hash present is one of
-- Auth's own, or one that was never proven.
update auth.users set encrypted_password = null where encrypted_password is not null;

-- ── Replacing a password ────────────────────────────────────────────────

-- Called with a session that has just proven the current password, or has
-- just come from the account's inbox. Opens five minutes in which Auth may
-- replace the password; the change spends it. False, and nothing granted, for
-- any other session — being signed in is not enough.
create or replace function public.authorize_password_change()
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    return false;
  end if;
  if not (public.password_proven_recently() or public.inbox_proven_recently()) then
    return false;
  end if;

  insert into public.account_security (user_id, password_change_authorized_at)
  values (auth.uid(), now())
  on conflict (user_id) do update set password_change_authorized_at = now();

  return true;
end;
$$;

revoke execute on function public.authorize_password_change() from public, anon;
grant execute on function public.authorize_password_change() to authenticated;

-- ── Email change ────────────────────────────────────────────────────────

-- Step one, called with a session that has just proven the current password.
-- Records which address Auth may complete a change to. Answers with a reason
-- rather than raising, so the caller can say what is missing; none of the
-- reasons says anything about any other account.
create or replace function public.authorize_email_change(p_new_email text)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_email text := public.normalize_email(p_new_email);
  v_current text;
  v_password_set_at timestamptz;
begin
  if v_uid is null then
    return 'unauthenticated';
  end if;
  if not public.looks_like_email(v_email) then
    return 'invalid';
  end if;

  select public.normalize_email(u.email) into v_current from auth.users u where u.id = v_uid;
  if v_email = v_current then
    return 'same';
  end if;

  if not public.password_proven_recently() then
    return 'reauthenticate';
  end if;

  select s.password_set_at into v_password_set_at
  from public.account_security s where s.user_id = v_uid;
  if v_password_set_at is null then
    return 'no-password';
  end if;
  if v_password_set_at > now() - public.email_change_cooldown() then
    return 'cooldown';
  end if;

  update public.account_security
     set email_change_to = v_email,
         email_change_authorized_at = now(),
         email_change_requested_at = null,
         email_change_armed_until = null
   where user_id = v_uid;

  return 'authorized';
end;
$$;

revoke execute on function public.authorize_email_change(text) from public, anon;
grant execute on function public.authorize_email_change(text) to authenticated;

-- Step two, called by the signed-in owner at the moment they press "confirm"
-- on the page the new address was sent. Opens a two-minute window in which
-- Auth may complete the change. False when nothing is waiting: no request the
-- owner authorised, one that is older than any emailed link can be, or one
-- Auth has since replaced with a request for somewhere else.
create or replace function public.arm_email_change()
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    return false;
  end if;

  update public.account_security s
     set email_change_armed_until = now() + interval '2 minutes'
   where s.user_id = auth.uid()
     and s.email_change_to is not null
     and s.email_change_requested_at > now() - interval '24 hours'
     and exists (
       select 1 from auth.users u
       where u.id = s.user_id
         and public.normalize_email(u.email_change) = s.email_change_to
     );

  return found;
end;
$$;

revoke execute on function public.arm_email_change() from public, anon;
grant execute on function public.arm_email_change() to authenticated;

-- Withdraws the caller's own pending change. The link already emailed stops
-- working, because Auth can no longer complete it.
create or replace function public.cancel_email_change()
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    return false;
  end if;

  update public.account_security
     set email_change_to = null,
         email_change_authorized_at = null,
         email_change_requested_at = null,
         email_change_armed_until = null
   where user_id = auth.uid()
     and email_change_to is not null;

  return found;
end;
$$;

revoke execute on function public.cancel_email_change() from public, anon;
grant execute on function public.cancel_email_change() to authenticated;

-- ── An invitation needs an account with a password ──────────────────────
--
-- The acceptance logic itself is untouched: it keeps its body under a new
-- name that no client can call, and the name clients do call checks one thing
-- first. An account without a password holding a good invitation for its own
-- address is told so, and noted as owing a password; every other case — and
-- every refusal — is the original function's, word for word.

alter function public.accept_invitation_token(text) rename to accept_invitation_token_for_account;
revoke execute on function public.accept_invitation_token_for_account(text) from public, anon, authenticated;

create function public.accept_invitation_token(p_token text)
returns table (ok boolean, community_id text, reason text)
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is not null
     and not public.account_has_password(v_uid)
     and exists (
       select 1
       from public.invitations inv
       join auth.users u on u.id = v_uid
       where inv.token_hash = public.hash_invitation_token(p_token)
         and inv.accepted_at is null
         and inv.revoked_at is null
         and inv.expires_at > now()
         and inv.email = public.normalize_email(u.email)
     ) then
    insert into public.account_security as s (user_id, password_setup_required_at)
    values (v_uid, now())
    on conflict (user_id) do update
      set password_setup_required_at = coalesce(s.password_setup_required_at, now());

    return query select false, null::text, 'password-required'::text;
    return;
  end if;

  return query select * from public.accept_invitation_token_for_account(p_token);
end;
$$;

revoke execute on function public.accept_invitation_token(text) from public, anon;
grant execute on function public.accept_invitation_token(text) to authenticated;

-- ── An approval activates only an account with a password ───────────────
--
-- `approve_access_request()` is the other way a membership becomes active:
-- when the address already has a confirmed account, approval used to activate
-- it there and then. That stands for an account with a password. One without
-- — confirmed or not, new or old, however it has signed in until now — gets
-- the invitation instead, and with it the same rule as everybody else.
-- Nothing else in the function is changed; it is restated whole because that
-- is the only way to change a line of it.

create or replace function public.approve_access_request(p_request_id uuid)
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

  -- An account that has not chosen a password is not yet one to activate on
  -- the spot, however long it has existed and however it has signed in
  -- before. It goes the invitation way instead, where choosing a password is
  -- part of accepting (accept_invitation_token) — the same journey as someone
  -- with no account at all. An account that has a password is activated here
  -- as before, and never asked for another.
  if v_user_id is not null and not public.account_has_password(v_user_id) then
    v_user_id := null;
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

-- And the rule itself, on the table, for every path there is or will be: a
-- membership does not become active for an account without a password. The
-- two functions above already see to that for themselves, so this never
-- fires in the ordinary course — it is what stands when some later function
-- forgets. It binds anything done on a person's behalf (a signed-in session,
-- whatever function it calls). The service role, which answers to no row
-- rule and is how fixtures are seeded, is not a person and is left alone.
create or replace function public.require_password_for_membership()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'active'
     and (tg_op = 'INSERT' or old.status is distinct from new.status)
     and coalesce(auth.jwt() ->> 'role', '') in ('authenticated', 'anon')
     and not public.account_has_password(new.user_id) then
    raise exception 'a membership cannot be activated before the account has a password'
      using errcode = '42501',
            hint = 'The account chooses a password first; accept_invitation_token() and approve_access_request() both wait for it.';
  end if;
  return new;
end;
$$;

revoke execute on function public.require_password_for_membership() from public, anon, authenticated;

create trigger memberships_require_password
before insert or update of status on public.memberships
for each row
execute function public.require_password_for_membership();

-- ── Slowing down password guessing ──────────────────────────────────────
--
-- Supabase Auth limits sign-ins per network address, but it sees the address
-- of whoever calls it — and TING's server is what calls it, for everyone. So
-- the counting that can tell one person from another happens here, before
-- Auth is asked at all.
--
-- Two counters, both in the database so they hold across processes and
-- restarts:
--
-- - Per account: five tries, then a wait that doubles from thirty seconds to
--   fifteen minutes, forgotten after an hour without a try or as soon as the
--   right password is given. It is keyed on the address typed, exists for
--   addresses with no account exactly as for those with one, and so says
--   nothing about which is which. It follows the account wherever the tries
--   come from, which is what stops guessing spread over many addresses.
-- - Per network address (when the server knows it): twenty failures, then
--   fifteen minutes. This is the one that keeps a single source from working
--   through a list of accounts.
--
-- Someone locked out of their password by another person's guessing still has
-- the emailed sign-in link, which none of this touches, and setting a new
-- password clears the account's counter.
--
-- The server calls these with the service role. No client can: a caller able
-- to name any address and any network address could lock out whoever it liked.

-- Asks to try a password. Returns 0 and counts the try, or the number of
-- seconds to wait and counts nothing.
create or replace function public.begin_password_attempt(p_email text, p_ip text)
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_account text := public.password_throttle_key(p_email);
  v_ip text := case when coalesce(btrim(p_ip), '') = '' then null else 'password:ip:' || btrim(p_ip) end;
  v_row public.auth_throttle;
  v_wait integer := 0;
  v_attempts integer;
begin
  -- Each row is locked before it is read, so tries arriving together are
  -- counted one after another rather than all slipping past the same check.
  insert into public.auth_throttle (key) values (v_account) on conflict (key) do nothing;
  select * into v_row from public.auth_throttle where key = v_account for update;
  if v_row.blocked_until > now() then
    v_wait := ceil(extract(epoch from v_row.blocked_until - now()))::integer;
  end if;

  if v_ip is not null then
    insert into public.auth_throttle (key) values (v_ip) on conflict (key) do nothing;
    select * into v_row from public.auth_throttle where key = v_ip for update;
    if v_row.blocked_until > now() then
      v_wait := greatest(v_wait, ceil(extract(epoch from v_row.blocked_until - now()))::integer);
    end if;
  end if;

  if v_wait > 0 then
    return v_wait;
  end if;

  update public.auth_throttle
     set attempts = case when last_attempt_at < now() - interval '1 hour' then 1 else attempts + 1 end,
         last_attempt_at = now(),
         blocked_until = null
   where key = v_account
  returning attempts into v_attempts;
  if v_attempts >= 5 then
    update public.auth_throttle
       set blocked_until = now() + least(interval '15 minutes', interval '30 seconds' * power(2, least(v_attempts - 5, 10)))
     where key = v_account;
  end if;

  if v_ip is not null then
    update public.auth_throttle
       set attempts = case when last_attempt_at < now() - interval '15 minutes' then 1 else attempts + 1 end,
           last_attempt_at = now(),
           blocked_until = null
     where key = v_ip
    returning attempts into v_attempts;
    if v_attempts >= 20 then
      update public.auth_throttle set blocked_until = now() + interval '15 minutes' where key = v_ip;
    end if;
  end if;

  -- Now and then, forget what is long over.
  if random() < 0.02 then
    delete from public.auth_throttle
     where last_attempt_at < now() - interval '1 day'
       and (blocked_until is null or blocked_until < now());
  end if;

  return 0;
end;
$$;

revoke execute on function public.begin_password_attempt(text, text) from public, anon, authenticated;

-- Reports how a counted try went. The right password clears the account's
-- counter and takes the try back off the network address; a wrong one leaves
-- both as they were counted.
create or replace function public.finish_password_attempt(p_email text, p_ip text, p_valid boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not coalesce(p_valid, false) then
    return;
  end if;

  delete from public.auth_throttle where key = public.password_throttle_key(p_email);
  if coalesce(btrim(p_ip), '') <> '' then
    update public.auth_throttle
       set attempts = greatest(attempts - 1, 0)
     where key = 'password:ip:' || btrim(p_ip);
  end if;
end;
$$;

revoke execute on function public.finish_password_attempt(text, text, boolean) from public, anon, authenticated;
