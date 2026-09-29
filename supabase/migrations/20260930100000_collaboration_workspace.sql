-- Collaborations — Step 2: the private workspace, and the one public output.
--
-- Steps 1A/1B (20260928100000, 20260929100000) settled WHO is in a
-- collaboration: which organisational units take part, which of their people
-- each unit contributes, and who therefore has effective access. This
-- migration adds WHAT those people do together — channels, threaded messages,
-- tasks, documents, files and event planning — and exactly one deliberate
-- route by which something leaves the private room: an explicitly published
-- event.
--
-- Nothing here changes a Step 1 rule. Every private table below answers one
-- question for reads, `has_collaboration_access(collaboration_id)`, which is
-- the live Step 1A formula (active collaboration, active team row, at least
-- one accepted sponsorship through a participant in force whose unit still
-- includes the person). So:
--
--   * a representative who is not on the team — the FTR administrator acting
--     for FTR Oslo without living in Oslo — reads none of it;
--   * losing the last qualifying sponsorship, leaving the organisation, the
--     lokallag being retired or the unit withdrawing removes every read and
--     write on the next query, with no synchronisation job;
--   * content a former member wrote stays, for the people still on the team.
--
-- ── Two kinds of authority, again never merged ──────────────────────────
--
--   workspace member   := has_collaboration_access(c)
--   workspace manager  := has_collaboration_access(c) AND is_collaboration_manager(c)
--                         (manages_collaboration_workspace)
--
-- Management is institutional (Step 1A) and does not by itself open the
-- workspace: a manager without a team seat cannot read a channel, let alone
-- moderate one. Anything a manager does INSIDE the workspace — channels,
-- archiving documents or files, event planning, publishing — requires both.
--
-- ── Identity ────────────────────────────────────────────────────────────
--
-- Content carries account ids (author_id, created_by_user_id, …) and is only
-- ever rendered through `collaboration_profiles`. Writing requires the caller
-- to HAVE a collaboration profile, so new content never needs a fallback name.
-- Historical authors stay renderable: the profile policy is widened, for
-- people with access, to anyone who contributed content here — and to nobody
-- else, so the team directory still shows only the current team and a lapsed
-- person who never wrote anything simply is not visible.
--
-- ── The publication boundary ────────────────────────────────────────────
--
-- `collaboration_events` is private planning data, readable only by the team,
-- whatever its `audience` says: audience describes who may ATTEND the event,
-- never who may read the plan. Publishing copies an allowlisted projection
-- into `published_collaboration_events` — a snapshot, refreshed only by an
-- explicit "update publication" — and anonymous visitors read that projection
-- through one function, `published_event_by_slug()`, which returns only public
-- fields. No private table is granted to anon, and no public page reads a
-- private one.
--
-- Naming a participating unit as a public organiser is that unit's own
-- decision: a manager may ASK, but a unit appears publicly only with consent
-- from its own representative, and revoking that consent takes the unit off
-- the live page at once.
--
-- ── Surface ─────────────────────────────────────────────────────────────
--
-- As in Step 1: clients get SELECT through RLS and nothing else; every write
-- is a SECURITY DEFINER function below that takes the actor from auth.uid(),
-- re-derives authority from current rows, has search_path pinned, and is
-- revoked from PUBLIC and anon. Refusals return null / false alike.
--
-- Naming note: nothing here is called "archive…". Archiving a COLLABORATION
-- still has no client path (Step 1A, R3); archiving a channel or document is
-- `set_…_status(…, 'archived')`, and removing a file is `remove_…`.

-- ── Types ───────────────────────────────────────────────────────────────

create type public.collaboration_channel_status as enum ('active', 'archived');
create type public.collaboration_document_status as enum ('active', 'archived');
create type public.collaboration_task_status as enum ('todo', 'in_progress', 'done', 'cancelled');
create type public.collaboration_event_status as enum ('draft', 'confirmed', 'cancelled');
create type public.collaboration_event_audience as enum ('public', 'participating_organizations', 'invite_only');
create type public.collaboration_publication_status as enum ('published', 'unpublished');

-- ── Channel names ───────────────────────────────────────────────────────
--
-- "# Program og panel" → "program-og-panel". Lower case letters (including
-- æ, ø, å), digits and single hyphens; at most 40 characters. Pure text
-- shaping, no authority.

create or replace function public.normalize_channel_name(p_name text)
returns text language sql immutable set search_path = public as $$
  select btrim(left(btrim(regexp_replace(
    regexp_replace(lower(btrim(coalesce(p_name, ''))), '^#+', ''),
    '[^a-z0-9æøå]+', '-', 'g'
  ), '-'), 40), '-');
$$;

revoke execute on function public.normalize_channel_name(text) from public, anon, authenticated;

-- ═══════════════════════════════════════════════════════════════════════
-- Tables
-- ═══════════════════════════════════════════════════════════════════════

-- ── Channels ────────────────────────────────────────────────────────────
--
-- A collaboration's own channels. Not community `channels`: a collaboration
-- is not a community and nothing here pretends it is. Exactly one default
-- channel, `general`, is created with the collaboration (trigger below);
-- every other channel is made on purpose by a workspace manager. Channels are
-- never deleted by a client — archived instead, which keeps their history
-- readable and stops new posts.

create table public.collaboration_channels (
  id uuid primary key default gen_random_uuid(),
  collaboration_id uuid not null references public.collaborations (id) on delete cascade,
  name text not null,
  description text,
  position integer not null default 0,
  status public.collaboration_channel_status not null default 'active',
  is_default boolean not null default false,
  created_by_user_id uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,

  unique (id, collaboration_id),
  unique (collaboration_id, name),

  constraint collaboration_channels_name_shape check (
    name ~ '^[a-z0-9æøå]+(-[a-z0-9æøå]+)*$' and length(name) between 1 and 40
  ),
  constraint collaboration_channels_description_length check (
    description is null or length(description) between 1 and 300
  ),
  constraint collaboration_channels_archive_consistent check (
    (status = 'archived') = (archived_at is not null)
  ),
  constraint collaboration_channels_default_stays_active check (
    not is_default or status = 'active'
  )
);

create unique index collaboration_channels_one_default_idx
  on public.collaboration_channels (collaboration_id) where is_default;

comment on table public.collaboration_channels is
  'Channels inside one collaboration''s private workspace. Readable with effective collaboration access only; managed by workspace managers (manager AND access). Archived, never deleted, by clients.';

-- ── Messages and one-level threads ──────────────────────────────────────
--
-- parent_message_id null → a message in the channel; set → a reply in that
-- message's thread. The composite foreign key makes a reply name its parent
-- together with the SAME channel and collaboration, so a reply can never hang
-- off a message elsewhere. Threads are one level deep, enforced by a trigger
-- (a CHECK cannot look at another row) as well as by the posting function.
--
-- Deleting is soft: the text is erased and deleted_at set, so a thread under
-- it keeps its context and nothing a person removed stays stored.

create table public.collaboration_messages (
  id uuid primary key default gen_random_uuid(),
  collaboration_id uuid not null references public.collaborations (id) on delete cascade,
  channel_id uuid not null,
  author_id uuid references public.profiles (id) on delete set null,
  parent_message_id uuid,
  body text not null,
  created_at timestamptz not null default now(),
  edited_at timestamptz,
  deleted_at timestamptz,
  deleted_by_user_id uuid references public.profiles (id) on delete set null,

  unique (id, channel_id, collaboration_id),

  constraint collaboration_messages_channel_fkey
    foreign key (channel_id, collaboration_id)
    references public.collaboration_channels (id, collaboration_id)
    on delete cascade,
  constraint collaboration_messages_parent_fkey
    foreign key (parent_message_id, channel_id, collaboration_id)
    references public.collaboration_messages (id, channel_id, collaboration_id)
    on delete cascade,
  constraint collaboration_messages_not_own_parent check (
    parent_message_id is null or parent_message_id <> id
  ),
  constraint collaboration_messages_body check (
    case when deleted_at is null then length(body) between 1 and 4000 else body = '' end
  )
);

create index collaboration_messages_channel_idx
  on public.collaboration_messages (channel_id, created_at) where parent_message_id is null;
create index collaboration_messages_thread_idx
  on public.collaboration_messages (parent_message_id, created_at) where parent_message_id is not null;
create index collaboration_messages_recent_idx
  on public.collaboration_messages (collaboration_id, created_at desc);
create index collaboration_messages_author_idx
  on public.collaboration_messages (collaboration_id, author_id);

comment on table public.collaboration_messages is
  'Workspace messages. parent_message_id set = a thread reply; one level only, same channel and collaboration (composite FK + trigger). Author always auth.uid(). Soft-deleted rows keep no text.';

create or replace function public.collaboration_message_thread_depth()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.parent_message_id is not null then
    if exists (
      select 1 from collaboration_messages p
      where p.id = new.parent_message_id and p.parent_message_id is not null
    ) then
      raise exception using errcode = 'check_violation',
        message = 'collaboration threads are one level deep';
    end if;
    if tg_op = 'UPDATE' and exists (
      select 1 from collaboration_messages c where c.parent_message_id = new.id
    ) then
      raise exception using errcode = 'check_violation',
        message = 'a message with replies cannot become a reply';
    end if;
  end if;
  return new;
end;
$$;

create trigger collaboration_messages_thread_depth
  before insert or update of parent_message_id on public.collaboration_messages
  for each row execute function public.collaboration_message_thread_depth();

-- ── Documents, with every saved revision kept ───────────────────────────
--
-- Plain text (Markdown is welcome, and shown as written — nothing renders it
-- to HTML). No realtime co-editing: a save names the revision it was based on
-- and is refused as a conflict if someone saved in between, so nobody
-- silently overwrites anyone. Every saved state is kept in
-- collaboration_document_versions, so an accidental overwrite can be
-- recovered by saving an earlier revision again.

create table public.collaboration_documents (
  id uuid primary key default gen_random_uuid(),
  collaboration_id uuid not null references public.collaborations (id) on delete cascade,
  title text not null,
  content text not null default '',
  status public.collaboration_document_status not null default 'active',
  revision integer not null default 1,
  created_by_user_id uuid references public.profiles (id) on delete set null,
  updated_by_user_id uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,

  unique (id, collaboration_id),

  constraint collaboration_documents_title_shape check (
    title = btrim(title) and length(title) between 1 and 200
  ),
  constraint collaboration_documents_content_length check (length(content) <= 100000),
  constraint collaboration_documents_revision_positive check (revision >= 1),
  constraint collaboration_documents_archive_consistent check (
    (status = 'archived') = (archived_at is not null)
  )
);

create index collaboration_documents_recent_idx
  on public.collaboration_documents (collaboration_id, updated_at desc);

comment on table public.collaboration_documents is
  'Shared plain-text documents in the private workspace. Optimistic concurrency on `revision`; every saved state is in collaboration_document_versions.';

