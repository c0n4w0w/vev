-- A member-safe way to enrich a public Crew card with the useful parts of an
-- explicitly linked TING profile, without ever handing out
-- community_people.user_id itself.
--
-- This is deliberately separate from community_people_linked_member_ids
-- (which the MEDLEMMER de-duplication still uses unchanged). That function
-- answers "which member ids are already shown as Crew" with bare ids; this
-- one answers "what does this specific, already-public Crew card get to show"
-- with bio/location/title, keyed by the Crew person's own id — a value the
-- caller already has from the public community_people read.
--
-- No new exposure of identity: the row returned carries nothing that names or
-- points at an account (no user_id, no membership id, no email, no role). A
-- caller who cannot resolve is_member() gets no rows, matching the pattern
-- used throughout the direct-message helpers.
create or replace function public.community_people_linked_member_details(p_community_id text)
returns table (
  person_id uuid,
  title text,
  bio text,
  location text
)
language sql security definer stable set search_path = public as $$
  select
    cp.id as person_id,
    m.title,
    p.bio,
    p.location
  from public.community_people cp
  join public.memberships m
    on m.community_id = cp.community_id
   and m.user_id = cp.user_id
   and m.status = 'active'
  join public.profiles p
    on p.id = cp.user_id
  where cp.community_id = p_community_id
    and cp.section = 'crew'
    and cp.active
    and cp.user_id is not null
    and public.is_member(p_community_id);
$$;

comment on function public.community_people_linked_member_details(text) is
  'Member-safe Crew-card enrichment: bio/location/title for explicitly-linked, actively-membered Crew people, keyed by the already-public community_people.id. Never returns user_id, membership id, email, or role. Empty for a non-member caller.';

revoke execute on function public.community_people_linked_member_details(text) from public, anon;
grant execute on function public.community_people_linked_member_details(text) to authenticated;
