-- Community custom emojis, and a reaction model that can point at one.
--
-- Two things change here.
--
-- First, a reaction is no longer "some text". It is either a built-in Unicode
-- emoji or a reference to a custom emoji owned by exactly one community, and
-- the database refuses a custom emoji from any community other than the one
-- the post lives in. That check cannot be left to the client: a reaction is
-- the one place where a row from community A would otherwise be attachable to
-- content in community B.
--
-- Second, custom emoji images are private. A community's emoji names are as
-- revealing as its channel names — ":harmreduction:" says what a group works
-- on — so both the metadata and the files are readable only by members. There
-- is deliberately no public bucket: portals publish a description and public
-- events, and nothing here rides along with that.

-- ── Custom emoji metadata ───────────────────────────────────────────────

create table community_emojis (
  id uuid primary key default gen_random_uuid(),
  community_id text not null references communities (id) on delete cascade,
  -- Normalised at write time: lowercase, no colons. ":Rave:" and ":rave:" are
  -- the same emoji, and the unique constraint below has to see that.
  name text not null check (name ~ '^[a-z0-9][a-z0-9_-]{1,31}$'),
  storage_path text not null,
  content_type text not null check (content_type in ('image/png', 'image/gif', 'image/webp')),
  byte_size integer not null check (byte_size > 0 and byte_size <= 262144),
  created_by uuid not null default auth.uid() references profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  -- The same name in two communities is two unrelated emojis.
  unique (community_id, name)
);

create index community_emojis_community_idx on community_emojis (community_id, name);

alter table community_emojis enable row level security;

-- Members may read their own community's emojis. Nobody else can see that a
-- name exists, which is the point.
create policy community_emojis_select on community_emojis for select to authenticated
using (is_member(community_id));

-- Creating and removing them is a moderator/admin job, matching how channels
-- and announcements are handled.
create policy community_emojis_insert on community_emojis for insert to authenticated
with check (created_by = auth.uid() and can_moderate(community_id));

create policy community_emojis_delete on community_emojis for delete to authenticated
using (can_moderate(community_id));

-- There is deliberately no UPDATE policy. A custom emoji is created and
-- deleted, never edited: allowing an update would mean allowing a row to be
-- re-pointed at another community, another owner, or another file, and every
-- reaction already referencing it would silently change meaning.

-- ── Reactions: built-in or custom ───────────────────────────────────────

-- The old primary key covered (post_id, user_id, emoji), which cannot express
-- uniqueness once emoji may be null — and a column in a primary key cannot be
-- made nullable at all. So the key goes first, then the column changes, then a
-- unique index over the *effective* reaction key restores "one reaction per
-- person per emoji" for both kinds.
alter table post_reactions drop constraint post_reactions_pkey;
alter table post_reactions add column id uuid primary key default gen_random_uuid();

alter table post_reactions add column emoji_id uuid references community_emojis (id) on delete cascade;
alter table post_reactions alter column emoji drop not null;

-- Exactly one of the two. A row that is both, or neither, is meaningless.
alter table post_reactions
  add constraint post_reactions_one_kind check (num_nonnulls(emoji, emoji_id) = 1);

create unique index post_reactions_unique_key
  on post_reactions (post_id, user_id, coalesce(emoji_id::text, emoji));

-- Is this custom emoji owned by the same community as this post? SECURITY
-- DEFINER so the check does not depend on the caller being able to see either
-- row through RLS — a member of community B must get a straight "no" rather
-- than an accident of visibility.
create or replace function public.emoji_matches_post(eid uuid, pid uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1
    from community_emojis e
    join posts p on p.community_id = e.community_id
    where e.id = eid and p.id = pid
  );
$$;

revoke execute on function public.emoji_matches_post(uuid, uuid) from public, anon;
grant execute on function public.emoji_matches_post(uuid, uuid) to authenticated;

drop policy post_reactions_insert on post_reactions;

create policy post_reactions_insert on post_reactions for insert to authenticated
with check (
  user_id = auth.uid()
  and can_access_post(post_id)
  -- A custom emoji must come from the post's own community.
  and (emoji_id is null or emoji_matches_post(emoji_id, post_id))
);

