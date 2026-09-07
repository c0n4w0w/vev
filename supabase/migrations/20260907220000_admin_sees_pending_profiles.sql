-- Lets an administrator see who is asking to join.
--
-- `profiles_select` allowed three cases: yourself, people you share an active
-- community with, and whoever invited you. That left a hole in the membership
-- queue: someone who is not active in *any* community — exactly the person a
-- request or an invitation is about — was invisible to the administrator who
-- has to decide on them. The members screen rendered a pending row it could
-- not put a name to, and an admin could not even see the name of a person they
-- had invited themselves.
--
-- The fix is deliberately narrow. It does not widen who can read the profile
-- table generally; it grants exactly one relationship: an *active admin* of a
-- community may read the profile of a person holding a *non-active* membership
-- row in that same community. Moderators are not included, matching
-- approve_membership/reject_membership, which are admin-only.
--
-- This cannot be used to enumerate accounts: pending rows are created either by
-- request_access(), which only ever writes a row for auth.uid(), or by an
-- invitation an admin issued deliberately.

create or replace function public.administers_pending_membership(other uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1
    from memberships pending
    join memberships mine
      on mine.community_id = pending.community_id
     and mine.user_id = auth.uid()
     and mine.status = 'active'
     and mine.role = 'admin'
    where pending.user_id = other
      and pending.status <> 'active'
  );
$$;

revoke execute on function public.administers_pending_membership(uuid) from public, anon;
grant execute on function public.administers_pending_membership(uuid) to authenticated;

drop policy profiles_select on profiles;

create policy profiles_select on profiles for select to authenticated
using (
  id = auth.uid()
  or shares_community(id)
  or exists (
    select 1 from memberships m
    where m.user_id = auth.uid() and m.invited_by = profiles.id
  )
  -- Someone waiting on a decision from a community you administer.
  or administers_pending_membership(profiles.id)
);
