-- Every privilege the Data API roles hold in `public`, said out loud.
--
-- Until now nothing here granted a table to anyone. The 64 migrations before
-- this one rely on Supabase's default privileges: every table `postgres`
-- creates in `public` was handed to `anon`, `authenticated` and `service_role`
-- in full, and row level security was the only thing deciding who saw what.
-- That default is gone on projects created since 30 May 2026, and is removed
-- from existing ones on 30 October 2026:
--
--   alter default privileges for role postgres in schema public
--     revoke select, insert, update, delete on tables from anon, authenticated, service_role;
--
-- On such a project — TING's hosted one is one — the same migrations build
-- the same tables and policies, and then no role may touch them: every query
-- answers 42501, "permission denied for table". The local stack, which still
-- applied the old defaults, showed none of it. Started without them
-- (`auto_expose_new_tables = false`), it also drops the default EXECUTE on
-- functions, and then the server's own role cannot run the functions written
-- for it either — begin_password_attempt and the rest. Whether the hosted
-- platform does the same is not something the repository can see, so nothing
-- below depends on it.
--
-- This migration replaces what the defaults did with what each role needs,
-- and ends at the same privileges whichever defaults the database started
-- with:
--
--   anon            no table at all. A visitor reaches TING through the seven
--                   functions at the end and nothing else.
--   authenticated   SELECT where a policy lets some member read; INSERT,
--                   UPDATE and DELETE only on the tables that have a policy
--                   for that command. Everything else is written by SECURITY
--                   DEFINER functions, which need no grant.
--   service_role    the server's key. It bypasses row level security by
--                   design, so a table grant is its only limit: read and
--                   write, never TRUNCATE, REFERENCES or TRIGGER.
--
-- Row level security is not touched: every table keeps its policies, and a
-- grant here only lets a policy be asked. A privilege without a policy was
-- never usable; it is taken away so that a policy added later cannot open a
-- table further than its author looked.
--
-- The default is switched off here as well (and `auto_expose_new_tables` in
-- supabase/config.toml says the same for a fresh local stack), so a table
-- added from now on is unreachable until its migration grants it — locally
-- too, where the missing grant used to go unnoticed.

-- ── Start from nothing ──────────────────────────────────────────────────
--
-- Only the three API roles and PUBLIC, and only in `public`. `auth`,
-- `storage` and the other Supabase schemas keep the grants Supabase gave
-- them; the policies on storage.objects are theirs to enforce.

alter default privileges for role postgres in schema public
  revoke all on tables from anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  revoke all on sequences from anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  revoke all on functions from anon, authenticated, service_role;

revoke all on all tables in schema public from public, anon, authenticated, service_role;
revoke all on all sequences in schema public from public, anon, authenticated, service_role;

-- Reaching anything in the schema at all. Supabase grants this itself; it is
-- repeated so the migration does not depend on it.
grant usage on schema public to anon, authenticated, service_role;

-- ── authenticated: reading ──────────────────────────────────────────────
--
-- One line per table that has a SELECT policy for `authenticated`. The policy
-- still decides which rows — a member of one community reads nothing of
-- another's through any of these.

grant select on
  public.access_requests,
  public.account_security,
  public.channel_groups,
  public.channel_participants,
  public.channels,
  public.comments,
  public.communities,
  public.community_emojis,
  public.community_local_group_managers,
  public.community_local_groups,
  public.community_profiles,
  public.community_subgroup_managers,
  public.community_subgroup_members,
  public.community_subgroups,
  public.direct_conversation_reads,
  public.direct_conversations,
  public.direct_messages,
  public.event_attendees,
  public.events,
  public.invitations,
  public.message_attachments,
  public.messages,
  public.notifications,
  public.post_reactions,
  public.posts,
  public.profiles
to authenticated;

grant select on
  public.collaboration_channels,
  public.collaboration_document_versions,
  public.collaboration_documents,
  public.collaboration_event_organizer_consents,
  public.collaboration_event_public_organizers,
  public.collaboration_events,
  public.collaboration_files,
  public.collaboration_manager_participants,
  public.collaboration_member_sponsorships,
  public.collaboration_members,
  public.collaboration_messages,
  public.collaboration_participants,
  public.collaboration_profiles,
  public.collaboration_task_assignees,
  public.collaboration_tasks,
  public.collaborations,
  public.published_collaboration_events
to authenticated;

-- Two tables are readable by column, because a row a member may see still
-- holds something they may not.
--
-- memberships: not accepts_member_dms (a staff member's own setting,
-- 20260915160000) and not onboarding_dismissed_at (20261014100000).
grant select (id, user_id, community_id, role, status, joined_at, title, invited_by, local_group_id)
  on public.memberships to authenticated;