create table public.collaboration_document_versions (
  id uuid primary key default gen_random_uuid(),
  collaboration_id uuid not null,
  document_id uuid not null,
  revision integer not null,
  title text not null,
  content text not null,
  created_by_user_id uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),

  unique (document_id, revision),

  constraint collaboration_document_versions_document_fkey
    foreign key (document_id, collaboration_id)
    references public.collaboration_documents (id, collaboration_id)
    on delete cascade
);

comment on table public.collaboration_document_versions is
  'Every saved state of a collaboration document, oldest first. Written only by the document functions.';

-- ── Event planning (private) ────────────────────────────────────────────
--
-- A collaboration may plan several events. The row is PRIVATE planning data:
-- readable only with effective access, whatever `audience` says.
--
--   Publishable candidates: title, description, starts_at, ends_at,
--                           location, audience, registration_url, and the
--                           explicitly chosen organisers and image.
--   Always private:         internal_notes — never copied anywhere.
--
-- Status: draft → confirmed, or cancelled. Nothing is ever deleted by a
-- client.

create table public.collaboration_events (
  id uuid primary key default gen_random_uuid(),
  collaboration_id uuid not null references public.collaborations (id) on delete cascade,
  title text not null,
  description text,
  internal_notes text,
  starts_at timestamptz,
  ends_at timestamptz,
  location text,
  audience public.collaboration_event_audience not null default 'public',
  registration_url text,
  status public.collaboration_event_status not null default 'draft',
  public_image_file_id uuid,
  -- The folder a published image is copied into. Random, and used for
  -- nothing else, so a public image address names no private row.
  public_asset_key uuid not null default gen_random_uuid() unique,
  created_by_user_id uuid references public.profiles (id) on delete set null,
  updated_by_user_id uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (id, collaboration_id),

  constraint collaboration_events_title_shape check (
    title = btrim(title) and length(title) between 1 and 200
  ),
  constraint collaboration_events_description_length check (
    description is null or length(description) between 1 and 5000
  ),
  constraint collaboration_events_notes_length check (
    internal_notes is null or length(internal_notes) between 1 and 10000
  ),
  constraint collaboration_events_location_length check (
    location is null or length(location) between 1 and 300
  ),
  constraint collaboration_events_registration_url_shape check (
    registration_url is null
    or (registration_url ~ '^https?://[^[:space:]<>"]+$' and length(registration_url) <= 500)
  ),
  constraint collaboration_events_time_order check (
    ends_at is null or (starts_at is not null and ends_at >= starts_at)
  )
);

create index collaboration_events_collaboration_idx
  on public.collaboration_events (collaboration_id, starts_at);

comment on table public.collaboration_events is
  'PRIVATE event planning. audience describes who may attend the event, never who may read this row. Only published_collaboration_events is ever shown publicly.';
comment on column public.collaboration_events.internal_notes is
  'Always private. Never copied into a publication.';
comment on column public.collaboration_events.audience is
  'Who the EVENT is for. Does not affect access to this row or to the workspace; `public` makes nothing public by itself.';

-- Which participating units the managers would like named publicly as
-- organisers — a REQUEST, not a publication, and not by itself permission.
-- A unit appears on a public page only if it is selected here AND its own
-- representative has consented (collaboration_event_organizer_consents).
-- Readable by the team and by the representative of the unit concerned, so a
-- unit can see what it is being asked to put its name to.
create table public.collaboration_event_public_organizers (
  event_id uuid not null,
  collaboration_id uuid not null,
  participant_id uuid not null,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  primary key (event_id, participant_id),

  constraint collaboration_event_public_organizers_event_fkey
    foreign key (event_id, collaboration_id)
    references public.collaboration_events (id, collaboration_id)
    on delete cascade,
  constraint collaboration_event_public_organizers_participant_fkey
    foreign key (participant_id, collaboration_id)
    references public.collaboration_participants (id, collaboration_id)
    on delete cascade
);

comment on table public.collaboration_event_public_organizers is
  'Participating units a workspace manager asks to name as public organisers of one event. A request only: publication also requires that unit''s own consent.';

-- Each participating unit decides for itself whether it appears publicly as
-- an organiser of a given event. One row per (event, unit) the unit's own
-- representative has approved — granted by them explicitly, or implied when
-- a manager selects a unit they themselves represent. No other unit, and no
-- collaboration manager as such, can create or remove a unit's consent.
-- Who granted it is in collaboration_audit_log, not on this row, so the row
-- carries no account ids.
create table public.collaboration_event_organizer_consents (
  event_id uuid not null,
  collaboration_id uuid not null,
  participant_id uuid not null,
  granted_at timestamptz not null default now(),
  primary key (event_id, participant_id),

  constraint collaboration_event_organizer_consents_event_fkey
    foreign key (event_id, collaboration_id)
    references public.collaboration_events (id, collaboration_id)
    on delete cascade,
  constraint collaboration_event_organizer_consents_participant_fkey
    foreign key (participant_id, collaboration_id)
    references public.collaboration_participants (id, collaboration_id)
    on delete cascade
);

comment on table public.collaboration_event_organizer_consents is
  'A participating unit''s own approval to be named as a public organiser of one event. Granted and revoked only by that unit''s representative. Revoking removes the unit from the live publication at once.';

-- ── Tasks ───────────────────────────────────────────────────────────────
--
-- Deliberately small. Optional links to a channel, a document or an event of
-- the SAME collaboration (composite foreign keys), and nothing generic.

create table public.collaboration_tasks (
  id uuid primary key default gen_random_uuid(),
  collaboration_id uuid not null references public.collaborations (id) on delete cascade,
  title text not null,
  description text,
  status public.collaboration_task_status not null default 'todo',
  due_on date,
  related_channel_id uuid,
  related_document_id uuid,
  related_event_id uuid,
  created_by_user_id uuid references public.profiles (id) on delete set null,
  updated_by_user_id uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,

  unique (id, collaboration_id),

  constraint collaboration_tasks_title_shape check (
    title = btrim(title) and length(title) between 1 and 200
  ),
  constraint collaboration_tasks_description_length check (
    description is null or length(description) between 1 and 4000
  ),
  constraint collaboration_tasks_completion_consistent check (
    (status = 'done') = (completed_at is not null)
  ),
  constraint collaboration_tasks_channel_fkey
    foreign key (related_channel_id, collaboration_id)
    references public.collaboration_channels (id, collaboration_id)
    on delete set null (related_channel_id),
  constraint collaboration_tasks_document_fkey
    foreign key (related_document_id, collaboration_id)
    references public.collaboration_documents (id, collaboration_id)
    on delete set null (related_document_id),
  constraint collaboration_tasks_event_fkey
    foreign key (related_event_id, collaboration_id)
    references public.collaboration_events (id, collaboration_id)
    on delete set null (related_event_id)
);

create index collaboration_tasks_collaboration_idx
  on public.collaboration_tasks (collaboration_id, status, due_on);

comment on table public.collaboration_tasks is
  'Lightweight shared tasks. Members create; creator, assignees and workspace managers change status; creator and workspace managers edit and assign; creator and managers cancel.';

-- An assignee must be a person who JOINED this collaboration: the composite
-- foreign key to collaboration_members rules out anyone who never did, and
-- the assigning function additionally requires effective access right now.
create table public.collaboration_task_assignees (
  task_id uuid not null,
  collaboration_id uuid not null,
  user_id uuid not null,
  assigned_by_user_id uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (task_id, user_id),

  constraint collaboration_task_assignees_task_fkey
    foreign key (task_id, collaboration_id)
    references public.collaboration_tasks (id, collaboration_id)
    on delete cascade,
  constraint collaboration_task_assignees_member_fkey
    foreign key (collaboration_id, user_id)
    references public.collaboration_members (collaboration_id, user_id)
    on delete cascade
);

create index collaboration_task_assignees_user_idx
  on public.collaboration_task_assignees (collaboration_id, user_id);

-- ── Files ───────────────────────────────────────────────────────────────
--
-- Metadata for objects in the private `collaboration-files` bucket. The
-- object name is canonical — `<collaboration_id>/<file_id>.<ext>` — and never
-- contains the uploaded filename, which lives only in display_name. The
-- extension is derived from the verified type, not from what was uploaded.

create table public.collaboration_files (
  id uuid primary key,
  collaboration_id uuid not null references public.collaborations (id) on delete cascade,
  storage_path text not null unique,
  display_name text not null,
  mime_type text not null,
  size_bytes bigint not null,
  uploaded_by_user_id uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  archived_at timestamptz,
  archived_by_user_id uuid references public.profiles (id) on delete set null,

  unique (id, collaboration_id),

  constraint collaboration_files_display_name_shape check (
    display_name = btrim(display_name)
    and length(display_name) between 1 and 200
    and display_name !~ '[[:cntrl:]/\\]'
  ),
  constraint collaboration_files_size check (size_bytes between 1 and 8388608),
  constraint collaboration_files_mime_known check (mime_type in (
    'application/pdf',
    'image/png',
    'image/jpeg',
    'image/webp',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/vnd.oasis.opendocument.text',
    'application/vnd.oasis.opendocument.spreadsheet',
    'application/vnd.oasis.opendocument.presentation',
    'text/plain',
    'text/csv',
    'text/markdown'
  )),
  constraint collaboration_files_path_shape check (
    storage_path = collaboration_id::text || '/' || id::text || '.' || (case mime_type
      when 'application/pdf' then 'pdf'
      when 'image/png' then 'png'
      when 'image/jpeg' then 'jpg'
      when 'image/webp' then 'webp'
      when 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' then 'docx'
      when 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' then 'xlsx'
      when 'application/vnd.openxmlformats-officedocument.presentationml.presentation' then 'pptx'
      when 'application/vnd.oasis.opendocument.text' then 'odt'
      when 'application/vnd.oasis.opendocument.spreadsheet' then 'ods'
      when 'application/vnd.oasis.opendocument.presentation' then 'odp'
      when 'text/plain' then 'txt'
      when 'text/csv' then 'csv'
      when 'text/markdown' then 'md'
    end)
  )
);

create index collaboration_files_collaboration_idx
  on public.collaboration_files (collaboration_id, created_at desc);

comment on table public.collaboration_files is
  'Private collaboration files. Object name is <collaboration_id>/<file_id>.<ext>; the uploaded filename is display text only. Removed files keep their row (archived_at) and become unreadable.';

-- The event's chosen public image is one of the collaboration's own files.
alter table public.collaboration_events
  add constraint collaboration_events_public_image_fkey
    foreign key (public_image_file_id, collaboration_id)
    references public.collaboration_files (id, collaboration_id)
    on delete set null (public_image_file_id);

