-- Private organisational subgroups ("grupper"), and one content-scope rule for
-- lokallag and subgroups alike.
--
-- ── Two kinds of private group ──────────────────────────────────────────
--
-- A lokallag is geographical: one per membership, stored on
-- `memberships.local_group_id`, chosen by the member. A subgroup is an
-- organisational team — Safe-Space frivillige is the first — that a member is
-- *added to* by someone entitled to manage it, alongside whatever lokallag
-- they are in. A column on memberships can hold one value, so a team cannot be
-- a lokallag: the same person must be FTR Oslo *and* Safe-Space at once, and
-- moving from Oslo to Trøndelag must not touch the team. Subgroups therefore
-- get their own tables, and content gets its own `subgroup_id` column next to
-- `local_group_id`. The two are mutually exclusive on any one row.
--
-- ── The scope rule ──────────────────────────────────────────────────────
--
-- Written once, in content_scope_admits(), and used for channels, channel
-- messages, posts, comments, reactions, events, RSVPs, announcement fan-out and
-- profile visibility. For an active member of the content's own community:
--
--   community-wide           every active member
--   lokallag (local_group)   members of exactly that group, and the
--                            community's admins
--   subgroup                 explicit members of that subgroup, and the
--                            community's moderators and admins
--
-- What changes for lokallag content compared with before:
--
--   * channels: admins gain access to every lokallag chat of their community
--     (previously exact members only).
--   * posts: moderators lose their cross-lokallag read (previously admins and
--     moderators read every group's posts); admins keep it.
--   * events: lokallag events become private to the group and admins
--     (previously every member of the community could read them; the group
--     was relevance metadata only).
--
-- Every override comes from the role on the caller's membership row *in the
-- content's own community*, so a TU admin has nothing to apply to FTR content.
--
-- ── Reading vs managing a subgroup ──────────────────────────────────────
--
-- Separate questions with separate answers:
--
--   can_access_subgroup()   read its private content: member, moderator, admin
--   can_manage_subgroup()   add/remove members: admin, or an explicit manager
--                           (who must be an active member of the community)
--
-- A manager grant gives no read access by itself, and a moderator's read
-- access gives no management rights.

-- ── Subgroups ───────────────────────────────────────────────────────────

create table if not exists public.community_subgroups (
  id uuid primary key default gen_random_uuid(),
  community_id text not null references public.communities (id) on delete cascade,
  slug text not null,
  name text not null,
  description text not null default '',
  active boolean not null default true,
  created_at timestamptz not null default now(),

  unique (community_id, slug),
  -- Lets scoped content and membership rows reference (id, community_id) as a
  -- pair, so "the subgroup belongs to this row's community" is structural.
  unique (id, community_id),

  constraint community_subgroups_slug_shape check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(slug) <= 60),
  constraint community_subgroups_name_valid check (name = btrim(name) and length(name) between 1 and 80 and name !~ '[[:cntrl:]]'),
  constraint community_subgroups_description_length check (length(description) <= 500)
);

comment on table public.community_subgroups is
  'Private organisational teams inside one community (e.g. Safe-Space frivillige). Independent of lokallag: a member can be in a lokallag and any number of subgroups. Retired with active = false, never deleted.';

-- Membership in a subgroup. The composite foreign key to memberships means a
-- row can only exist for someone who has a membership in the subgroup's own
-- community; whether that membership is *active* is checked when the row is
-- added and again on every access check, so a lapsed membership grants nothing.
create table if not exists public.community_subgroup_members (
  subgroup_id uuid not null,
  community_id text not null,
  user_id uuid not null,
  added_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),

  primary key (subgroup_id, user_id),
  foreign key (subgroup_id, community_id)
    references public.community_subgroups (id, community_id) on delete cascade,
  foreign key (user_id, community_id)
    references public.memberships (user_id, community_id) on delete cascade
);

create index if not exists community_subgroup_members_user_idx
  on public.community_subgroup_members (user_id, community_id);

create table if not exists public.community_subgroup_managers (
  subgroup_id uuid not null,
  community_id text not null,
  user_id uuid not null,
  created_at timestamptz not null default now(),

  primary key (subgroup_id, user_id),
  foreign key (subgroup_id, community_id)
    references public.community_subgroups (id, community_id) on delete cascade,
  foreign key (user_id, community_id)
    references public.memberships (user_id, community_id) on delete cascade
);

comment on table public.community_subgroup_managers is
  'Explicit permission to add and remove members of one subgroup. Grants no read access to its content; community admins can manage without a row here.';

-- ── Who may read a subgroup, who may manage it ──────────────────────────
--
-- Internal versions take a user id and are never granted to an API role; the
-- caller-bound versions supply auth.uid().

