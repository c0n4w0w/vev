-- Local scope for ordinary community content.
--
-- A local group is not a subcommunity in this phase. Posts and events remain
-- content of their parent community and keep the same read policies; the local
-- group id is a relevance signal used by "Mitt lokallag".
--
-- Null means community-wide/national. When present, the group must belong to
-- the same community as the content. Retired groups keep existing content, but
-- cannot be newly selected for local content.

alter table posts
  add column local_group_id uuid,
  add constraint posts_local_group_fkey
    foreign key (local_group_id, community_id)
    references community_local_groups (id, community_id)
    on delete restrict;

alter table events
  add column local_group_id uuid,
  add constraint events_local_group_fkey
    foreign key (local_group_id, community_id)
    references community_local_groups (id, community_id)
    on delete restrict;

create index posts_local_group_idx
  on posts (community_id, local_group_id, created_at desc)
  where local_group_id is not null;

create index events_local_group_idx
  on events (community_id, local_group_id, starts_at)
  where local_group_id is not null;

comment on column posts.local_group_id is
  'Optional local group scope. Null means the post is community-wide. When set, the group must belong to the same community and be active when chosen.';

comment on column events.local_group_id is
  'Optional local group scope. Null means the event is community-wide. When set, the group must belong to the same community and be active when chosen.';

-- Keep new local assignments to active groups. This is deliberately only about
-- assigning a value: if an organisation later retires a group, old content
-- keeps its historical scope and still renders in the hub for members already
-- attached to that group.
create or replace function public.ensure_active_content_local_group()
returns trigger language plpgsql security invoker set search_path = public as $$
begin
  if new.local_group_id is null then
    return new;
  end if;

  if not exists (
    select 1
    from community_local_groups g
    where g.id = new.local_group_id
      and g.community_id = new.community_id
      and g.active
  ) then
    raise exception 'Lokallaget finnes ikke, hører til et annet fellesskap eller er avviklet'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

create trigger posts_local_group_active
  before insert or update of local_group_id on posts
  for each row execute function public.ensure_active_content_local_group();

create trigger events_local_group_active
  before insert or update of local_group_id on events
  for each row execute function public.ensure_active_content_local_group();

revoke execute on function public.ensure_active_content_local_group() from public, anon, authenticated;

-- Recreate the current post immutability guard with one added rule: once a
-- post is published, its local scope cannot be moved through the generic edit
-- path. There is no edit UI for scope in this first version, and freezing it
-- avoids turning author edits into an unreviewed scope-management feature.
create or replace function public.posts_guard_immutable()
returns trigger language plpgsql security invoker set search_path = public as $$
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

revoke execute on function public.posts_guard_immutable() from public, anon, authenticated;
