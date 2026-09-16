-- Makes the promise in 20260906120000 true.
--
-- `posts_insert` has carried this comment since the first migration:
--
--     -- Announcements notify everyone, so they are moderator-and-up only.
--
-- The permission model was built around that sentence — an announcement is
-- moderator-and-up precisely because it reaches every member — and the
-- sentence has been false the whole time. Publishing one wrote a post and
-- notified nobody. This is the fan-out it describes.
--
-- ── Why a trigger, and not a function the application calls ──────────────
--
-- The audit that preceded this work suggested a SECURITY DEFINER function,
-- reasoning from the other write paths in this schema. Tracing the actual
-- announcement path changes the answer.
--
-- An announcement is already created by an ordinary PostgREST insert whose
-- every rule `posts_insert` enforces: the author is `auth.uid()` by column
-- default and by policy, membership is required, and `can_moderate()` is
-- required for `kind = 'announcement'`. There is nothing left for a function
-- to authorise. What a function *would* add is a second way to publish, and a
-- callable entry point that creates notifications — and a callable thing that
-- creates notifications is exactly the surface this schema should not have.
-- There is deliberately no "notify user X" RPC here, and no argument anywhere
-- below that names a recipient.
--
-- A trigger has the properties the feature needs and none of that:
--
--   not callable     — it is not in the PostgREST schema. A client cannot
--                      invoke it, with any arguments, at all.
--   cannot diverge   — there is no path that creates an announcement without
--                      notifying, because the notifying *is* the insert.
--   atomic           — same transaction. A fan-out that fails takes the
--                      announcement with it rather than leaving a published
--                      post nobody was told about.
--   nothing to forge — community, author and kind are read from the row that
--                      was just written, which the policy has already vetted.
--                      They are not parameters.
--
-- The cost is that fan-out happens inside the insert's transaction, so
-- publishing is as slow as the member count. For organisations of this size
-- that is one small insert-select. If TING ever has a community where that
-- matters, this becomes a queue — and the trigger is a better place to start
-- from than a scattering of call sites, because there is only one of it.
--
-- ── Why no new column ───────────────────────────────────────────────────
--
-- The obvious idempotency device is `notifications.post_id` plus a unique
-- index, and it is deliberately not here, because with an AFTER INSERT trigger
-- there is nothing for it to deduplicate. The trigger fires once per inserted
-- row, and only on insert: a retried submission creates a *different* post,
-- which is a different announcement and legitimately notifies again, and no
-- update — pinning, unpinning, editing — reaches this code at all. Duplicate
-- notifications for one announcement are not prevented here so much as
-- unconstructible.
--
-- Matching on title and body to fake the same guarantee would be worse than
-- nothing. `post_id` earns its place when something needs to *find* a
-- notification's subject — a post detail route to link to, or a second
-- generator that can be invoked more than once — and neither exists yet.
--
-- The href is therefore the community feed rather than a post, which is also
-- what makes a deleted announcement harmless: the link still resolves, to a
-- page whose own access check runs as usual.

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
  -- announcement's own community, minus the person who wrote it.
  --
  -- `status = 'active'` is the whole rule. The enum also holds 'invited' and
  -- 'requested', which 20260908160000 left unreachable rather than dropped —
  -- naming 'active' explicitly means those stay excluded if anything ever
  -- writes them again.
  insert into notifications (user_id, kind, community_id, title, body, href)
  select
    m.user_id,
    'announcement',
    new.community_id,
    'Ny kunngjøring: ' || coalesce(nullif(btrim(new.title), ''), left(btrim(new.body), 80)),
    author.name || ' publiserte en kunngjøring i ' || c.name,
    '/community/' || new.community_id || '/feed'
  from memberships m
  join communities c on c.id = new.community_id
  join profiles author on author.id = new.author_id
  where m.community_id = new.community_id
    and m.status = 'active'
    and m.user_id <> new.author_id;

  return new;
end $$;

revoke execute on function public.notify_announcement() from public, anon, authenticated;

-- AFTER INSERT, and only insert. An UPDATE trigger here would fan out again
-- every time an announcement was pinned or edited; there is deliberately no
-- such trigger, and `notifications` still has no INSERT policy, so this
-- function remains the only thing in the database that can create an
-- announcement notification.
create trigger posts_notify_announcement
after insert on posts
for each row execute function public.notify_announcement();

comment on function public.notify_announcement() is
  'Fan-out for feed announcements. Recipients are derived from active '
  'memberships of the post''s own community and exclude its author. Not '
  'callable: it is a trigger function, revoked from every API role, and takes '
  'no recipient argument.';
