-- Public organisational people for a community.
--
-- This is deliberately separate from `memberships`. A person shown here may be
-- staff, a board member or a local-group contact without having a TING account,
-- a membership row, a role in the private room, DM settings, or a visible
-- profile. The table describes what the organisation publishes about itself,
-- not who belongs to the private TING community.

create type community_person_section as enum ('staff', 'board', 'local_group_leader');

create table community_people (
  id uuid primary key default gen_random_uuid(),
  community_id text not null references communities (id) on delete cascade,
  section community_person_section not null,
  local_group_id uuid,
  name text not null,
  role text,
  email text,
  description text,
  sort_order int not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),

  constraint community_people_name_not_blank check (length(btrim(name)) > 0),
  constraint community_people_email_shape check (
    email is null or (email = lower(btrim(email)) and email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$')
  ),
  constraint community_people_local_group_section check (
    (section = 'local_group_leader' and local_group_id is not null)
    or (section <> 'local_group_leader' and local_group_id is null)
  ),
  constraint community_people_local_group_fkey
    foreign key (local_group_id, community_id)
    references community_local_groups (id, community_id)
    on delete restrict
);

create index community_people_community_idx
  on community_people (community_id, active, section, sort_order, name);

create index community_people_local_group_idx
  on community_people (local_group_id)
  where local_group_id is not null;

comment on table community_people is
  'Organisation-published public people. Separate from TING memberships and profiles.';

comment on column community_people.section is
  'staff: ansatte/sekretariat. board: sentralstyret. local_group_leader: public contact for a local group.';

comment on column community_people.local_group_id is
  'Required only for local_group_leader and constrained to a group in the same community.';

alter table community_people enable row level security;

create policy community_people_select on community_people
  for select to authenticated
  using (active and is_member(community_id));

create policy community_people_insert on community_people
  for insert to authenticated
  with check (is_admin(community_id));

create policy community_people_update on community_people
  for update to authenticated
  using (is_admin(community_id))
  with check (is_admin(community_id));

-- No delete policy. Deactivation is the ordinary lifecycle.
