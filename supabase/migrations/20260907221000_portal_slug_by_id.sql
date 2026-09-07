-- Lets the private-area guard send a non-member to the public portal.
--
-- `/community/[id]` is supposed to redirect anyone without access to that
-- community's public portal. It could only do so when the community row was
-- visible under RLS — which requires a membership row of some kind. A signed-in
-- person with no relationship to the community got a bare 404 instead, so the
-- same intent produced two different outcomes depending on an RLS artifact:
-- an invited user was redirected, a stranger was not.
--
-- This resolves a community id to its portal slug, and nothing else. It leaks
-- no information that the portal does not already publish: `/under-the-rug`
-- answers 200 and `/finnes-ikke` answers 404 for anyone, so confirming that a
-- *specific, already-known* name exists is inherent to having public portals.
-- What the privacy model forbids is *enumeration* — listing communities, or
-- discovering ones you were never told about — and that is unchanged: there is
-- still no query that returns more than one community to an outsider.

create or replace function public.portal_slug_by_id(p_community_id text)
returns text language sql security definer stable set search_path = public as $$
  select slug from communities where id = p_community_id;
$$;

revoke execute on function public.portal_slug_by_id(text) from public;
grant execute on function public.portal_slug_by_id(text) to anon, authenticated;
