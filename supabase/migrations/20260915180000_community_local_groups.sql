-- Optional local groups ("lokallag") inside a community.
--
-- Tryggere Ruspolitikk and Tryggere Ungdom are national organisations that do
-- most of their actual work locally. A member may belong to one local group —
-- or to none, which is an ordinary and permanent state, not an unfinished
-- profile. Nothing here may stand between a person and joining.
--
-- The affiliation belongs to the *membership*, not the account. The same
-- person can be FTR Trøndelag in the parent organisation and TU Oslo in the
-- youth organisation, and an ordinary member of a third community where the
-- idea does not apply at all. A column on `profiles` could not express that.
--
-- Local groups are rows, not a hard-coded list: an organisation adds or
-- retires one without a deployment, and a community that has no use for them
-- simply has none — which is also how the feature stays invisible in
-- communities that never opted in. Nothing branches on a community's name.

create table community_local_groups (
  id uuid primary key default gen_random_uuid(),
  community_id text not null references communities (id) on delete cascade,
  name text not null,
  slug text not null,
  sort_order int not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),

  unique (community_id, slug),

  -- Not redundant with the primary key. It is what lets `memberships` point at
  -- (local_group_id, community_id) as a pair, which is what makes invariant
  -- "the chosen group belongs to this membership's community" structural
  -- rather than something a trigger has to remember to check.
  unique (id, community_id)
);

create index community_local_groups_community_idx
  on community_local_groups (community_id, active, sort_order);

comment on table community_local_groups is
  'Selectable local groups within one community. Retired groups are deactivated (active = false), never deleted, so existing affiliations survive.';

-- ── The affiliation ─────────────────────────────────────────────────────
--
-- Nullable, and null is the default: every existing member keeps working
-- exactly as before and simply has no local group. No backfill, no guessing
-- from location, no placeholder row standing in for "don't know".
--
-- The foreign key is composite and deliberately so. With MATCH SIMPLE — the
-- default — a row where local_group_id is null is not checked at all, which is
-- precisely the "no local group" case. When it is set, both columns are
-- present and the pair must exist, so a membership in Tryggere Ungdom cannot
-- reference an FTR group however the value got there. The database refuses it
-- without anyone writing a check.
--
-- on delete restrict: a local group that people are attached to cannot be
-- deleted out from under them. Retiring one is `active = false`, which leaves
-- every existing affiliation in place.
alter table memberships
  add column local_group_id uuid,
  add constraint memberships_local_group_fkey
    foreign key (local_group_id, community_id)
    references community_local_groups (id, community_id)
    on delete restrict;

create index memberships_local_group_idx on memberships (local_group_id);

-- 20260915160000 replaced the table-level SELECT grant on `memberships` with a
-- per-column allowlist, so that `accepts_member_dms` stays private to the
-- person it belongs to. A column added afterwards is therefore unreadable by
-- clients until it is named here — the safe default, and the reason this line
-- exists.
--
-- Unlike that column, this one is ordinary membership metadata and takes the
-- table's existing visibility rules: under member_directory_visibility =
-- 'admin_only' a member still sees only their own row, an administrator sees
-- the community's, and nobody gains a view they did not already have. Local
-- groups ride on the registry's rules rather than around them.
grant select (local_group_id) on memberships to anon, authenticated;

comment on column memberships.local_group_id is
  'Optional local group for this membership. Null means the member has not chosen one, which is a normal state. Constrained to a group of the same community by a composite foreign key.';

-- ── Reading ─────────────────────────────────────────────────────────────
--
-- Active members of the community, and nobody else. A local group is not
-- secret within the community — a member has to be able to see the list in
-- order to pick from it, and to see the name of the one they belong to even
-- after it is retired — but the list belongs to the community and is not
-- public, so it follows membership like everything else here.
--
-- Note what this policy does *not* do: it says nothing about who belongs to
-- which group. That lives on `memberships` and keeps that table's rules,
-- including member_directory_visibility. Adding local groups does not open a
-- back door to the member registry.
alter table community_local_groups enable row level security;

create policy community_local_groups_select on community_local_groups
  for select to authenticated
  using (is_member(community_id));

-- No insert, update or delete policy. Every write goes through one of the
-- SECURITY DEFINER functions below, which is the same arrangement `memberships`
-- has: authorisation is decided inside a function that knows who is asking,
-- rather than by a policy broad enough to be wrong.

-- ── Slugs ───────────────────────────────────────────────────────────────

create or replace function public.local_group_slug(p_name text)
returns text language sql immutable set search_path = public as $$
  select nullif(
    trim(both '-' from
      regexp_replace(
        regexp_replace(
          lower(translate(p_name, 'æøåÆØÅéèêüöäÉÈÊÜÖÄ', 'aoaAOAeeeuoaEEEUOA')),
          '[^a-z0-9]+', '-', 'g'
        ),
        '-{2,}', '-', 'g'
      )
    ),
    ''
  );
$$;

-- ── A member choosing, changing or clearing their own affiliation ───────
--
-- The one write an ordinary member may make. It is a function rather than an
-- UPDATE policy on `memberships` because a policy cannot say "this column and
-- no other": `with check` sees the finished row, not which fields moved, so
-- anything permissive enough to set local_group_id would also permit rewriting
-- one's own role. The statement lives here instead, written once.
--
-- Passing null clears the selection. That is a real answer, not a failure, and
-- it is how "Jeg vil ikke velge lokallag nå" is stored.
--
-- Refusals are structural rather than checked:
--   * the acting person is auth.uid(), never an argument, so there is no user
--     id to forge and no way to reach another member's row;
--   * the membership must be the caller's own and active;
--   * the group must be active — a retired group cannot be newly chosen, while
--     members already in it keep it;
--   * the group must belong to the named community, and the composite foreign
--     key would refuse the write even if this check were removed.
--
-- Returns true when the membership now holds the requested value.
create or replace function public.set_my_local_group(
  p_community_id text,
  p_local_group_id uuid
)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  v_updated uuid;
  v_found boolean;
