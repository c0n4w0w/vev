-- Vev — initial schema.
--
-- Two rules shape everything below:
--
--   1. There is no query that returns "all communities". Reading the
--      `communities` table requires an existing relationship to that specific
--      community. Public portals are served by `portal_by_slug`, which takes an
--      exact slug and returns one row — so a portal link works, but the API
--      cannot be walked to discover which organisations exist here.
--
--   2. Membership is the unit of authorisation. Every read policy resolves to
--      "is the caller an active member of this community", so a mistake in the
--      application cannot expose another organisation's data.
--
-- Mutations go through SECURITY DEFINER functions rather than table policies,
-- so each transition (invite → accept, request → approve) checks its own
-- preconditions in one place and cannot be half-applied.

create extension if not exists "pgcrypto";

-- ── Enums ────────────────────────────────────────────────────────────────

create type community_role as enum ('member', 'moderator', 'admin');
create type membership_status as enum ('active', 'invited', 'requested');
create type access_policy as enum ('invite-only', 'request-to-join');
create type post_kind as enum ('post', 'announcement');
create type notification_kind as enum (
  'mention', 'announcement', 'event', 'invitation', 'membership'
);

-- ── Tables ───────────────────────────────────────────────────────────────

-- One row per account. `id` matches auth.users so RLS can key on auth.uid().
create table profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  name text not null,
  handle text not null unique,
  initials text not null,
  email text not null,
  pronoun text not null default '',
  location text not null default '',
  bio text not null default '',
  joined_at date not null default current_date
);

-- Text ids keep the URLs the prototype already uses (/community/under-the-rug).
create table communities (
  id text primary key,
  slug text not null unique,
  name text not null,
  tagline text not null,
  public_description text not null,
  about text not null,
  location text not null,
  founded_year int not null,
  accent text not null,
  accent_soft text not null,
  monogram text not null,
  mark_style text not null default 'sans',
  access_policy access_policy not null default 'invite-only',
  member_count int not null default 0,
  links jsonb not null default '[]'::jsonb
);

create table memberships (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles (id) on delete cascade,
  community_id text not null references communities (id) on delete cascade,
  role community_role not null default 'member',
  status membership_status not null default 'requested',
  joined_at date not null default current_date,
  title text,
  invited_by uuid references profiles (id) on delete set null,
  unique (user_id, community_id)
);

create index memberships_community_idx on memberships (community_id, status);
create index memberships_user_idx on memberships (user_id, status);

create table channel_groups (
  id text primary key,
  label text not null,
  position int not null default 0
);

create table channels (
  id text primary key,
  community_id text not null references communities (id) on delete cascade,
  group_id text not null references channel_groups (id),
  name text not null,
  purpose text not null,
  read_only boolean not null default false,
  position int not null default 0
);

create index channels_community_idx on channels (community_id);

create table messages (
  id uuid primary key default gen_random_uuid(),
  channel_id text not null references channels (id) on delete cascade,
  author_id uuid not null references profiles (id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now(),
  attachment jsonb,
  reactions jsonb not null default '[]'::jsonb
);

create index messages_channel_idx on messages (channel_id, created_at);

create table posts (
  id uuid primary key default gen_random_uuid(),
  community_id text not null references communities (id) on delete cascade,
  author_id uuid not null references profiles (id) on delete cascade,
  title text,
  body text not null,
  created_at timestamptz not null default now(),
  kind post_kind not null default 'post',
  pinned boolean not null default false,
  comment_count int not null default 0,
  reactions jsonb not null default '[]'::jsonb
);

create index posts_community_idx on posts (community_id, created_at desc);

create table events (
  id uuid primary key default gen_random_uuid(),
  community_id text not null references communities (id) on delete cascade,
  title text not null,
  description text not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  location text not null,
  is_public boolean not null default false,
  host_id uuid references profiles (id) on delete set null,
  capacity int
);

create index events_community_idx on events (community_id, starts_at);

create table event_attendees (
  event_id uuid not null references events (id) on delete cascade,
  user_id uuid not null references profiles (id) on delete cascade,
  primary key (event_id, user_id)
);

create table notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles (id) on delete cascade,
  kind notification_kind not null,
  community_id text references communities (id) on delete cascade,
  title text not null,
  body text not null,
  created_at timestamptz not null default now(),
  read boolean not null default false,
  href text not null
);

create index notifications_user_idx on notifications (user_id, created_at desc);