-- ── The public projection ───────────────────────────────────────────────
--
-- One row per event that has EVER been published. Only the allowlisted
-- public fields are copied in, at the moment someone publishes or updates the
-- publication; private edits afterwards change nothing here until the next
-- explicit update. `organizers` is a label snapshot (organisation name, local
-- group name, colours) of the units chosen for publication — no ids that
-- lead back into the private workspace.
--
-- The table itself is NOT readable anonymously. Visitors read one row at a
-- time through published_event_by_slug(), which returns public columns only.
-- The team can read the row (to see what is live) through ordinary RLS.
-- collaboration_id, source_event_id and the actor columns are private
-- bookkeeping and are never returned publicly.

create table public.published_collaboration_events (
  id uuid primary key default gen_random_uuid(),
  source_event_id uuid not null unique,
  collaboration_id uuid not null,
  public_slug text not null unique,
  status public.collaboration_publication_status not null default 'published',
  locale text not null,
  title text not null,
  description text,
  starts_at timestamptz not null,
  ends_at timestamptz,
  location text,
  audience public.collaboration_event_audience not null,
  registration_url text,
  is_cancelled boolean not null default false,
  organizers jsonb not null default '[]'::jsonb,
  public_image_path text,
  public_image_source_file_id uuid,
  first_published_at timestamptz not null default now(),
  published_at timestamptz not null default now(),
  published_by_user_id uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now(),
  unpublished_at timestamptz,
  unpublished_by_user_id uuid references public.profiles (id) on delete set null,

  constraint published_collaboration_events_source_fkey
    foreign key (source_event_id, collaboration_id)
    references public.collaboration_events (id, collaboration_id)
    on delete cascade,
  constraint published_collaboration_events_slug_shape check (
    public_slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(public_slug) between 3 and 90
  ),
  constraint published_collaboration_events_locale check (locale in ('nb', 'en')),
  constraint published_collaboration_events_organizers_array check (jsonb_typeof(organizers) = 'array'),
  constraint published_collaboration_events_unpublished_consistent check (
    (status = 'unpublished') = (unpublished_at is not null)
  ),
  -- `<event public_asset_key>/<uuid>.<ext>`; publish_collaboration_event()
  -- checks the folder is this event's key.
  constraint published_collaboration_events_image_shape check (
    public_image_path is null
    or public_image_path ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpg|webp)$'
  )
);

comment on table public.published_collaboration_events is
  'Explicit public snapshot of a collaboration event. Allowlisted fields only; refreshed only by an explicit publish/update. Anonymous visitors read it solely through published_event_by_slug().';

-- ── Audit: publication is a public act and is recorded as one ───────────

alter table public.collaboration_audit_log
  drop constraint collaboration_audit_log_action_known;
alter table public.collaboration_audit_log
  add constraint collaboration_audit_log_action_known check (action in (
    'collaboration_created',
    'participant_invited',
    'participant_accepted',
    'participant_declined',
    'participant_left',
    'sponsorship_invited',
    'sponsorship_accepted',
    'sponsorship_declined',
    'sponsorship_revoked',
    'member_joined',
    'member_left',
    'manager_seat_granted',
    'event_published',
    'event_publication_updated',
    'event_unpublished',
    'organizer_consent_granted',
    'organizer_consent_revoked'
  ));

-- ── Grants on tables ────────────────────────────────────────────────────
--
-- As in Step 1A: revoke Supabase's default DML, grant authenticated SELECT
-- only, and let RLS pick rows. anon gets nothing on any of these, including
-- the publication table.

revoke all on public.collaboration_channels from anon, authenticated;
revoke all on public.collaboration_messages from anon, authenticated;
revoke all on public.collaboration_documents from anon, authenticated;
revoke all on public.collaboration_document_versions from anon, authenticated;
revoke all on public.collaboration_events from anon, authenticated;
revoke all on public.collaboration_event_public_organizers from anon, authenticated;
revoke all on public.collaboration_event_organizer_consents from anon, authenticated;
revoke all on public.collaboration_tasks from anon, authenticated;
revoke all on public.collaboration_task_assignees from anon, authenticated;
revoke all on public.collaboration_files from anon, authenticated;
revoke all on public.published_collaboration_events from anon, authenticated;

grant select on public.collaboration_channels to authenticated;
grant select on public.collaboration_messages to authenticated;
grant select on public.collaboration_documents to authenticated;
grant select on public.collaboration_document_versions to authenticated;
grant select on public.collaboration_events to authenticated;
grant select on public.collaboration_event_public_organizers to authenticated;
grant select on public.collaboration_event_organizer_consents to authenticated;
grant select on public.collaboration_tasks to authenticated;
grant select on public.collaboration_task_assignees to authenticated;
grant select on public.collaboration_files to authenticated;
grant select on public.published_collaboration_events to authenticated;

alter table public.collaboration_channels enable row level security;
alter table public.collaboration_messages enable row level security;
alter table public.collaboration_documents enable row level security;
alter table public.collaboration_document_versions enable row level security;
alter table public.collaboration_events enable row level security;
alter table public.collaboration_event_public_organizers enable row level security;
alter table public.collaboration_event_organizer_consents enable row level security;
alter table public.collaboration_tasks enable row level security;
alter table public.collaboration_task_assignees enable row level security;
alter table public.collaboration_files enable row level security;
alter table public.published_collaboration_events enable row level security;

-- ═══════════════════════════════════════════════════════════════════════
-- Helpers
-- ═══════════════════════════════════════════════════════════════════════

