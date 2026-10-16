-- Ressurser: links, folders and pins beside a channel's files.
--
-- Builds on 20261030100000 (file sharing in community channels and the file
-- library). A channel's resources are now:
--
--   * the files already sent in it — the same message_attachments rows, the
--     same private objects, the same viewers and downloads. Nothing about an
--     attachment row, its message or its object changes here;
--   * external links its members add: a URL, a title and an optional
--     description. TING never fetches them; a link is text the browser opens;
--   * optional folders, three levels deep at most, to file both in;
--   * pins: administrators lift a file or link to the top of the library.
--
-- What is NOT here: another storage system, per-folder permissions, version
-- history, synchronisation with outside services, default folders.
--
-- ── Who may do what ─────────────────────────────────────────────────────
--
-- Everything follows the channel. One internal function,
-- channel_resource_rights(), answers for a person and a channel from the
-- channel's own access rule (channel_access_admits — the rule its messages
-- follow), its archive state, `read_only` and the person's role:
--
--   read        whoever can read the channel now
--   contribute  read + the channel is not archived + may write in it (any
--               member who can read it; on a restricted channel only admins
--               and moderators)
--   manage      an active administrator of the channel's community; in a
--               lokallag's main chat also that lokallag's own leaders
--               (local_group_manage_admits — an active lokallag and the
--               leader's own membership in it, so never another lokallag);
--               in a private lokallag channel whoever may manage that
--               channel (private_channel_manage_admits)
--
--   add a link, create a folder, file a resource      contribute
--   edit or remove a link, rename or delete a folder  contribute and own it,
--                                                      or manage
--   pin and unpin                                      manage
--
-- Reading a lokallag's main chat is, as for its messages, for active members
-- of exactly that lokallag and the community's administrators — not every
-- member of the community, and not another lokallag's leaders.
--
-- An archived channel is readable and takes no change at all, from anyone.
-- The file-upload switch (file_sharing_enabled) is about uploads only; links
-- and folders do not depend on it.
--
-- Every write is a SECURITY DEFINER function below that asks
-- channel_resource_rights() for auth.uid() and the channel the row belongs
-- to — never a channel the caller names alongside a row from somewhere else.
-- Clients may read the new tables (a select policy that is can_read_channel)
-- and write none of them.
--
-- ── Lifecycle ───────────────────────────────────────────────────────────
--
--   A folder is deleted       its subfolders go with it; every file and link
--                             in any of them is left in place, unfiled
--                             ("Uten mappe"). Nothing a member shared is lost.
--   A file's message goes     its placement and pin go with it (cascade)
--   A link is removed         its pin goes with it
--   A channel is deleted      its links, folders, placements and pins go with
--                             it; its files as before (objects queued)
--   Archived / restored       nothing changes but whether it can be changed
--
-- Placements and pins are keyed by (id, channel_id) pairs on both sides, so a
-- file or link can only ever be filed in, or pinned to, its own channel.

-- ── Keys the new tables point at ────────────────────────────────────────

alter table public.message_attachments
  add constraint message_attachments_id_channel_key unique (id, channel_id);

-- ── Folders ─────────────────────────────────────────────────────────────

create table public.channel_resource_folders (
  id uuid primary key default gen_random_uuid(),
  channel_id text not null references public.channels (id) on delete cascade,
  parent_id uuid,
  name text not null,
  depth smallint not null,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint channel_resource_folders_id_channel_key unique (id, channel_id),
  -- A subfolder is always in its parent's channel, and goes with its parent.
  constraint channel_resource_folders_parent_fkey
    foreign key (parent_id, channel_id)
    references public.channel_resource_folders (id, channel_id) on delete cascade,
  constraint channel_resource_folders_depth check (depth between 1 and 3),
  constraint channel_resource_folders_root check ((parent_id is null) = (depth = 1)),
  constraint channel_resource_folders_name_valid
    check (name = btrim(name) and length(name) between 1 and 60 and name !~ '[[:cntrl:]]')
);

create unique index channel_resource_folders_name_key
  on public.channel_resource_folders (
    channel_id, coalesce(parent_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(name)
  );
create index channel_resource_folders_parent_idx
  on public.channel_resource_folders (parent_id) where parent_id is not null;

comment on table public.channel_resource_folders is
  'Optional folders in a channel''s Ressurser, at most three deep. Permissions are the channel''s. Deleting one deletes its subfolders and unfiles everything in them; no file or link is deleted with a folder. Written only by the functions in 20261031100000.';

-- Depth comes from the parent; a folder never moves or changes channel.
create or replace function public.channel_resource_folders_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if new.parent_id is null then
      new.depth := 1;
    else
      select f.depth + 1 into new.depth
      from channel_resource_folders f
      where f.id = new.parent_id and f.channel_id = new.channel_id;
      if new.depth is null then
        raise exception 'resource_error:not_found' using errcode = 'check_violation';
      end if;
    end if;
    return new;
  end if;

  if new.id is distinct from old.id
     or new.channel_id is distinct from old.channel_id
     or new.parent_id is distinct from old.parent_id
     or new.depth is distinct from old.depth
     or new.created_by is distinct from old.created_by
     or new.created_at is distinct from old.created_at then
    raise exception 'resource_error:folder_fixed' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

revoke all on function public.channel_resource_folders_guard() from public, anon, authenticated, service_role;

create trigger channel_resource_folders_guard
before insert or update on public.channel_resource_folders
for each row execute function public.channel_resource_folders_guard();

-- ── Links ───────────────────────────────────────────────────────────────

-- An absolute http(s) URL with a plain host (the browser's URL parser has
-- already lowercased it and turned an international name into its ASCII
-- form), an optional port, and no user name or password. Nothing else.
create or replace function public.channel_link_url_valid(p_url text)
returns boolean language sql immutable set search_path = public as $$
  select p_url is not null
    and length(p_url) between 10 and 2000
    and p_url ~ '^https?://[^[:space:][:cntrl:]]+$'
    and coalesce(substring(p_url from '^https?://([^/?#]*)'), '')
        ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*(:[0-9]{1,5})?$';
$$;

revoke all on function public.channel_link_url_valid(text) from public, anon;
grant execute on function public.channel_link_url_valid(text) to authenticated, service_role;

create table public.channel_links (
  id uuid primary key default gen_random_uuid(),
  channel_id text not null references public.channels (id) on delete cascade,
  folder_id uuid,
  url text not null,
  title text not null,
  description text not null default '',
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint channel_links_id_channel_key unique (id, channel_id),
  -- In a folder of its own channel; unfiled (not deleted) when the folder goes.
  constraint channel_links_folder_fkey
    foreign key (folder_id, channel_id)
    references public.channel_resource_folders (id, channel_id) on delete set null (folder_id),
  constraint channel_links_url_valid check (channel_link_url_valid(url)),
  constraint channel_links_title_valid
    check (title = btrim(title) and length(title) between 1 and 120 and title !~ '[[:cntrl:]]'),
  constraint channel_links_description_valid
    check (description = btrim(description) and length(description) <= 300 and description !~ '[[:cntrl:]]')
);

create index channel_links_channel_idx on public.channel_links (channel_id, created_at, id);
create index channel_links_folder_idx on public.channel_links (folder_id) where folder_id is not null;
create index channel_links_created_by_idx on public.channel_links (created_by);

comment on table public.channel_links is
  'External links in a channel''s Ressurser: a URL the browser opens, a title and a description. Never fetched by TING. Readable by whoever can read the channel; written only by the functions in 20261031100000.';

-- ── Where a file is filed ───────────────────────────────────────────────
--
-- A row only while a sent attachment sits in a folder. The attachment itself
-- — its message, its object, its row — is untouched by filing.

create table public.channel_attachment_placements (
  attachment_id uuid primary key,
  channel_id text not null,
  folder_id uuid not null,
  placed_by uuid references public.profiles (id) on delete set null,
  placed_at timestamptz not null default now(),
  constraint channel_attachment_placements_attachment_fkey
    foreign key (attachment_id, channel_id)
    references public.message_attachments (id, channel_id) on delete cascade,
  constraint channel_attachment_placements_folder_fkey
    foreign key (folder_id, channel_id)
    references public.channel_resource_folders (id, channel_id) on delete cascade
);

create index channel_attachment_placements_folder_idx on public.channel_attachment_placements (folder_id);

comment on table public.channel_attachment_placements is
  'Which folder a sent channel attachment is filed in. No row: unfiled. Goes with the attachment or the folder; never moves or changes the attachment.';

-- ── Pins ────────────────────────────────────────────────────────────────

create table public.channel_resource_pins (
  id uuid primary key default gen_random_uuid(),
  channel_id text not null references public.channels (id) on delete cascade,
  attachment_id uuid,
  link_id uuid,
  pinned_by uuid references public.profiles (id) on delete set null,
  pinned_at timestamptz not null default now(),
  constraint channel_resource_pins_one check ((attachment_id is null) <> (link_id is null)),
  constraint channel_resource_pins_attachment_fkey
    foreign key (attachment_id, channel_id)
    references public.message_attachments (id, channel_id) on delete cascade,
  constraint channel_resource_pins_link_fkey
    foreign key (link_id, channel_id)
    references public.channel_links (id, channel_id) on delete cascade,
  constraint channel_resource_pins_attachment_key unique (attachment_id),
  constraint channel_resource_pins_link_key unique (link_id)
);

create index channel_resource_pins_channel_idx on public.channel_resource_pins (channel_id, pinned_at);

comment on table public.channel_resource_pins is
  'Files and links an administrator pinned to the top of a channel''s Ressurser. A pin points at the resource; nothing is copied. Goes with the resource.';

-- ── Reading the tables directly ─────────────────────────────────────────

alter table public.channel_resource_folders enable row level security;
alter table public.channel_links enable row level security;
alter table public.channel_attachment_placements enable row level security;
alter table public.channel_resource_pins enable row level security;

create policy channel_resource_folders_select on public.channel_resource_folders
  for select to authenticated using (can_read_channel(channel_id));
create policy channel_links_select on public.channel_links
  for select to authenticated using (can_read_channel(channel_id));
create policy channel_attachment_placements_select on public.channel_attachment_placements
  for select to authenticated using (can_read_channel(channel_id));
create policy channel_resource_pins_select on public.channel_resource_pins
  for select to authenticated using (can_read_channel(channel_id));

revoke all on public.channel_resource_folders, public.channel_links,
  public.channel_attachment_placements, public.channel_resource_pins
  from public, anon, authenticated, service_role;
grant select on public.channel_resource_folders, public.channel_links,
  public.channel_attachment_placements, public.channel_resource_pins
  to authenticated;
grant select, insert, update, delete on public.channel_resource_folders, public.channel_links,
  public.channel_attachment_placements, public.channel_resource_pins
  to service_role;

-- ── Rights, for one person and one channel ──────────────────────────────

create or replace function public.channel_resource_rights(p_user_id uuid, p_channel_id text)
returns table (can_read boolean, can_contribute boolean, can_manage boolean, archived boolean)
language plpgsql security definer stable set search_path = public as $$
#variable_conflict use_column
declare
  v_channel channels%rowtype;
  v_role text;
begin
  can_read := false;
  can_contribute := false;
  can_manage := false;
  archived := false;

  if p_user_id is null or p_channel_id is null then
    return next;
    return;
  end if;

  select * into v_channel from channels c where c.id = p_channel_id;
  if not found or not channel_access_admits(
    p_user_id, v_channel.community_id, v_channel.local_group_id,
    v_channel.subgroup_id, v_channel.id, v_channel.is_private
  ) then
    return next;
    return;
  end if;

  select m.role::text into v_role
  from memberships m
  where m.community_id = v_channel.community_id and m.user_id = p_user_id and m.status = 'active';

  can_read := true;
  archived := v_channel.archived_at is not null;
  can_manage :=
    coalesce(v_role = 'admin', false)
    or (
      v_channel.local_group_id is not null
      and not v_channel.is_private
      and local_group_manage_admits(p_user_id, v_channel.local_group_id)
    )
    or (v_channel.is_private and private_channel_manage_admits(p_user_id, v_channel.id));
  can_contribute :=
    not archived
    and (not v_channel.read_only or coalesce(v_role in ('admin', 'moderator'), false));
  return next;
end;
$$;

-- Takes a user id: internal only.
revoke all on function public.channel_resource_rights(uuid, text) from public, anon, authenticated, service_role;

create or replace function public.require_channel_resource_rights(p_channel_id text, p_manage boolean, p_owner uuid)
returns void language plpgsql security definer stable set search_path = public as $$
declare
  v_rights record;
begin
  select * into v_rights from channel_resource_rights(auth.uid(), p_channel_id);
  if not coalesce(v_rights.can_read, false) then
    raise exception 'resource_error:not_found' using errcode = 'insufficient_privilege';
  end if;
  if v_rights.archived then
    raise exception 'resource_error:archived' using errcode = 'insufficient_privilege';
  end if;
  if p_manage then
    if not v_rights.can_manage then
      raise exception 'resource_error:not_allowed' using errcode = 'insufficient_privilege';
    end if;
  elsif not (
    v_rights.can_manage
    or (v_rights.can_contribute and (p_owner is null or p_owner = auth.uid()))
  ) then
    raise exception 'resource_error:not_allowed' using errcode = 'insufficient_privilege';
  end if;
end;
$$;

revoke all on function public.require_channel_resource_rights(text, boolean, uuid) from public, anon, authenticated, service_role;

-- What the caller may do with one channel's Ressurser, for the interface to
-- decide which controls to offer. Every action asks again.
--   can_configure_uploads  may switch file sharing on or off here
--                          (set_channel_file_sharing's own rule)
create or replace function public.channel_resource_permissions(p_channel_id text)
returns table (can_read boolean, can_contribute boolean, can_manage boolean, can_configure_uploads boolean)
language sql stable security definer set search_path = public as $$
  select r.can_read, r.can_contribute, r.can_manage and not r.archived,
    r.can_read and not r.archived and coalesce((
      select not c.is_private and c.subgroup_id is null and (
        is_admin(c.community_id)
        or (c.local_group_id is not null and local_group_manage_admits(auth.uid(), c.local_group_id))
      )
      from channels c where c.id = p_channel_id
    ), false)
  from channel_resource_rights(auth.uid(), p_channel_id) r;
$$;

revoke all on function public.channel_resource_permissions(text) from public, anon;
grant execute on function public.channel_resource_permissions(text) to authenticated;

-- ── Folders: create, rename, delete ─────────────────────────────────────

create or replace function public.create_channel_resource_folder(p_channel_id text, p_parent_id uuid, p_name text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_name text := btrim(coalesce(p_name, ''));
  v_depth smallint;
  v_id uuid;
begin
  -- Anyone who may contribute; p_owner null means "not about ownership".
  perform require_channel_resource_rights(p_channel_id, false, null);
  if not (select r.can_contribute from channel_resource_rights(auth.uid(), p_channel_id) r) then
    raise exception 'resource_error:not_allowed' using errcode = 'insufficient_privilege';
  end if;
  if length(v_name) not between 1 and 60 or v_name ~ '[[:cntrl:]]' then
    raise exception 'resource_error:folder_name' using errcode = 'check_violation';
  end if;

  -- Serialises folder changes in one channel.
  perform pg_advisory_xact_lock(hashtextextended('channel-resources:' || p_channel_id, 0));

  if p_parent_id is not null then
    select f.depth into v_depth from channel_resource_folders f
    where f.id = p_parent_id and f.channel_id = p_channel_id;
    if v_depth is null then
      raise exception 'resource_error:not_found' using errcode = 'check_violation';
    end if;
    if v_depth >= 3 then
      raise exception 'resource_error:folder_depth' using errcode = 'check_violation';
    end if;
  end if;

  if (select count(*) from channel_resource_folders f where f.channel_id = p_channel_id) >= 200 then
    raise exception 'resource_error:folder_limit' using errcode = 'check_violation';
  end if;

  if exists (
    select 1 from channel_resource_folders f
    where f.channel_id = p_channel_id
      and f.parent_id is not distinct from p_parent_id
      and lower(f.name) = lower(v_name)
  ) then
    raise exception 'resource_error:folder_name_taken' using errcode = 'unique_violation';
  end if;

  insert into channel_resource_folders (channel_id, parent_id, name, depth, created_by)
  values (p_channel_id, p_parent_id, v_name, 1, auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.rename_channel_resource_folder(p_folder_id uuid, p_name text)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  v_folder channel_resource_folders%rowtype;
  v_name text := btrim(coalesce(p_name, ''));
begin
  select * into v_folder from channel_resource_folders f where f.id = p_folder_id;
  if not found then
    raise exception 'resource_error:not_found' using errcode = 'insufficient_privilege';
  end if;
  perform require_channel_resource_rights(v_folder.channel_id, false, coalesce(v_folder.created_by, '00000000-0000-0000-0000-000000000000'::uuid));
  if length(v_name) not between 1 and 60 or v_name ~ '[[:cntrl:]]' then
    raise exception 'resource_error:folder_name' using errcode = 'check_violation';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('channel-resources:' || v_folder.channel_id, 0));
  if exists (
    select 1 from channel_resource_folders f
    where f.channel_id = v_folder.channel_id
      and f.parent_id is not distinct from v_folder.parent_id
      and f.id <> v_folder.id
      and lower(f.name) = lower(v_name)
  ) then
    raise exception 'resource_error:folder_name_taken' using errcode = 'unique_violation';
  end if;

  update channel_resource_folders f set name = v_name, updated_at = now() where f.id = v_folder.id;
  return found;
end;
$$;

-- Deletes a folder and its subfolders. Every file and link in any of them
-- stays in the channel, unfiled: placements go (cascade), links are set to no
-- folder. Returns how many resources were unfiled.
create or replace function public.delete_channel_resource_folder(p_folder_id uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_folder channel_resource_folders%rowtype;
  v_moved integer;
begin
  select * into v_folder from channel_resource_folders f where f.id = p_folder_id;
  if not found then
    raise exception 'resource_error:not_found' using errcode = 'insufficient_privilege';
  end if;
  perform require_channel_resource_rights(v_folder.channel_id, false, coalesce(v_folder.created_by, '00000000-0000-0000-0000-000000000000'::uuid));
  perform pg_advisory_xact_lock(hashtextextended('channel-resources:' || v_folder.channel_id, 0));

  with recursive tree as (
    select f.id from channel_resource_folders f where f.id = v_folder.id
    union all
    select f.id from channel_resource_folders f join tree t on f.parent_id = t.id
  )
  select
    (select count(*) from channel_attachment_placements p where p.folder_id in (select id from tree))
    + (select count(*) from channel_links l where l.folder_id in (select id from tree))
  into v_moved;

  delete from channel_resource_folders f where f.id = v_folder.id;
  return v_moved;
end;
$$;

-- ── Filing a file or a link ─────────────────────────────────────────────

-- p_type 'file' (a sent attachment of a channel) or 'link'. p_folder_id null:
-- unfiled. The folder must be the resource's own channel's.
create or replace function public.move_channel_resource(p_type text, p_id uuid, p_folder_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  v_channel text;
begin
  if p_type = 'file' then
    select a.channel_id into v_channel from message_attachments a
    where a.id = p_id and a.status = 'sent' and a.channel_id is not null;
  elsif p_type = 'link' then
    select l.channel_id into v_channel from channel_links l where l.id = p_id;
  end if;
  if v_channel is null then
    raise exception 'resource_error:not_found' using errcode = 'insufficient_privilege';
  end if;

  perform require_channel_resource_rights(v_channel, false, null);
  if not (select r.can_contribute from channel_resource_rights(auth.uid(), v_channel) r) then
    raise exception 'resource_error:not_allowed' using errcode = 'insufficient_privilege';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('channel-resources:' || v_channel, 0));
  if p_folder_id is not null and not exists (
    select 1 from channel_resource_folders f where f.id = p_folder_id and f.channel_id = v_channel
  ) then
    raise exception 'resource_error:not_found' using errcode = 'check_violation';
  end if;

  if p_type = 'file' then
    if p_folder_id is null then
      delete from channel_attachment_placements p where p.attachment_id = p_id;
    else
      insert into channel_attachment_placements (attachment_id, channel_id, folder_id, placed_by)
      values (p_id, v_channel, p_folder_id, auth.uid())
      on conflict (attachment_id) do update
        set folder_id = excluded.folder_id, placed_by = excluded.placed_by, placed_at = now();
    end if;
  else
    update channel_links l set folder_id = p_folder_id where l.id = p_id;
  end if;
  return true;
end;
$$;

-- ── Links: add, edit, remove ────────────────────────────────────────────

create or replace function public.add_channel_link(
  p_channel_id text,
  p_folder_id uuid,
  p_url text,
  p_title text,
  p_description text
)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_url text := btrim(coalesce(p_url, ''));
  v_title text := btrim(coalesce(p_title, ''));
  v_description text := btrim(coalesce(p_description, ''));
  v_id uuid;
begin
  perform require_channel_resource_rights(p_channel_id, false, null);
  if not (select r.can_contribute from channel_resource_rights(auth.uid(), p_channel_id) r) then
    raise exception 'resource_error:not_allowed' using errcode = 'insufficient_privilege';
  end if;
  if not channel_link_url_valid(v_url) then
    raise exception 'resource_error:link_url' using errcode = 'check_violation';
  end if;
  if length(v_title) not between 1 and 120 or v_title ~ '[[:cntrl:]]' then
    raise exception 'resource_error:link_title' using errcode = 'check_violation';
  end if;
  if length(v_description) > 300 or v_description ~ '[[:cntrl:]]' then
    raise exception 'resource_error:link_description' using errcode = 'check_violation';
  end if;
  if p_folder_id is not null and not exists (
    select 1 from channel_resource_folders f where f.id = p_folder_id and f.channel_id = p_channel_id
  ) then
    raise exception 'resource_error:not_found' using errcode = 'check_violation';
  end if;
  if (select count(*) from channel_links l where l.channel_id = p_channel_id) >= 2000 then
    raise exception 'resource_error:link_limit' using errcode = 'check_violation';
  end if;

  insert into channel_links (channel_id, folder_id, url, title, description, created_by)
  values (p_channel_id, p_folder_id, v_url, v_title, v_description, auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.update_channel_link(p_link_id uuid, p_url text, p_title text, p_description text)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  v_link channel_links%rowtype;
  v_url text := btrim(coalesce(p_url, ''));
  v_title text := btrim(coalesce(p_title, ''));
  v_description text := btrim(coalesce(p_description, ''));
begin
  select * into v_link from channel_links l where l.id = p_link_id;
  if not found then
    raise exception 'resource_error:not_found' using errcode = 'insufficient_privilege';
  end if;
  perform require_channel_resource_rights(v_link.channel_id, false, coalesce(v_link.created_by, '00000000-0000-0000-0000-000000000000'::uuid));
  if not channel_link_url_valid(v_url) then
    raise exception 'resource_error:link_url' using errcode = 'check_violation';
  end if;
  if length(v_title) not between 1 and 120 or v_title ~ '[[:cntrl:]]' then
    raise exception 'resource_error:link_title' using errcode = 'check_violation';
  end if;
  if length(v_description) > 300 or v_description ~ '[[:cntrl:]]' then
    raise exception 'resource_error:link_description' using errcode = 'check_violation';
  end if;

  update channel_links l
     set url = v_url, title = v_title, description = v_description, updated_at = now()
   where l.id = v_link.id;
  return found;
end;
$$;

create or replace function public.delete_channel_link(p_link_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  v_link channel_links%rowtype;
begin
  select * into v_link from channel_links l where l.id = p_link_id;
  if not found then
    raise exception 'resource_error:not_found' using errcode = 'insufficient_privilege';
  end if;
  perform require_channel_resource_rights(v_link.channel_id, false, coalesce(v_link.created_by, '00000000-0000-0000-0000-000000000000'::uuid));
  delete from channel_links l where l.id = v_link.id;
  return found;
end;
$$;

-- ── Pins ────────────────────────────────────────────────────────────────

create or replace function public.set_channel_resource_pinned(p_type text, p_id uuid, p_pinned boolean)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  v_channel text;
begin
  if p_pinned is null then
    raise exception 'resource_error:not_found' using errcode = 'check_violation';
  end if;
  if p_type = 'file' then
    select a.channel_id into v_channel from message_attachments a
    where a.id = p_id and a.status = 'sent' and a.channel_id is not null;
  elsif p_type = 'link' then
    select l.channel_id into v_channel from channel_links l where l.id = p_id;
  end if;
  if v_channel is null then
    raise exception 'resource_error:not_found' using errcode = 'insufficient_privilege';
  end if;

  perform require_channel_resource_rights(v_channel, true, null);
  perform pg_advisory_xact_lock(hashtextextended('channel-resources:' || v_channel, 0));

  if not p_pinned then
    delete from channel_resource_pins p
    where (p_type = 'file' and p.attachment_id = p_id) or (p_type = 'link' and p.link_id = p_id);
    return true;
  end if;

  if exists (
    select 1 from channel_resource_pins p
    where (p_type = 'file' and p.attachment_id = p_id) or (p_type = 'link' and p.link_id = p_id)
  ) then
    return true;
  end if;
  if (select count(*) from channel_resource_pins p where p.channel_id = v_channel) >= 20 then
    raise exception 'resource_error:pin_limit' using errcode = 'check_violation';
  end if;

  insert into channel_resource_pins (channel_id, attachment_id, link_id, pinned_by)
  values (
    v_channel,
    case when p_type = 'file' then p_id end,
    case when p_type = 'link' then p_id end,
    auth.uid()
  );
  return true;
end;
$$;

-- ── Reading the library ─────────────────────────────────────────────────
--
-- The file library's three functions (20261030100000) become the resource
-- library's: the same rule — nothing unless can_read_channel() admits the
-- caller now — over files and links together.

drop function if exists public.channel_files(text, text, text, uuid, text, text, uuid, integer);
drop function if exists public.channel_file_count(text);
drop function if exists public.channel_file_uploaders(text);

-- One page of a channel's resources.
--
--   p_kind        'file' (any file), 'document', 'image', 'other', 'link';
--                 null: everything
--   p_contributor who uploaded the file or added the link
--   p_folder      null: every folder and none; 'none': unfiled; a folder id:
--                 directly in that folder
--   p_pinned      true: only pinned resources, most recently pinned first,
--                 at most 20, no paging
--   p_sort        'newest' (default), 'oldest', 'name_asc', 'name_desc'
--   p_after_*     the previous page's last sort_key and id
create or replace function public.channel_resources(
  p_channel_id text,
  p_search text default null,
  p_kind text default null,
  p_contributor uuid default null,
  p_folder text default null,
  p_pinned boolean default false,
  p_sort text default 'newest',
  p_after_key text default null,
  p_after_id uuid default null,
  p_limit integer default 30
)
returns table (
  resource_type text,
  id uuid,
  community_id text,
  message_id uuid,
  contributor_id uuid,
  name text,
  mime_type text,
  size_bytes bigint,
  width integer,
  height integer,
  has_thumbnail boolean,
  url text,
  description text,
  folder_id uuid,
  pinned_at timestamptz,
  created_at timestamptz,
  sort_key text
)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare
  v_limit integer := least(greatest(coalesce(p_limit, 30), 1), 100);
  v_search text := nullif(btrim(left(coalesce(p_search, ''), 100)), '');
  v_pattern text;
  v_kind text := case when p_kind in ('file', 'document', 'image', 'other', 'link') then p_kind end;
  v_sort text := case when p_sort in ('oldest', 'name_asc', 'name_desc') then p_sort else 'newest' end;
  v_unfiled boolean := coalesce(p_folder = 'none', false);
  v_folder uuid;
  v_after_time timestamptz;
  v_after_key text;
  v_after_id uuid := p_after_id;
  v_community text;
begin
  if auth.uid() is null or p_channel_id is null or not can_read_channel(p_channel_id) then
    return;
  end if;
  select c.community_id into v_community from channels c where c.id = p_channel_id;

  if p_folder is not null and not v_unfiled then
    begin
      v_folder := p_folder::uuid;
    exception when others then
      return;
    end;
  end if;

  if v_search is not null then
    v_pattern := '%' || replace(replace(replace(v_search, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  end if;

  if v_after_id is not null and p_after_key is null then
    v_after_id := null;
  end if;
  if v_after_id is not null then
    if v_sort in ('newest', 'oldest') then
      begin
        v_after_time := p_after_key::timestamptz;
      exception when others then
        v_after_id := null;
      end;
    else
      v_after_key := p_after_key;
    end if;
  end if;

  return query
  with resources as (
    select 'file'::text as t, a.id, a.community_id, a.message_id, a.uploader_id as contributor,
           a.display_name as name, a.mime_type, a.size_bytes, a.width, a.height,
           a.thumb_path is not null as thumb, null::text as url, null::text as description,
           pl.folder_id, pin.pinned_at, a.attached_at as at
    from message_attachments a
    left join channel_attachment_placements pl on pl.attachment_id = a.id
    left join channel_resource_pins pin on pin.attachment_id = a.id
    where a.channel_id = p_channel_id
      and a.status = 'sent'
      and (v_kind is null or v_kind = 'file'
           or (v_kind <> 'link' and message_attachment_library_kind(a.mime_type) = v_kind))
      and (v_kind is distinct from 'link')
    union all
    select 'link'::text, l.id, v_community, null::uuid, l.created_by,
           l.title, null::text, null::bigint, null::integer, null::integer,
           false, l.url, l.description, l.folder_id, pin.pinned_at, l.created_at
    from channel_links l
    left join channel_resource_pins pin on pin.link_id = l.id
    where l.channel_id = p_channel_id
      and (v_kind is null or v_kind = 'link')
  )
  select r.t, r.id, r.community_id, r.message_id, r.contributor, r.name, r.mime_type, r.size_bytes,
         r.width, r.height, r.thumb, r.url, r.description, r.folder_id, r.pinned_at, r.at,
         case
           when v_sort in ('newest', 'oldest')
             then to_char(r.at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
           else r.name
         end
  from resources r
  where (v_pattern is null or r.name ilike v_pattern)
    and (p_contributor is null or r.contributor = p_contributor)
    and (not v_unfiled or r.folder_id is null)
    and (v_folder is null or r.folder_id = v_folder)
    and (not coalesce(p_pinned, false) or r.pinned_at is not null)
    and (
      coalesce(p_pinned, false)
      or v_after_id is null
      or case v_sort
        when 'newest' then (r.at, r.id) < (v_after_time, v_after_id)
        when 'oldest' then (r.at, r.id) > (v_after_time, v_after_id)
        when 'name_asc' then
          (r.name collate "nb-x-icu") > (v_after_key collate "nb-x-icu")
          or ((r.name collate "nb-x-icu") = (v_after_key collate "nb-x-icu") and r.id > v_after_id)
        else
          (r.name collate "nb-x-icu") < (v_after_key collate "nb-x-icu")
          or ((r.name collate "nb-x-icu") = (v_after_key collate "nb-x-icu") and r.id < v_after_id)
      end
    )
  order by
    case when coalesce(p_pinned, false) then r.pinned_at end desc,
    case when not coalesce(p_pinned, false) and v_sort = 'oldest' then r.at end asc,
    case when not coalesce(p_pinned, false) and v_sort = 'newest' then r.at end desc,
    case when not coalesce(p_pinned, false) and v_sort = 'name_asc' then r.name collate "nb-x-icu" end asc,
    case when not coalesce(p_pinned, false) and v_sort = 'name_desc' then r.name collate "nb-x-icu" end desc,
    case when v_sort in ('oldest', 'name_asc') then r.id end asc,
    case when v_sort in ('newest', 'name_desc') then r.id end desc
  limit case when coalesce(p_pinned, false) then 20 else v_limit end;
end;
$$;

comment on function public.channel_resources(text, text, text, uuid, text, boolean, text, text, uuid, integer) is
  'One page of a channel''s resources — sent files and links — for the caller: searched by name, filtered by kind, contributor and folder (or pinned only), sorted newest, oldest, name_asc or name_desc, continued from the previous page''s last sort_key and id. Nothing unless can_read_channel() admits the caller now.';

-- Folders of a channel with how many resources sit directly in each.
create or replace function public.channel_resource_folders(p_channel_id text)
returns table (id uuid, parent_id uuid, name text, depth smallint, created_by uuid, created_at timestamptz, resource_count integer)
language sql stable security definer set search_path = public as $$
  select f.id, f.parent_id, f.name, f.depth, f.created_by, f.created_at,
         ((select count(*) from channel_attachment_placements p where p.folder_id = f.id)
          + (select count(*) from channel_links l where l.folder_id = f.id))::integer
  from channel_resource_folders f
  where auth.uid() is not null
    and p_channel_id is not null
    and can_read_channel(p_channel_id)
    and f.channel_id = p_channel_id
  order by f.depth, f.name collate "nb-x-icu", f.id;
$$;

-- How much there is: sent files, links, folders and pins.
create or replace function public.channel_resource_summary(p_channel_id text)
returns table (file_count integer, link_count integer, folder_count integer, pin_count integer)
language sql stable security definer set search_path = public as $$
  select
    (select count(*)::integer from message_attachments a where a.channel_id = p_channel_id and a.status = 'sent'),
    (select count(*)::integer from channel_links l where l.channel_id = p_channel_id),
    (select count(*)::integer from channel_resource_folders f where f.channel_id = p_channel_id),
    (select count(*)::integer from channel_resource_pins p where p.channel_id = p_channel_id)
  where auth.uid() is not null and p_channel_id is not null and can_read_channel(p_channel_id);
$$;

-- Who has contributed: uploaders of sent files and authors of links.
create or replace function public.channel_resource_contributors(p_channel_id text)
returns table (contributor_id uuid, resource_count integer)
language sql stable security definer set search_path = public as $$
  select x.contributor, count(*)::integer
  from (
    select a.uploader_id as contributor from message_attachments a
    where a.channel_id = p_channel_id and a.status = 'sent'
    union all
    select l.created_by from channel_links l where l.channel_id = p_channel_id and l.created_by is not null
  ) x
  where auth.uid() is not null and p_channel_id is not null and can_read_channel(p_channel_id)
  group by x.contributor;
$$;

-- ── Deleting a channel says what goes with it ───────────────────────────
--
-- Recreated from 20261028100000 / 20261029100000: links and folders are
-- counted, and a channel holding any — not only one with messages — needs its
-- name typed to be deleted.

drop function if exists public.community_channel_content_counts(text);

create or replace function public.community_channel_content_counts(p_channel_id text)
returns table (message_count integer, attachment_count integer, link_count integer, folder_count integer)
language sql stable security definer set search_path = public as $$
  select
    (select count(*)::integer from messages m where m.channel_id = c.id),
    (select count(*)::integer from message_attachments a where a.channel_id = c.id),
    (select count(*)::integer from channel_links l where l.channel_id = c.id),
    (select count(*)::integer from channel_resource_folders f where f.channel_id = c.id)
  from channels c
  where c.id = p_channel_id
    and c.local_group_id is null
    and c.subgroup_id is null
    and auth.uid() is not null
    and is_admin(c.community_id);
$$;

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

  select * into v_channel from channels c where c.id = v_channel.id for update;
  if not found then
    return false;
  end if;

  if (
    exists (select 1 from messages m where m.channel_id = v_channel.id)
    or exists (select 1 from channel_links l where l.channel_id = v_channel.id)
    or exists (select 1 from channel_resource_folders f where f.channel_id = v_channel.id)
  ) and btrim(coalesce(p_confirm_name, '')) is distinct from v_channel.name then
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

  if v_deleted is not null then
    insert into channel_retired_ids (id, community_id)
    values (v_deleted, v_channel.community_id)
    on conflict (id) do nothing;
  end if;

  perform renumber_community_channels(v_channel.community_id, v_channel.section_id);
  return v_deleted is not null;
end;
$$;

-- ── Grants ──────────────────────────────────────────────────────────────

revoke all on function public.create_channel_resource_folder(text, uuid, text) from public, anon;
revoke all on function public.rename_channel_resource_folder(uuid, text) from public, anon;
revoke all on function public.delete_channel_resource_folder(uuid) from public, anon;
revoke all on function public.move_channel_resource(text, uuid, uuid) from public, anon;
revoke all on function public.add_channel_link(text, uuid, text, text, text) from public, anon;
revoke all on function public.update_channel_link(uuid, text, text, text) from public, anon;
revoke all on function public.delete_channel_link(uuid) from public, anon;
revoke all on function public.set_channel_resource_pinned(text, uuid, boolean) from public, anon;
revoke all on function public.channel_resources(text, text, text, uuid, text, boolean, text, text, uuid, integer) from public, anon;
revoke all on function public.channel_resource_folders(text) from public, anon;
revoke all on function public.channel_resource_summary(text) from public, anon;
revoke all on function public.channel_resource_contributors(text) from public, anon;
revoke all on function public.community_channel_content_counts(text) from public, anon;
revoke all on function public.delete_community_channel(text, text) from public, anon;

grant execute on function public.create_channel_resource_folder(text, uuid, text) to authenticated;
grant execute on function public.rename_channel_resource_folder(uuid, text) to authenticated;
grant execute on function public.delete_channel_resource_folder(uuid) to authenticated;
grant execute on function public.move_channel_resource(text, uuid, uuid) to authenticated;
grant execute on function public.add_channel_link(text, uuid, text, text, text) to authenticated;
grant execute on function public.update_channel_link(uuid, text, text, text) to authenticated;
grant execute on function public.delete_channel_link(uuid) to authenticated;
grant execute on function public.set_channel_resource_pinned(text, uuid, boolean) to authenticated;
grant execute on function public.channel_resources(text, text, text, uuid, text, boolean, text, text, uuid, integer) to authenticated;
grant execute on function public.channel_resource_folders(text) to authenticated;
grant execute on function public.channel_resource_summary(text) to authenticated;
grant execute on function public.channel_resource_contributors(text) to authenticated;
grant execute on function public.community_channel_content_counts(text) to authenticated;
grant execute on function public.delete_community_channel(text, text) to authenticated;

comment on function public.community_channel_content_counts(text) is
  'Community admins only. How many messages, attachments, links and resource folders deleting this community-wide channel would remove. No row for anyone else.';
comment on function public.delete_community_channel(text, text) is
  'Community admins only. Permanently deletes one community-wide channel with its messages, their attachments (objects queued for removal), its links, resource folders and pins, and notifications addressed to it, and retires its id. A channel with messages, links or folders needs its exact name as confirmation (channel_delete_unconfirmed otherwise). False when the caller may not.';
