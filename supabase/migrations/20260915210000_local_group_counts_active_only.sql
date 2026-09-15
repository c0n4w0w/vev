-- Aligns what the count function returns with what the member-facing UI shows.
--
-- 20260915200000 opened headcounts to ordinary members, and counted every group
-- in the community — retired ones included. The picker never renders those: a
-- retired group cannot be chosen, so it is filtered out before display. The
-- result was an API that answered a question the interface had deliberately
-- decided not to ask, which is the kind of gap that is invisible until someone
-- reads the network tab.
--
-- Retired groups are not a secret, and nothing here is a breach. But "the UI
-- hides it" is not an access rule, and a count endpoint should not quietly
-- return more than the screen it exists to fill.
--
-- So the active filter is lifted only for administrators, who genuinely need
-- the retired counts: the management panel shows "FTR Oslo · 2 medlemmer ·
-- Avviklet", and an administrator deciding whether to reinstate a group has to
-- know whether anyone is still in it. Moderators are ordinary members for this
-- purpose, as they are for the directory.
--
-- Everything else is untouched: same gate, same community scoping, same return
-- shape, no change to community_local_groups RLS, none to member-directory
-- privacy, and still nothing in the result that names a person.
create or replace function public.local_group_member_counts(p_community_id text)
returns table (local_group_id uuid, member_count bigint)
language sql security definer stable set search_path = public as $$
  select g.id, count(m.id) filter (where m.status = 'active')
  from community_local_groups g
  left join memberships m
    on m.local_group_id = g.id
   and m.community_id = g.community_id
  where g.community_id = p_community_id
    and is_member(p_community_id)
    and (g.active or is_admin(p_community_id))
  group by g.id;
$$;

revoke execute on function public.local_group_member_counts(text) from public, anon;
grant execute on function public.local_group_member_counts(text) to authenticated;
