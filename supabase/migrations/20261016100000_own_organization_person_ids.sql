-- Which published organisation cards are the caller's own?
--
-- community_people.user_id stays unreadable by clients (column grant
-- unchanged). This answers one narrow question the same way
-- organization_person_dm_actions does: run as security definer, read the
-- protected link internally, and return only the community_people.id values
-- that point at auth.uid() — ids that are already public. It reveals nothing
-- about any other person, and is empty for a non-member or signed-out caller.
create or replace function public.own_organization_person_ids(p_community_id text)
returns setof uuid
language sql security definer stable set search_path = public as $$
  select cp.id
  from community_people cp
  join memberships m
    on m.community_id = cp.community_id
   and m.user_id = cp.user_id
   and m.status = 'active'
  where cp.community_id = p_community_id
    and cp.active
    and cp.user_id is not null
    and cp.user_id = auth.uid()
    and is_member(p_community_id);
$$;

comment on function public.own_organization_person_ids(text) is
  'Member-safe: the caller''s own community_people.id values in this community, so a directory card can say "this is you". Never returns user_id or any other person''s link.';

revoke execute on function public.own_organization_person_ids(text) from public, anon;
grant execute on function public.own_organization_person_ids(text) to authenticated;
