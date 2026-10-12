-- Closes local-group headcounts to ordinary members again.
--
-- 20260915200000 opened this function to every active member of a community,
-- reasoning that a number names nobody and makes choosing a lokallag feel
-- real. The organisations using it have decided otherwise: how many members a
-- lokallag has is management information. Both Tryggere organisations keep
-- their member registry to administrators, and "FTR Vestland · 1 medlem" is
-- that registry in aggregate — the caveat the earlier migration accepted
-- knowingly is the one being withdrawn here.
--
-- A count is now returned only for a lokallag the caller manages:
--
--   active admin of the community      every lokallag, retired ones included
--                                      (the administration panel shows them)
--   effective lokallagsleder           their own lokallag only — the same
--                                      can_lead_local_group() that decides
--                                      whether they may run its events
--   moderators and ordinary members    nothing
--   non-members, signed out            nothing, as before
--
-- Moderators are ordinary members for this purpose, as they already are for
-- the member directory and for lokallag events.
--
-- Nothing else changes. The return shape is the same (group id, count), so
-- there is still nothing for an identity to travel in. Choosing, changing and
-- clearing a lokallag never depended on this function and is untouched, as
-- are community_local_groups RLS, lokallag channels, leadership grants and
-- member-directory privacy. An administrator's zero still reads as zero:
-- counting from the groups outward gives every group they may see a row.
create or replace function public.local_group_member_counts(p_community_id text)
returns table (local_group_id uuid, member_count bigint)
language sql security definer stable set search_path = public as $$
  select g.id, count(m.id) filter (where m.status = 'active')
  from community_local_groups g
  left join memberships m
    on m.local_group_id = g.id
   and m.community_id = g.community_id
  where g.community_id = p_community_id
    and (is_admin(p_community_id) or can_lead_local_group(g.id))
  group by g.id;
$$;

comment on function public.local_group_member_counts(text) is
  'Active-member headcount per lokallag, only for a lokallag the caller manages: every lokallag for an active admin of the community, their own for an effective lokallagsleder. Empty for moderators, ordinary members and non-members.';

-- Unchanged, restated so the grant travels with the definition: never anon,
-- never PUBLIC.
revoke execute on function public.local_group_member_counts(text) from public, anon;
grant execute on function public.local_group_member_counts(text) to authenticated;
