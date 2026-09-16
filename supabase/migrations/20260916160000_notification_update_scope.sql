-- Narrows what a recipient may change about their own notification to the one
-- thing the product means them to change: whether they have read it.
--
-- `notifications_update` reads
--
--   using (user_id = auth.uid()) with check (user_id = auth.uid())
--
-- which pins *ownership* and says nothing about content. A policy admits or
-- refuses a whole row; it has no vocabulary for "this column, but not that
-- one". So the check passes for any update that leaves the row belonging to
-- the same person — including one that rewrites the title, the body, the link
-- and the kind. Verified against this database before the change: one
-- PATCH rewrote all four on six rows at once.
--
-- Nobody else can read those rows, so today the damage is confined to lying to
-- yourself. It stops being confined the moment anything server-side trusts a
-- notification's own fields — a click-through handler that follows `href`, a
-- grouping query on `kind`, a count by community. The notification feature is
-- about to be built on top of this table, and this is the cheapest moment to
-- make those fields mean what they say.
--
-- Two layers, because they fail differently:
--
--   column privileges — the structural control. A client cannot even name the
--       other columns in an UPDATE, so the request is refused by Postgres
--       before any policy or trigger runs.
--   the trigger — the invariant. Column grants are a *configuration* that a
--       later `grant all on notifications to authenticated` would silently
--       undo, and Supabase hands out table-wide grants on its own (the init
--       migration's own grant block exists because of exactly that). The
--       trigger keeps holding when the grants stop.
--
-- Neither layer is redundant with the other: the first refuses the request,
-- the second refuses the write.

-- ── Layer 1: column privileges ──────────────────────────────────────────
--
-- Order matters, for the same reason it did in 20260915160000: a column-level
-- REVOKE cannot subtract from a table-level GRANT. `grant update on
-- notifications` means every column, and `revoke update (title)` against it is
-- accepted and does nothing. The table-level privilege comes off first, and
-- the one column a client may write is granted back by name.
--
-- anon gets nothing back. It never had a policy on this table, so it could not
-- update a row in any case; leaving it a table-wide privilege it cannot use is
-- just a thing for someone to misread later.
revoke update on notifications from anon, authenticated;

grant update (read) on notifications to authenticated;

-- Note for whoever adds the next column to this table: it will *not* be
-- writable by clients until it is named above. That is the safe default — a
-- new column is immutable until someone decides otherwise — but it is a
-- surprise if you are not expecting it. A future `read_at` belongs in that
-- grant; `actor_id`, `post_id` and the rest do not.

-- ── Layer 2: the guard ──────────────────────────────────────────────────
--
-- Same shape as posts_guard_immutable: the columns that must not move are
-- compared old to new, and anything else is left alone.
--
-- The service role is exempt, as it is from row level security everywhere
-- else and as it is in the posts guard. It is not a person — it is the seed
-- and the maintenance scripts — it has no auth.uid() to judge, and it could
-- drop this trigger outright. Policing it would only mean a future seed that
-- needs to correct a notification fails in the way that is hardest to notice:
-- a rejected PostgREST write comes back as an error object, not an exception,
-- so a script that forgets to read it reports success.
create or replace function public.notifications_guard_immutable()
returns trigger language plpgsql security invoker set search_path = public as $$
begin
  if coalesce(auth.role(), '') = 'service_role' then
    return new;
  end if;

  if new.id is distinct from old.id
     or new.user_id is distinct from old.user_id
     or new.kind is distinct from old.kind
     or new.community_id is distinct from old.community_id
     or new.title is distinct from old.title
     or new.body is distinct from old.body
     or new.href is distinct from old.href
     or new.created_at is distinct from old.created_at then
    raise exception 'Et varsel kan bare markeres som lest eller ulest'
      using errcode = 'insufficient_privilege';
  end if;

  return new;
end $$;

revoke execute on function public.notifications_guard_immutable()
  from public, anon, authenticated;

create trigger notifications_immutable
before update on notifications
for each row execute function public.notifications_guard_immutable();

-- ── What is deliberately unchanged ──────────────────────────────────────
--
-- notifications_select and notifications_update keep their existing
-- definitions: a recipient still sees and still writes only their own rows.
-- This migration removes columns from that write, not rows.
--
-- There is still no INSERT policy and still no DELETE policy, so a client can
-- create nothing and remove nothing. That stays true here.
--
-- mark_notifications_read() and accept_invitation_token() are untouched and
-- keep working. Both are SECURITY DEFINER owned by postgres, which owns this
-- table, so they act as the owner: column privileges granted to
-- `authenticated` do not apply to them, and neither does row level security.
-- mark_notifications_read() still scopes itself with
-- `where user_id = auth.uid()`, which is what confines it to the caller — the
-- change below gives it no authority it did not already have, and takes none
-- away. accept_invitation_token() inserts rather than updates and so never
-- meets the trigger at all.

comment on column notifications.read is
  'The only column a recipient may write. Everything else is fixed at creation '
  '— see the column grant and the notifications_immutable trigger in '
  '20260916160000. Mark the caller''s own notifications with '
  'mark_notifications_read().';