-- community_people: not user_id, which would say which account a listed
-- person is (20260920103000).
grant select (id, community_id, section, local_group_id, name, role, email, description, sort_order, active, created_at)
  on public.community_people to authenticated;

-- ── authenticated: writing ──────────────────────────────────────────────
--
-- Only where a policy for the command exists. Every other table —
-- memberships, invitations, access requests, channels, profiles, the
-- collaboration tables, attachments — is written through functions alone.

grant insert, update, delete on public.comments to authenticated;
grant insert, update, delete on public.events to authenticated;
grant insert, update, delete on public.posts to authenticated;
grant insert, delete on public.community_emojis to authenticated;
grant insert, delete on public.event_attendees to authenticated;
grant insert, delete on public.post_reactions to authenticated;

-- A message is sent and never edited or removed by its author: the table has
-- no UPDATE or DELETE policy.
grant insert on public.messages to authenticated;

-- A direct message names its conversation and its text; the sender, the time
-- and the rest are the database's to fill in (20260919191000).
grant insert (conversation_id, body) on public.direct_messages to authenticated;

-- A notice can be marked read and nothing else about it changed
-- (20260916160000).
grant update (read) on public.notifications to authenticated;

-- ── service_role ────────────────────────────────────────────────────────
--
-- The key the server holds, and the seed, bootstrap and check scripts with
-- it. Listed table by table rather than "all tables", so a table added later
-- is not handed over by an old line.
--
-- What the running app does with it is narrow: it reads profiles to address
-- an approval email, deletes abandoned message_attachments, and reads and
-- clears message_attachment_purges. The rest is what `npm run bootstrap`
-- writes (communities and their structure, the first administrators'
-- memberships) and what the showcase seed and the check suites build and
-- tear down.

grant select, insert, update, delete on
  public.access_requests,
  public.account_security,
  public.auth_throttle,
  public.channel_groups,
  public.channel_participants,
  public.channels,
  public.comments,
  public.communities,
  public.community_emojis,
  public.community_local_group_managers,
  public.community_local_groups,
  public.community_people,
  public.community_profiles,
  public.community_subgroup_managers,
  public.community_subgroup_members,
  public.community_subgroups,
  public.direct_conversation_reads,
  public.direct_conversations,
  public.direct_messages,
  public.event_attendees,
  public.events,
  public.invitations,
  public.memberships,
  public.message_attachment_purges,
  public.message_attachments,
  public.messages,
  public.notifications,
  public.post_reactions,
  public.posts,
  public.profiles
to service_role;

grant select, insert, update, delete on
  public.collaboration_audit_log,
  public.collaboration_channels,
  public.collaboration_document_versions,
  public.collaboration_documents,
  public.collaboration_event_organizer_consents,
  public.collaboration_event_public_organizers,
  public.collaboration_events,
  public.collaboration_files,
  public.collaboration_manager_participants,
  public.collaboration_member_sponsorships,
  public.collaboration_members,
  public.collaboration_messages,
  public.collaboration_participants,
  public.collaboration_profiles,
  public.collaboration_task_assignees,
  public.collaboration_tasks,
  public.collaborations,
  public.published_collaboration_events
to service_role;

-- collaboration_audit_log.id is a bigserial; inserting a row needs its
-- sequence. No other table has one.
grant usage on sequence public.collaboration_audit_log_id_seq to service_role;

-- ── Functions ───────────────────────────────────────────────────────────
--
-- Every function before this one already says who may run it, and revokes
-- PUBLIC, so `anon` and `authenticated` hold exactly what their migrations
-- granted on either kind of project. Three things are put right.
--
-- 1. A trigger function is run by its trigger, never called. One was left
--    callable by everyone.
revoke all on function public.ensure_active_content_subgroup() from public, anon, authenticated;

-- 2. local_group_slug() is a helper for SECURITY DEFINER functions. It was
--    revoked from PUBLIC and anon, and stayed callable by `authenticated`
--    only where the old default had granted it.
revoke all on function public.local_group_slug(text) from authenticated;

-- 3. service_role held EXECUTE on every function through the old default,
--    and on three through a grant. It keeps what the server calls.
revoke all on all functions in schema public from service_role;

-- Around every password check (lib/account-security.ts). Callable by no one
-- else: they take the address and the account as arguments.
grant execute on function public.begin_password_attempt(text, text) to service_role;
grant execute on function public.finish_password_attempt(text, text, boolean) to service_role;

-- Message attachments (lib/attachment-storage.ts, `npm run attachments:sweep`).
grant execute on function public.complete_message_attachment(uuid) to service_role;
grant execute on function public.sweep_abandoned_message_attachments(interval) to service_role;

