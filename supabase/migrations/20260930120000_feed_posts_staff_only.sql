-- The community feed becomes an official, moderated publishing surface.
--
-- Until now `posts_insert` let any active member publish an ordinary post and
-- reserved only `kind = 'announcement'` for moderators and admins. The product
-- rule is now:
--
--   feed posts — active admins and moderators of that community only
--   comments   — every active member who can read the post (unchanged)
--   reactions  — every active member who can read the post (unchanged)
--   channels and direct messages — unchanged
--
-- Only creation is narrowed. Everything else about posts stays as it was:
--
--   read      — `posts_select` still admits every active member, local posts
--               included. A local group is a relevance signal, not a
--               visibility boundary, and this migration does not change that.
--   edit      — `posts_update` still lets an author edit their own post, so a
--               member who published before this rule can still correct it.
--               Its `with check` keeps refusing a promotion to announcement.
--   delete    — author, or a moderator/admin of that community.
--   pin       — `set_post_pinned()` and the posts_immutable trigger, both
--               `can_moderate()`.
--
-- ── Why the policy and not a function ───────────────────────────────────
--
-- The insert through PostgREST is the only way a post is created — there is
-- no SECURITY DEFINER function that writes `posts` — so the policy is the one
-- place every create passes through. Hiding the composer is presentation; this
-- is the boundary.
--
-- `can_moderate(community_id)` is the project's existing definition of content
-- powers: an *active* membership of *that* community with role admin or
-- moderator. It already decides announcements, pinning and deleting other
-- people's posts, so posting joins them rather than getting a parallel rule.
-- Because it is evaluated against the row's own community_id, a moderator of
-- one community gains nothing in another, and an invited or requested row
-- carrying an elevated role counts for nothing until it is active.
--
-- The announcement clause is subsumed rather than dropped in spirit: whoever
-- may now post may also announce, which is exactly who could announce before.
-- Announcement authority is neither widened nor narrowed.
--
-- ── Local group scope ───────────────────────────────────────────────────
--
-- Untouched, because it was already enforced where it has to be. The
-- composite foreign key (local_group_id, community_id) →
-- community_local_groups (id, community_id) makes a group from another
-- community unrepresentable, and the posts_local_group_active trigger refuses
-- a retired group. An FTR moderator therefore cannot scope into a TU group and
-- vice versa, whatever id they send.

drop policy posts_insert on posts;

create policy posts_insert on posts for insert to authenticated
with check (
  author_id = auth.uid()
  -- Active admin or moderator of the post's own community. Implies active
  -- membership, and so also covers announcements.
  and can_moderate(community_id)
);

comment on policy posts_insert on posts is
  'Feed posts are official: only active admins and moderators of the community '
  'may create them, announcements included. Members comment and react instead.';
