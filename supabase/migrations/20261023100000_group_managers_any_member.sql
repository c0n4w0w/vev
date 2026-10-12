-- Gruppeansvarlig is a responsibility in one group, not a community role.
--
-- Builds on 20261022100000_community_group_management, which let a community
-- admin give the manager mark only to a member of the group who was also a
-- moderator or admin of the community, and took every mark away again when its
-- holder was demoted to ordinary member. Both tied a group-specific job to a
-- community-wide role. This removes that tie, and nothing else:
--
--   who may be appointed     any member of the group who is an active member
--                            of its community — ordinary member, moderator or
--                            admin alike
--   who appoints, who        still the community's admins only
--   removes the mark         (set_subgroup_manager)
--   a role change            no longer touches the mark: a moderator who
--                            becomes an ordinary member keeps the groups they
--                            were made manager of, and loses only what the
--                            moderator role itself gave
--
-- Unchanged, and still the whole rule for managing a group
-- (subgroup_manage_admits, 20261005100000): an ACTIVE member of the group's
-- own community who is an admin of it, or holds an explicit manager row for
-- that group. So an appointed ordinary member manages exactly the groups they
-- hold a row for — name and description, members, archive/reopen, delete under
-- delete_subgroup()'s safeguards — and gets nothing community-wide from it:
-- creating a group still needs the admin or moderator role
-- (subgroup_create_admits), the mark still cannot be handed on by its holder,
-- and reading still follows content_scope_admits().
--
-- The mark still ends with what it rests on:
--
--   removed from the group          remove_subgroup_member() takes the mark
--                                   with the member row (20261022100000)
--   membership stops being active   rows deleted by the trigger below, and
--                                   subgroup_manage_admits() refuses at once
--   membership deleted              rows cascade
--   revoked by an admin             set_subgroup_manager(…, false)
--
-- Who reads a group, who creates one, deletion's safeguards, Safe-Space's
-- moderators_read and the private lokallag channels are not touched here.

-- ── The manager mark ────────────────────────────────────────────────────
--
-- Recreated from 20261022100000 with one change: the person being appointed
-- needs an active membership in the group's community and a member row in the
-- group — no particular community role.
create or replace function public.set_subgroup_manager(
  p_subgroup_id uuid,
  p_user_id uuid,
  p_is_manager boolean
)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  v_community text;
  v_changed uuid;
begin
  if auth.uid() is null or p_user_id is null or p_is_manager is null then
    return false;
  end if;

  select s.community_id into v_community from community_subgroups s where s.id = p_subgroup_id;
  if v_community is null or not is_admin(v_community) then
    return false;
  end if;

  if not p_is_manager then
    delete from community_subgroup_managers mg
     where mg.subgroup_id = p_subgroup_id and mg.user_id = p_user_id
    returning mg.user_id into v_changed;
    return v_changed is not null;
  end if;

  if not exists (
    select 1 from memberships m
    where m.user_id = p_user_id
      and m.community_id = v_community
      and m.status = 'active'
  ) or not exists (
    select 1 from community_subgroup_members sm
    where sm.subgroup_id = p_subgroup_id
      and sm.community_id = v_community
      and sm.user_id = p_user_id
  ) then
    return false;
  end if;

  insert into community_subgroup_managers (subgroup_id, community_id, user_id)
  values (p_subgroup_id, v_community, p_user_id)
  on conflict (subgroup_id, user_id) do nothing
  returning user_id into v_changed;

  return v_changed is not null;
end;
$$;

revoke execute on function public.set_subgroup_manager(uuid, uuid, boolean) from public, anon;
grant execute on function public.set_subgroup_manager(uuid, uuid, boolean) to authenticated;

comment on function public.set_subgroup_manager(uuid, uuid, boolean) is
  'Community admins only. Gives or takes the manager mark of one group; it can be given to any member of the group who is an active member of its community, whatever their community role.';

comment on table public.community_subgroup_managers is
  'Explicit responsibility for one group (gruppeansvarlig): name and description, members, archive/reopen, delete. Group-specific, independent of community role, and given by a community admin to a member of the group. Counts only while the holder is an active member of the community; grants no read access by itself. Community admins manage every group without a row here.';

-- ── The mark follows the membership, not the role ───────────────────────
--
-- Recreated from 20261022100000 without the role half. A grant ends when the
-- membership it rests on stops being active — only that person's, only in
-- that community — so someone who comes back is not a manager again without
-- being appointed again. A change of community role leaves it alone.
create or replace function public.subgroup_managers_follow_membership()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status <> 'active' and old.status = 'active' then
    delete from community_subgroup_managers mg
     where mg.user_id = new.user_id
       and mg.community_id = new.community_id;
  end if;
  return null;
end;
$$;

revoke execute on function public.subgroup_managers_follow_membership() from public, anon, authenticated;

drop trigger if exists memberships_subgroup_managers on public.memberships;
create trigger memberships_subgroup_managers
  after update of status on public.memberships
  for each row execute function public.subgroup_managers_follow_membership();
