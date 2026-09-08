-- Comments, one level of replies, and reactions — with the aggregates on
-- `posts` derived by the database instead of asserted by the client.
--
-- Before this, `posts.comment_count` and `posts.reactions` were numbers with
-- nothing behind them: seeded values that no user action could ever change,
-- and that Phase 1 froze precisely because there was no legitimate write path.
-- This migration builds that path.
--
-- The central rule is that a comment or a reaction never carries a community.
-- Authorisation is derived from the post it hangs off, through
-- `can_access_post()`. A client cannot pass a community_id here because there
-- is no community_id to pass.

-- ── Authorisation helpers ───────────────────────────────────────────────
--
-- SECURITY DEFINER so policies on `comments` can consult `posts` and
-- `memberships` without recursing into their own RLS. search_path is pinned so
-- a caller cannot shadow the tables these read.

create or replace function public.can_access_post(pid uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1
    from posts p
    join memberships m on m.community_id = p.community_id
    where p.id = pid
      and m.user_id = auth.uid()
      and m.status = 'active'
  );
$$;

create or replace function public.can_moderate_post(pid uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1
    from posts p
    join memberships m on m.community_id = p.community_id
    where p.id = pid
      and m.user_id = auth.uid()
      and m.status = 'active'
      and m.role in ('admin', 'moderator')
  );
$$;

revoke execute on function public.can_access_post(uuid) from public, anon;
revoke execute on function public.can_moderate_post(uuid) from public, anon;
grant execute on function public.can_access_post(uuid) to authenticated;
grant execute on function public.can_moderate_post(uuid) to authenticated;

-- ── Comments ────────────────────────────────────────────────────────────
--
-- One level of replies: a comment may have a parent, but a reply may not
-- itself be replied to. The existing UI has no threading at all, so this is
-- the smallest model that still lets someone answer a specific person, and it
-- avoids an unbounded tree nobody asked for.

create table comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references posts (id) on delete cascade,
  parent_id uuid references comments (id) on delete cascade,
  -- Taken from the session, exactly as posts.author_id is.
  author_id uuid not null default auth.uid() references profiles (id) on delete cascade,
  body text not null check (length(btrim(body)) between 1 and 4000),
  created_at timestamptz not null default now(),
  edited_at timestamptz
);

create index comments_post_idx on comments (post_id, created_at);
create index comments_parent_idx on comments (parent_id);

alter table comments enable row level security;

create policy comments_select on comments for select to authenticated
using (can_access_post(post_id));

create policy comments_insert on comments for insert to authenticated
with check (author_id = auth.uid() and can_access_post(post_id));

-- Editing is the author's alone, same as posts: a moderator follows up a
-- conversation, they do not rewrite someone's words.
create policy comments_update on comments for update to authenticated
using (author_id = auth.uid() and can_access_post(post_id))
with check (author_id = auth.uid() and can_access_post(post_id));

create policy comments_delete on comments for delete to authenticated
using (can_access_post(post_id) and (author_id = auth.uid() or can_moderate_post(post_id)));

-- Structure is fixed at creation and frozen afterwards, so a comment cannot be
-- walked onto another post, reattributed, or re-parented into a different
-- conversation. A policy cannot express this: `using` sees the old row and
-- `with check` the new one, and no single expression compares the two.
create or replace function public.comments_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  parent_post uuid;
  parent_parent uuid;
begin
  if tg_op = 'INSERT' then
    if new.parent_id is not null then
      select post_id, parent_id into parent_post, parent_parent
      from comments where id = new.parent_id;

      if parent_post is null then
        raise exception 'Svaret peker på en kommentar som ikke finnes'
          using errcode = 'foreign_key_violation';
      end if;
      -- A reply must live on the same post as the comment it answers.
      if parent_post is distinct from new.post_id then
        raise exception 'Et svar må høre til samme innlegg som kommentaren det svarer på'
          using errcode = 'check_violation';
      end if;
      -- One level only.
      if parent_parent is not null then
        raise exception 'Det går ikke an å svare på et svar'
          using errcode = 'check_violation';
      end if;
    end if;
    return new;
  end if;

  if new.post_id is distinct from old.post_id then
    raise exception 'En kommentar kan ikke flyttes til et annet innlegg'
      using errcode = 'check_violation';
  end if;
  if new.parent_id is distinct from old.parent_id then
    raise exception 'En kommentar kan ikke flyttes i tråden'
      using errcode = 'check_violation';
  end if;
  if new.author_id is distinct from old.author_id then
    raise exception 'Forfatteren av en kommentar kan ikke endres'
      using errcode = 'check_violation';
  end if;
  if new.created_at is distinct from old.created_at then
    raise exception 'Tidspunktet for en kommentar kan ikke endres'
      using errcode = 'check_violation';
  end if;

  if new.body is distinct from old.body then
    new.edited_at := now();
  end if;
  return new;
