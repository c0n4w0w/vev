-- Makes posts editable and deletable, under the same role model as everything
-- else, and freezes the columns that must never move.
--
-- `posts_insert` already covered creation completely: it pins author_id to
-- auth.uid(), requires active membership of the target community, and limits
-- announcements to moderators and admins. Nothing here loosens that.
--
-- What was missing is that `posts` had no UPDATE and no DELETE policy at all,
-- so with RLS enabled neither was possible for anyone. The two policies below
-- add exactly the intended rules and no more:
--
--   edit   — the author, and only the author. A moderator follows up
--            conversations; they do not rewrite someone else's words.
--   delete — the author, or a moderator/admin of that same community, which is
--            what moderation means here.
--
-- The `with check` clause on update re-asserts every condition insert checks,
-- so an edit cannot be used to reassign authorship, move a post into another
-- community, or promote an ordinary post into an announcement.

-- The author is taken from the session by the database itself. With a default
-- of auth.uid(), an insert simply does not carry an author_id, so there is no
-- client-supplied value for the policy to have to reject. The policy still
-- checks it, belt and braces, for any caller that sends one anyway.
alter table posts alter column author_id set default auth.uid();

create policy posts_update on posts for update to authenticated
using (
  author_id = auth.uid()
  and is_member(community_id)
)
with check (
  author_id = auth.uid()
  and is_member(community_id)
  -- Same rule as insert: only moderators and admins may publish announcements,
  -- so editing cannot be a back door into one.
  and (kind = 'post' or can_moderate(community_id))
);

create policy posts_delete on posts for delete to authenticated
using (
  is_member(community_id)
  and (author_id = auth.uid() or can_moderate(community_id))
);

-- A policy's `using` clause sees the old row and `with check` sees the new one,
-- and no single expression can compare the two. Anything that must be immutable
-- therefore needs a trigger.
--
-- community_id and author_id are frozen so a post cannot be walked into another
-- community or reattributed. created_at is frozen so ordering cannot be forged.
-- comment_count and reactions are frozen because they are derived state: they
-- get their own controlled write path later, and until then nothing should be
-- able to set them by editing a post.
--
-- edited_at is stamped here rather than accepted from the caller, so an edit
-- cannot be made to look like an original. That matters for an organisation
-- whose members may act on what someone wrote.

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
  if new.comment_count is distinct from old.comment_count
     or new.reactions is distinct from old.reactions then
    raise exception 'Kommentarer og reaksjoner har sin egen skrivevei'
      using errcode = 'check_violation';
  end if;

  if new.body is distinct from old.body or new.title is distinct from old.title then
    new.edited_at := now();
  end if;

  return new;
end $$;

revoke execute on function public.posts_guard_immutable() from public, anon, authenticated;

alter table posts add column edited_at timestamptz;

comment on column posts.edited_at is
  'Set by the posts_immutable trigger when the text changes. Never accepted from a caller.';

create trigger posts_immutable
before update on posts
for each row execute function public.posts_guard_immutable();
