-- A member-safe way to ask "which active memberships are also explicitly
-- linked organisation/Crew identities in this community?"
--
-- community_people.user_id itself stays exactly as locked down as before:
-- the column grant on community_people still excludes it, and
-- community_person_account_links(...) still refuses anyone but an admin.
-- This function does not change either of those. It answers a narrower
-- question instead, the same way organization_person_dm_actions already
-- does: run as security definer, touch the protected column internally, and
-- return only a derived result that carries no more than what the caller can
-- already see.
--
-- A membership's own user_id is already visible to any member who passes
-- can_view_member_directory (that is how the member list itself is read).
-- This function does not expose a single user_id beyond that set — it only
-- says which of those already-visible ids are also an explicit organisation
-- link, so a caller can avoid presenting the same person twice. It is
-- presentation data, not new identity.
create or replace function public.community_people_linked_member_ids(p_community_id text)
returns setof uuid
language sql security definer stable set search_path = public as $$
  select distinct m.user_id
  from community_people cp
  join memberships m
    on m.community_id = cp.community_id
   and m.user_id = cp.user_id
   and m.status = 'active'
  where cp.community_id = p_community_id
    and cp.active
    and cp.user_id is not null
    and is_member(p_community_id);
$$;

comment on function public.community_people_linked_member_ids(text) is
  'Member-safe: active membership user_ids that are also an explicit community_people link, for de-duplicating a member-facing directory against a published organisation/Crew list. Empty for a non-member caller.';

revoke execute on function public.community_people_linked_member_ids(text) from public, anon;
grant execute on function public.community_people_linked_member_ids(text) to authenticated;