-- Internal: the caller may put content into this collaboration — effective
-- access AND a collaboration profile to appear under. Never granted.
create or replace function public.collaboration_can_contribute(p_collaboration_id uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select auth.uid() is not null
    and collaboration_user_has_access(p_collaboration_id, auth.uid())
    and exists (
      select 1 from collaboration_profiles cp
      where cp.collaboration_id = p_collaboration_id
        and cp.user_id = auth.uid()
        and cp.display_name is not null
    );
$$;

-- Internal: whether a person left anything in this collaboration's shared
-- work — a message, a document or revision, a task or an assignment, a file,
-- an event plan. Never granted: it takes a user id.
create or replace function public.collaboration_user_contributed(
  p_collaboration_id uuid,
  p_user_id uuid
)
returns boolean language sql security definer stable set search_path = public as $$
  select p_user_id is not null and (
    exists (select 1 from collaboration_messages m
            where m.collaboration_id = p_collaboration_id and m.author_id = p_user_id)
    or exists (select 1 from collaboration_documents d
               where d.collaboration_id = p_collaboration_id
                 and (d.created_by_user_id = p_user_id or d.updated_by_user_id = p_user_id))
    or exists (select 1 from collaboration_document_versions v
               where v.collaboration_id = p_collaboration_id and v.created_by_user_id = p_user_id)
    or exists (select 1 from collaboration_tasks t
               where t.collaboration_id = p_collaboration_id and t.created_by_user_id = p_user_id)
    or exists (select 1 from collaboration_task_assignees a
               where a.collaboration_id = p_collaboration_id and a.user_id = p_user_id)
    or exists (select 1 from collaboration_files f
               where f.collaboration_id = p_collaboration_id and f.uploaded_by_user_id = p_user_id)
    or exists (select 1 from collaboration_events e
               where e.collaboration_id = p_collaboration_id
                 and (e.created_by_user_id = p_user_id or e.updated_by_user_id = p_user_id))
  );
$$;

revoke execute on function public.collaboration_can_contribute(uuid) from public, anon, authenticated;
revoke execute on function public.collaboration_user_contributed(uuid, uuid) from public, anon, authenticated;

-- Caller-scoped: a workspace manager is a collaboration manager who is ALSO
-- on the team with effective access. A representative-only manager is not.
create or replace function public.manages_collaboration_workspace(p_collaboration_id uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select has_collaboration_access(p_collaboration_id)
    and is_collaboration_manager(p_collaboration_id);
$$;

-- Caller-scoped: may the caller see the collaboration profile of someone
-- whose content they are looking at? Only with effective access themselves,
-- and only for a person who contributed here — so historical authorship
-- stays readable after that person's access ends, without turning the
-- profile table into a list of everyone who was ever on the team.
create or replace function public.can_view_collaboration_author(
  p_collaboration_id uuid,
  p_user_id uuid
)
returns boolean language sql security definer stable set search_path = public as $$
  select has_collaboration_access(p_collaboration_id)
    and collaboration_user_contributed(p_collaboration_id, p_user_id);
$$;

revoke execute on function public.manages_collaboration_workspace(uuid) from public, anon, authenticated;
revoke execute on function public.can_view_collaboration_author(uuid, uuid) from public, anon, authenticated;
grant execute on function public.manages_collaboration_workspace(uuid) to authenticated;
grant execute on function public.can_view_collaboration_author(uuid, uuid) to authenticated;

-- ── Policies (SELECT only; there are no write policies) ─────────────────

create policy collaboration_channels_select on public.collaboration_channels
  for select to authenticated using (has_collaboration_access(collaboration_id));

create policy collaboration_messages_select on public.collaboration_messages
  for select to authenticated using (has_collaboration_access(collaboration_id));

create policy collaboration_documents_select on public.collaboration_documents
  for select to authenticated using (has_collaboration_access(collaboration_id));

create policy collaboration_document_versions_select on public.collaboration_document_versions
  for select to authenticated using (has_collaboration_access(collaboration_id));

create policy collaboration_events_select on public.collaboration_events
  for select to authenticated using (has_collaboration_access(collaboration_id));

-- The team; and the representative of the unit concerned, for that unit's
-- own rows only — enough to see that it is being asked, never what else the
-- team decided.
create policy collaboration_event_public_organizers_select on public.collaboration_event_public_organizers
  for select to authenticated
  using (has_collaboration_access(collaboration_id) or represents_collaboration_participant(participant_id));

create policy collaboration_event_organizer_consents_select on public.collaboration_event_organizer_consents
  for select to authenticated
  using (has_collaboration_access(collaboration_id) or represents_collaboration_participant(participant_id));

create policy collaboration_tasks_select on public.collaboration_tasks
  for select to authenticated using (has_collaboration_access(collaboration_id));

create policy collaboration_task_assignees_select on public.collaboration_task_assignees
  for select to authenticated using (has_collaboration_access(collaboration_id));

-- A removed file is gone for every client, including its uploader.
create policy collaboration_files_select on public.collaboration_files
  for select to authenticated using (archived_at is null and has_collaboration_access(collaboration_id));

-- The team sees what is (or was) live. Visitors never read this table.
create policy published_collaboration_events_select on public.published_collaboration_events
  for select to authenticated using (has_collaboration_access(collaboration_id));

-- Step 1A showed a profile only between two people who both have access.
-- Keep that, and add historical authors (see can_view_collaboration_author).
drop policy collaboration_profiles_select on public.collaboration_profiles;
create policy collaboration_profiles_select on public.collaboration_profiles
  for select to authenticated
  using (
    can_view_collaboration_member(collaboration_id, user_id)
    or can_view_collaboration_author(collaboration_id, user_id)
  );

-- ═══════════════════════════════════════════════════════════════════════
-- Default channel
-- ═══════════════════════════════════════════════════════════════════════

create or replace function public.collaboration_create_default_channel()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into collaboration_channels (collaboration_id, name, position, is_default, created_by_user_id)
  values (new.id, 'general', 0, true, new.created_by_user_id)
  on conflict do nothing;
  return new;
end;
$$;

revoke execute on function public.collaboration_create_default_channel() from public, anon, authenticated;
revoke execute on function public.collaboration_message_thread_depth() from public, anon, authenticated;

create trigger collaborations_default_channel
  after insert on public.collaborations
  for each row execute function public.collaboration_create_default_channel();

-- Collaborations that already exist get theirs now.
insert into public.collaboration_channels (collaboration_id, name, position, is_default, created_by_user_id)
select c.id, 'general', 0, true, c.created_by_user_id
from public.collaborations c
on conflict do nothing;

-- ═══════════════════════════════════════════════════════════════════════
-- Channels
-- ═══════════════════════════════════════════════════════════════════════

create or replace function public.create_collaboration_channel(
  p_collaboration_id uuid,
  p_name text,
  p_description text
)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_name text := normalize_channel_name(p_name);
  v_description text := nullif(btrim(coalesce(p_description, '')), '');
  v_id uuid;
begin
  if not manages_collaboration_workspace(p_collaboration_id) then
    return null;
  end if;
  if v_name is null or v_name = '' or (v_description is not null and length(v_description) > 300) then
    return null;
  end if;

  -- Serialise channel creation per collaboration so the position and the
  -- name check agree with the unique index.
  perform 1 from collaborations c where c.id = p_collaboration_id for update;

  if exists (
    select 1 from collaboration_channels ch
    where ch.collaboration_id = p_collaboration_id and ch.name = v_name
  ) or (
    select count(*) from collaboration_channels ch where ch.collaboration_id = p_collaboration_id
  ) >= 50 then
    return null;
  end if;

  insert into collaboration_channels (collaboration_id, name, description, position, created_by_user_id)
  select p_collaboration_id, v_name, v_description, coalesce(max(ch.position), 0) + 1, auth.uid()
  from collaboration_channels ch
  where ch.collaboration_id = p_collaboration_id
  returning id into v_id;

  return v_id;
end;
$$;

create or replace function public.update_collaboration_channel(
  p_channel_id uuid,
  p_name text,
  p_description text
)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  v_ch collaboration_channels%rowtype;
  v_name text := normalize_channel_name(p_name);
  v_description text := nullif(btrim(coalesce(p_description, '')), '');
begin
  select * into v_ch from collaboration_channels where id = p_channel_id for update;
  if v_ch.id is null or not manages_collaboration_workspace(v_ch.collaboration_id) then
    return false;
  end if;
  if v_name is null or v_name = '' or (v_description is not null and length(v_description) > 300) then
    return false;
  end if;
  if exists (
    select 1 from collaboration_channels ch
    where ch.collaboration_id = v_ch.collaboration_id and ch.name = v_name and ch.id <> v_ch.id
  ) then
    return false;
  end if;

  update collaboration_channels
     set name = v_name, description = v_description, updated_at = now()
   where id = v_ch.id;
  return true;
end;
$$;

-- Archive or restore. The default channel stays active: every collaboration
-- keeps one place to talk.
create or replace function public.set_collaboration_channel_status(
  p_channel_id uuid,
  p_status public.collaboration_channel_status
)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  v_ch collaboration_channels%rowtype;
begin
  select * into v_ch from collaboration_channels where id = p_channel_id for update;
  if v_ch.id is null or p_status is null or not manages_collaboration_workspace(v_ch.collaboration_id) then
    return false;
  end if;
  if v_ch.status = p_status then
    return true;
  end if;
  if v_ch.is_default and p_status = 'archived' then
    return false;
  end if;

  update collaboration_channels
     set status = p_status,
         archived_at = case when p_status = 'archived' then now() end,
         updated_at = now()
   where id = v_ch.id;
  return true;
end;
$$;

-- ═══════════════════════════════════════════════════════════════════════
-- Messages and threads
-- ═══════════════════════════════════════════════════════════════════════

-- Post in a channel (p_parent_message_id null) or reply in a thread. The
-- author is auth.uid(); the collaboration comes from the channel, never from
-- the caller. A reply must name a top-level, undeleted message of the SAME
-- channel. Archived channels take no new posts.
create or replace function public.post_collaboration_message(
  p_channel_id uuid,
  p_parent_message_id uuid,
  p_body text
)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_ch collaboration_channels%rowtype;
  v_parent collaboration_messages%rowtype;
  v_body text := regexp_replace(coalesce(p_body, ''), '^[[:space:]]+|[[:space:]]+$', '', 'g');
  v_id uuid;
begin
  if auth.uid() is null then
    return null;
  end if;

  select * into v_ch from collaboration_channels where id = p_channel_id;
  if v_ch.id is null
     or v_ch.status <> 'active'
     or not collaboration_can_contribute(v_ch.collaboration_id)
  then
    return null;
  end if;
  if length(v_body) = 0 or length(v_body) > 4000 then
    return null;
  end if;

  if p_parent_message_id is not null then
    select * into v_parent from collaboration_messages where id = p_parent_message_id;
    if v_parent.id is null
       or v_parent.collaboration_id <> v_ch.collaboration_id
       or v_parent.channel_id <> v_ch.id
       or v_parent.parent_message_id is not null
       or v_parent.deleted_at is not null
    then
      return null;
    end if;
  end if;

  insert into collaboration_messages (collaboration_id, channel_id, author_id, parent_message_id, body)
  values (v_ch.collaboration_id, v_ch.id, auth.uid(), p_parent_message_id, v_body)
  returning id into v_id;
  return v_id;
end;
$$;

-- Only the author, only while they can still contribute, only in an active
-- channel, and never a deleted message.
create or replace function public.edit_collaboration_message(p_message_id uuid, p_body text)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  v_m collaboration_messages%rowtype;
  v_body text := regexp_replace(coalesce(p_body, ''), '^[[:space:]]+|[[:space:]]+$', '', 'g');
begin
  if auth.uid() is null then
    return false;
  end if;
  select * into v_m from collaboration_messages where id = p_message_id for update;
  if v_m.id is null
     or v_m.author_id is distinct from auth.uid()
     or v_m.deleted_at is not null
     or not collaboration_can_contribute(v_m.collaboration_id)
     or not exists (
       select 1 from collaboration_channels ch where ch.id = v_m.channel_id and ch.status = 'active'
     )
  then
    return false;
  end if;
  if length(v_body) = 0 or length(v_body) > 4000 then
    return false;
  end if;
  if v_body <> v_m.body then
    update collaboration_messages set body = v_body, edited_at = now() where id = v_m.id;
  end if;
  return true;
end;
$$;

-- The author, or a workspace manager moderating (who must have access too).
-- The text is erased; replies in its thread stay.
create or replace function public.delete_collaboration_message(p_message_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  v_m collaboration_messages%rowtype;
begin
  if auth.uid() is null then
    return false;
  end if;
  select * into v_m from collaboration_messages where id = p_message_id for update;
  if v_m.id is null or not has_collaboration_access(v_m.collaboration_id) then
    return false;
  end if;
  if v_m.author_id is distinct from auth.uid() and not manages_collaboration_workspace(v_m.collaboration_id) then
    return false;
  end if;
  if v_m.deleted_at is not null then
    return true;
  end if;
  update collaboration_messages
     set body = '', deleted_at = now(), deleted_by_user_id = auth.uid()
   where id = v_m.id;
  return true;
end;
$$;

-- ═══════════════════════════════════════════════════════════════════════
-- Documents
-- ═══════════════════════════════════════════════════════════════════════

create or replace function public.create_collaboration_document(
  p_collaboration_id uuid,
  p_title text,
  p_content text
)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_title text := btrim(coalesce(p_title, ''));
  v_content text := coalesce(p_content, '');
  v_id uuid;
begin
  if not collaboration_can_contribute(p_collaboration_id) then
    return null;
  end if;
  if length(v_title) = 0 or length(v_title) > 200 or length(v_content) > 100000 then
    return null;
  end if;
  if (select count(*) from collaboration_documents d where d.collaboration_id = p_collaboration_id) >= 500 then
    return null;
  end if;

  insert into collaboration_documents (collaboration_id, title, content, created_by_user_id, updated_by_user_id)
  values (p_collaboration_id, v_title, v_content, auth.uid(), auth.uid())
  returning id into v_id;

  insert into collaboration_document_versions (collaboration_id, document_id, revision, title, content, created_by_user_id)
  values (p_collaboration_id, v_id, 1, v_title, v_content, auth.uid());
  return v_id;
end;
$$;

-- Save, based on a known revision.
--   'saved'     — written as the next revision (and kept in the history);
--   'unchanged' — nothing differed, nothing written;
--   'conflict'  — someone saved after p_expected_revision; nothing written,
--                 and saved_revision is the current one;
--   nulls       — refused (no access, archived, invalid).
-- Restoring an earlier version is simply saving its text again.
create or replace function public.save_collaboration_document(
  p_document_id uuid,
  p_expected_revision integer,
  p_title text,
  p_content text,
  out save_result text,
  out saved_revision integer
)
language plpgsql security definer set search_path = public as $$
declare
  v_doc collaboration_documents%rowtype;
  v_title text := btrim(coalesce(p_title, ''));
  v_content text := coalesce(p_content, '');
begin
  select * into v_doc from collaboration_documents where id = p_document_id for update;
  if v_doc.id is null
     or v_doc.status <> 'active'
     or not collaboration_can_contribute(v_doc.collaboration_id)
  then
    return;
  end if;
  if length(v_title) = 0 or length(v_title) > 200 or length(v_content) > 100000 then
    return;
  end if;

  if p_expected_revision is distinct from v_doc.revision then
    save_result := 'conflict';
    saved_revision := v_doc.revision;
    return;
  end if;
  if v_title = v_doc.title and v_content = v_doc.content then
    save_result := 'unchanged';
    saved_revision := v_doc.revision;
    return;
  end if;

  update collaboration_documents
     set title = v_title,
         content = v_content,
         revision = v_doc.revision + 1,
         updated_by_user_id = auth.uid(),
         updated_at = now()
   where id = v_doc.id;

  insert into collaboration_document_versions (collaboration_id, document_id, revision, title, content, created_by_user_id)
  values (v_doc.collaboration_id, v_doc.id, v_doc.revision + 1, v_title, v_content, auth.uid());

  save_result := 'saved';
  saved_revision := v_doc.revision + 1;
end;
$$;

create or replace function public.set_collaboration_document_status(
  p_document_id uuid,
  p_status public.collaboration_document_status
)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  v_doc collaboration_documents%rowtype;
begin
  select * into v_doc from collaboration_documents where id = p_document_id for update;
  if v_doc.id is null or p_status is null or not manages_collaboration_workspace(v_doc.collaboration_id) then
    return false;
  end if;
  if v_doc.status <> p_status then
    update collaboration_documents
       set status = p_status,
           archived_at = case when p_status = 'archived' then now() end,
           updated_at = now()
     where id = v_doc.id;
  end if;
  return true;
end;
$$;

-- ═══════════════════════════════════════════════════════════════════════
-- Tasks
-- ═══════════════════════════════════════════════════════════════════════

-- Internal: every id in a proposed assignee list is someone who could be
-- assigned right now — on the team with effective access and a
-- collaboration profile. p_keep are people already assigned to the task, who
-- may stay assigned after their access ends (history), but nobody is ADDED
-- who does not qualify.
create or replace function public.collaboration_assignees_valid(
  p_collaboration_id uuid,
  p_assignee_ids uuid[],
  p_keep uuid[]
)
returns boolean language sql security definer stable set search_path = public as $$
  select coalesce(array_length(p_assignee_ids, 1), 0) <= 10
    and not exists (
      select 1 from unnest(coalesce(p_assignee_ids, '{}')) as a(user_id)
      where a.user_id is null
         or (
           not (a.user_id = any(coalesce(p_keep, '{}')))
           and not (
             collaboration_user_has_access(p_collaboration_id, a.user_id)
             and exists (
               select 1 from collaboration_profiles cp
               where cp.collaboration_id = p_collaboration_id
                 and cp.user_id = a.user_id
                 and cp.display_name is not null
             )
           )
         )
    );
$$;

-- Internal: optional links point into the same collaboration.
create or replace function public.collaboration_task_links_valid(
  p_collaboration_id uuid,
  p_channel_id uuid,
  p_document_id uuid,
  p_event_id uuid
)
returns boolean language sql security definer stable set search_path = public as $$
  select (p_channel_id is null or exists (
            select 1 from collaboration_channels ch
            where ch.id = p_channel_id and ch.collaboration_id = p_collaboration_id))
     and (p_document_id is null or exists (
            select 1 from collaboration_documents d
            where d.id = p_document_id and d.collaboration_id = p_collaboration_id))
     and (p_event_id is null or exists (
            select 1 from collaboration_events e
            where e.id = p_event_id and e.collaboration_id = p_collaboration_id));
$$;

revoke execute on function public.collaboration_assignees_valid(uuid, uuid[], uuid[]) from public, anon, authenticated;
revoke execute on function public.collaboration_task_links_valid(uuid, uuid, uuid, uuid) from public, anon, authenticated;

-- Any workspace member may create a task, and may name assignees from the
-- current team when doing so.
create or replace function public.create_collaboration_task(
  p_collaboration_id uuid,
  p_title text,
  p_description text,
  p_due_on date,
  p_related_channel_id uuid,
  p_related_document_id uuid,
  p_related_event_id uuid,
  p_assignee_ids uuid[]
)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_title text := btrim(coalesce(p_title, ''));
  v_description text := nullif(btrim(coalesce(p_description, '')), '');
  v_id uuid;
begin
  if not collaboration_can_contribute(p_collaboration_id) then
    return null;
  end if;
  if length(v_title) = 0 or length(v_title) > 200
     or (v_description is not null and length(v_description) > 4000)
     or not collaboration_task_links_valid(p_collaboration_id, p_related_channel_id, p_related_document_id, p_related_event_id)
     or not collaboration_assignees_valid(p_collaboration_id, p_assignee_ids, '{}')
  then
    return null;
  end if;
  if (select count(*) from collaboration_tasks t where t.collaboration_id = p_collaboration_id) >= 2000 then
    return null;
  end if;

  insert into collaboration_tasks (
    collaboration_id, title, description, due_on,
    related_channel_id, related_document_id, related_event_id,
    created_by_user_id, updated_by_user_id
  )
  values (
    p_collaboration_id, v_title, v_description, p_due_on,
    p_related_channel_id, p_related_document_id, p_related_event_id,
    auth.uid(), auth.uid()
  )
  returning id into v_id;

  insert into collaboration_task_assignees (task_id, collaboration_id, user_id, assigned_by_user_id)
  select distinct v_id, p_collaboration_id, a.user_id, auth.uid()
  from unnest(coalesce(p_assignee_ids, '{}')) as a(user_id);

  return v_id;
end;
$$;

-- The task's creator, or a workspace manager.
create or replace function public.update_collaboration_task(
  p_task_id uuid,
  p_title text,
  p_description text,
  p_due_on date,
  p_related_channel_id uuid,
  p_related_document_id uuid,
  p_related_event_id uuid
)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  v_t collaboration_tasks%rowtype;
  v_title text := btrim(coalesce(p_title, ''));
  v_description text := nullif(btrim(coalesce(p_description, '')), '');
begin
  select * into v_t from collaboration_tasks where id = p_task_id for update;
  if v_t.id is null
     or not collaboration_can_contribute(v_t.collaboration_id)
     or not (v_t.created_by_user_id is not distinct from auth.uid() or manages_collaboration_workspace(v_t.collaboration_id))
  then
    return false;
  end if;
  if length(v_title) = 0 or length(v_title) > 200
     or (v_description is not null and length(v_description) > 4000)
     or not collaboration_task_links_valid(v_t.collaboration_id, p_related_channel_id, p_related_document_id, p_related_event_id)
  then
    return false;
  end if;

  update collaboration_tasks
     set title = v_title,
         description = v_description,
         due_on = p_due_on,
         related_channel_id = p_related_channel_id,
         related_document_id = p_related_document_id,
         related_event_id = p_related_event_id,
         updated_by_user_id = auth.uid(),
         updated_at = now()
   where id = v_t.id;
  return true;
end;
$$;

-- Status rules:
--   todo / in_progress / done — the creator, an assignee, or a workspace manager;
--   cancelled, or bringing a cancelled task back — the creator or a workspace manager.
create or replace function public.set_collaboration_task_status(
  p_task_id uuid,
  p_status public.collaboration_task_status
)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  v_t collaboration_tasks%rowtype;
  v_owner boolean;
  v_assignee boolean;
begin
  select * into v_t from collaboration_tasks where id = p_task_id for update;
  if v_t.id is null or p_status is null or not collaboration_can_contribute(v_t.collaboration_id) then
    return false;
  end if;

  v_owner := v_t.created_by_user_id is not distinct from auth.uid() or manages_collaboration_workspace(v_t.collaboration_id);
  v_assignee := exists (
    select 1 from collaboration_task_assignees a where a.task_id = v_t.id and a.user_id = auth.uid()
  );

  if (p_status = 'cancelled' or v_t.status = 'cancelled') then
    if not v_owner then
      return false;
    end if;
  elsif not (v_owner or v_assignee) then
    return false;
  end if;

  if v_t.status <> p_status then
    update collaboration_tasks
       set status = p_status,
           completed_at = case when p_status = 'done' then now() end,
           updated_by_user_id = auth.uid(),
           updated_at = now()
     where id = v_t.id;
  end if;
  return true;
end;
$$;

-- Replace the assignee set. The creator or a workspace manager. New names
-- must be on the team now; people already assigned may stay.
create or replace function public.set_collaboration_task_assignees(
  p_task_id uuid,
  p_assignee_ids uuid[]
)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  v_t collaboration_tasks%rowtype;
  v_current uuid[];
begin
  select * into v_t from collaboration_tasks where id = p_task_id for update;
  if v_t.id is null
     or not collaboration_can_contribute(v_t.collaboration_id)
     or not (v_t.created_by_user_id is not distinct from auth.uid() or manages_collaboration_workspace(v_t.collaboration_id))
  then
    return false;
  end if;

  select coalesce(array_agg(a.user_id), '{}') into v_current
  from collaboration_task_assignees a where a.task_id = v_t.id;

  if not collaboration_assignees_valid(v_t.collaboration_id, p_assignee_ids, v_current) then
    return false;
  end if;

  delete from collaboration_task_assignees a
   where a.task_id = v_t.id
     and not (a.user_id = any(coalesce(p_assignee_ids, '{}')));

  insert into collaboration_task_assignees (task_id, collaboration_id, user_id, assigned_by_user_id)
  select distinct v_t.id, v_t.collaboration_id, a.user_id, auth.uid()
  from unnest(coalesce(p_assignee_ids, '{}')) as a(user_id)
  on conflict (task_id, user_id) do nothing;

  update collaboration_tasks set updated_by_user_id = auth.uid(), updated_at = now() where id = v_t.id;
  return true;
end;
$$;

-- ═══════════════════════════════════════════════════════════════════════
-- Files
-- ═══════════════════════════════════════════════════════════════════════

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'collaboration-files',
  'collaboration-files',
  false,
  8388608,                                         -- 8 MiB
  array[
    'application/pdf',
    'image/png',
    'image/jpeg',
    'image/webp',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/vnd.oasis.opendocument.text',
    'application/vnd.oasis.opendocument.spreadsheet',
    'application/vnd.oasis.opendocument.presentation',
    'text/plain',
    'text/csv',
    'text/markdown'
  ]
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- The exact object-name shape: <collaboration uuid>/<file uuid>.<ext>.
-- Parsed before any uuid cast, so a malformed name is simply nobody's file.
create or replace function public.collaboration_file_object_collaboration(p_name text)
returns uuid language sql security definer immutable set search_path = public as $$
  select case
    when p_name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(pdf|png|jpg|webp|docx|xlsx|pptx|odt|ods|odp|txt|csv|md)$'
    then split_part(p_name, '/', 1)::uuid
  end;
$$;

revoke execute on function public.collaboration_file_object_collaboration(text) from public, anon, authenticated;

-- Read one object: a registered, not-removed file of a collaboration the
-- caller has access to — decided from the metadata row, never from the name.
-- Plus the caller's own just-uploaded object before it is registered, so the
-- upload itself can complete; nobody else can see an unregistered object.
create or replace function public.can_read_collaboration_file_object(p_name text)
returns boolean language sql security definer stable set search_path = public as $$
  select auth.uid() is not null and (
    exists (
      select 1 from collaboration_files f
      where f.storage_path = p_name
        and f.archived_at is null
        and has_collaboration_access(f.collaboration_id)
    )
    or (
      not exists (select 1 from collaboration_files f where f.storage_path = p_name)
      and exists (
        select 1 from storage.objects o
        where o.bucket_id = 'collaboration-files'
          and o.name = p_name
          and o.owner_id = auth.uid()::text
      )
      and coalesce(collaboration_can_contribute(collaboration_file_object_collaboration(p_name)), false)
    )
  );
$$;

-- Upload: exact shape, into a collaboration the caller can contribute to,
-- and never onto a name a registered file already uses.
create or replace function public.can_upload_collaboration_file_object(p_name text)
returns boolean language sql security definer stable set search_path = public as $$
  select collaboration_file_object_collaboration(p_name) is not null
    and collaboration_can_contribute(collaboration_file_object_collaboration(p_name))
    and not exists (select 1 from collaboration_files f where f.storage_path = p_name);
$$;

-- Delete: only your own object that never became a registered file (a
-- failed or refused upload cleaning up after itself). Registered files are
-- removed through remove_collaboration_file(), which keeps the history.
create or replace function public.can_discard_collaboration_file_object(p_name text)
returns boolean language sql security definer stable set search_path = public as $$
  select auth.uid() is not null
    and collaboration_file_object_collaboration(p_name) is not null
    and not exists (select 1 from collaboration_files f where f.storage_path = p_name)
    and exists (
      select 1 from storage.objects o
      where o.bucket_id = 'collaboration-files'
        and o.name = p_name
        and o.owner_id = auth.uid()::text
    );
$$;

revoke execute on function public.can_read_collaboration_file_object(text) from public, anon, authenticated;
revoke execute on function public.can_upload_collaboration_file_object(text) from public, anon, authenticated;
revoke execute on function public.can_discard_collaboration_file_object(text) from public, anon, authenticated;
grant execute on function public.can_read_collaboration_file_object(text) to authenticated;
grant execute on function public.can_upload_collaboration_file_object(text) to authenticated;
grant execute on function public.can_discard_collaboration_file_object(text) to authenticated;

create policy collaboration_files_read on storage.objects for select to authenticated
using (bucket_id = 'collaboration-files' and can_read_collaboration_file_object(name));

create policy collaboration_files_write on storage.objects for insert to authenticated
with check (bucket_id = 'collaboration-files' and can_upload_collaboration_file_object(name));

create policy collaboration_files_discard on storage.objects for delete to authenticated
using (bucket_id = 'collaboration-files' and can_discard_collaboration_file_object(name));

-- No update policy: an object is written once.

-- Register an uploaded object as a shared file. Size and type are read from
-- what Storage actually stored, not from the caller; the object must be the
-- caller's own upload under this collaboration and this file id.
create or replace function public.register_collaboration_file(
  p_collaboration_id uuid,
  p_file_id uuid,
  p_display_name text,
  p_mime_type text
)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_name text := btrim(coalesce(p_display_name, ''));
  v_ext text;
  v_path text;
  v_object storage.objects%rowtype;
  v_size bigint;
begin
  if p_file_id is null or not collaboration_can_contribute(p_collaboration_id) then
    return null;
  end if;

  v_ext := case p_mime_type
    when 'application/pdf' then 'pdf'
    when 'image/png' then 'png'
    when 'image/jpeg' then 'jpg'
    when 'image/webp' then 'webp'
    when 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' then 'docx'
    when 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' then 'xlsx'
    when 'application/vnd.openxmlformats-officedocument.presentationml.presentation' then 'pptx'
    when 'application/vnd.oasis.opendocument.text' then 'odt'
    when 'application/vnd.oasis.opendocument.spreadsheet' then 'ods'
    when 'application/vnd.oasis.opendocument.presentation' then 'odp'
    when 'text/plain' then 'txt'
    when 'text/csv' then 'csv'
    when 'text/markdown' then 'md'
  end;
  if v_ext is null
     or length(v_name) = 0 or length(v_name) > 200 or v_name ~ '[[:cntrl:]/\\]'
  then
    return null;
  end if;

  v_path := p_collaboration_id::text || '/' || p_file_id::text || '.' || v_ext;

  select * into v_object from storage.objects o
  where o.bucket_id = 'collaboration-files' and o.name = v_path;
  if v_object.id is null
     or v_object.owner_id is distinct from auth.uid()::text
     or v_object.metadata ->> 'mimetype' is distinct from p_mime_type
  then
    return null;
  end if;

  v_size := nullif(v_object.metadata ->> 'size', '')::bigint;
  if v_size is null or v_size < 1 or v_size > 8388608 then
    return null;
  end if;

  if exists (select 1 from collaboration_files f where f.id = p_file_id or f.storage_path = v_path) then
    return null;
  end if;

  insert into collaboration_files (id, collaboration_id, storage_path, display_name, mime_type, size_bytes, uploaded_by_user_id)
  values (p_file_id, p_collaboration_id, v_path, v_name, p_mime_type, v_size, auth.uid());
  return p_file_id;
end;
$$;

-- Remove a shared file: its uploader or a workspace manager. The row and the
-- object stay (history); both become unreadable to every client at once.
create or replace function public.remove_collaboration_file(p_file_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  v_f collaboration_files%rowtype;
begin
  select * into v_f from collaboration_files where id = p_file_id for update;
  if v_f.id is null or not has_collaboration_access(v_f.collaboration_id) then
    return false;
  end if;
  if v_f.uploaded_by_user_id is distinct from auth.uid()
     and not manages_collaboration_workspace(v_f.collaboration_id)
  then
    return false;
  end if;
  if v_f.archived_at is null then
    update collaboration_files set archived_at = now(), archived_by_user_id = auth.uid() where id = v_f.id;
    update collaboration_events set public_image_file_id = null
     where public_image_file_id = v_f.id;
  end if;
  return true;
end;
$$;

-- ═══════════════════════════════════════════════════════════════════════
-- Event planning
-- ═══════════════════════════════════════════════════════════════════════

-- Internal: shape checks shared by create and update. Returns true when the
-- fields are acceptable.
create or replace function public.collaboration_event_fields_valid(
  p_title text,
  p_description text,
  p_internal_notes text,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_location text,
  p_registration_url text
)
returns boolean language sql security definer immutable set search_path = public as $$
  select length(btrim(coalesce(p_title, ''))) between 1 and 200
    and coalesce(length(nullif(btrim(coalesce(p_description, '')), '')), 0) <= 5000
    and coalesce(length(nullif(btrim(coalesce(p_internal_notes, '')), '')), 0) <= 10000
    and coalesce(length(nullif(btrim(coalesce(p_location, '')), '')), 0) <= 300
    and (p_ends_at is null or (p_starts_at is not null and p_ends_at >= p_starts_at))
    and (
      nullif(btrim(coalesce(p_registration_url, '')), '') is null
      or (
        btrim(p_registration_url) ~ '^https?://[^[:space:]<>"]+$'
        and length(btrim(p_registration_url)) <= 500
      )
    );
$$;

revoke execute on function public.collaboration_event_fields_valid(text, text, text, timestamptz, timestamptz, text, text) from public, anon, authenticated;

-- Workspace managers only (manager AND access). Conservative on purpose: the
-- plan is what may one day be published.
create or replace function public.create_collaboration_event(
  p_collaboration_id uuid,
  p_title text,
  p_description text,
  p_internal_notes text,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_location text,
  p_audience public.collaboration_event_audience,
  p_registration_url text,
  p_status public.collaboration_event_status
)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
begin
  if not manages_collaboration_workspace(p_collaboration_id)
     or not collaboration_can_contribute(p_collaboration_id)
     or p_audience is null or p_status is null
     or not collaboration_event_fields_valid(p_title, p_description, p_internal_notes, p_starts_at, p_ends_at, p_location, p_registration_url)
  then
    return null;
  end if;
  if (select count(*) from collaboration_events e where e.collaboration_id = p_collaboration_id) >= 50 then
    return null;
  end if;

  insert into collaboration_events (
    collaboration_id, title, description, internal_notes, starts_at, ends_at,
    location, audience, registration_url, status, created_by_user_id, updated_by_user_id
  )
  values (
    p_collaboration_id,
    btrim(p_title),
    nullif(btrim(coalesce(p_description, '')), ''),
    nullif(btrim(coalesce(p_internal_notes, '')), ''),
    p_starts_at,
    p_ends_at,
    nullif(btrim(coalesce(p_location, '')), ''),
    p_audience,
    nullif(btrim(coalesce(p_registration_url, '')), ''),
    p_status,
    auth.uid(),
    auth.uid()
  )
  returning id into v_id;
  return v_id;
end;
$$;

-- Editing the PRIVATE plan. A publication, if there is one, is not touched.
create or replace function public.update_collaboration_event(
  p_event_id uuid,
  p_title text,
  p_description text,
  p_internal_notes text,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_location text,
  p_audience public.collaboration_event_audience,
  p_registration_url text,
  p_status public.collaboration_event_status
)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  v_e collaboration_events%rowtype;
begin
  select * into v_e from collaboration_events where id = p_event_id for update;
  if v_e.id is null
     or not manages_collaboration_workspace(v_e.collaboration_id)
     or not collaboration_can_contribute(v_e.collaboration_id)
     or p_audience is null or p_status is null
     or not collaboration_event_fields_valid(p_title, p_description, p_internal_notes, p_starts_at, p_ends_at, p_location, p_registration_url)
  then
    return false;
  end if;

  update collaboration_events
     set title = btrim(p_title),
         description = nullif(btrim(coalesce(p_description, '')), ''),
         internal_notes = nullif(btrim(coalesce(p_internal_notes, '')), ''),
         starts_at = p_starts_at,
         ends_at = p_ends_at,
         location = nullif(btrim(coalesce(p_location, '')), ''),
         audience = p_audience,
         registration_url = nullif(btrim(coalesce(p_registration_url, '')), ''),
         status = p_status,
         updated_by_user_id = auth.uid(),
         updated_at = now()
   where id = v_e.id;
  return true;
end;
$$;

-- Which ACTIVE participating units the managers would like to name publicly.
-- Replaces the selection; order follows the array. Nothing is published by
-- this, and it grants nothing on another unit's behalf:
--   * a unit the CALLER represents is consented at once — the caller already
--     holds that unit's authority;
--   * every other unit stays a request until its own representative approves
--     (set_collaboration_event_organizer_consent);
--   * a unit taken out of the selection loses its consent, so selecting it
--     again later asks again.
create or replace function public.set_collaboration_event_organizers(
  p_event_id uuid,
  p_participant_ids uuid[]
)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  v_e collaboration_events%rowtype;
  v_dropped uuid;
  v_own uuid;
begin
  select * into v_e from collaboration_events where id = p_event_id for update;
  if v_e.id is null or not manages_collaboration_workspace(v_e.collaboration_id) then
    return false;
  end if;
  if coalesce(array_length(p_participant_ids, 1), 0) > 20 or exists (
    select 1 from unnest(coalesce(p_participant_ids, '{}')) as x(participant_id)
    where x.participant_id is null or not exists (
      select 1 from collaboration_participants p
      where p.id = x.participant_id
        and p.collaboration_id = v_e.collaboration_id
        and p.status = 'active'
    )
  ) then
    return false;
  end if;

  for v_dropped in
    delete from collaboration_event_organizer_consents c
     where c.event_id = v_e.id
       and not (c.participant_id = any(coalesce(p_participant_ids, '{}')))
    returning c.participant_id
  loop
    perform collaboration_log(v_e.collaboration_id, 'organizer_consent_revoked', v_dropped);
  end loop;

  delete from collaboration_event_public_organizers where event_id = v_e.id;
  insert into collaboration_event_public_organizers (event_id, collaboration_id, participant_id, position)
  select v_e.id, v_e.collaboration_id, x.participant_id, min(x.ord)::integer
  from unnest(coalesce(p_participant_ids, '{}')) with ordinality as x(participant_id, ord)
  group by x.participant_id;

  for v_own in
    insert into collaboration_event_organizer_consents (event_id, collaboration_id, participant_id)
    select v_e.id, v_e.collaboration_id, p.id
    from collaboration_participants p
    where p.id = any(coalesce(p_participant_ids, '{}'))
      and p.collaboration_id = v_e.collaboration_id
      and can_represent_collaboration_unit(p.community_id, p.local_group_id, auth.uid())
    on conflict (event_id, participant_id) do nothing
    returning participant_id
  loop
    perform collaboration_log(v_e.collaboration_id, 'organizer_consent_granted', v_own);
  end loop;

  update collaboration_events set updated_by_user_id = auth.uid(), updated_at = now() where id = v_e.id;
  return true;
end;
$$;

-- A unit's own answer to being named as a public organiser of one event.
--
-- Only someone who can represent THAT participant's unit (v1: its
-- community's administrator, also for its local groups). Workspace access is
-- not needed and not sufficient: the FTR administrator can answer for FTR
-- Oslo without being on the team; a TU manager on the team cannot answer for
-- FTR Oslo.
--
--   p_consent = true  — only while the unit is actually being asked (it is in
--                       the event's selection), is active and in force, and
--                       the collaboration is active. It takes effect at the
--                       next publish or update, like every other change.
--   p_consent = false — always allowed to the unit's representative, even
--                       after the unit withdrew. Takes effect IMMEDIATELY: the
--                       unit is removed from the live public page right now,
--                       without waiting for anyone to republish. A unit must
--                       never stay publicly attached to something it has
--                       stopped agreeing to.
--
-- Idempotent; false for every refusal alike.
create or replace function public.set_collaboration_event_organizer_consent(
  p_event_id uuid,
  p_participant_id uuid,
  p_consent boolean
)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  v_e collaboration_events%rowtype;
  v_p collaboration_participants%rowtype;
begin
  if auth.uid() is null or p_consent is null then
    return false;
  end if;

  select * into v_e from collaboration_events where id = p_event_id for update;
  select * into v_p from collaboration_participants where id = p_participant_id;
  if v_e.id is null
     or v_p.id is null
     or v_p.collaboration_id <> v_e.collaboration_id
     or not can_represent_collaboration_unit(v_p.community_id, v_p.local_group_id, auth.uid())
  then
    return false;
  end if;

  if not p_consent then
    delete from collaboration_event_organizer_consents
     where event_id = v_e.id and participant_id = v_p.id;
    if found then
      perform collaboration_log(v_e.collaboration_id, 'organizer_consent_revoked', v_p.id);
    end if;
    -- Off the live page now, published or not.
    update published_collaboration_events pub
       set organizers = coalesce((
             select jsonb_agg(x.e order by x.ord)
             from jsonb_array_elements(pub.organizers) with ordinality as x(e, ord)
             where x.e ->> 'participantId' is distinct from v_p.id::text
           ), '[]'::jsonb),
           updated_at = now()
     where pub.source_event_id = v_e.id
       and exists (
         select 1 from jsonb_array_elements(pub.organizers) as y(e)
         where y.e ->> 'participantId' = v_p.id::text
       );
    return true;
  end if;

  if v_p.status <> 'active'
     or not collaboration_participant_in_force(v_p.id)
     or not exists (select 1 from collaborations c where c.id = v_e.collaboration_id and c.status = 'active')
     or not exists (
       select 1 from collaboration_event_public_organizers o
       where o.event_id = v_e.id and o.participant_id = v_p.id
     )
  then
    return false;
  end if;

  insert into collaboration_event_organizer_consents (event_id, collaboration_id, participant_id)
  values (v_e.id, v_e.collaboration_id, v_p.id)
  on conflict (event_id, participant_id) do nothing;
  if found then
    perform collaboration_log(v_e.collaboration_id, 'organizer_consent_granted', v_p.id);
  end if;
  return true;
end;
$$;

-- What a unit is being asked to put its name to. For the representative of
-- that unit only, and only while the request exists: the event's
-- PUBLISHABLE fields (never internal notes, the team, or anything else in
-- the workspace), whether the unit has consented, and whether it is on the
-- live public page right now. A single row of nulls otherwise. This is the
-- one piece of a private plan a representative outside the team can see, and
-- it is exactly what would become public with their approval.
create or replace function public.collaboration_organizer_request(
  p_event_id uuid,
  p_participant_id uuid,
  out title text,
  out starts_at timestamptz,
  out ends_at timestamptz,
  out location text,
  out audience public.collaboration_event_audience,
  out status public.collaboration_event_status,
  out consented boolean,
  out listed boolean
)
language sql security definer stable set search_path = public as $$
  select e.title, e.starts_at, e.ends_at, e.location, e.audience, e.status,
         exists (
           select 1 from collaboration_event_organizer_consents c
           where c.event_id = e.id and c.participant_id = p.id
         ),
         exists (
           select 1
           from published_collaboration_events pub,
                jsonb_array_elements(pub.organizers) as x(el)
           where pub.source_event_id = e.id
             and pub.status = 'published'
             and x.el ->> 'participantId' = p.id::text
         )
  from collaboration_events e
  join collaboration_event_public_organizers o on o.event_id = e.id
  join collaboration_participants p on p.id = o.participant_id and p.collaboration_id = e.collaboration_id
  join collaborations c on c.id = e.collaboration_id and c.status = 'active'
  where e.id = p_event_id
    and p.id = p_participant_id
    and auth.uid() is not null
    and can_represent_collaboration_unit(p.community_id, p.local_group_id, auth.uid());
$$;

-- Choose (or clear, with null) one of the collaboration's own image files as
-- the candidate public image. Nothing is published by this either.
create or replace function public.set_collaboration_event_image(
  p_event_id uuid,
  p_file_id uuid
)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  v_e collaboration_events%rowtype;
begin
  select * into v_e from collaboration_events where id = p_event_id for update;
  if v_e.id is null or not manages_collaboration_workspace(v_e.collaboration_id) then
    return false;
  end if;
  if p_file_id is not null and not exists (
    select 1 from collaboration_files f
    where f.id = p_file_id
      and f.collaboration_id = v_e.collaboration_id
      and f.archived_at is null
      and f.mime_type in ('image/png', 'image/jpeg', 'image/webp')
  ) then
    return false;
  end if;

  update collaboration_events
     set public_image_file_id = p_file_id, updated_by_user_id = auth.uid(), updated_at = now()
   where id = v_e.id;
  return true;
end;
$$;

-- ═══════════════════════════════════════════════════════════════════════
-- Publication
-- ═══════════════════════════════════════════════════════════════════════

-- A separate bucket for images that have been explicitly published. Private
-- like every other TING bucket: an object is readable — by anyone, signed in
-- or not — only while a PUBLISHED publication references it by exact name.
-- Nothing in `collaboration-files` is ever readable anonymously.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'published-event-images',
  'published-event-images',
  false,
  8388608,
  array['image/png', 'image/jpeg', 'image/webp']
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Whether one object in `published-event-images` is currently public. Takes
-- an object name and answers only for exactly that name.
create or replace function public.published_event_image_is_public(p_name text)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from published_collaboration_events p
    where p.status = 'published' and p.public_image_path = p_name
  );
$$;

-- Upload a copy for publication: `<event public_asset_key>/<uuid>.<ext>`, by
-- a workspace manager of that event's collaboration. The key is readable
-- only by the team, so nobody else can even address a folder.
create or replace function public.can_upload_published_event_image(p_name text)
returns boolean language sql security definer stable set search_path = public as $$
  select p_name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpg|webp)$'
    and exists (
      select 1 from collaboration_events e
      where e.public_asset_key = split_part(p_name, '/', 1)::uuid
        and manages_collaboration_workspace(e.collaboration_id)
    );
$$;

revoke execute on function public.published_event_image_is_public(text) from public, anon, authenticated;
revoke execute on function public.can_upload_published_event_image(text) from public, anon, authenticated;
grant execute on function public.published_event_image_is_public(text) to anon, authenticated;
grant execute on function public.can_upload_published_event_image(text) to authenticated;

create policy published_event_images_read on storage.objects for select to anon, authenticated
using (bucket_id = 'published-event-images' and published_event_image_is_public(name));

create policy published_event_images_write on storage.objects for insert to authenticated
with check (bucket_id = 'published-event-images' and can_upload_published_event_image(name));

-- Publish, or update what is published — the SAME explicit act. Copies the
-- allowlisted fields of the private event into the projection as they are
-- right now, plus a label snapshot of the chosen organisers. Never copies
-- internal_notes, and has no way to: the projection has no such column.
--
-- Requirements: a workspace manager; audience 'public' (an event for invited
-- guests or member organisations has no business on an open page); a start
-- time; and not a draft. A cancelled event may be (re)published so the public
-- page can say it is cancelled.
--
-- p_image_path: when the event has a chosen image and the caller has just
-- copied it into `published-event-images` under `<public_asset_key>/…`,
-- that path.
-- Otherwise null: a previously published copy of the SAME chosen file is
-- kept; anything else is cleared.
--
-- Returns the public slug, or null on any refusal. The slug is fixed at the
-- first publication and survives unpublishing and republishing.
create or replace function public.publish_collaboration_event(
  p_event_id uuid,
  p_image_path text
)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_e collaboration_events%rowtype;
  v_pub published_collaboration_events%rowtype;
  v_locale text;
  v_organizers jsonb;
  v_image text;
  v_image_source uuid;
  v_base text;
  v_slug text;
  v_action text;
begin
  select * into v_e from collaboration_events where id = p_event_id for update;
  if v_e.id is null or not manages_collaboration_workspace(v_e.collaboration_id) then
    return null;
  end if;
  if v_e.audience <> 'public' or v_e.status = 'draft' or v_e.starts_at is null then
    return null;
  end if;

  select * into v_pub from published_collaboration_events where source_event_id = v_e.id for update;
  select c.default_locale into v_locale from collaborations c where c.id = v_e.collaboration_id;

  -- Labels of units that are selected, have CONSENTED, and still take part.
  -- `participantId` stays on the private row so a unit's later revocation
  -- can find and remove its own label; published_event_by_slug() strips it.
  select coalesce(jsonb_agg(jsonb_build_object(
           'participantId', p.id,
           'communityName', cm.name,
           'localGroupName', g.name,
           'accent', cm.accent,
           'monogram', cm.monogram,
           'markStyle', cm.mark_style
         ) order by o.position, cm.name, g.name), '[]'::jsonb)
    into v_organizers
    from collaboration_event_public_organizers o
    join collaboration_event_organizer_consents consent
      on consent.event_id = o.event_id and consent.participant_id = o.participant_id
    join collaboration_participants p
      on p.id = o.participant_id and p.collaboration_id = v_e.collaboration_id
    join communities cm on cm.id = p.community_id
    left join community_local_groups g on g.id = p.local_group_id and g.community_id = p.community_id
   where o.event_id = v_e.id
     and p.status = 'active'
     and collaboration_participant_in_force(p.id);

  if v_e.public_image_file_id is null then
    v_image := null;
    v_image_source := null;
  elsif p_image_path is not null then
    if split_part(p_image_path, '/', 1) <> v_e.public_asset_key::text
       or p_image_path !~ '^[0-9a-f-]{36}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpg|webp)$'
       or not exists (
         select 1 from storage.objects o
         where o.bucket_id = 'published-event-images' and o.name = p_image_path
       )
    then
      return null;
    end if;
    v_image := p_image_path;
    v_image_source := v_e.public_image_file_id;
  elsif v_pub.id is not null and v_pub.public_image_source_file_id = v_e.public_image_file_id then
    v_image := v_pub.public_image_path;
    v_image_source := v_pub.public_image_source_file_id;
  else
    v_image := null;
    v_image_source := null;
  end if;

  if v_pub.id is null then
    v_base := btrim(left(local_group_slug(v_e.title), 80), '-');
    if v_base is null or length(v_base) < 3 then
      v_base := 'arrangement';
    end if;
    v_slug := v_base;
    while exists (select 1 from published_collaboration_events p where p.public_slug = v_slug) loop
      v_slug := v_base || '-' || substr(md5(gen_random_uuid()::text), 1, 6);
    end loop;

    insert into published_collaboration_events (
      source_event_id, collaboration_id, public_slug, status, locale,
      title, description, starts_at, ends_at, location, audience, registration_url,
      is_cancelled, organizers, public_image_path, public_image_source_file_id,
      published_by_user_id
    )
    values (
      v_e.id, v_e.collaboration_id, v_slug, 'published', coalesce(v_locale, 'nb'),
      v_e.title, v_e.description, v_e.starts_at, v_e.ends_at, v_e.location, v_e.audience, v_e.registration_url,
      v_e.status = 'cancelled', v_organizers, v_image, v_image_source,
      auth.uid()
    );
    v_action := 'event_published';
  else
    v_slug := v_pub.public_slug;
    update published_collaboration_events
       set status = 'published',
           locale = coalesce(v_locale, 'nb'),
           title = v_e.title,
           description = v_e.description,
           starts_at = v_e.starts_at,
           ends_at = v_e.ends_at,
           location = v_e.location,
           audience = v_e.audience,
           registration_url = v_e.registration_url,
           is_cancelled = v_e.status = 'cancelled',
           organizers = v_organizers,
           public_image_path = v_image,
           public_image_source_file_id = v_image_source,
           published_at = now(),
           published_by_user_id = auth.uid(),
           updated_at = now(),
           unpublished_at = null,
           unpublished_by_user_id = null
     where id = v_pub.id;
    v_action := case when v_pub.status = 'published' then 'event_publication_updated' else 'event_published' end;
  end if;

  perform collaboration_log(v_e.collaboration_id, v_action);
  return v_slug;
end;
$$;

-- Take the public page down. The private event and its whole history stay;
-- the projection row stays too (unpublished), so republishing keeps the slug.
create or replace function public.unpublish_collaboration_event(p_event_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  v_e collaboration_events%rowtype;
  v_pub published_collaboration_events%rowtype;
begin
  select * into v_e from collaboration_events where id = p_event_id;
  if v_e.id is null or not manages_collaboration_workspace(v_e.collaboration_id) then
    return false;
  end if;
  select * into v_pub from published_collaboration_events where source_event_id = v_e.id for update;
  if v_pub.id is null then
    return false;
  end if;
  if v_pub.status = 'unpublished' then
    return true;
  end if;
  update published_collaboration_events
     set status = 'unpublished', unpublished_at = now(), unpublished_by_user_id = auth.uid(), updated_at = now()
   where id = v_pub.id;
  perform collaboration_log(v_e.collaboration_id, 'event_unpublished');
  return true;
end;
$$;

-- ── The ONE anonymous read ──────────────────────────────────────────────
--
-- One published event by its public slug, public columns only. Returns a
-- single row (all nulls when there is no such published event) — not a set,
-- and there is no way to list publications. Nothing here says which
-- collaboration an event came from, who published it, or anything about the
-- team.
create or replace function public.published_event_by_slug(
  p_slug text,
  out public_slug text,
  out locale text,
  out title text,
  out description text,
  out starts_at timestamptz,
  out ends_at timestamptz,
  out location text,
  out audience public.collaboration_event_audience,
  out registration_url text,
  out is_cancelled boolean,
  out organizers jsonb,
  out image_path text,
  out updated_at timestamptz
)
language sql security definer stable set search_path = public as $$
  select p.public_slug, p.locale, p.title, p.description, p.starts_at, p.ends_at,
         p.location, p.audience, p.registration_url, p.is_cancelled,
         -- Labels only: the private participant key is removed here.
         coalesce((
           select jsonb_agg(x.e - 'participantId' order by x.ord)
           from jsonb_array_elements(p.organizers) with ordinality as x(e, ord)
         ), '[]'::jsonb),
         p.public_image_path, p.published_at
  from published_collaboration_events p
  where p.public_slug = lower(btrim(coalesce(p_slug, '')))
    and p.status = 'published';
$$;

comment on function public.published_event_by_slug(text) is
  'The only anonymous read in the collaboration feature: one PUBLISHED event projection by slug, allowlisted public fields only.';

revoke execute on function public.published_event_by_slug(text) from public, anon, authenticated;
grant execute on function public.published_event_by_slug(text) to anon, authenticated;

-- ── Grants on transitions ───────────────────────────────────────────────

revoke execute on function public.create_collaboration_channel(uuid, text, text) from public, anon, authenticated;
revoke execute on function public.update_collaboration_channel(uuid, text, text) from public, anon, authenticated;
revoke execute on function public.set_collaboration_channel_status(uuid, public.collaboration_channel_status) from public, anon, authenticated;
revoke execute on function public.post_collaboration_message(uuid, uuid, text) from public, anon, authenticated;
revoke execute on function public.edit_collaboration_message(uuid, text) from public, anon, authenticated;
revoke execute on function public.delete_collaboration_message(uuid) from public, anon, authenticated;
revoke execute on function public.create_collaboration_document(uuid, text, text) from public, anon, authenticated;
revoke execute on function public.save_collaboration_document(uuid, integer, text, text) from public, anon, authenticated;
revoke execute on function public.set_collaboration_document_status(uuid, public.collaboration_document_status) from public, anon, authenticated;
revoke execute on function public.create_collaboration_task(uuid, text, text, date, uuid, uuid, uuid, uuid[]) from public, anon, authenticated;
revoke execute on function public.update_collaboration_task(uuid, text, text, date, uuid, uuid, uuid) from public, anon, authenticated;
revoke execute on function public.set_collaboration_task_status(uuid, public.collaboration_task_status) from public, anon, authenticated;
revoke execute on function public.set_collaboration_task_assignees(uuid, uuid[]) from public, anon, authenticated;
revoke execute on function public.register_collaboration_file(uuid, uuid, text, text) from public, anon, authenticated;
revoke execute on function public.remove_collaboration_file(uuid) from public, anon, authenticated;
revoke execute on function public.create_collaboration_event(uuid, text, text, text, timestamptz, timestamptz, text, public.collaboration_event_audience, text, public.collaboration_event_status) from public, anon, authenticated;
revoke execute on function public.update_collaboration_event(uuid, text, text, text, timestamptz, timestamptz, text, public.collaboration_event_audience, text, public.collaboration_event_status) from public, anon, authenticated;
revoke execute on function public.set_collaboration_event_organizers(uuid, uuid[]) from public, anon, authenticated;
revoke execute on function public.set_collaboration_event_image(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.set_collaboration_event_organizer_consent(uuid, uuid, boolean) from public, anon, authenticated;
revoke execute on function public.collaboration_organizer_request(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.publish_collaboration_event(uuid, text) from public, anon, authenticated;
revoke execute on function public.unpublish_collaboration_event(uuid) from public, anon, authenticated;

grant execute on function public.create_collaboration_channel(uuid, text, text) to authenticated;
grant execute on function public.update_collaboration_channel(uuid, text, text) to authenticated;
grant execute on function public.set_collaboration_channel_status(uuid, public.collaboration_channel_status) to authenticated;
grant execute on function public.post_collaboration_message(uuid, uuid, text) to authenticated;
grant execute on function public.edit_collaboration_message(uuid, text) to authenticated;
grant execute on function public.delete_collaboration_message(uuid) to authenticated;
grant execute on function public.create_collaboration_document(uuid, text, text) to authenticated;
grant execute on function public.save_collaboration_document(uuid, integer, text, text) to authenticated;
grant execute on function public.set_collaboration_document_status(uuid, public.collaboration_document_status) to authenticated;
grant execute on function public.create_collaboration_task(uuid, text, text, date, uuid, uuid, uuid, uuid[]) to authenticated;
grant execute on function public.update_collaboration_task(uuid, text, text, date, uuid, uuid, uuid) to authenticated;
grant execute on function public.set_collaboration_task_status(uuid, public.collaboration_task_status) to authenticated;
grant execute on function public.set_collaboration_task_assignees(uuid, uuid[]) to authenticated;
grant execute on function public.register_collaboration_file(uuid, uuid, text, text) to authenticated;
grant execute on function public.remove_collaboration_file(uuid) to authenticated;
grant execute on function public.create_collaboration_event(uuid, text, text, text, timestamptz, timestamptz, text, public.collaboration_event_audience, text, public.collaboration_event_status) to authenticated;
grant execute on function public.update_collaboration_event(uuid, text, text, text, timestamptz, timestamptz, text, public.collaboration_event_audience, text, public.collaboration_event_status) to authenticated;
grant execute on function public.set_collaboration_event_organizers(uuid, uuid[]) to authenticated;
grant execute on function public.set_collaboration_event_image(uuid, uuid) to authenticated;
grant execute on function public.set_collaboration_event_organizer_consent(uuid, uuid, boolean) to authenticated;
grant execute on function public.collaboration_organizer_request(uuid, uuid) to authenticated;
grant execute on function public.publish_collaboration_event(uuid, text) to authenticated;
grant execute on function public.unpublish_collaboration_event(uuid) to authenticated;
