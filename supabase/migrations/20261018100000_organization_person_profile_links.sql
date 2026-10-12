-- Whose profile photo belongs on which organisation card?
--
-- A directory card is a `community_people` row: a name, a role and a contact
-- address the organisation publishes. It has no photo of its own. When an
-- administrator has linked a card to a TING account, the person behind it may
-- have uploaded a profile photo in this community — but the card could never
-- show it, because the link (`community_people.user_id`) is unreadable by
-- clients, so nothing could tell the page which profile to ask for.
--
-- This answers exactly that, and no more. For each linked card it returns the
-- account id *only when the caller may already see that person's profile in
-- this community* — `can_view_community_profile`, the same rule that guards
-- the profile row and the photo object in `member-avatars`. So:
--
--   * no photo becomes visible to anyone who could not already fetch it;
--   * no account id is returned that the caller could not already read from
--     `community_profiles` — in a community with a closed member directory,
--     a linked person who has never taken part stays as unnamed as before;
--   * it is one community at a time, and empty for a non-member.
--
-- The page then reads the photo the ordinary way, through the caller's own
-- `community_profiles` rows. The column grant on `community_people.user_id`
-- is unchanged.
create or replace function public.organization_person_profile_links(p_community_id text)
returns table (person_id uuid, user_id uuid)
language sql security definer stable set search_path = public as $$
  select cp.id as person_id, cp.user_id
  from community_people cp
  join memberships m
    on m.community_id = cp.community_id
   and m.user_id = cp.user_id
   and m.status = 'active'
  where cp.community_id = p_community_id
    and cp.active
    and cp.user_id is not null
    and is_member(p_community_id)
    and can_view_community_profile(cp.community_id, cp.user_id);
$$;

comment on function public.organization_person_profile_links(text) is
  'Member-safe: pairs a published organisation card with its linked account, only for accounts whose profile in this community the caller may already see (can_view_community_profile). Used to show that profile''s photo on the card. Empty for a non-member caller.';

revoke execute on function public.organization_person_profile_links(text) from public, anon;
grant execute on function public.organization_person_profile_links(text) to authenticated;
