-- Members write only the columns the app sends.
--
-- 20261026100000 granted INSERT (and UPDATE) on messages, comments, posts and
-- events to `authenticated` on the whole table. The app never sends more than
-- a handful of columns, but anyone holding a member's session can call the
-- API directly, and the guard triggers only watch some of the rest. That let a
-- member store a message with a made-up `attachment` (a JSON shape the channel
-- page cannot render, which broke the page for everyone), invented
-- `reactions` counts, or a `created_at` of their choosing; a comment with a
-- backdated `created_at`; and, for moderators, a post with invented
-- `reactions`, `comment_count` and date.
--
-- Now each role gets exactly the columns the app writes, so anything else is
-- refused on privilege (42501) before a policy or trigger runs. Defaults
-- (`id`, `author_id`, `host_id`, `created_at`, `reactions`, …) and the guard
-- triggers set the rest. Pinning, cancelling and restoring, editing a
-- message, and sending with attachments or a poll already go through
-- SECURITY DEFINER functions and need no column here.
--
-- Two checks the API could previously skip:
--   * a channel message's text is at most 4000 characters, as lib/message-form
--     and edit_channel_message already require (direct messages and comments
--     have had the same rule in the database from the start);
--   * the legacy `attachment` card, written only by the seed, has the one
--     shape the channel page renders.

-- ── messages ─────────────────────────────────────────────────────────────
revoke insert on public.messages from authenticated;
grant insert (channel_id, body) on public.messages to authenticated;

alter table public.messages
  add constraint messages_body_length
  check (length(btrim(body)) <= 4000);

alter table public.messages
  add constraint messages_attachment_shape
  check (
    attachment is null
    or (
      jsonb_typeof(attachment) = 'object'
      and attachment ->> 'kind' in ('file', 'link')
      and jsonb_typeof(attachment -> 'label') = 'string'
      and jsonb_typeof(attachment -> 'meta') = 'string'
      and length(attachment ->> 'label') between 1 and 200
      and length(attachment ->> 'meta') <= 200
    )
  );

-- ── comments ─────────────────────────────────────────────────────────────
revoke insert, update on public.comments from authenticated;
grant insert (post_id, parent_id, body) on public.comments to authenticated;
grant update (body) on public.comments to authenticated;

-- ── posts ────────────────────────────────────────────────────────────────
revoke insert, update on public.posts from authenticated;
grant insert (community_id, local_group_id, subgroup_id, title, body, kind) on public.posts to authenticated;
grant update (title, body) on public.posts to authenticated;

-- ── events ───────────────────────────────────────────────────────────────
revoke insert, update on public.events from authenticated;
grant insert (community_id, local_group_id, subgroup_id, title, description, starts_at, ends_at, location, is_public, capacity)
  on public.events to authenticated;
grant update (title, description, starts_at, ends_at, location, capacity) on public.events to authenticated;
