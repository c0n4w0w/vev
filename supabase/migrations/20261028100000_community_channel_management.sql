-- Community channels and channel sections, managed by each community's own
-- administrators.
--
-- Until now every community was handed the same six channels under the same
-- two headings. The headings lived in `channel_groups`, one table shared by
-- every community ("Channel groups are just labels shared by every community",
-- 20260906120000), so a section could not be renamed, added or removed for one
-- organisation without doing it for all of them, and the channels themselves
-- were created by the seed and the production bootstrap. This migration makes
-- the community-wide channels and their sections the community's own:
--
--   * Sections become per-community rows in `channel_sections`.
--   * A community-wide channel may sit in one of its community's sections, or
--     in none: `channels.section_id` is nullable, and a community may have no
--     sections and no channels at all. No placeholder section is ever created.
--   * Creating, renaming, describing, moving, ordering, archiving, restoring
--     and permanently deleting a channel, and creating, renaming, ordering
--     and deleting a section, go through the functions below. Each one decides
--     from auth.uid() that the caller is an active administrator of the
--     community the row belongs to. Nothing else may: not moderators, not
--     lokallagsledere, not members, not another community's administrators.
--
-- What does not change:
--
--   * `channel_groups` keeps its two platform headings, `lokallag` ("Mitt
--     lokallag") and `grupper` ("Mine grupper"). Lokallag chats, private
--     lokallag channels and group chats are filed under them exactly as
--     before, and are not reachable through anything here.
--   * Who may read and write a channel. channels_select, messages_select,
--     messages_insert, messages_channel_access and messages_not_archived are
--     untouched. An archived community-wide channel is refused new messages by
--     the existing restrictive messages_not_archived policy, which already
--     reads `archived_at` for every kind of channel.
--   * `channels.id` is still the stable key: the route, every message and the
--     sidebar link use it. A rename or a move never changes it.
--   * There is still no INSERT, UPDATE or DELETE policy or grant on `channels`
--     for any API role, and none is added on `channel_sections`. The functions
--     are the only way a signed-in person changes either.
--
-- ── Existing channels ────────────────────────────────────────────────────
--
-- Nothing is deleted. Every community-wide channel that exists keeps its id,
-- name, description, messages and order. The platform heading it was filed
-- under becomes a section of its own community with the same name and place
-- ("Generelt", "Prosjekter" on a seeded stack), and the shared heading row is
-- removed once nothing points at it. On a database with no community-wide
-- channel — a fresh installation — no section is created at all.
--
-- ── Identifiers ─────────────────────────────────────────────────────────
--
-- A new channel's id is `<community>--<slug>`, the slug derived from the name
-- it was created with (æ→a, ø→o, å→a, anything else not a-z0-9 → "-"), with
-- "-2", "-3" … appended while the id is taken. The id namespace is shared with
-- the channels the database creates itself — `--lokallag-<slug>`,
-- `--gruppe-<slug>`, `--privat-<hex>` — so a slug that would start with one of
-- those words gets `kanal-` in front: an administrator's channel can never take
-- the id a future lokallag or group needs. Names are unique per community
-- (case-insensitively) among community-wide channels, and section names among
-- that community's sections.
--
-- A create carries an optional client-generated `creation_key`. The same
-- caller sending the same key again — a double click, a retried request —
-- gets the channel or section the first call created instead of a second one.
--
-- ── Concurrency ─────────────────────────────────────────────────────────
--
-- Every function that creates, moves, orders or deletes takes one
-- transaction-scoped advisory lock per community first, so two administrators
-- reordering, moving into a section that is being deleted, or creating at the
-- same moment are serialised and positions are renumbered on a consistent
-- list. Different communities never wait for each other.

-- ── Sections ────────────────────────────────────────────────────────────

create table public.channel_sections (
  id uuid primary key default gen_random_uuid(),
  community_id text not null references public.communities (id) on delete cascade,
  name text not null,
  position integer not null default 0,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  creation_key uuid,
  constraint channel_sections_name_valid
    check (name = btrim(name) and length(name) between 1 and 40 and name !~ '[[:cntrl:]]'),
  -- Target of the composite key from channels: a channel's section is always
  -- one of its own community's.
  constraint channel_sections_id_community_key unique (id, community_id)
);

create unique index channel_sections_name_key
  on public.channel_sections (community_id, lower(name));
create unique index channel_sections_creation_key
  on public.channel_sections (community_id, creation_key) where creation_key is not null;
create index channel_sections_community_idx
  on public.channel_sections (community_id, position);

comment on table public.channel_sections is
  'A community''s own channel headings, created and arranged by its administrators. A community may have none. Written only by the functions in 20261028100000.';

alter table public.channel_sections enable row level security;

-- The headings are part of the sidebar every member sees; nobody else sees them.
create policy channel_sections_select on public.channel_sections
  for select to authenticated
  using (is_member(community_id));

grant select on public.channel_sections to authenticated;
grant select, insert, update, delete on public.channel_sections to service_role;

-- ── Channels: placement ─────────────────────────────────────────────────

alter table public.channels
  add column if not exists section_id uuid,
  add column if not exists creation_key uuid,
  alter column group_id drop not null;

-- NO ACTION, as for lokallag: deleting a whole community cascades to both its
-- channels and its sections and completes; on its own a section with channels
-- cannot be deleted. delete_channel_section() moves them first, as told.
alter table public.channels
  add constraint channels_section_fkey
    foreign key (section_id, community_id)
    references public.channel_sections (id, community_id);

create index channels_section_idx on public.channels (section_id) where section_id is not null;

comment on column public.channels.section_id is
  'Community-wide channels only: the community''s own section it is listed under, or null for none.';
comment on column public.channels.group_id is
  'Platform heading for channels the database files itself: ''lokallag'' for lokallag chats and private lokallag channels, ''grupper'' for group chats. Null for every community-wide channel.';
comment on column public.channels.position is
  'Order within the channel''s list: its section (or no section) for a community-wide channel, its platform heading otherwise.';

-- Existing community-wide channels: their platform heading becomes a section
-- of their own community, same name and place. Nothing is created where no
-- community-wide channel exists.
insert into public.channel_sections (community_id, name, position)
select distinct c.community_id, g.label, g.position
from public.channels c
join public.channel_groups g on g.id = c.group_id
where c.local_group_id is null and c.subgroup_id is null;

update public.channels c
   set section_id = s.id,
       group_id = null
  from public.channel_groups g, public.channel_sections s
 where g.id = c.group_id
   and s.community_id = c.community_id
   and s.name = g.label
   and c.local_group_id is null
   and c.subgroup_id is null;

-- Positions were one running number across every community; from here they
-- count within one list.
update public.channels c
   set position = r.ord - 1
  from (
    select id, row_number() over (partition by community_id, section_id order by position, id) as ord
    from public.channels
    where local_group_id is null and subgroup_id is null
  ) r
 where c.id = r.id;

update public.channel_sections s
   set position = r.ord - 1
  from (
    select id, row_number() over (partition by community_id order by position, name) as ord
    from public.channel_sections
  ) r
 where s.id = r.id;

-- The shared headings nothing points at any more.
delete from public.channel_groups g
where g.id not in ('lokallag', 'grupper')
  and not exists (select 1 from public.channels c where c.group_id = g.id);

-- The two platform headings keep their order, counted from 0 as on a fresh
-- installation, so every database agrees with the bootstrap's definition.
update public.channel_groups g
   set position = case g.id when 'lokallag' then 0 when 'grupper' then 1 end
 where g.id in ('lokallag', 'grupper');

-- One placement rule replaces the two section checks, and also holds when
-- `group_id` is null (where the old `(…) = (group_id = 'lokallag')` was null,
-- and so passed).
alter table public.channels drop constraint if exists channels_local_group_section;
alter table public.channels drop constraint if exists channels_subgroup_section;
alter table public.channels
  add constraint channels_placement check (
    case
      when local_group_id is not null
        then group_id is not distinct from 'lokallag' and section_id is null
      when subgroup_id is not null
        then group_id is not distinct from 'grupper' and section_id is null
      else group_id is null
    end
  );

-- Community-wide channels may now be archived as well. The main lokallag chat
-- still may not: it follows its lokallag.
alter table public.channels drop constraint if exists channels_archive_scope;
alter table public.channels
  add constraint channels_archive_scope
    check (archived_at is null or is_private or subgroup_id is not null or local_group_id is null);

comment on column public.channels.archived_at is
  'Set while a community-wide channel or a private lokallag channel is archived, or while a group''s chat belongs to an archived group: no new messages, history stays readable to those who have access.';

-- One name per community among its community-wide channels; archived ones
-- keep theirs, so restoring never collides.
create unique index channels_community_name_key
  on public.channels (community_id, lower(name))
  where local_group_id is null and subgroup_id is null;

create unique index channels_creation_key
  on public.channels (community_id, creation_key) where creation_key is not null;

-- A channel's identity and scope are facts, not settings — for every channel
-- and every path, the service role and future functions included. (The
-- private-channel guard from 20261020100000 stays; this one covers the rest.)
create or replace function public.channels_guard_identity()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.id is distinct from old.id
     or new.community_id is distinct from old.community_id
     or new.local_group_id is distinct from old.local_group_id
     or new.subgroup_id is distinct from old.subgroup_id
     or new.is_private is distinct from old.is_private then
    raise exception 'A channel cannot change its id, community or scope'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

revoke all on function public.channels_guard_identity() from public, anon, authenticated, service_role;

drop trigger if exists channels_guard_identity on public.channels;
create trigger channels_guard_identity
  before update on public.channels
  for each row execute function public.channels_guard_identity();

-- ── Internal helpers ────────────────────────────────────────────────────

-- Serialises every layout change within one community.
create or replace function public.lock_channel_layout(p_community_id text)
returns void language sql set search_path = public as $$
  select pg_advisory_xact_lock(hashtextextended('channel-layout:' || p_community_id, 0));
$$;

revoke all on function public.lock_channel_layout(text) from public, anon, authenticated, service_role;

-- A free id for a new community-wide channel. See "Identifiers" above.
create or replace function public.community_channel_id(p_community_id text, p_name text)
returns text language plpgsql stable set search_path = public as $$
declare
  v_slug text := btrim(left(coalesce(local_group_slug(p_name), ''), 40), '-');
  v_base text;
  v_id text;
  v_n integer := 1;
begin
  if v_slug = '' then
    v_slug := 'kanal';
  end if;
  if v_slug ~ '^(lokallag|gruppe|privat)(-|$)' then
    v_slug := 'kanal-' || v_slug;
  end if;

  v_base := p_community_id || '--' || v_slug;
  v_id := v_base;
  while exists (select 1 from channels c where c.id = v_id) loop
    v_n := v_n + 1;
    v_id := v_base || '-' || v_n;
  end loop;
  return v_id;
end;
$$;

revoke all on function public.community_channel_id(text, text) from public, anon, authenticated, service_role;

-- Renumbers one list of community-wide channels: active first, in their
-- current order, archived after.
create or replace function public.renumber_community_channels(p_community_id text, p_section_id uuid)
returns void language sql set search_path = public as $$
  update channels c
     set position = r.ord - 1
    from (
      select c2.id,
             row_number() over (order by c2.archived_at is not null, c2.position, c2.id) as ord
      from channels c2
      where c2.community_id = p_community_id
        and c2.local_group_id is null
        and c2.subgroup_id is null
        and c2.section_id is not distinct from p_section_id
    ) r
   where c.id = r.id and c.position is distinct from r.ord - 1;
$$;

revoke all on function public.renumber_community_channels(text, uuid) from public, anon, authenticated, service_role;

create or replace function public.renumber_channel_sections(p_community_id text)
returns void language sql set search_path = public as $$
  update channel_sections s
     set position = r.ord - 1
    from (
      select s2.id, row_number() over (order by s2.position, s2.created_at, s2.id) as ord
      from channel_sections s2
      where s2.community_id = p_community_id
    ) r
   where s.id = r.id and s.position is distinct from r.ord - 1;
$$;

revoke all on function public.renumber_channel_sections(text) from public, anon, authenticated, service_role;

-- ── Channels: creating ──────────────────────────────────────────────────
--
-- Returns the channel's id, or null when the caller may not create one here,
-- the input is not acceptable or the section is not this community's. One
-- refusal carries a reason, because the caller is authorised and it is their
-- own input: a name already used by a channel of this community.
create or replace function public.create_community_channel(
  p_community_id text,
  p_name text,
  p_purpose text,
  p_section_id uuid,
  p_creation_key uuid
)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_name text := btrim(coalesce(p_name, ''));
  v_purpose text := btrim(coalesce(p_purpose, ''));
  v_id text;
  v_position integer;
begin
  if v_uid is null or not is_admin(p_community_id) then
    return null;
  end if;
  if length(v_name) not between 1 and 40 or v_name ~ '[[:cntrl:]]' then
    return null;
  end if;
  if length(v_purpose) > 200 or v_purpose ~ '[[:cntrl:]]' then
    return null;
  end if;

  perform lock_channel_layout(p_community_id);

  -- The same request again: the channel it already made.
  if p_creation_key is not null then
    select c.id into v_id
    from channels c
    where c.community_id = p_community_id and c.creation_key = p_creation_key;
    if found then
      return case when exists (select 1 from channels c where c.id = v_id and c.created_by = v_uid) then v_id end;
    end if;
  end if;

  if p_section_id is not null and not exists (
    select 1 from channel_sections s where s.id = p_section_id and s.community_id = p_community_id
  ) then
    return null;
  end if;

  if exists (
    select 1 from channels c
    where c.community_id = p_community_id
      and c.local_group_id is null
      and c.subgroup_id is null
      and lower(c.name) = lower(v_name)
  ) then
    raise exception 'channel_name_taken' using errcode = 'unique_violation';
  end if;

  select coalesce(max(c.position) + 1, 0) into v_position
  from channels c
  where c.community_id = p_community_id
    and c.local_group_id is null
    and c.subgroup_id is null
    and c.archived_at is null
    and c.section_id is not distinct from p_section_id;

  v_id := community_channel_id(p_community_id, v_name);

  insert into channels (id, community_id, group_id, section_id, name, purpose, read_only, position, created_by, creation_key)
  values (v_id, p_community_id, null, p_section_id, v_name, v_purpose, false, v_position, v_uid, p_creation_key);

  -- Archived channels in that list move down behind the new one.
  perform renumber_community_channels(p_community_id, p_section_id);
  return v_id;
end;
$$;

-- ── Channels: name and description ──────────────────────────────────────
--
-- Recreated from 20261020100000 with one addition: a community-wide channel's
-- new name must not be another of its community's channels'. Who may edit
-- what is unchanged.
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
  v_channel public.channels%rowtype;
  v_name text := btrim(coalesce(p_name, ''));
  v_purpose text := btrim(coalesce(p_purpose, ''));
begin
  if auth.uid() is null then
    return;
  end if;

  select c.* into v_channel
  from public.channels c
  where c.id = p_channel_id and c.community_id = p_community_id;
  if not found then
    return;
  end if;

  if v_channel.is_private then
    if not public.private_channel_manage_admits(auth.uid(), v_channel.id) then
      return;
    end if;
  elsif not public.is_admin(p_community_id)
     or v_channel.local_group_id is not null
     or v_channel.subgroup_id is not null then
    return;
  end if;

  if length(v_name) not between 1 and 40 or v_name ~ '[[:cntrl:]]' then
    return;
  end if;

  if length(v_purpose) > 200 or v_purpose ~ '[[:cntrl:]]' then
    return;
  end if;

  if v_channel.is_private and exists (
    select 1 from public.channels other
    where other.local_group_id = v_channel.local_group_id
      and other.is_private
      and other.id <> v_channel.id
      and lower(other.name) = lower(v_name)
  ) then
    raise exception 'private_channel_name_taken' using errcode = 'unique_violation';
  end if;

  if v_channel.local_group_id is null and v_channel.subgroup_id is null and exists (
    select 1 from public.channels other
    where other.community_id = v_channel.community_id
      and other.local_group_id is null
      and other.subgroup_id is null
      and other.id <> v_channel.id
      and lower(other.name) = lower(v_name)
  ) then
    raise exception 'channel_name_taken' using errcode = 'unique_violation';
  end if;

  return query
    update public.channels c
       set name = v_name, purpose = v_purpose
     where c.id = v_channel.id
    returning c.name, c.purpose;
end;
$$;

-- ── Channels: section and order ─────────────────────────────────────────
--
-- Puts a community-wide channel into a section of its community (null: no
-- section) at a place in that list, counted among its active channels from 0;
-- null or past the end puts it last. Moving within the same list reorders it.
create or replace function public.move_community_channel(
  p_channel_id text,
  p_section_id uuid,
  p_position integer
)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  v_channel channels%rowtype;
  v_ids text[];
  v_index integer;
begin
  if auth.uid() is null then
    return false;
  end if;

  select * into v_channel
  from channels c
  where c.id = p_channel_id and c.local_group_id is null and c.subgroup_id is null;
  if not found or not is_admin(v_channel.community_id) then
    return false;
  end if;

  perform lock_channel_layout(v_channel.community_id);

  -- Read again under the lock: another move may have just finished.
  select * into v_channel from channels c where c.id = v_channel.id;
  if not found then
    return false;
  end if;

  if p_section_id is not null and not exists (
    select 1 from channel_sections s where s.id = p_section_id and s.community_id = v_channel.community_id
  ) then
    return false;
  end if;

  -- The destination's active channels without this one, in order. Archived
  -- channels are not in navigation and are renumbered behind them.
  v_ids := array(
    select c.id from channels c
    where c.community_id = v_channel.community_id
      and c.local_group_id is null
      and c.subgroup_id is null
      and c.archived_at is null
      and c.section_id is not distinct from p_section_id
      and c.id <> v_channel.id
    order by c.position, c.id
  );
  v_index := least(greatest(coalesce(p_position, cardinality(v_ids)), 0), cardinality(v_ids));
  v_ids := v_ids[1:v_index] || v_channel.id || v_ids[v_index + 1:];

  update channels c
     set section_id = p_section_id,
         position = x.ord - 1
    from unnest(v_ids) with ordinality as x(id, ord)
   where c.id = x.id;

  if v_channel.archived_at is not null then
    -- An archived channel keeps its place behind the active ones.
    update channels c set position = cardinality(v_ids) where c.id = v_channel.id;
  end if;

  perform renumber_community_channels(v_channel.community_id, p_section_id);
  if v_channel.section_id is distinct from p_section_id then
    perform renumber_community_channels(v_channel.community_id, v_channel.section_id);
  end if;
  return true;
end;
$$;

-- ── Channels: archive and restore ───────────────────────────────────────
--
-- Archived: no new messages (messages_not_archived), history readable by
-- everyone who could read it, out of ordinary navigation. Restored: the same
-- channel again, same id and messages, last in its list.
create or replace function public.set_community_channel_archived(p_channel_id text, p_archived boolean)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  v_channel channels%rowtype;
begin
  if auth.uid() is null or p_archived is null then
    return false;
  end if;

  select * into v_channel
  from channels c
  where c.id = p_channel_id and c.local_group_id is null and c.subgroup_id is null;
  if not found or not is_admin(v_channel.community_id) then
    return false;
  end if;

  perform lock_channel_layout(v_channel.community_id);

  update channels c
     set archived_at = case when p_archived then coalesce(c.archived_at, now()) end,
         -- Restoring puts it after the active channels of its list.
         position = case
           when not p_archived and c.archived_at is not null then (
             select coalesce(max(o.position) + 1, 0) from channels o
             where o.community_id = c.community_id
               and o.local_group_id is null and o.subgroup_id is null
               and o.archived_at is null
               and o.section_id is not distinct from c.section_id
           )
           else c.position
         end
   where c.id = v_channel.id;

  perform renumber_community_channels(v_channel.community_id, v_channel.section_id);
  return true;
end;
$$;

-- ── Channels: what deleting would remove ────────────────────────────────

create or replace function public.community_channel_content_counts(p_channel_id text)
returns table (message_count integer, attachment_count integer)
language sql stable security definer set search_path = public as $$
  select
    (select count(*)::integer from messages m where m.channel_id = c.id),
    (select count(*)::integer from message_attachments a where a.channel_id = c.id)
  from channels c
  where c.id = p_channel_id
    and c.local_group_id is null
    and c.subgroup_id is null
    and auth.uid() is not null
    and is_admin(c.community_id);
$$;

-- ── Channels: permanent deletion ────────────────────────────────────────
--
-- Who: an active administrator of the channel's community. What: one
-- community-wide channel — never a lokallag chat, private channel or group
-- chat, which keep their own rules (delete_private_channel, delete_subgroup).
--
-- A channel with messages is deleted only when `p_confirm_name` is its exact
-- current name — the confirmation is part of the request the database checks,
-- not only a dialog, so an accidental or replayed call cannot empty a channel.
-- An empty channel needs no confirmation.
--
-- What goes with it, read off the schema:
--
--   messages              messages.channel_id → channels, ON DELETE CASCADE;
--                         a message's reactions are a column of its row
--   message_attachments   message_attachments.channel_id → channels, CASCADE;
--                         each deleted row queues its stored objects in
--                         message_attachment_purges (20261024100000), and the
--                         server removes them after the response. Community-
--                         wide channels take no attachments today
--                         (message_attachment_policy_for), so this is a
--                         safeguard rather than an expectation.
--   notifications         no key points at a channel; rows addressed to this
--                         channel's page are removed here.
--
-- Nothing else references `channels` for a community-wide channel (participant
-- rows exist only for private ones). Posts, comments and post reactions belong
-- to the community feed, not to a channel, and are not touched; nor is any
-- other channel, section, member or community. One call is one transaction.
create or replace function public.delete_community_channel(p_channel_id text, p_confirm_name text)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  v_channel channels%rowtype;
  v_href text;
  v_deleted text;
begin
  if auth.uid() is null then
    return false;
  end if;

  select * into v_channel
  from channels c
  where c.id = p_channel_id and c.local_group_id is null and c.subgroup_id is null;
  if not found or not is_admin(v_channel.community_id) then
    return false;
  end if;

  perform lock_channel_layout(v_channel.community_id);

  -- Locked: a message being written into it waits (its key check needs this
  -- row), and is then refused, rather than slipping in after the count.
  select * into v_channel from channels c where c.id = v_channel.id for update;
  if not found then
    return false;
  end if;

  if exists (select 1 from messages m where m.channel_id = v_channel.id)
     and btrim(coalesce(p_confirm_name, '')) is distinct from v_channel.name then
    raise exception 'channel_delete_unconfirmed' using errcode = 'check_violation';
  end if;

  v_href := '/community/' || v_channel.community_id || '/channel/' || v_channel.id;
  delete from notifications n
  where n.community_id = v_channel.community_id
    and (
      n.href = v_href
      or starts_with(n.href, v_href || '?')
      or starts_with(n.href, v_href || '#')
      or starts_with(n.href, v_href || '/')
    );

  delete from channels c
  where c.id = v_channel.id and c.local_group_id is null and c.subgroup_id is null
  returning c.id into v_deleted;

  perform renumber_community_channels(v_channel.community_id, v_channel.section_id);
  return v_deleted is not null;
end;
$$;

-- ── Sections ────────────────────────────────────────────────────────────

create or replace function public.create_channel_section(
  p_community_id text,
  p_name text,
  p_creation_key uuid
)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_name text := btrim(coalesce(p_name, ''));
  v_id uuid;
begin
  if v_uid is null or not is_admin(p_community_id) then
    return null;
  end if;
  if length(v_name) not between 1 and 40 or v_name ~ '[[:cntrl:]]' then
    return null;
  end if;

  perform lock_channel_layout(p_community_id);

  if p_creation_key is not null then
    select s.id into v_id
    from channel_sections s
    where s.community_id = p_community_id and s.creation_key = p_creation_key;
    if found then
      return case when exists (select 1 from channel_sections s where s.id = v_id and s.created_by = v_uid) then v_id end;
    end if;
  end if;

  if exists (
    select 1 from channel_sections s
    where s.community_id = p_community_id and lower(s.name) = lower(v_name)
  ) then
    raise exception 'channel_section_name_taken' using errcode = 'unique_violation';
  end if;

  insert into channel_sections (community_id, name, position, created_by, creation_key)
  values (
    p_community_id,
    v_name,
    (select coalesce(max(s.position) + 1, 0) from channel_sections s where s.community_id = p_community_id),
    v_uid,
    p_creation_key
  )
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.rename_channel_section(p_section_id uuid, p_name text)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  v_section channel_sections%rowtype;
  v_name text := btrim(coalesce(p_name, ''));
begin
  if auth.uid() is null then
    return false;
  end if;

  select * into v_section from channel_sections s where s.id = p_section_id;
  if not found or not is_admin(v_section.community_id) then
    return false;
  end if;
  if length(v_name) not between 1 and 40 or v_name ~ '[[:cntrl:]]' then
    return false;
  end if;

  perform lock_channel_layout(v_section.community_id);

  if exists (
    select 1 from channel_sections s
    where s.community_id = v_section.community_id
      and s.id <> v_section.id
      and lower(s.name) = lower(v_name)
  ) then
    raise exception 'channel_section_name_taken' using errcode = 'unique_violation';
  end if;

  update channel_sections s set name = v_name where s.id = v_section.id;
  return found;
end;
$$;

-- Moves a section to a place among its community's sections, from 0.
create or replace function public.move_channel_section(p_section_id uuid, p_position integer)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  v_section channel_sections%rowtype;
  v_ids uuid[];
  v_index integer;
begin
  if auth.uid() is null or p_position is null then
    return false;
  end if;

  select * into v_section from channel_sections s where s.id = p_section_id;
  if not found or not is_admin(v_section.community_id) then
    return false;
  end if;

  perform lock_channel_layout(v_section.community_id);

  v_ids := array(
    select s.id from channel_sections s
    where s.community_id = v_section.community_id and s.id <> v_section.id
    order by s.position, s.created_at, s.id
  );
  if not exists (select 1 from channel_sections s where s.id = v_section.id) then
    return false;
  end if;

  v_index := least(greatest(p_position, 0), cardinality(v_ids));
  v_ids := v_ids[1:v_index] || v_section.id || v_ids[v_index + 1:];

  update channel_sections s
     set position = x.ord - 1
    from unnest(v_ids) with ordinality as x(id, ord)
   where s.id = x.id and s.position is distinct from x.ord - 1;
  return true;
end;
$$;

-- Deletes a section. Its channels are never deleted with it: an empty section
-- goes as it is; a section with channels only when the caller has said where
-- they go — `p_channels_to` is 'none' (no section) or the id of another
-- section of the same community — and they are appended there in their
-- order. Raises channel_section_not_empty when there are channels and no
-- destination was given.
create or replace function public.delete_channel_section(p_section_id uuid, p_channels_to text)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  v_section channel_sections%rowtype;
  v_target uuid;
  v_base integer;
begin
  if auth.uid() is null then
    return false;
  end if;

  select * into v_section from channel_sections s where s.id = p_section_id;
  if not found or not is_admin(v_section.community_id) then
    return false;
  end if;

  perform lock_channel_layout(v_section.community_id);

  select * into v_section from channel_sections s where s.id = p_section_id for update;
  if not found then
    return false;
  end if;

  if exists (select 1 from channels c where c.section_id = v_section.id) then
    if p_channels_to is null then
      raise exception 'channel_section_not_empty' using errcode = 'restrict_violation';
    elsif p_channels_to <> 'none' then
      begin
        v_target := p_channels_to::uuid;
      exception when invalid_text_representation then
        return false;
      end;
      if v_target = v_section.id or not exists (
        select 1 from channel_sections s
        where s.id = v_target and s.community_id = v_section.community_id
      ) then
        return false;
      end if;
    end if;

    select coalesce(max(c.position) + 1, 0) into v_base
    from channels c
    where c.community_id = v_section.community_id
      and c.local_group_id is null
      and c.subgroup_id is null
      and c.section_id is not distinct from v_target;

    update channels c
       set section_id = v_target,
           position = v_base + r.ord - 1
      from (
        select c2.id, row_number() over (order by c2.archived_at is not null, c2.position, c2.id) as ord
        from channels c2
        where c2.section_id = v_section.id
      ) r
     where c.id = r.id;

    perform renumber_community_channels(v_section.community_id, v_target);
  end if;

  delete from channel_sections s where s.id = v_section.id;
  perform renumber_channel_sections(v_section.community_id);
  return true;
end;
$$;

-- ── Grants ──────────────────────────────────────────────────────────────

revoke all on function public.create_community_channel(text, text, text, uuid, uuid) from public, anon;
revoke all on function public.move_community_channel(text, uuid, integer) from public, anon;
revoke all on function public.set_community_channel_archived(text, boolean) from public, anon;
revoke all on function public.community_channel_content_counts(text) from public, anon;
revoke all on function public.delete_community_channel(text, text) from public, anon;
revoke all on function public.create_channel_section(text, text, uuid) from public, anon;
revoke all on function public.rename_channel_section(uuid, text) from public, anon;
revoke all on function public.move_channel_section(uuid, integer) from public, anon;
revoke all on function public.delete_channel_section(uuid, text) from public, anon;
revoke all on function public.set_channel_details(text, text, text, text) from public, anon;

grant execute on function public.create_community_channel(text, text, text, uuid, uuid) to authenticated;
grant execute on function public.move_community_channel(text, uuid, integer) to authenticated;
grant execute on function public.set_community_channel_archived(text, boolean) to authenticated;
grant execute on function public.community_channel_content_counts(text) to authenticated;
grant execute on function public.delete_community_channel(text, text) to authenticated;
grant execute on function public.create_channel_section(text, text, uuid) to authenticated;
grant execute on function public.rename_channel_section(uuid, text) to authenticated;
grant execute on function public.move_channel_section(uuid, integer) to authenticated;
grant execute on function public.delete_channel_section(uuid, text) to authenticated;
grant execute on function public.set_channel_details(text, text, text, text) to authenticated;

comment on function public.create_community_channel(text, text, text, uuid, uuid) is
  'Community admins only. Creates a community-wide channel, optionally in one of that community''s sections, and returns its id; the same caller repeating a creation key gets the same channel. Raises channel_name_taken. Null when the caller may not, the input is invalid or the section is not the community''s.';
comment on function public.set_channel_details(text, text, text, text) is
  'Sets name and purpose of one channel of the given community and returns the stored values. Community-wide channels: active admins of that community; a name another community-wide channel there has raises channel_name_taken. Private lokallag channels: whoever may manage the channel. Returns no row when the caller may not, the channel is not in that community, the channel is a main lokallag or subgroup channel, or the input is invalid.';
comment on function public.move_community_channel(text, uuid, integer) is
  'Community admins only. Puts a community-wide channel into a section of its community (null: none) at a place among that list''s active channels; reorders within the same list. False when the caller may not or the section is not the community''s.';
comment on function public.set_community_channel_archived(text, boolean) is
  'Community admins only. Archives (no new messages, history kept and readable, out of ordinary navigation) or restores a community-wide channel.';
comment on function public.community_channel_content_counts(text) is
  'Community admins only. How many messages and attachments deleting this community-wide channel would remove. No row for anyone else.';
comment on function public.delete_community_channel(text, text) is
  'Community admins only. Permanently deletes one community-wide channel with its messages, their attachments (objects queued for removal) and notifications addressed to it. A channel with messages needs its exact name as confirmation (channel_delete_unconfirmed otherwise). Never deletes another kind of channel. False when the caller may not.';
comment on function public.create_channel_section(text, text, uuid) is
  'Community admins only. Creates a section last in the community''s list and returns its id; the same caller repeating a creation key gets the same section. Raises channel_section_name_taken.';
comment on function public.rename_channel_section(uuid, text) is
  'Community admins only. Renames a section. Raises channel_section_name_taken.';
comment on function public.move_channel_section(uuid, integer) is
  'Community admins only. Moves a section to a place among its community''s sections.';
comment on function public.delete_channel_section(uuid, text) is
  'Community admins only. Deletes a section. Its channels are kept and moved where p_channels_to says (''none'' or another section of the community); raises channel_section_not_empty when it has channels and no destination was given.';
