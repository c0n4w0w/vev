-- Makes pinning a real, controlled operation.
--
-- `posts.pinned` has existed since the first migration and the seed sets it on
-- one announcement per community, but nothing ever wrote it from the product
-- and nothing ever read it for ordering. The badge said "Festet" while the feed
-- stayed strictly chronological, so the pinned post drifted down the page as
-- soon as anyone posted. The badge was decoration.
--
-- Worse, the column was writable by the wrong people. `posts_update` allows an
-- author to edit their own post and its `with check` never mentioned `pinned`,
-- so any ordinary member could pin their own post with a single PostgREST
-- request — no moderator involved, and the result rode to the top of the feed
-- once ordering existed. This migration is what makes that ordering safe to
-- add.
--
-- Two things are needed, and they enforce the same rule from both sides:
--
--   the trigger — `pinned` may only change when the caller can moderate that
--                 community. This is what actually closes the hole, because it
--                 runs on every update whatever path reached the table.
--   the function — a moderator must be able to pin *someone else's* post, and
--                 `posts_update`'s `using` clause restricts updates to the
--                 author. Rather than widen that policy — which would also let
--                 moderators rewrite other people's words, something the
--                 existing design deliberately refuses — pinning gets its own
--                 narrow SECURITY DEFINER entry point that can change nothing
--                 else.

-- ── Ordering ────────────────────────────────────────────────────────────
--
-- The feed reads `order by pinned desc, created_at desc` within one community.
-- The existing index covers (community_id, created_at desc) only, which the
-- planner can no longer use for that sort.
create index posts_community_pinned_idx
  on posts (community_id, pinned desc, created_at desc);

-- ── The rule, on the table itself ───────────────────────────────────────
--
-- Recreated rather than replaced piecemeal: this is the same guard as before
-- with one clause added, so the whole body stays readable in one place. The
-- version it builds on is the one from 20260908110000_comments_and_reactions,
-- where the aggregate clause was narrowed with pg_trigger_depth() so the
-- comment and reaction sync triggers can maintain their own columns. That
-- narrowing is carried forward here unchanged; dropping it would break every
-- comment and reaction write.
--
-- `can_moderate` is the project's existing definition of content powers —
-- admin or moderator, active membership — and is what already decides who may
-- publish an announcement and who may delete another member's post. Pinning
-- belongs with those, not with editing.
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

  -- The new clause. Note it reads `old.community_id`: the check above has
  -- already established the two are equal, and using the old value means a
  -- caller cannot smuggle in a community they *can* moderate.
  --
  -- The service role is exempt, as it is from row level security everywhere
  -- else. It is not a person: it is the seed and the maintenance scripts, it
  -- has no auth.uid() for can_moderate() to judge, and it could drop this
  -- trigger outright if it wanted to. Policing it here would buy nothing and
  -- would quietly break `npm run seed` the first time the seed needs to move a
  -- pin — a failure that looks like success, because a rejected update returns
  -- an error object rather than throwing.
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

-- ── The entry point ─────────────────────────────────────────────────────
--
-- Takes a post id and nothing else. There is no community parameter to forge:
-- the community is read from the post itself, and the permission check is made
-- against that. A post id from another community therefore fails the same way
-- a made-up one does.
--
-- Returns the resulting state, or null when the caller may not do this or the
-- post is not theirs to see. Refusal and absence look identical on purpose —
-- the same reason `/demo/<token>` answers one 404 for every reason — so this
-- cannot be used to probe which post ids exist.
create or replace function public.set_post_pinned(
  p_post_id uuid,
  p_pinned boolean
)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  v_community_id text;
begin
  if p_post_id is null or p_pinned is null then
    return null;
  end if;

  select community_id into v_community_id from posts where id = p_post_id;
  if v_community_id is null then
    return null;
  end if;

  if not can_moderate(v_community_id) then
    return null;
  end if;

  -- Only ever this one column. The function is SECURITY DEFINER, so anything
  -- else it touched would be touched with the owner's rights.
  update posts set pinned = p_pinned where id = p_post_id;

  return p_pinned;
end;
$$;

revoke execute on function public.set_post_pinned(uuid, boolean) from public, anon;
grant execute on function public.set_post_pinned(uuid, boolean) to authenticated;

comment on column posts.pinned is
  'Pinned posts sort before the rest of their community feed. Written only by '
  'set_post_pinned(); the posts_immutable trigger refuses any other change by '
  'a caller who cannot moderate the community.';