create or replace function public.subgroup_access_admits(p_user_id uuid, p_subgroup_id uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select p_user_id is not null and exists (
    select 1
    from community_subgroups s
    join memberships m on m.community_id = s.community_id
    where s.id = p_subgroup_id
      and m.user_id = p_user_id
      and m.status = 'active'
      and (
        m.role in ('admin', 'moderator')
        or exists (
          select 1 from community_subgroup_members sm
          where sm.subgroup_id = s.id and sm.user_id = p_user_id
        )
      )
  );
$$;

create or replace function public.subgroup_manage_admits(p_user_id uuid, p_subgroup_id uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select p_user_id is not null and exists (
    select 1
    from community_subgroups s
    join memberships m on m.community_id = s.community_id
    where s.id = p_subgroup_id
      and m.user_id = p_user_id
      and m.status = 'active'
      and (
        m.role = 'admin'
        or exists (
          select 1 from community_subgroup_managers mg
          where mg.subgroup_id = s.id and mg.user_id = p_user_id
        )
      )
  );
$$;

revoke execute on function public.subgroup_access_admits(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.subgroup_manage_admits(uuid, uuid) from public, anon, authenticated;

create or replace function public.can_access_subgroup(p_subgroup_id uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select subgroup_access_admits(auth.uid(), p_subgroup_id);
$$;

create or replace function public.can_manage_subgroup(p_subgroup_id uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select subgroup_manage_admits(auth.uid(), p_subgroup_id);
$$;

revoke execute on function public.can_access_subgroup(uuid) from public, anon;
revoke execute on function public.can_manage_subgroup(uuid) from public, anon;
grant execute on function public.can_access_subgroup(uuid) to authenticated;
grant execute on function public.can_manage_subgroup(uuid) to authenticated;

-- ── Subgroup tables: reading ────────────────────────────────────────────
--
-- Not discoverable: a subgroup's row is visible only to people who may read
-- its content or manage it. The member list is visible to its managers, and
-- each person sees their own row — enough for the sidebar to know which
-- groups are "mine" without listing anyone else.

alter table public.community_subgroups enable row level security;
alter table public.community_subgroup_members enable row level security;
alter table public.community_subgroup_managers enable row level security;

drop policy if exists community_subgroups_select on public.community_subgroups;
create policy community_subgroups_select on public.community_subgroups
  for select to authenticated
  using (can_access_subgroup(id) or can_manage_subgroup(id));

drop policy if exists community_subgroup_members_select on public.community_subgroup_members;
create policy community_subgroup_members_select on public.community_subgroup_members
  for select to authenticated
  using (user_id = auth.uid() or can_manage_subgroup(subgroup_id));

drop policy if exists community_subgroup_managers_select on public.community_subgroup_managers;
create policy community_subgroup_managers_select on public.community_subgroup_managers
  for select to authenticated
  using (user_id = auth.uid() or can_manage_subgroup(subgroup_id));

-- Every write goes through the functions below.
revoke insert, update, delete, truncate on public.community_subgroups from anon, authenticated;
revoke insert, update, delete, truncate on public.community_subgroup_members from anon, authenticated;
revoke insert, update, delete, truncate on public.community_subgroup_managers from anon, authenticated;
revoke all on public.community_subgroups from anon;
revoke all on public.community_subgroup_members from anon;
revoke all on public.community_subgroup_managers from anon;

-- ── The content scope rule ──────────────────────────────────────────────
--
-- Each scope column is an independent filter, so a row with both set (which
-- the constraints below forbid) would need to satisfy both rather than either.
create or replace function public.content_scope_admits(
  p_user_id uuid,
  p_community_id text,
  p_local_group_id uuid,
  p_subgroup_id uuid
)
returns boolean language sql security definer stable set search_path = public as $$
  select p_user_id is not null and exists (
    select 1
    from memberships m
    where m.user_id = p_user_id
      and m.community_id = p_community_id
      and m.status = 'active'
      and (
        p_local_group_id is null
        or m.local_group_id = p_local_group_id
        or m.role = 'admin'
      )
      and (
        p_subgroup_id is null
        or m.role in ('admin', 'moderator')
        or exists (
          select 1 from community_subgroup_members sm
          where sm.subgroup_id = p_subgroup_id
            and sm.community_id = p_community_id
            and sm.user_id = p_user_id
        )
      )
  );
$$;

revoke execute on function public.content_scope_admits(uuid, text, uuid, uuid) from public, anon, authenticated;

comment on function public.content_scope_admits(uuid, text, uuid, uuid) is
  'Whether a user may read content in this community/lokallag/subgroup scope. Community-wide: active members. Lokallag: members of exactly that group, and the community''s admins. Subgroup: its explicit members, and the community''s moderators and admins. Internal; takes a user id.';

create or replace function public.can_read_content_scope(
  p_community_id text,
  p_local_group_id uuid,
  p_subgroup_id uuid
)
returns boolean language sql security definer stable set search_path = public as $$
  select content_scope_admits(auth.uid(), p_community_id, p_local_group_id, p_subgroup_id);
$$;

revoke execute on function public.can_read_content_scope(text, uuid, uuid) from public, anon;
grant execute on function public.can_read_content_scope(text, uuid, uuid) to authenticated;

-- ── Scope columns ───────────────────────────────────────────────────────

alter table public.channels add column if not exists subgroup_id uuid;
alter table public.posts add column if not exists subgroup_id uuid;
alter table public.events add column if not exists subgroup_id uuid;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'channels_subgroup_fkey') then
    alter table public.channels
      add constraint channels_subgroup_fkey foreign key (subgroup_id, community_id)
        references public.community_subgroups (id, community_id),
      add constraint channels_single_scope check (local_group_id is null or subgroup_id is null);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'posts_subgroup_fkey') then
    alter table public.posts
      add constraint posts_subgroup_fkey foreign key (subgroup_id, community_id)
        references public.community_subgroups (id, community_id) on delete restrict,
      add constraint posts_single_scope check (local_group_id is null or subgroup_id is null);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'events_subgroup_fkey') then
    alter table public.events
      add constraint events_subgroup_fkey foreign key (subgroup_id, community_id)
        references public.community_subgroups (id, community_id) on delete restrict,
      add constraint events_single_scope check (local_group_id is null or subgroup_id is null),
      -- The public portal lists is_public events to anyone holding its link. A
      -- scoped event is private by definition, so it can never be public.
      add constraint events_scoped_not_public check (not is_public or (local_group_id is null and subgroup_id is null));
  end if;
end $$;

create index if not exists posts_subgroup_idx on public.posts (subgroup_id) where subgroup_id is not null;
create index if not exists events_subgroup_idx on public.events (subgroup_id) where subgroup_id is not null;

-- New scoped content needs an active subgroup, as new lokallag content needs an
-- active lokallag (ensure_active_content_local_group). Existing content keeps
-- its scope when a subgroup is retired.
create or replace function public.ensure_active_content_subgroup()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.subgroup_id is null then
    return new;
  end if;

  if not exists (
    select 1 from community_subgroups s
    where s.id = new.subgroup_id and s.community_id = new.community_id and s.active
  ) then
    raise exception 'Gruppen finnes ikke, hører til et annet fellesskap eller er avviklet'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists posts_subgroup_active on public.posts;
create trigger posts_subgroup_active
  before insert or update of subgroup_id on public.posts
  for each row execute function public.ensure_active_content_subgroup();

drop trigger if exists events_subgroup_active on public.events;
create trigger events_subgroup_active
  before insert or update of subgroup_id on public.events
  for each row execute function public.ensure_active_content_subgroup();

-- ── Channels ────────────────────────────────────────────────────────────

insert into public.channel_groups (id, label, position)
values (
  'grupper',
  'Mine grupper',
  coalesce((select max(position) + 1 from public.channel_groups where id <> 'grupper'), 0)
)
on conflict (id) do nothing;

create unique index if not exists channels_subgroup_key
  on public.channels (subgroup_id) where subgroup_id is not null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'channels_subgroup_section') then
    alter table public.channels
      add constraint channels_subgroup_section
        check ((subgroup_id is not null) = (group_id = 'grupper'));
  end if;
end $$;

comment on column public.channels.subgroup_id is
  'Set for a subgroup chat channel: readable by the subgroup''s explicit members and the community''s moderators and admins. Never set together with local_group_id. One channel per subgroup; name follows the subgroup.';

comment on column public.channels.local_group_id is
  'Set for a lokallag chat channel: readable by members of exactly that local group and the community''s admins. Null means a community-wide (or subgroup) channel. One channel per group; name follows the group.';

drop policy if exists channels_select on public.channels;
create policy channels_select on public.channels for select to authenticated
using (can_read_content_scope(community_id, local_group_id, subgroup_id));

comment on policy channels_select on public.channels is
  'Scope rule from content_scope_admits(). A channel the caller cannot read does not exist for them: no name, purpose or id.';

-- Same signature: messages_select, messages_insert and the restrictive
-- messages_channel_access policy all follow the channel's scope unchanged.
create or replace function public.can_read_channel(chid text)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1
    from channels c
    where c.id = chid
      and content_scope_admits(auth.uid(), c.community_id, c.local_group_id, c.subgroup_id)
  );