end $$;

revoke execute on function public.comments_guard() from public, anon, authenticated;

create trigger comments_guard_trigger
before insert or update on comments
for each row execute function public.comments_guard();

-- ── Reactions ───────────────────────────────────────────────────────────
--
-- A row per person per emoji per post. The primary key is what makes a double
-- reaction impossible — there is no counter to increment twice.

create table post_reactions (
  post_id uuid not null references posts (id) on delete cascade,
  user_id uuid not null default auth.uid() references profiles (id) on delete cascade,
  emoji text not null check (length(emoji) between 1 and 12),
  created_at timestamptz not null default now(),
  primary key (post_id, user_id, emoji)
);

create index post_reactions_post_idx on post_reactions (post_id);

alter table post_reactions enable row level security;

create policy post_reactions_select on post_reactions for select to authenticated
using (can_access_post(post_id));

create policy post_reactions_insert on post_reactions for insert to authenticated
with check (user_id = auth.uid() and can_access_post(post_id));

-- You may withdraw your own reaction and nobody else's. There is deliberately
-- no UPDATE policy: a reaction is added or removed, never edited, so there is
-- no path that could move one onto a different person.
create policy post_reactions_delete on post_reactions for delete to authenticated
using (user_id = auth.uid());

-- ── Derived aggregates ──────────────────────────────────────────────────
--
-- `posts.comment_count` and `posts.reactions` are recomputed from the rows
-- above whenever those rows change. They are never accepted from a caller.
--
-- SECURITY DEFINER is required: the person commenting is usually not the
-- author of the post, and `posts_update` restricts updates to the author. The
-- functions touch nothing but the aggregate columns of the one affected post.

create or replace function public.sync_post_comment_count()
returns trigger language plpgsql security definer set search_path = public as $$
declare pid uuid := coalesce(new.post_id, old.post_id);
begin
  update posts
     set comment_count = (select count(*) from comments where post_id = pid)
   where id = pid;
  return null;
end $$;

create or replace function public.sync_post_reactions()
returns trigger language plpgsql security definer set search_path = public as $$
declare pid uuid := coalesce(new.post_id, old.post_id);
begin
  update posts
     set reactions = coalesce(
       (select jsonb_agg(entry order by entry->>'emoji')
          from (
            select jsonb_build_object(
                     'emoji', emoji,
                     'userIds', jsonb_agg(user_id::text order by created_at)
                   ) as entry
              from post_reactions
             where post_id = pid
             group by emoji
          ) grouped),
       '[]'::jsonb)
   where id = pid;
  return null;
end $$;

revoke execute on function public.sync_post_comment_count() from public, anon, authenticated;
revoke execute on function public.sync_post_reactions() from public, anon, authenticated;

create trigger comments_sync_count
after insert or delete or update of post_id on comments
for each row execute function public.sync_post_comment_count();

create trigger post_reactions_sync
after insert or delete on post_reactions
for each row execute function public.sync_post_reactions();

-- ── Phase 1 immutability, narrowed rather than removed ──────────────────
--
-- The Phase 1 guard rejected every change to comment_count and reactions,
-- because at that point no legitimate writer existed. Now two do, and they are
-- both triggers.
--
-- pg_trigger_depth() separates them from a client: a statement sent by a user
-- runs the guard at depth 1, while an update issued *by* one of the sync
-- triggers runs it at depth 2 or more. A client cannot reach depth 2 without
-- going through a trigger, and the only triggers that write these columns
-- compute them from the comment and reaction rows.
--
-- Every other protection in the Phase 1 guard is untouched: community_id,
-- author_id and created_at stay frozen at any depth, and edited_at is still
-- stamped rather than accepted.

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

  -- Aggregates: only a nested trigger may change these.
  if (new.comment_count is distinct from old.comment_count
      or new.reactions is distinct from old.reactions)
     and pg_trigger_depth() < 2 then
    raise exception 'Kommentarer og reaksjoner har sin egen skrivevei'
      using errcode = 'check_violation';
  end if;

  if new.body is distinct from old.body or new.title is distinct from old.title then
    new.edited_at := now();
  end if;

  return new;
end $$;