begin
  if p_local_group_id is not null then
    select true into v_found
    from community_local_groups g
    where g.id = p_local_group_id
      and g.community_id = p_community_id
      and g.active;

    -- Unknown, retired, or belonging to another community. All three are the
    -- same answer to the caller: no.
    if v_found is null then
      return false;
    end if;
  end if;

  update memberships m
     set local_group_id = p_local_group_id
   where m.user_id = auth.uid()
     and m.community_id = p_community_id
     and m.status = 'active'
  returning m.id into v_updated;

  return v_updated is not null;
end;
$$;

revoke execute on function public.set_my_local_group(text, uuid) from public, anon;
grant execute on function public.set_my_local_group(text, uuid) to authenticated;

-- ── Administration ──────────────────────────────────────────────────────
--
-- Administrators of that one community, through is_admin(), which is the same
-- gate the membership queue uses. Moderators are deliberately not included:
-- moderation is about content and conversation, and the roster of local groups
-- is organisational structure.

create or replace function public.create_local_group(
  p_community_id text,
  p_name text
)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_name text := nullif(btrim(coalesce(p_name, '')), '');
  v_base text;
  v_slug text;
  v_n int := 1;
  v_id uuid;
begin
  if not is_admin(p_community_id) then
    return null;
  end if;

  if v_name is null or length(v_name) > 80 then
    return null;
  end if;

  v_base := local_group_slug(v_name);
  if v_base is null then
    return null;
  end if;

  -- A name that slugifies onto an existing one gets a numbered slug rather
  -- than an error. The displayed name is whatever the admin typed.
  v_slug := v_base;
  while exists (
    select 1 from community_local_groups g
    where g.community_id = p_community_id and g.slug = v_slug
  ) loop
    v_n := v_n + 1;
    v_slug := v_base || '-' || v_n;
  end loop;

  insert into community_local_groups (community_id, name, slug, sort_order)
  values (
    p_community_id, v_name, v_slug,
    coalesce((select max(sort_order) + 1 from community_local_groups g
              where g.community_id = p_community_id), 0)
  )
  returning id into v_id;

  return v_id;
end;
$$;

create or replace function public.rename_local_group(
  p_local_group_id uuid,
  p_name text
)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  v_community text;
  v_name text := nullif(btrim(coalesce(p_name, '')), '');
begin
  select g.community_id into v_community
  from community_local_groups g where g.id = p_local_group_id;

  if v_community is null or not is_admin(v_community) then
    return false;
  end if;

  if v_name is null or length(v_name) > 80 then
    return false;
  end if;

  -- The slug is left alone on purpose. It is the stable handle for a group
  -- that members may already be attached to; correcting a display name should
  -- not quietly change identity.
  update community_local_groups g set name = v_name where g.id = p_local_group_id;
  return true;
end;
$$;

-- Retiring and un-retiring. Never deletes, and never touches anybody's
-- affiliation: a member of a group that is switched off stays in it, keeps
-- seeing its name, and is not silently moved or cleared. What changes is only
-- that nobody new can choose it.
create or replace function public.set_local_group_active(
  p_local_group_id uuid,
  p_active boolean
)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  v_community text;
begin
  select g.community_id into v_community
  from community_local_groups g where g.id = p_local_group_id;

  if v_community is null or not is_admin(v_community) then
    return false;
  end if;

  update community_local_groups g
     set active = coalesce(p_active, true)
   where g.id = p_local_group_id;
  return true;
end;
$$;

revoke execute on function public.create_local_group(text, text) from public, anon;
revoke execute on function public.rename_local_group(uuid, text) from public, anon;
revoke execute on function public.set_local_group_active(uuid, boolean) from public, anon;
revoke execute on function public.local_group_slug(text) from public, anon;
grant execute on function public.create_local_group(text, text) to authenticated;
grant execute on function public.rename_local_group(uuid, text) to authenticated;
grant execute on function public.set_local_group_active(uuid, boolean) to authenticated;

-- ── How many people are in each group ───────────────────────────────────
--
-- Counting members means reading rows the caller may not be allowed to read.
-- Under member_directory_visibility = 'admin_only' — which is what both
-- Tryggere organisations use — an ordinary member cannot enumerate the
-- registry, and a per-group headcount is that same information in aggregate.
--
-- So this answers with counts only for someone who could have counted the
-- rows themselves, and returns null otherwise. The caller renders a list
-- without numbers in that case, which is the honest result rather than a
-- fabricated one.
create or replace function public.local_group_member_counts(p_community_id text)
returns table (local_group_id uuid, member_count bigint)
language sql security definer stable set search_path = public as $$
  select m.local_group_id, count(*)
  from memberships m
  where m.community_id = p_community_id
    and m.status = 'active'
    and m.local_group_id is not null
    and can_view_member_directory(p_community_id)
  group by m.local_group_id;
$$;

revoke execute on function public.local_group_member_counts(text) from public, anon;
grant execute on function public.local_group_member_counts(text) to authenticated;
