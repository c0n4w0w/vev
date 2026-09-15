-- Makes `accepts_member_dms` private to the person it belongs to.
--
-- The previous migration attached the setting to `memberships`, which was the
-- right place for it: community-scoped, role-aware, already keyed by
-- (user_id, community_id). But it inherited that table's read rules, and in a
-- community with `member_directory_visibility = 'admin_only'` those rules give
-- administrators the whole row. So every administrator could read whether each
-- of their moderators had made themselves reachable — a personal preference
-- that no feature needs anyone else to see. `can_send_dm()` decides who may
-- write to whom entirely on its own.
--
-- Row level security cannot fix this. A policy admits or refuses a whole row;
-- it has no vocabulary for "this column, but not that one". Column privileges
-- do, and they are a separate layer that composes with RLS rather than
-- competing with it: the policies are untouched below, so exactly the same
-- rows remain visible to exactly the same people — with one column removed
-- from what a client may name.
--
-- It has to be done in this order. A column-level REVOKE cannot subtract from
-- a table-level GRANT: `grant select on memberships` means every column, and
-- `revoke select (one_column)` against it is accepted and does nothing. The
-- table-level privilege has to come off first, and the columns that should
-- stay readable are then granted back by name.
--
-- Note for whoever adds the next column to this table: it will *not* be
-- readable by clients until it is added to the grant below. That is the safe
-- default — a new column is private until someone decides otherwise — but it
-- is a surprise if you are not expecting it.
revoke select on memberships from anon, authenticated;

grant select (
  id,
  user_id,
  community_id,
  role,
  status,
  joined_at,
  title,
  invited_by
) on memberships to anon, authenticated;

-- The two functions that need the value keep it. Both are SECURITY DEFINER and
-- owned by postgres, so they read the column as the owner and are unaffected
-- by the revoke above:
--
--   can_send_dm()            — authorisation. Unchanged by this migration.
--   set_accepts_member_dms() — the only client write path. Unchanged.
--
-- What is missing after the revoke is an honest way for the setting's owner to
-- see their own value, which the settings screen has to render. This is that
-- function, and it is deliberately the narrowest possible read: no arguments
-- naming a person, one community, the caller's own row, and staff only —
-- exactly the same conditions under which the value can be written.
--
-- An ordinary member gets false rather than an error. That is not evasion: the
-- setting has no meaning for a row that is not staff, `can_send_dm()` ignores
-- it for such a row, and false is what is stored.
create or replace function public.my_accepts_member_dms(p_community_id text)
returns boolean language sql security definer stable set search_path = public as $$
  select coalesce(
    (
      select m.accepts_member_dms
      from memberships m
      where m.user_id = auth.uid()
        and m.community_id = p_community_id
        and m.status = 'active'
        and m.role in ('admin', 'moderator')
    ),
    false
  );
$$;

revoke execute on function public.my_accepts_member_dms(text) from public, anon;
grant execute on function public.my_accepts_member_dms(text) to authenticated;

comment on column memberships.accepts_member_dms is
  'Staff only: when true, ordinary members of this community may open a DM with this person. Private to that person — clients cannot select this column (see the revoke in 20260915160000). Read it through my_accepts_member_dms() for the caller''s own value, or can_send_dm() for an authorisation decision. Default false.';
