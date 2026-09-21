-- Single-admin fixture model and narrow moderator management.
--
-- The role enum stays the source of authorisation. This migration only adds
-- the database invariant the showcase now wants and one small transition RPC:
-- an active administrator may move an active member in the same community
-- between ordinary member and moderator. It deliberately cannot assign or
-- remove administrator rights, and `memberships` still has no broad UPDATE
-- policy.

create unique index memberships_one_active_admin_per_community_idx
  on public.memberships (community_id)
  where status = 'active' and role = 'admin';

create or replace function public.set_membership_role(
  p_membership_id uuid,
  p_role public.community_role
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_target public.memberships;
begin
  if auth.uid() is null then
    return false;
  end if;

  if p_role is null or p_role not in ('member', 'moderator') then
    return false;
  end if;

  select *
    into v_target
    from public.memberships
   where id = p_membership_id;

  if v_target.id is null then
    return false;
  end if;

  if v_target.status <> 'active' then
    return false;
  end if;

  if v_target.role not in ('member', 'moderator') then
    return false;
  end if;

  if not public.is_admin(v_target.community_id) then
    return false;
  end if;

  update public.memberships
     set role = p_role
   where id = v_target.id
     and status = 'active'
     and role in ('member', 'moderator');

  return found;
end;
$$;

comment on function public.set_membership_role(uuid, public.community_role) is
  'Admin-only transition for member<->moderator on one active membership. It cannot assign or demote admins and updates no other membership fields.';

revoke execute on function public.set_membership_role(uuid, public.community_role)
  from public, anon;
grant execute on function public.set_membership_role(uuid, public.community_role)
  to authenticated;
