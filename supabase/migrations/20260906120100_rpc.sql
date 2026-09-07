-- Vev — the only two ways in, and the membership state machine.

-- ── Public portals ───────────────────────────────────────────────────────
--
-- A portal is reachable by anyone holding the link. These functions take an
-- exact slug and return at most one community, which is what keeps the
-- platform undiscoverable: there is no argument that lists everything, and the
-- `communities` table itself is unreadable to anon.
--
-- `about` is omitted on purpose — that is the internal description, for
-- members. So is `host_id` on events: naming who in an organisation runs a
-- public event would disclose that person's membership to any visitor.

create or replace function public.portal_by_slug(p_slug text)
returns table (
  id text,
  slug text,
  name text,
  tagline text,
  public_description text,
  location text,
  founded_year int,
  accent text,
  accent_soft text,
  monogram text,
  mark_style text,
  access_policy access_policy,
  member_count int,
  links jsonb
)
language sql security definer stable set search_path = public as $$
  select c.id, c.slug, c.name, c.tagline, c.public_description, c.location,
         c.founded_year, c.accent, c.accent_soft, c.monogram, c.mark_style,
         c.access_policy, c.member_count, c.links
  from communities c
  where c.slug = p_slug;
$$;

create or replace function public.portal_events(p_slug text)
returns table (
  id uuid,
  title text,
  description text,
  starts_at timestamptz,
  ends_at timestamptz,
  location text
)
language sql security definer stable set search_path = public as $$
  select e.id, e.title, e.description, e.starts_at, e.ends_at, e.location
  from events e
  join communities c on c.id = e.community_id
  where c.slug = p_slug and e.is_public and e.ends_at >= now()
  order by e.starts_at;
$$;

-- ── Membership transitions ───────────────────────────────────────────────
--
-- Each function is the single place a given transition can happen, so its
-- preconditions cannot be bypassed by writing to the table directly (there are
-- no insert/update policies on `memberships` at all).

-- Marks an invitation notice as handled once the invitation is answered, so a
-- decision the user already made stops asking to be made.
create or replace function public.resolve_invitation_notice(p_user uuid, p_community text)
returns void language sql security definer set search_path = public as $$
  update notifications
  set read = true
  where user_id = p_user and community_id = p_community and kind = 'invitation';
$$;

create or replace function public.request_access(p_community_id text)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  v_policy access_policy;
begin
  if auth.uid() is null then
    return false;
  end if;

  select access_policy into v_policy from communities where id = p_community_id;
  -- Unknown community, or one that does not take open applications.
  if v_policy is null or v_policy <> 'request-to-join' then
    return false;
  end if;

  -- Already a member, already invited, or already waiting.
  if exists (
    select 1 from memberships
    where user_id = auth.uid() and community_id = p_community_id
  ) then
    return false;
  end if;

  insert into memberships (user_id, community_id, role, status, joined_at)
  values (auth.uid(), p_community_id, 'member', 'requested', current_date);
  return true;
end;
$$;

create or replace function public.accept_invitation(p_community_id text)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    return false;
  end if;

  update memberships
  set status = 'active', joined_at = current_date
  where user_id = auth.uid()
    and community_id = p_community_id
    and status = 'invited';

  if not found then
    return false;
  end if;

  perform resolve_invitation_notice(auth.uid(), p_community_id);
  return true;
end;
$$;

create or replace function public.decline_invitation(p_community_id text)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    return false;
  end if;

  delete from memberships
  where user_id = auth.uid()
    and community_id = p_community_id
    and status = 'invited';

  if not found then
    return false;
  end if;

  perform resolve_invitation_notice(auth.uid(), p_community_id);
  return true;
end;
$$;

create or replace function public.approve_membership(p_community_id text, p_user_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  v_name text;
begin
  -- Only an administrator of this specific community.
  if not is_admin(p_community_id) then
    return false;
  end if;

  update memberships
  set status = 'active', joined_at = current_date
  where user_id = p_user_id
    and community_id = p_community_id
    and status <> 'active';

  if not found then
    return false;
  end if;

  perform resolve_invitation_notice(p_user_id, p_community_id);

  -- Without this the person just finds themselves inside a new community with
  -- no idea when, or by whom, they were let in.
  select name into v_name from communities where id = p_community_id;
  insert into notifications (user_id, kind, community_id, title, body, href)
  values (
    p_user_id,
    'membership',
    p_community_id,
    'Du har fått tilgang til ' || v_name,
    'En administrator godkjente forespørselen din. Du kan nå lese og delta i fellesskapet.',
    '/community/' || p_community_id
  );
  return true;
end;
$$;

create or replace function public.reject_membership(p_community_id text, p_user_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if not is_admin(p_community_id) then
    return false;
  end if;

  -- Turning down a pending request is not the same as removing a member;
  -- this path must never be able to do the latter.
  delete from memberships
  where user_id = p_user_id
    and community_id = p_community_id
    and status <> 'active';

  return found;
end;
$$;

create or replace function public.mark_notifications_read()
returns void language sql security definer set search_path = public as $$
  update notifications set read = true where user_id = auth.uid() and not read;
$$;

-- ── Grants ───────────────────────────────────────────────────────────────
--
-- Two things hand out execution by default: Postgres grants new functions to
-- PUBLIC, and Supabase's `auto_expose_new_tables` grants them to the API roles
-- directly. Revoking from PUBLIC alone would leave the second one standing, so
-- take back both and then grant deliberately.

revoke execute on all functions in schema public from public;
revoke execute on all functions in schema public from anon, authenticated;

grant execute on function public.portal_by_slug(text) to anon, authenticated;
grant execute on function public.portal_events(text) to anon, authenticated;

grant execute on function public.request_access(text) to authenticated;
grant execute on function public.accept_invitation(text) to authenticated;
grant execute on function public.decline_invitation(text) to authenticated;
grant execute on function public.approve_membership(text, uuid) to authenticated;
grant execute on function public.reject_membership(text, uuid) to authenticated;
grant execute on function public.mark_notifications_read() to authenticated;

-- The helpers are called from inside policies, which run as the invoking role.
grant execute on function public.is_member(text) to authenticated;
grant execute on function public.is_admin(text) to authenticated;
grant execute on function public.can_moderate(text) to authenticated;
grant execute on function public.has_membership_row(text) to authenticated;
grant execute on function public.shares_community(uuid) to authenticated;
grant execute on function public.can_read_channel(text) to authenticated;

-- resolve_invitation_notice takes a user id as an argument and checks nothing,
-- so it must stay unreachable from the API. It is only ever called from inside
-- the SECURITY DEFINER functions above, which run as the owner and are not
-- subject to these grants.

-- ── New accounts ─────────────────────────────────────────────────────────
-- A profile row is created for every sign-up so the app never has to deal with
-- a logged-in user who has no profile.

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, name, handle, initials, email)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'name', split_part(new.email, '@', 1)),
    coalesce(
      new.raw_user_meta_data ->> 'handle',
      split_part(new.email, '@', 1) || '-' || substr(new.id::text, 1, 4)
    ),
    upper(substr(coalesce(new.raw_user_meta_data ->> 'name', new.email), 1, 2)),
    new.email
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();