-- ── Authorisation helpers ────────────────────────────────────────────────
--
-- SECURITY DEFINER so that policies on `memberships` can call them without
-- recursing into their own RLS. `search_path` is pinned so a caller cannot
-- shadow the tables these read.

create or replace function public.is_member(cid text)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from memberships m
    where m.community_id = cid and m.user_id = auth.uid() and m.status = 'active'
  );
$$;

create or replace function public.is_admin(cid text)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from memberships m
    where m.community_id = cid and m.user_id = auth.uid()
      and m.status = 'active' and m.role = 'admin'
  );
$$;

create or replace function public.can_moderate(cid text)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from memberships m
    where m.community_id = cid and m.user_id = auth.uid()
      and m.status = 'active' and m.role in ('admin', 'moderator')
  );
$$;

-- Any relationship at all — active, invited or requested. This is what makes a
-- community row visible: an invitation is enough to see the name you were
-- invited to, a stranger sees nothing.
create or replace function public.has_membership_row(cid text)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from memberships m
    where m.community_id = cid and m.user_id = auth.uid()
  );
$$;

-- Whether the caller and another person are both active in some community.
create or replace function public.shares_community(other uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from memberships a
    join memberships b on a.community_id = b.community_id
    where a.user_id = auth.uid() and a.status = 'active'
      and b.user_id = other and b.status = 'active'
  );
$$;

create or replace function public.can_read_channel(chid text)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from channels c
    join memberships m on m.community_id = c.community_id
    where c.id = chid and m.user_id = auth.uid() and m.status = 'active'
  );
$$;

-- ── Row level security ───────────────────────────────────────────────────

alter table profiles enable row level security;
alter table communities enable row level security;
alter table memberships enable row level security;
alter table channel_groups enable row level security;
alter table channels enable row level security;
alter table messages enable row level security;
alter table posts enable row level security;
alter table events enable row level security;
alter table event_attendees enable row level security;
alter table notifications enable row level security;

-- Profiles: yourself, people you share a community with, and whoever invited
-- you (so an invitation can say who it came from). Not the whole user table.
create policy profiles_select on profiles for select to authenticated
using (
  id = auth.uid()
  or shares_community(id)
  or exists (
    select 1 from memberships m
    where m.user_id = auth.uid() and m.invited_by = profiles.id
  )
);

create policy profiles_update_self on profiles for update to authenticated
using (id = auth.uid()) with check (id = auth.uid());

-- Communities: only ones you already have a relationship with. There is
-- deliberately no policy granting anon access — portals go through
-- portal_by_slug() below.
create policy communities_select on communities for select to authenticated
using (has_membership_row(id));

-- Memberships: your own rows, plus the member list of communities you belong
-- to. Admins additionally see pending rows via the same policy.
create policy memberships_select on memberships for select to authenticated
using (user_id = auth.uid() or is_member(community_id));

-- Channel groups are just labels shared by every community.
create policy channel_groups_select on channel_groups for select to authenticated
using (true);

create policy channels_select on channels for select to authenticated
using (is_member(community_id));

create policy messages_select on messages for select to authenticated
using (can_read_channel(channel_id));

create policy messages_insert on messages for insert to authenticated
with check (
  author_id = auth.uid()
  and can_read_channel(channel_id)
  and not exists (
    select 1 from channels c
    where c.id = channel_id and c.read_only and not can_moderate(c.community_id)
  )
);

create policy posts_select on posts for select to authenticated
using (is_member(community_id));

create policy posts_insert on posts for insert to authenticated
with check (
  author_id = auth.uid()
  and is_member(community_id)
  -- Announcements notify everyone, so they are moderator-and-up only.
  and (kind = 'post' or can_moderate(community_id))
);

create policy events_select on events for select to authenticated
using (is_member(community_id));

create policy event_attendees_select on event_attendees for select to authenticated
using (
  exists (select 1 from events e where e.id = event_id and is_member(e.community_id))
);

create policy event_attendees_write on event_attendees for all to authenticated
using (user_id = auth.uid())
with check (
  user_id = auth.uid()
  and exists (select 1 from events e where e.id = event_id and is_member(e.community_id))
);

create policy notifications_select on notifications for select to authenticated
using (user_id = auth.uid());

create policy notifications_update on notifications for update to authenticated
using (user_id = auth.uid()) with check (user_id = auth.uid());
