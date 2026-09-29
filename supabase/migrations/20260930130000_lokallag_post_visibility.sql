-- A post's local-group scope becomes a real read boundary.
--
-- Until now `posts.local_group_id` was relevance metadata only
-- (20260919120000_local_content_scope): `posts_select` admitted every active
-- member of the community, so an "FTR Oslo" post was readable by a member in
-- Trøndelag, or in no local group at all. The badge on the post described an
-- audience the database did not enforce.
--
-- The rule from here on:
--
--   local_group_id is null  — every active member of the community
--   local_group_id is set   — active members whose membership is in exactly
--                             that group, plus the community's active admins
--                             and moderators
--
-- Staff read every scope in their own community without joining each group,
-- because moderating and publishing to a group they are not in is their job.
-- That oversight is community-scoped by construction: it comes from the role on
-- the membership row of the post's own community, so a TU moderator has nothing
-- to apply to an FTR post.
--
-- ── Where the affiliation comes from ────────────────────────────────────
--
-- `memberships.local_group_id` — one group or none per membership, constrained
-- to a group of the same community by a composite foreign key
-- (20260915180000_community_local_groups). It is read live on every check, so
-- a member who moves from Oslo to Trøndelag loses Oslo posts and gains
-- Trøndelag ones on the next query, with no post rewritten. A membership that
-- is no longer active admits nothing.
--
-- A retired group (`active = false`) is deliberately not tested. Retiring
-- keeps existing affiliations and existing content — that was the promise of
-- the local-content migration — so members still attached to a retired group
-- keep reading what was posted to it.
--
-- ── One rule, every path ────────────────────────────────────────────────
--
-- The decision is written once, in post_scope_admits(), and everything that
-- decides post visibility goes through it:
--
--   posts_select              — the table itself: feed, overview, home, the
--                               lokallag hub, and direct PostgREST reads
--   can_access_post()         — comments and reactions, read and write. Every
--                               comment and reaction policy already calls it,
--                               so they inherit the boundary unchanged.
--   notify_announcement()     — a SECURITY DEFINER trigger that bypasses RLS.
--                               Without this, a lokallag announcement would
--                               put its title in the notifications of members
--                               who cannot open it.
--   can_view_community_profile() — also SECURITY DEFINER. "Wrote something
--                               the caller can read" must mean readable under
--                               this rule, or commenting on a hidden Oslo post
--                               would expose that member's profile to the
--                               whole community where the directory is closed.
--
-- UPDATE and DELETE need no change: when those statements read the row they
-- are filtered by the SELECT policy as well, so nobody edits, deletes or pins
-- through a post they cannot see.

-- ── The rule ────────────────────────────────────────────────────────────
--
-- Internal: it takes a user id, so it is never granted to an API role — the
-- same arrangement as ensure_community_profile(). Callers reach it either
-- through can_read_post_scope() below, which supplies auth.uid(), or from a
-- SECURITY DEFINER trigger deciding for a recipient.
--
-- One indexed lookup: memberships is unique on (user_id, community_id).
create or replace function public.post_scope_admits(
  p_user_id uuid,
  p_community_id text,
  p_local_group_id uuid
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
        or m.role in ('admin', 'moderator')
        or m.local_group_id = p_local_group_id
      )
  );
$$;

revoke execute on function public.post_scope_admits(uuid, text, uuid) from public, anon, authenticated;

comment on function public.post_scope_admits(uuid, text, uuid) is
  'Whether a user may read content in this community and local-group scope: any active member for community-wide (null) scope; for a local group, active members of that group and the community''s active admins and moderators. Internal; takes a user id.';

