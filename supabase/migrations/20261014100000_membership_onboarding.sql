-- Welcome card state: one nullable timestamp per membership.
--
-- "Kom i gang" on a community's Overview is shown to someone who has just
-- become an active member of *that* community, until they dismiss it. The
-- state therefore lives on the membership, not on the account: the same person
-- joining a second organisation gets that organisation's welcome separately.
--
-- Semantics
--   NULL        not dismissed. Only means "show the card" while status is
--               'active' — an invited or requested row also has NULL, which is
--               what makes the card appear at the moment it is activated.
--   timestamp   dismissed (or pre-dates the feature). Never reset.
--
-- No trigger is needed to detect a *new* member. Every path that activates a
-- membership (accept_invitation, approve_membership, accept_invitation_token,
-- the request flow's immediate activation) either inserts a row or flips an
-- existing non-active row, and none of them touch this column, so a freshly
-- activated membership is NULL by construction. A row that is already active
-- keeps whatever it had: profile edits, lokallag changes and role changes never
-- reset it. There is no leave/remove path for an active member today; if one
-- is added and deletes the row, a later rejoin is a new membership and gets a
-- new welcome, which is the intended meaning of "new member".
alter table public.memberships add column onboarding_dismissed_at timestamptz;

-- Everyone who is active when this ships is an existing member and must not
-- suddenly be welcomed. Pending (invited / requested) rows stay NULL.
update public.memberships
set onboarding_dismissed_at = now()
where status = 'active' and onboarding_dismissed_at is null;

comment on column public.memberships.onboarding_dismissed_at is
  'When the member dismissed the Overview welcome card, or when this membership was already active before the card existed. NULL on an active row means the card is still to be shown. Private: clients cannot select it (column grants, see 20260915160000) — read through my_onboarding_visible(), written only through dismiss_my_onboarding().';

-- The column is deliberately NOT added to the column-level SELECT grant on
-- memberships, so no one — including fellow members who can read other
-- columns of the row — can read it directly. There is also no UPDATE policy on
-- memberships; the function below is the only write path.

create or replace function public.my_onboarding_visible(p_community_id text)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from memberships m
    where m.user_id = auth.uid()
      and m.community_id = p_community_id
      and m.status = 'active'
      and m.onboarding_dismissed_at is null
  );
$$;

revoke execute on function public.my_onboarding_visible(text) from public, anon;
grant execute on function public.my_onboarding_visible(text) to authenticated;

-- The caller's own, active membership in the named community; the only
-- argument is the community. Touches one column, keeps the first dismissal
-- time on repeats, and returns true while the membership exists (so repeating
-- the call is harmless) and false for every refusal alike.
create or replace function public.dismiss_my_onboarding(p_community_id text)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    return false;
  end if;

  update memberships
  set onboarding_dismissed_at = coalesce(onboarding_dismissed_at, now())
  where user_id = auth.uid()
    and community_id = p_community_id
    and status = 'active';

  return found;
end;
$$;

revoke execute on function public.dismiss_my_onboarding(text) from public, anon;
grant execute on function public.dismiss_my_onboarding(text) to authenticated;