-- Called on the role's behalf rather than by it: by CHECK constraints, and
-- by posts_guard_immutable(), a SECURITY INVOKER trigger. Both run as whoever
-- writes the row, and Postgres checks EXECUTE before the trigger's own
-- "is this the service role" test is reached.
grant execute on function public.message_attachment_extension(text) to service_role;
grant execute on function public.normalize_display_name(text) to service_role;
grant execute on function public.can_moderate(text) to service_role;

-- Read by the check suites to find and reset what a test left behind. They
-- reveal nothing the role cannot already read. password_throttle_key() is
-- SECURITY INVOKER and calls normalize_email().
grant execute on function public.password_throttle_key(text) to service_role;
grant execute on function public.normalize_email(text) to service_role;
grant execute on function public.email_change_cooldown() to service_role;
grant execute on function public.ensure_local_group_channel(uuid) to service_role;

-- ── Refuse to finish on anything unexpected ─────────────────────────────
--
-- The hosted database cannot be inspected from the repository. Rather than
-- assume it matches, the migration checks the result and fails — changing
-- nothing — if a table is open that should not be.

do $$
declare
  v_found text;
begin
  -- Row level security on every table.
  select string_agg(c.relname, ', ' order by c.relname) into v_found
    from pg_class c
   where c.relnamespace = 'public'::regnamespace
     and c.relkind in ('r', 'p')
     and not c.relrowsecurity;
  if v_found is not null then
    raise exception 'Tables in public without row level security: %', v_found;
  end if;

  -- A view would run with its owner's rights and bypass all of the above.
  select string_agg(c.relname, ', ' order by c.relname) into v_found
    from pg_class c
   where c.relnamespace = 'public'::regnamespace
     and c.relkind in ('v', 'm');
  if v_found is not null then
    raise exception 'Views in public have no grants decided here: %', v_found;
  end if;

  -- A table created outside these migrations has no line above.
  select string_agg(c.relname, ', ' order by c.relname) into v_found
    from pg_class c
   where c.relnamespace = 'public'::regnamespace
     and c.relkind in ('r', 'p')
     and not has_table_privilege('service_role', c.oid, 'select');
  if v_found is not null then
    raise exception 'Tables in public this migration does not know: %', v_found;
  end if;

  -- anon and PUBLIC: no table, no column, no sequence.
  select string_agg(distinct c.relname, ', ' order by c.relname) into v_found
    from pg_class c
   where c.relnamespace = 'public'::regnamespace
     and c.relkind in ('r', 'p', 'v', 'm', 'S')
     and case c.relkind
           when 'S' then has_sequence_privilege('anon', c.oid, 'usage, select, update')
           else has_table_privilege('anon', c.oid, 'select, insert, update, delete, truncate, references, trigger')
             or has_any_column_privilege('anon', c.oid, 'select, insert, update, references')
         end;
  if v_found is not null then
    raise exception 'anon still holds a privilege on: %', v_found;
  end if;

  -- authenticated: never TRUNCATE, REFERENCES or TRIGGER.
  select string_agg(c.relname, ', ' order by c.relname) into v_found
    from pg_class c
   where c.relnamespace = 'public'::regnamespace
     and c.relkind in ('r', 'p')
     and has_table_privilege('authenticated', c.oid, 'truncate, references, trigger');
  if v_found is not null then
    raise exception 'authenticated holds TRUNCATE, REFERENCES or TRIGGER on: %', v_found;
  end if;

  -- Nothing callable by everyone.
  select string_agg(p.oid::regprocedure::text, ', ' order by p.oid::regprocedure::text) into v_found
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and exists (
       select 1
         from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
        where a.grantee = 0
          and a.privilege_type = 'EXECUTE'
     );
  if v_found is not null then
    raise exception 'Functions in public callable by PUBLIC: %', v_found;
  end if;

  -- anon: the portal, a published event, an invitation's preview and the
  -- request form. Exactly these.
  select string_agg(f.name, ', ' order by f.name) into v_found
    from (
      select p.oid::regprocedure::text as name
        from pg_proc p
       where p.pronamespace = 'public'::regnamespace
         and has_function_privilege('anon', p.oid, 'execute')
      except
      select unnest(array[
        'portal_by_slug(text)',
        'portal_events(text)',
        'portal_slug_by_id(text)',
        'published_event_by_slug(text)',
        'published_event_image_is_public(text)',
        'invitation_preview(text)',
        'request_community_access(text,text,text)'
      ])
    ) f;
  if v_found is not null then
    raise exception 'anon may call functions it should not: %', v_found;
  end if;
end;
$$;