-- Belt and braces: the policy above is the boundary, but a trigger keeps the
-- rule true for any future writer that is not subject to that policy, such as
-- a SECURITY DEFINER function added later or the seed running as service_role.
create or replace function public.post_reactions_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare emoji_community text;
begin
  if new.emoji_id is not null then
    select e.community_id into emoji_community from community_emojis e where e.id = new.emoji_id;
    if emoji_community is distinct from (select p.community_id from posts p where p.id = new.post_id) then
      raise exception 'Emojien hører til et annet fellesskap enn innlegget'
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end $$;

revoke execute on function public.post_reactions_guard() from public, anon, authenticated;

create trigger post_reactions_guard_trigger
before insert or update on post_reactions
for each row execute function public.post_reactions_guard();

-- ── Aggregate, widened for custom emojis ────────────────────────────────
--
-- The old shape was [{emoji, userIds}], which cannot name a custom emoji. Each
-- entry now also carries emojiId and name, with `emoji` null for custom ones.
-- The reaction rows stay the single source of truth; this is still recomputed
-- by trigger and still unwritable by a client.
--
-- Migration path: nothing to backfill by hand. Every existing row has
-- emoji set and emoji_id null, so the new shape reproduces the old entries
-- with emojiId and name null, and the recompute at the end of this file
-- rewrites every post's aggregate in the new form in one pass.

create or replace function public.sync_post_reactions()
returns trigger language plpgsql security definer set search_path = public as $$
declare pid uuid := coalesce(new.post_id, old.post_id);
begin
  update posts
     set reactions = coalesce(
       (select jsonb_agg(entry order by entry->>'sort')
          from (
            select jsonb_build_object(
                     'emoji', r.emoji,
                     'emojiId', r.emoji_id,
                     'name', e.name,
                     'sort', coalesce(e.name, r.emoji),
                     'userIds', jsonb_agg(r.user_id::text order by r.created_at)
                   ) as entry
              from post_reactions r
              left join community_emojis e on e.id = r.emoji_id
             where r.post_id = pid
             group by r.emoji, r.emoji_id, e.name
          ) grouped),
       '[]'::jsonb)
   where id = pid;
  return null;
end $$;

revoke execute on function public.sync_post_reactions() from public, anon, authenticated;

-- Deleting a custom emoji removes its reactions by cascade, but the cascade
-- does not fire the per-row sync in a way that leaves the aggregate correct
-- for the post, so recompute directly.
create or replace function public.resync_posts_after_emoji_delete()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update posts p
     set reactions = coalesce(
       (select jsonb_agg(entry order by entry->>'sort')
          from (
            select jsonb_build_object(
                     'emoji', r.emoji, 'emojiId', r.emoji_id, 'name', e.name,
                     'sort', coalesce(e.name, r.emoji),
                     'userIds', jsonb_agg(r.user_id::text order by r.created_at)
                   ) as entry
              from post_reactions r
              left join community_emojis e on e.id = r.emoji_id
             where r.post_id = p.id
             group by r.emoji, r.emoji_id, e.name
          ) grouped),
       '[]'::jsonb)
   where p.community_id = old.community_id;
  return null;
end $$;

revoke execute on function public.resync_posts_after_emoji_delete() from public, anon, authenticated;

create trigger community_emojis_resync
after delete on community_emojis
for each row execute function public.resync_posts_after_emoji_delete();

-- Rewrite every existing aggregate into the new shape.
--
-- Note how this is done. A plain `update posts set reactions = ...` is refused
-- by the Phase 1 guard, and rightly so — that guard exists precisely to stop
-- anything writing these columns directly, and a migration is not a good
-- reason to switch it off. Touching the reaction rows instead fires the normal
-- sync trigger, which reaches `posts` at trigger depth 2 and is allowed. The
-- backfill therefore runs through exactly the same code path as a user
-- clicking a reaction, which is also the best proof that path works.
--
-- Posts with no reactions already hold '[]', which is valid in both shapes.

update post_reactions set created_at = created_at;
