-- Explicit admin-managed bridge from public organisation contacts to TING accounts.
--
-- The link is stored on community_people.user_id, but public organisation reads
-- still receive only the organisation-published fields. The stored link is
-- preserved if a member later leaves; DM helpers already require an active
-- same-community membership before exposing or opening a Send melding action.

revoke insert, update, delete on community_people from anon, authenticated;
revoke select on community_people from anon, authenticated;

drop policy if exists community_people_insert on community_people;
drop policy if exists community_people_update on community_people;

grant select (
  id,
  community_id,
  section,
  local_group_id,
  name,
  role,
  email,
  description,
  sort_order,
  active,
  created_at
) on community_people to authenticated;

create or replace function public.community_person_account_links(p_community_id text)
returns table (
  person_id uuid,
  user_id uuid,
  member_name text,
  member_handle text,
  member_email text,
  membership_role community_role,
  membership_title text,
  membership_status membership_status
)
language plpgsql security definer stable set search_path = public as $$
begin
  if not is_admin(p_community_id) then
    raise exception 'Bare administratorer kan se TING-koblinger for organisasjonspersoner'
      using errcode = 'insufficient_privilege';
  end if;

  return query
    select
      cp.id,
      cp.user_id,
      p.name,
      p.handle,
      p.email,
      m.role,
      m.title,
      m.status
    from community_people cp
    left join memberships m
      on m.community_id = cp.community_id
     and m.user_id = cp.user_id
    left join profiles p
      on p.id = cp.user_id
     and m.user_id is not null
    where cp.community_id = p_community_id
      and cp.active
      and cp.user_id is not null
    order by cp.section, cp.sort_order, cp.name;
end;
$$;

create or replace function public.set_community_person_user(
  p_person_id uuid,
  p_user_id uuid
)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  v_community_id text;
begin
  select cp.community_id into v_community_id
  from community_people cp
  where cp.id = p_person_id;

  if v_community_id is null then
    raise exception 'Ukjent organisasjonsperson'
      using errcode = 'no_data_found';
  end if;

  if not is_admin(v_community_id) then
    raise exception 'Bare administratorer kan koble organisasjonspersoner til TING-kontoer'
      using errcode = 'insufficient_privilege';
  end if;

  if p_user_id is not null and not exists (
    select 1
    from memberships m
    where m.community_id = v_community_id
      and m.user_id = p_user_id
      and m.status = 'active'
  ) then
    raise exception 'Kontoen må være et aktivt medlem av samme fellesskap'
      using errcode = 'check_violation';
  end if;

  update community_people
     set user_id = p_user_id
   where id = p_person_id;

  return true;
end;
$$;

comment on function public.community_person_account_links(text) is
  'Admin-only view of explicit TING account links for organisation contacts in one community.';

comment on function public.set_community_person_user(uuid, uuid) is
  'Admin-only mutation for linking or unlinking exactly community_people.user_id. Target users must be active members of the same community.';

revoke execute on function public.community_person_account_links(text) from public, anon;
revoke execute on function public.set_community_person_user(uuid, uuid) from public, anon;
grant execute on function public.community_person_account_links(text) to authenticated;
grant execute on function public.set_community_person_user(uuid, uuid) to authenticated;
