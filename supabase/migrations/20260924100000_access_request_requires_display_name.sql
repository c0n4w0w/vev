-- A name or pseudonym is now required on every new access request.
--
-- It is the identity the person will have when they take part in the
-- community, so a request without one is not a complete request. Until now the
-- field was optional in the form and, more to the point, optional at the only
-- boundary that cannot be bypassed: anyone can call `request_community_access`
-- directly with the public anon key, whatever the form does. The rule
-- therefore lives here, and the form and the server action merely agree with
-- it early enough to give a useful message.
--
-- ── What changes ────────────────────────────────────────────────────────
--
-- 1. `request_community_access()` rejects a missing, empty, whitespace-only or
--    over-long name. The same rule applies to every community; there is no
--    per-organisation exception. Names are trimmed before they are stored.
--
--    "Whitespace" is broader than what `btrim` removes (only ASCII spaces):
--    tabs, newlines, no-break spaces and zero-width characters are stripped
--    too, so a value that renders as nothing is not a name. The limit is 80
--    characters, the same as the form and the server action; JavaScript counts
--    UTF-16 units, which is never fewer than characters, so anything the app
--    accepts is accepted here.
--
--    A rejection returns false, exactly as a malformed address always has,
--    and happens before the community is looked up. It therefore describes the
--    input and nothing else: it says nothing about which slugs exist, which
--    take requests, or who is already a member, and it cannot be used to probe
--    any of that. The uniform `true` for every other outcome is untouched.
--
--    Nothing else about the function changes: same signature (so its grants
--    carry over and are restated below), same SECURITY DEFINER with a pinned
--    search_path, same rate limits, same idempotency through the partial
--    unique index on pending requests, same identity binding, same
--    notifications. Existing rows are not touched — requests filed before this
--    migration may have no name, and stay valid.
--
-- 2. `has_pending_access_request()` lets a signed-in person find out whether
--    *they* have a request waiting in a community, so the portal can show
--    that instead of the form. It answers only for the caller's own identity:
--    a request bound to their session, or one filed for their own confirmed
--    address. It takes no address, so it cannot be used to ask about anybody
--    else, and it is not granted to anon — a visitor who has not signed in
--    cannot be recognised, by design. `access_requests` still has no policy
--    that lets a requester read the table.

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

  -- A name is required, and has to be short enough to be a name. This answers
  -- about the input alone and runs before anything is looked up, so it cannot
  -- reveal anything about a community.
  if v_name = '' or length(v_name) > 80 then
    return false;
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
$$;

-- ── Whether the signed-in caller has a request waiting here ──────────────

create function public.has_pending_access_request(p_slug text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from access_requests ar
    join communities c on c.id = ar.community_id
    where c.slug = p_slug
      and ar.status = 'pending'
      and auth.uid() is not null
      and (
        ar.user_id = auth.uid()
        or exists (
          select 1 from auth.users u
          where u.id = auth.uid()
            and u.email_confirmed_at is not null
            and normalize_email(u.email) = ar.email
        )
      )
  );
$$;

-- Grants are restated so this migration shows the whole surface of what it
-- touches. `create or replace` keeps the existing ones; the new function has
-- to be locked down explicitly, since functions are executable by public by
-- default.
revoke execute on function public.request_community_access(text, text, text) from public;
grant execute on function public.request_community_access(text, text, text) to anon, authenticated;

revoke execute on function public.has_pending_access_request(text) from public, anon;
grant execute on function public.has_pending_access_request(text) to authenticated;