$$;

revoke execute on function public.can_read_channel(text) from public, anon;
grant execute on function public.can_read_channel(text) to authenticated;

-- One chat channel per active subgroup, created and renamed with it, exactly
-- like ensure_local_group_channel(). Id `<community>--gruppe-<slug>`.
create or replace function public.ensure_subgroup_channel(p_subgroup_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_subgroup community_subgroups%rowtype;
  v_id text;
begin
  select * into v_subgroup from community_subgroups s where s.id = p_subgroup_id;
  if not found then
    return null;
  end if;

  select c.id into v_id from channels c where c.subgroup_id = v_subgroup.id;
  if v_id is not null or not v_subgroup.active then
    return v_id;
  end if;

  insert into channel_groups (id, label, position)
  values ('grupper', 'Mine grupper', coalesce((select max(position) + 1 from channel_groups), 0))
  on conflict (id) do nothing;

  insert into channels (id, community_id, group_id, subgroup_id, name, purpose, read_only, position)
  values (
    v_subgroup.community_id || '--gruppe-' || v_subgroup.slug,
    v_subgroup.community_id,
    'grupper',
    v_subgroup.id,
    local_group_channel_name(v_subgroup.name),
    'Samtaler i gruppen. Bare gruppens medlemmer og fellesskapets moderatorer og administratorer kan se og skrive her.',
    false,
    2000
  )
  on conflict (subgroup_id) where subgroup_id is not null do nothing;

  select c.id into v_id from channels c where c.subgroup_id = v_subgroup.id;
  return v_id;
end;
$$;

revoke execute on function public.ensure_subgroup_channel(uuid) from public, anon, authenticated;

create or replace function public.subgroup_channel_sync()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' or (new.active and not old.active) then
    perform ensure_subgroup_channel(new.id);
  end if;

  if tg_op = 'UPDATE' and new.name is distinct from old.name then
    update channels c
       set name = local_group_channel_name(new.name)
     where c.subgroup_id = new.id;
  end if;

  return null;
end;
$$;

revoke execute on function public.subgroup_channel_sync() from public, anon, authenticated;

drop trigger if exists community_subgroups_channel on public.community_subgroups;
create trigger community_subgroups_channel
  after insert or update of name, active on public.community_subgroups
  for each row execute function public.subgroup_channel_sync();

-- Admin channel editing stays limited to community-wide channels: both kinds
-- of private channel take their name from their group.
create or replace function public.set_channel_details(
  p_community_id text,
  p_channel_id text,
  p_name text,
  p_purpose text
)
returns table (name text, purpose text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text := btrim(coalesce(p_name, ''));
  v_purpose text := btrim(coalesce(p_purpose, ''));
begin
  if auth.uid() is null or not public.is_admin(p_community_id) then
    return;
  end if;

  if length(v_name) not between 1 and 40 or v_name ~ '[[:cntrl:]]' then
    return;
  end if;

  if length(v_purpose) > 200 or v_purpose ~ '[[:cntrl:]]' then
    return;
  end if;

  return query
    update public.channels c
       set name = v_name, purpose = v_purpose
     where c.id = p_channel_id
       and c.community_id = p_community_id
       and c.local_group_id is null
       and c.subgroup_id is null
    returning c.name, c.purpose;
end;
$$;

comment on function public.set_channel_details(text, text, text, text) is
  'Admin-only. Sets name and purpose of one community-wide channel of the given community and returns the stored values; returns no row when the caller is not an active admin of that community, the channel is not in it, the channel is a lokallag or subgroup channel, or the input is invalid.';

revoke execute on function public.set_channel_details(text, text, text, text) from public, anon;
grant execute on function public.set_channel_details(text, text, text, text) to authenticated;

-- ── Posts ───────────────────────────────────────────────────────────────

drop policy if exists posts_select on public.posts;
create policy posts_select on public.posts for select to authenticated
using (can_read_content_scope(community_id, local_group_id, subgroup_id));

comment on policy posts_select on public.posts is
  'Scope rule from content_scope_admits(): community-wide posts for active members; lokallag posts for that group and admins; subgroup posts for its members, moderators and admins.';

-- Publishing stays staff-only (can_moderate), and staff may only publish into a
-- scope they can read themselves: an admin anywhere, a moderator into
-- community-wide, their own lokallag, or a subgroup.
drop policy if exists posts_insert on public.posts;
create policy posts_insert on public.posts for insert to authenticated
with check (
  author_id = auth.uid()
  and can_moderate(community_id)
  and can_read_content_scope(community_id, local_group_id, subgroup_id)
);

-- Comments and reactions: every policy calls this, so they follow the post.
create or replace function public.can_access_post(pid uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1
    from posts p
    where p.id = pid
      and content_scope_admits(auth.uid(), p.community_id, p.local_group_id, p.subgroup_id)
  );
$$;

-- Pinning was gated on moderating the community only, which would let a
-- moderator pin a post in a scope they cannot read. Now both.
create or replace function public.set_post_pinned(p_post_id uuid, p_pinned boolean)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  v_community_id text;
begin
  if p_post_id is null or p_pinned is null then
    return null;
  end if;

  select community_id into v_community_id from posts where id = p_post_id;
  if v_community_id is null then
    return null;
  end if;

  if not can_moderate(v_community_id) or not can_access_post(p_post_id) then
    return null;
  end if;

  update posts set pinned = p_pinned where id = p_post_id;

  return p_pinned;
end;
$$;

-- Recreated from 20260916140000 with one addition: subgroup scope is frozen
-- like lokallag scope.
create or replace function public.posts_guard_immutable()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.community_id is distinct from old.community_id then
    raise exception 'Et innlegg kan ikke flyttes til et annet fellesskap'
      using errcode = 'check_violation';
  end if;
  if new.author_id is distinct from old.author_id then
    raise exception 'Forfatteren av et innlegg kan ikke endres'
      using errcode = 'check_violation';
  end if;
  if new.created_at is distinct from old.created_at then
    raise exception 'Tidspunktet for et innlegg kan ikke endres'
      using errcode = 'check_violation';
  end if;
  if new.local_group_id is distinct from old.local_group_id then
    raise exception 'Lokallagstilknytningen til et innlegg kan ikke endres'
      using errcode = 'check_violation';
  end if;
  if new.subgroup_id is distinct from old.subgroup_id then
    raise exception 'Gruppetilknytningen til et innlegg kan ikke endres'
      using errcode = 'check_violation';
  end if;
  -- Aggregates: only a nested trigger may change these.
  if (new.comment_count is distinct from old.comment_count
      or new.reactions is distinct from old.reactions)
     and pg_trigger_depth() < 2 then
    raise exception 'Kommentarer og reaksjoner har sin egen skrivevei'
      using errcode = 'check_violation';
  end if;

  if new.pinned is distinct from old.pinned
     and coalesce(auth.role(), '') <> 'service_role'
     and not can_moderate(old.community_id) then
    raise exception 'Bare moderatorer og administratorer kan feste innlegg'
      using errcode = 'insufficient_privilege';
  end if;

  if new.body is distinct from old.body or new.title is distinct from old.title then
    new.edited_at := now();
  end if;

  return new;
end $$;

-- Announcement fan-out: recipients are exactly the people who can read it.
create or replace function public.notify_announcement()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.kind <> 'announcement' then
    return new;
  end if;

  if coalesce(auth.role(), '') = 'service_role' then
    return new;
  end if;

  if not can_moderate(new.community_id) then
    raise exception 'Bare moderatorer og administratorer kan publisere kunngjøringer'
      using errcode = 'insufficient_privilege';
  end if;

  -- post_id ties each row to the post, so it stays readable only while its
  -- recipient can read the post (notifications_select, below).
  insert into notifications (user_id, kind, community_id, title, body, href, post_id)
  select
    m.user_id,
    'announcement',
    new.community_id,
    'Ny kunngjøring: ' || coalesce(nullif(btrim(new.title), ''), left(btrim(new.body), 80)),
    coalesce(author.display_name, 'Et medlem') || ' publiserte en kunngjøring i ' || c.name,
    '/community/' || new.community_id || '/feed',
    new.id
  from memberships m
  join communities c on c.id = new.community_id
  left join community_profiles author
    on author.community_id = new.community_id and author.user_id = new.author_id
  where m.community_id = new.community_id
    and m.status = 'active'
    and m.user_id <> new.author_id
    and content_scope_admits(m.user_id, new.community_id, new.local_group_id, new.subgroup_id);

  return new;
end $$;

revoke execute on function public.notify_announcement() from public, anon, authenticated;

comment on column public.posts.local_group_id is
  'Optional lokallag scope. Readable by members of exactly that group and the community''s admins (posts_select). Never set together with subgroup_id.';
comment on column public.posts.subgroup_id is
  'Optional subgroup scope. Readable by the subgroup''s members and the community''s moderators and admins (posts_select). Never set together with local_group_id.';

-- ── Events ──────────────────────────────────────────────────────────────

create or replace function public.can_read_event(p_event_id uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1
    from events e
    where e.id = p_event_id
      and content_scope_admits(auth.uid(), e.community_id, e.local_group_id, e.subgroup_id)
  );
$$;

revoke execute on function public.can_read_event(uuid) from public, anon;
grant execute on function public.can_read_event(uuid) to authenticated;

drop policy if exists events_select on public.events;
create policy events_select on public.events for select to authenticated
using (can_read_content_scope(community_id, local_group_id, subgroup_id));

comment on policy events_select on public.events is
  'Scope rule from content_scope_admits(): community-wide events for active members; lokallag events for that group and admins; subgroup events for its members, moderators and admins.';

-- Unchanged apart from the scope clause: events are created by admins, who can
-- read every scope, so this only matters if that ever widens.
drop policy if exists events_insert on public.events;
create policy events_insert on public.events for insert to authenticated
with check (
  host_id = auth.uid()
  and is_admin(community_id)
  and can_read_content_scope(community_id, local_group_id, subgroup_id)
  and btrim(title) <> ''
  and btrim(location) <> ''
  and length(title) <= 120
  and length(location) <= 120
  and length(description) <= 4000
  and ends_at > starts_at
);

-- Attendance follows the event: who is going is visible only to people who can
-- read the event, and only they can sign up. The previous single FOR ALL
-- policy also let anyone read their own RSVP rows regardless of the event.
drop policy if exists event_attendees_select on public.event_attendees;
drop policy if exists event_attendees_write on public.event_attendees;
drop policy if exists event_attendees_insert on public.event_attendees;
drop policy if exists event_attendees_delete on public.event_attendees;

-- event_attendees_select is created below with the RSVP rules (it also needs
-- rsvp_is_current()).

create policy event_attendees_insert on public.event_attendees for insert to authenticated
with check (user_id = auth.uid() and can_read_event(event_id));

create policy event_attendees_delete on public.event_attendees for delete to authenticated
using (user_id = auth.uid() and can_read_event(event_id));

-- Belt and braces next to events_scoped_not_public.
create or replace function public.portal_events(p_slug text)
returns table (id uuid, title text, description text, starts_at timestamptz, ends_at timestamptz, location text)
language sql stable security definer set search_path = public as $$
  select e.id, e.title, e.description, e.starts_at, e.ends_at, e.location
  from events e
  join communities c on c.id = e.community_id
  where c.slug = p_slug
    and e.is_public
    and e.local_group_id is null
    and e.subgroup_id is null
    and e.ends_at >= now()
  order by e.starts_at;
$$;

revoke execute on function public.portal_events(text) from public;
grant execute on function public.portal_events(text) to anon, authenticated;

comment on column public.events.local_group_id is
  'Optional lokallag audience. Readable by members of exactly that group and the community''s admins (events_select). Never public; never set together with subgroup_id.';
comment on column public.events.subgroup_id is
  'Optional subgroup audience. Readable by the subgroup''s members and the community''s moderators and admins (events_select). Never public; never set together with local_group_id.';

-- ── RSVPs follow current access ─────────────────────────────────────────
--
-- An RSVP is kept when its owner loses access to the event (removed from a
-- team, moved to another lokallag, membership no longer active): it is
-- attendance history, and deleting it would be guessing. But it stops being a
-- *current* RSVP. A non-current RSVP is not shown to anyone and does not take a
-- seat, so people who still have access are not refused because of someone
-- who can no longer come. If access returns, the row counts again exactly as
-- it was — the trigger below governs new sign-ups, so a restored RSVP can
-- leave an event temporarily above its capacity.
--
-- Internal: takes a user id.
create or replace function public.rsvp_is_current(p_event_id uuid, p_user_id uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from events e
    where e.id = p_event_id
      and content_scope_admits(p_user_id, e.community_id, e.local_group_id, e.subgroup_id)
  );
$$;

revoke execute on function public.rsvp_is_current(uuid, uuid) from public, anon, authenticated;

create or replace function public.enforce_event_capacity()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_capacity int;
  v_taken int;
begin
  -- Locks the event row, so two people taking the last seat at the same moment
  -- are serialised even though they insert different attendee rows.
  select capacity into v_capacity from events where id = new.event_id for update;

  if v_capacity is null then
    return new;
  end if;

  select count(*) into v_taken
  from event_attendees a
  where a.event_id = new.event_id
    and rsvp_is_current(a.event_id, a.user_id);

  if v_taken >= v_capacity then
    raise exception 'event_full' using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

revoke execute on function public.enforce_event_capacity() from public, anon, authenticated;

-- What the policy calls. rsvp_is_current() takes any user id, so it is not
-- granted to API roles; this wrapper answers only for an event the caller can
-- read and only about an RSVP that exists, so it cannot be used to probe
-- whether some other person has access to an event.
create or replace function public.can_see_rsvp(p_event_id uuid, p_attendee_id uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select can_read_event(p_event_id)
    and exists (
      select 1 from event_attendees a
      where a.event_id = p_event_id and a.user_id = p_attendee_id
    )
    and rsvp_is_current(p_event_id, p_attendee_id);
$$;

revoke execute on function public.can_see_rsvp(uuid, uuid) from public, anon;
grant execute on function public.can_see_rsvp(uuid, uuid) to authenticated;

drop policy if exists event_attendees_select on public.event_attendees;
create policy event_attendees_select on public.event_attendees for select to authenticated
using (can_see_rsvp(event_id, user_id));

-- ── Notifications follow current access ─────────────────────────────────
--
-- An announcement notification carries its post's title in plain text. It is
-- stored for its recipient at the moment of publishing, so without a link back
-- to the post a member removed from a team (or moved out of a lokallag) could
-- keep reading the private title. Announcement notifications now record their
-- post, and a notification tied to a post is readable only while its recipient
-- can read that post. Everything else about the row is unchanged.
--
-- Hiding rather than deleting: access can come back (re-added to the team,
-- back in the lokallag), and a removal should not destroy the recipient's
-- history. Notifications without a post (DMs, invitations, access requests,
-- fixtures) are unaffected. A notification whose post is deleted goes with it,
-- since there is nothing left for it to point at.
alter table public.notifications
  add column if not exists post_id uuid references public.posts (id) on delete cascade;

create index if not exists notifications_post_idx on public.notifications (post_id) where post_id is not null;

comment on column public.notifications.post_id is
  'The post an announcement notification is about. When set, the notification is readable only while its recipient can read that post (notifications_select).';

drop policy if exists notifications_select on public.notifications;
create policy notifications_select on public.notifications for select to authenticated
using (user_id = auth.uid() and (post_id is null or can_access_post(post_id)));

-- Recreated from 20260916160000 with post_id added to the frozen columns: a
-- recipient who could clear it would make a revoked notification readable.
create or replace function public.notifications_guard_immutable()
returns trigger language plpgsql set search_path = public as $$
begin
  if coalesce(auth.role(), '') = 'service_role' then
    return new;
  end if;

  if new.id is distinct from old.id
     or new.user_id is distinct from old.user_id
     or new.kind is distinct from old.kind
     or new.community_id is distinct from old.community_id
     or new.title is distinct from old.title
     or new.body is distinct from old.body
     or new.href is distinct from old.href
     or new.created_at is distinct from old.created_at
     or new.post_id is distinct from old.post_id then
    raise exception 'Et varsel kan bare markeres som lest eller ulest'
      using errcode = 'insufficient_privilege';
  end if;

  return new;
end $$;

-- ── Profile visibility derived from content ─────────────────────────────
--
-- Authorship and hosting count only for content the caller can read.
create or replace function public.can_view_community_profile(p_community_id text, p_user_id uuid)
returns boolean language sql security definer stable set search_path = public as $$
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
              and m.status = 'active'
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
            and content_scope_admits(auth.uid(), ch.community_id, ch.local_group_id, ch.subgroup_id)
        )
        or exists (
          select 1 from events e
          where e.community_id = p_community_id and e.host_id = p_user_id
            and content_scope_admits(auth.uid(), e.community_id, e.local_group_id, e.subgroup_id)
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
$$;

revoke execute on function public.can_view_community_profile(text, uuid) from public, anon;
grant execute on function public.can_view_community_profile(text, uuid) to authenticated;

create or replace function public.shares_visible_authorship(other uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from posts p
    where p.author_id = other
      and content_scope_admits(auth.uid(), p.community_id, p.local_group_id, p.subgroup_id)
  ) or exists (
    select 1 from comments cm
    join posts p on p.id = cm.post_id
    where cm.author_id = other
      and content_scope_admits(auth.uid(), p.community_id, p.local_group_id, p.subgroup_id)
  ) or exists (
    select 1 from messages msg
    join channels ch on ch.id = msg.channel_id
    where msg.author_id = other
      and content_scope_admits(auth.uid(), ch.community_id, ch.local_group_id, ch.subgroup_id)
  ) or exists (
    select 1 from events e
    where e.host_id = other
      and content_scope_admits(auth.uid(), e.community_id, e.local_group_id, e.subgroup_id)
  );
$$;

revoke execute on function public.shares_visible_authorship(uuid) from public, anon;
grant execute on function public.shares_visible_authorship(uuid) to authenticated;

-- ── Managing subgroup membership ────────────────────────────────────────
--
-- The acting person is always auth.uid(). Adding never touches the target's
-- community role, lokallag or membership; removing deletes the subgroup row
-- and nothing else, so authored content stays where it is.

create or replace function public.add_subgroup_member(p_subgroup_id uuid, p_user_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  v_community text;
  v_added boolean;
begin
  select s.community_id into v_community
  from community_subgroups s
  where s.id = p_subgroup_id and s.active;

  if v_community is null or not can_manage_subgroup(p_subgroup_id) then
    return false;
  end if;

  if not exists (
    select 1 from memberships m
    where m.user_id = p_user_id and m.community_id = v_community and m.status = 'active'
  ) then
    return false;
  end if;

  insert into community_subgroup_members (subgroup_id, community_id, user_id, added_by)
  values (p_subgroup_id, v_community, p_user_id, auth.uid())
  on conflict (subgroup_id, user_id) do nothing
  returning true into v_added;

  -- Already a member: refused rather than reported as a change.
  return coalesce(v_added, false);
end;
$$;

create or replace function public.remove_subgroup_member(p_subgroup_id uuid, p_user_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  v_removed uuid;
begin
  if not can_manage_subgroup(p_subgroup_id) then
    return false;
  end if;

  delete from community_subgroup_members sm
   where sm.subgroup_id = p_subgroup_id and sm.user_id = p_user_id
  returning sm.user_id into v_removed;

  return v_removed is not null;
end;
$$;

-- The roster and the member search name people, so they answer only for
-- someone who may manage the subgroup — the same people who can add and remove.
-- A moderator manager would otherwise see no names under an admin-only member
-- directory, so both are deliberately narrow:
--
--   * a person appears only as their display name in this community — never
--     their account name, email, handle, avatar or anything from the registry;
--   * community roles are returned only to the community's admins, who see
--     them in member administration anyway. An explicit manager who is not an
--     admin gets null: managing a team needs no one's role;
--   * nobody gets the whole community roster. Adding someone means searching
--     for them: at least two characters, at most ten matches, active members of
--     this community who are not already in the team.
create or replace function public.subgroup_roster(p_subgroup_id uuid)
returns table (user_id uuid, display_name text, role community_role, is_manager boolean, added_at timestamptz)
language sql stable security definer set search_path = public as $$
  select
    sm.user_id,
    coalesce(cp.display_name, 'Medlem'),
    case when is_admin(sm.community_id) then m.role end,
    exists (
      select 1 from community_subgroup_managers mg
      where mg.subgroup_id = sm.subgroup_id and mg.user_id = sm.user_id
    ),
    sm.created_at
  from community_subgroup_members sm
  join memberships m on m.user_id = sm.user_id and m.community_id = sm.community_id
  left join community_profiles cp on cp.community_id = sm.community_id and cp.user_id = sm.user_id
  where sm.subgroup_id = p_subgroup_id
    and can_manage_subgroup(p_subgroup_id)
  order by lower(coalesce(cp.display_name, 'Medlem'));
$$;

-- Replaced by search_subgroup_candidates(): it listed every active member.
drop function if exists public.subgroup_member_candidates(uuid);

create or replace function public.search_subgroup_candidates(p_subgroup_id uuid, p_query text)
returns table (user_id uuid, display_name text)
language sql stable security definer set search_path = public as $$
  with q as (
    select btrim(coalesce(p_query, '')) as term
  )
  select m.user_id, cp.display_name
  from q,
       community_subgroups s
  join memberships m on m.community_id = s.community_id and m.status = 'active'
  join community_profiles cp on cp.community_id = s.community_id and cp.user_id = m.user_id
  where s.id = p_subgroup_id
    and s.active
    and length(q.term) between 2 and 80
    and can_manage_subgroup(p_subgroup_id)
    and cp.display_name ilike
      '%' || replace(replace(replace(q.term, '\', '\\'), '%', '\%'), '_', '\_') || '%'
    and not exists (
      select 1 from community_subgroup_members sm
      where sm.subgroup_id = s.id and sm.user_id = m.user_id
    )
  order by lower(cp.display_name)
  limit 10;
$$;

revoke execute on function public.add_subgroup_member(uuid, uuid) from public, anon;
revoke execute on function public.remove_subgroup_member(uuid, uuid) from public, anon;
revoke execute on function public.subgroup_roster(uuid) from public, anon;
revoke execute on function public.search_subgroup_candidates(uuid, text) from public, anon;
grant execute on function public.add_subgroup_member(uuid, uuid) to authenticated;
grant execute on function public.remove_subgroup_member(uuid, uuid) to authenticated;
grant execute on function public.subgroup_roster(uuid) to authenticated;
grant execute on function public.search_subgroup_candidates(uuid, text) to authenticated;

-- ── Lokallag channel description ────────────────────────────────────────
--
-- The description written by 20261001100000 said only the group's members can
-- read the chat, which stops being true with the admin override. Recreated
-- with the accurate sentence; existing channels still holding the old default
-- are updated (their purpose cannot be edited by anyone, so nothing custom is
-- overwritten). Ids, names and messages are untouched.
create or replace function public.ensure_local_group_channel(p_local_group_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_group community_local_groups%rowtype;
  v_id text;
begin
  select * into v_group from community_local_groups g where g.id = p_local_group_id;
  if not found then
    return null;
  end if;

  select c.id into v_id from channels c where c.local_group_id = v_group.id;
  if v_id is not null or not v_group.active then
    return v_id;
  end if;

  insert into channel_groups (id, label, position)
  values ('lokallag', 'Mitt lokallag', coalesce((select max(position) + 1 from channel_groups), 0))
  on conflict (id) do nothing;

  insert into channels (id, community_id, group_id, local_group_id, name, purpose, read_only, position)
  values (
    v_group.community_id || '--lokallag-' || v_group.slug,
    v_group.community_id,
    'lokallag',
    v_group.id,
    local_group_channel_name(v_group.name),
    'Samtaler i lokallaget. Bare medlemmer av lokallaget og fellesskapets administratorer kan se og skrive her.',
    false,
    1000 + v_group.sort_order
  )
  on conflict (local_group_id) where local_group_id is not null do nothing;

  select c.id into v_id from channels c where c.local_group_id = v_group.id;
  return v_id;
end;
$$;

revoke execute on function public.ensure_local_group_channel(uuid) from public, anon, authenticated;

update public.channels
   set purpose = 'Samtaler i lokallaget. Bare medlemmer av lokallaget og fellesskapets administratorer kan se og skrive her.'
 where local_group_id is not null
   and purpose = 'Samtaler i lokallaget. Bare medlemmer av lokallaget kan se og skrive her.';

-- ── Retire the per-surface scope helpers ────────────────────────────────
--
-- Everything that called them now calls content_scope_admits() /
-- can_read_content_scope(). Dropping them keeps a second copy of the rule from
-- lingering where a future policy might pick it up.
drop function if exists public.can_read_post_scope(text, uuid);
drop function if exists public.post_scope_admits(uuid, text, uuid);
drop function if exists public.can_read_channel_scope(text, uuid);
drop function if exists public.channel_scope_admits(uuid, text, uuid);

-- ── Safe-Space frivillige ───────────────────────────────────────────────
--
-- The subgroup itself, keyed on community id and slug — no display-name
-- matching. Only where that community exists, and only once. Its channel
-- follows from the trigger. Members and managers are people, not schema, and
-- are assigned by an administrator (or the demo seed), never here.
insert into public.community_subgroups (community_id, slug, name, description)
select
  'tryggere-ruspolitikk',
  'safe-space-frivillige',
  'Safe-Space frivillige',
  'Frivillige i Safe-Space-arbeidet.'
where exists (select 1 from public.communities where id = 'tryggere-ruspolitikk')
on conflict (community_id, slug) do nothing;
