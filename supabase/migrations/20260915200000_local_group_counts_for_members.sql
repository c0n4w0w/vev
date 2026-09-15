-- Opens local-group headcounts to ordinary members.
--
-- 20260915180000 gated this function on can_view_member_directory(), on the
-- reasoning that a per-group headcount is the member registry in aggregate and
-- should follow the registry's own rule. Under member_directory_visibility =
-- 'admin_only' that meant only administrators saw any numbers at all.
--
-- That was the cautious reading, and it is the wrong trade here. The point of
-- local groups is to get people to their nearest one, and "FTR Trøndelag ·
-- 12 medlemmer" is most of what makes that choice feel real. A count is also
-- categorically different from the thing admin_only protects: the registry is
-- sensitive because knowing *who* is involved is sensitive, and a number names
-- nobody.
--
-- So the gate becomes ordinary active membership of the community being asked
-- about. Everything else is unchanged, and deliberately so:
--
--   * member_directory_visibility keeps its exact meaning. This function does
--     not consult it any more, but nothing else changed: a member still cannot
--     list the membership, read another person's affiliation, or see a name.
--   * The result is still (group id, count). No user id, no name, no email, no
--     role, no individual affiliation — there is nothing in the return type for
--     an identity to travel in.
--   * Still community-scoped twice over: is_member() must hold for the
--     community asked about, and both the group and the memberships counted are
--     pinned to it. A member of one Tryggere organisation gets nothing for the
--     other.
--   * Non-members and anonymous callers get an empty set, which is also what a
--     community that does not exist returns. The function confirms nothing.
--
-- What a count can still tell you is that a group has exactly one member,
-- which in a small organisation narrows a guess. That is inherent to publishing
-- any aggregate and is accepted here knowingly; it is not a way to learn who
-- that person is, and every path that would name them is unchanged.
--
-- Also fixed while here: a group nobody has joined previously returned no row
-- at all, so "no permission" and "nobody yet" were indistinguishable to the
-- caller. Counting from the groups outward gives every group in the community
-- a row, and zero now reads as zero.
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
  group by g.id;
$$;

-- Unchanged, restated so the grant travels with the definition: never anon,
-- never PUBLIC.
revoke execute on function public.local_group_member_counts(text) from public, anon;
grant execute on function public.local_group_member_counts(text) to authenticated;