-- What policies call. Answers only for the caller.
create or replace function public.can_read_post_scope(p_community_id text, p_local_group_id uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select post_scope_admits(auth.uid(), p_community_id, p_local_group_id);
$$;

revoke execute on function public.can_read_post_scope(text, uuid) from public, anon;
grant execute on function public.can_read_post_scope(text, uuid) to authenticated;

-- ── Posts ───────────────────────────────────────────────────────────────

drop policy posts_select on posts;

create policy posts_select on posts for select to authenticated
using (can_read_post_scope(community_id, local_group_id));

comment on policy posts_select on posts is
  'Community-wide posts: active members. Local-group posts: active members of that group, and the community''s active admins and moderators.';

-- ── Comments and reactions ──────────────────────────────────────────────
--
-- Same signature, so every policy that calls it — comments select, insert,
-- update, delete; post_reactions select and insert — follows the post's scope
-- without being touched. A reply or reaction on a post the caller cannot read
-- is refused exactly as one on a post in another community.
create or replace function public.can_access_post(pid uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1
    from posts p
    where p.id = pid
      and post_scope_admits(auth.uid(), p.community_id, p.local_group_id)
  );
$$;

-- ── Announcement fan-out ────────────────────────────────────────────────
--
-- Recreated from 20260926100000_community_profiles with one change: the
-- recipients are the people who can read the announcement, rather than every
-- active member of the community. A lokallag announcement notifies that group
-- and the community's staff; a community-wide one notifies everyone, as before.
create or replace function public.notify_announcement()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- Only announcements. An ordinary post — pinned or not — returns here.
  if new.kind <> 'announcement' then
    return new;
  end if;

  -- The seed is not a broadcast. It loads fixtures as the service role,
  -- including three historical announcements, and its notifications are their
  -- own fixtures. Same exemption as the posts and notifications guards, and
  -- for the same reason: the service role is not a person.
  if coalesce(auth.role(), '') = 'service_role' then
    return new;
  end if;

  -- Independent of the policy that let this row in, and loud rather than
  -- silent. `posts_insert` already requires can_moderate() for an
  -- announcement, so this cannot fire today; it exists so that loosening that
  -- policy fails here instead of quietly turning a member's post into a
  -- notification for the whole community.
  if not can_moderate(new.community_id) then
    raise exception 'Bare moderatorer og administratorer kan publisere kunngjøringer'
      using errcode = 'insufficient_privilege';
  end if;

  -- Recipients are derived, never supplied: every active membership of this
  -- announcement's own community that may read it, minus the person who wrote
  -- it. The author is named as they appear in this community.
  insert into notifications (user_id, kind, community_id, title, body, href)
  select
    m.user_id,
    'announcement',
    new.community_id,
    'Ny kunngjøring: ' || coalesce(nullif(btrim(new.title), ''), left(btrim(new.body), 80)),
    coalesce(author.display_name, 'Et medlem') || ' publiserte en kunngjøring i ' || c.name,
    '/community/' || new.community_id || '/feed'
  from memberships m
  join communities c on c.id = new.community_id
  left join community_profiles author
    on author.community_id = new.community_id and author.user_id = new.author_id
  where m.community_id = new.community_id
    and m.status = 'active'
    and m.user_id <> new.author_id
    and post_scope_admits(m.user_id, new.community_id, new.local_group_id);

  return new;
end $$;

revoke execute on function public.notify_announcement() from public, anon, authenticated;

-- ── Community profiles ──────────────────────────────────────────────────
--
-- Recreated from 20260926100000_community_profiles. The only change is in the
-- two authorship clauses: a post, or a comment on a post, counts only when the
-- caller may read that post. Everything else is as it was.
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
            and post_scope_admits(auth.uid(), p.community_id, p.local_group_id)
        )
        or exists (
          select 1 from comments c
          join posts p on p.id = c.post_id
          where p.community_id = p_community_id and c.author_id = p_user_id
            and post_scope_admits(auth.uid(), p.community_id, p.local_group_id)
        )
        or exists (
          select 1 from messages msg
          join channels ch on ch.id = msg.channel_id
          where ch.community_id = p_community_id and msg.author_id = p_user_id
        )
        or exists (
          select 1 from events e
          where e.community_id = p_community_id and e.host_id = p_user_id
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

comment on column posts.local_group_id is
  'Optional local group scope. Null means the post is community-wide. When set, only active members of that group and the community''s active admins and moderators may read it (posts_select). Must belong to the same community and be active when chosen.';
