-- Real one-to-one, community-scoped direct messages.
--
-- The initiation rule is deliberately not reimplemented here. New
-- conversations go through can_send_dm(), while replies to an existing
-- conversation keep working as long as both participants remain active members
-- of the conversation's community.

-- ── Organisation contact account link ──────────────────────────────────

alter table community_people
  add column user_id uuid references profiles (id) on delete set null;

comment on column community_people.user_id is
  'Optional explicit link to a TING account for TING functionality. Not public organisation data; ordinary selects are not granted this column.';

-- A table-level SELECT grant would make the new column readable even if a
-- column-level revoke below said otherwise, so remove it and grant the public
-- organisation columns back by name.
revoke select on community_people from anon, authenticated;

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

-- ── Tables ─────────────────────────────────────────────────────────────

create table direct_conversations (
  id uuid primary key default gen_random_uuid(),
  community_id text not null references communities (id) on delete cascade,
  participant_one_id uuid not null references profiles (id) on delete cascade,
  participant_two_id uuid not null references profiles (id) on delete cascade,
  created_by uuid not null default auth.uid() references profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  last_message_at timestamptz not null default now(),

  constraint direct_conversations_two_distinct_participants
    check (participant_one_id < participant_two_id),
  constraint direct_conversations_created_by_participant
    check (created_by in (participant_one_id, participant_two_id)),
  unique (community_id, participant_one_id, participant_two_id)
);

create index direct_conversations_participant_one_idx
  on direct_conversations (participant_one_id, last_message_at desc);

create index direct_conversations_participant_two_idx
  on direct_conversations (participant_two_id, last_message_at desc);

create table direct_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references direct_conversations (id) on delete cascade,
  author_id uuid not null default auth.uid() references profiles (id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now(),

  constraint direct_messages_body_present
    check (length(btrim(body)) between 1 and 4000)
);

create index direct_messages_conversation_idx
  on direct_messages (conversation_id, created_at);

create table direct_conversation_reads (
  conversation_id uuid not null references direct_conversations (id) on delete cascade,
  user_id uuid not null references profiles (id) on delete cascade,
  last_read_at timestamptz not null default now(),
  primary key (conversation_id, user_id)
);

create index direct_conversation_reads_user_idx
  on direct_conversation_reads (user_id, last_read_at desc);

alter table direct_conversations enable row level security;
alter table direct_messages enable row level security;
alter table direct_conversation_reads enable row level security;

revoke all on direct_conversations from anon, authenticated;
revoke all on direct_messages from anon, authenticated;
revoke all on direct_conversation_reads from anon, authenticated;

grant select on direct_conversations to authenticated;
grant select on direct_messages to authenticated;
grant insert (conversation_id, body) on direct_messages to authenticated;
grant select on direct_conversation_reads to authenticated;

-- ── Helpers ────────────────────────────────────────────────────────────

create or replace function public.is_direct_conversation_participant(
  p_conversation_id uuid,
  p_user_id uuid default auth.uid()
)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1
    from direct_conversations dc
    join memberships m on m.community_id = dc.community_id
    where dc.id = p_conversation_id
      and p_user_id in (dc.participant_one_id, dc.participant_two_id)
      and m.user_id = p_user_id
      and m.status = 'active'
  );
$$;

create or replace function public.can_reply_direct_conversation(p_conversation_id uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1
    from direct_conversations dc
    join memberships sender on sender.community_id = dc.community_id
    join memberships recipient on recipient.community_id = dc.community_id
    where dc.id = p_conversation_id
      and auth.uid() in (dc.participant_one_id, dc.participant_two_id)
      and sender.user_id = auth.uid()
      and sender.status = 'active'
      and recipient.user_id = case
        when dc.participant_one_id = auth.uid() then dc.participant_two_id
        else dc.participant_one_id
      end
      and recipient.status = 'active'
  );
$$;

create or replace function public.shares_direct_conversation(other uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1
    from direct_conversations dc
    join memberships mine on mine.community_id = dc.community_id
    where auth.uid() in (dc.participant_one_id, dc.participant_two_id)
      and other in (dc.participant_one_id, dc.participant_two_id)
      and other <> auth.uid()
      and mine.user_id = auth.uid()
      and mine.status = 'active'
  );
$$;

revoke execute on function public.is_direct_conversation_participant(uuid, uuid) from public, anon;
revoke execute on function public.can_reply_direct_conversation(uuid) from public, anon;
revoke execute on function public.shares_direct_conversation(uuid) from public, anon;
grant execute on function public.is_direct_conversation_participant(uuid, uuid) to authenticated;
grant execute on function public.can_reply_direct_conversation(uuid) to authenticated;
grant execute on function public.shares_direct_conversation(uuid) to authenticated;

drop policy profiles_select on profiles;

create policy profiles_select on profiles for select to authenticated
using (
  id = auth.uid()
  or shares_visible_directory(id)
  or shares_visible_authorship(id)
  or shares_direct_conversation(id)
  or exists (
    select 1 from memberships m
    where m.user_id = auth.uid() and m.invited_by = profiles.id
  )
  or administers_pending_membership(id)
);

-- ── RLS ────────────────────────────────────────────────────────────────

create policy direct_conversations_select on direct_conversations
  for select to authenticated
  using (is_direct_conversation_participant(id));

create policy direct_messages_select on direct_messages
  for select to authenticated
  using (is_direct_conversation_participant(conversation_id));

create policy direct_messages_insert on direct_messages
  for insert to authenticated
  with check (
    author_id = auth.uid()
    and can_reply_direct_conversation(conversation_id)
    and length(btrim(body)) between 1 and 4000
  );

create policy direct_conversation_reads_select on direct_conversation_reads
  for select to authenticated
  using (
    user_id = auth.uid()
    and is_direct_conversation_participant(conversation_id)
  );

-- ── Initiation and read state RPCs ─────────────────────────────────────

create or replace function public.start_direct_conversation(
  p_community_id text,
  p_recipient_id uuid
)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_sender uuid := auth.uid();
  v_one uuid;
  v_two uuid;
  v_conversation_id uuid;
begin
  if v_sender is null then
    raise exception 'Du må være logget inn for å starte en samtale'
      using errcode = 'insufficient_privilege';
  end if;

  if p_recipient_id is null or p_recipient_id = v_sender then
    raise exception 'Du kan ikke starte en samtale med deg selv'
      using errcode = 'check_violation';
  end if;

  if not exists (
    select 1 from memberships
    where community_id = p_community_id
      and user_id = v_sender
      and status = 'active'
  ) then
    raise exception 'Du er ikke aktivt medlem av dette fellesskapet'
      using errcode = 'insufficient_privilege';
  end if;

  if not exists (
    select 1 from memberships
    where community_id = p_community_id
      and user_id = p_recipient_id
      and status = 'active'
  ) then
    raise exception 'Mottakeren er ikke aktivt medlem av dette fellesskapet'
      using errcode = 'insufficient_privilege';
  end if;

  v_one := least(v_sender, p_recipient_id);
  v_two := greatest(v_sender, p_recipient_id);

  select id into v_conversation_id
  from direct_conversations
  where community_id = p_community_id
    and participant_one_id = v_one
    and participant_two_id = v_two;

  if v_conversation_id is not null then
    return v_conversation_id;
  end if;

  if not can_send_dm(p_community_id, p_recipient_id) then
    raise exception 'Du kan ikke starte en direkte melding med denne personen'
      using errcode = 'insufficient_privilege';
  end if;

  insert into direct_conversations (
    community_id,
    participant_one_id,
    participant_two_id,
    created_by
  )
  values (p_community_id, v_one, v_two, v_sender)
  on conflict (community_id, participant_one_id, participant_two_id)
  do update set last_message_at = direct_conversations.last_message_at
  returning id into v_conversation_id;

  return v_conversation_id;
end;
$$;

create or replace function public.start_direct_conversation_with_organization_person(
  p_person_id uuid
)
returns table (conversation_id uuid, community_id text)
language plpgsql security definer set search_path = public as $$
declare
  v_community_id text;
  v_recipient_id uuid;
begin
  select cp.community_id, cp.user_id
    into v_community_id, v_recipient_id
  from community_people cp
  where cp.id = p_person_id
    and cp.active
    and cp.user_id is not null;

  if v_community_id is null or v_recipient_id is null then
    raise exception 'Denne kontakten kan ikke motta meldinger i TING'
      using errcode = 'insufficient_privilege';
  end if;

  if not is_member(v_community_id) then
    raise exception 'Du er ikke aktivt medlem av dette fellesskapet'
      using errcode = 'insufficient_privilege';
  end if;

  if not exists (
    select 1 from memberships m
    where m.community_id = v_community_id
      and m.user_id = v_recipient_id
      and m.status = 'active'
  ) then
    raise exception 'Denne kontakten kan ikke motta meldinger i TING'
      using errcode = 'insufficient_privilege';
  end if;

  conversation_id := start_direct_conversation(v_community_id, v_recipient_id);
  community_id := v_community_id;
  return next;
end;
$$;

create or replace function public.organization_person_dm_actions(p_community_id text)
returns table (person_id uuid, conversation_id uuid)
language sql security definer stable set search_path = public as $$
  with linked as (
    select cp.id as person_id, cp.user_id
    from community_people cp
    join memberships rec
      on rec.community_id = cp.community_id
     and rec.user_id = cp.user_id
     and rec.status = 'active'
    where cp.community_id = p_community_id
      and cp.active
      and cp.user_id is not null
      and is_member(cp.community_id)
  ),
  canonical as (
    select
      linked.person_id,
      linked.user_id,
      least(auth.uid(), linked.user_id) as p_one,
      greatest(auth.uid(), linked.user_id) as p_two
    from linked
    where auth.uid() is not null and linked.user_id <> auth.uid()
  )
  select
    canonical.person_id,
    dc.id as conversation_id
  from canonical
  left join direct_conversations dc
    on dc.community_id = p_community_id
   and dc.participant_one_id = canonical.p_one
   and dc.participant_two_id = canonical.p_two
  where dc.id is not null
     or can_send_dm(p_community_id, canonical.user_id);
$$;

create or replace function public.direct_member_dm_actions(p_community_id text)
returns table (user_id uuid, conversation_id uuid)
language sql security definer stable set search_path = public as $$
  with visible_members as (
    select m.user_id
    from memberships m
    where m.community_id = p_community_id
      and m.status = 'active'
      and m.user_id <> auth.uid()
      and can_view_member_directory(p_community_id)
  ),
  canonical as (
    select
      user_id,
      least(auth.uid(), user_id) as p_one,
      greatest(auth.uid(), user_id) as p_two
    from visible_members
    where auth.uid() is not null
  )
  select
    canonical.user_id,
    dc.id as conversation_id
  from canonical
  left join direct_conversations dc
    on dc.community_id = p_community_id
   and dc.participant_one_id = canonical.p_one
   and dc.participant_two_id = canonical.p_two
  where dc.id is not null
     or can_send_dm(p_community_id, canonical.user_id);
$$;

create or replace function public.mark_direct_conversation_read(p_conversation_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if not is_direct_conversation_participant(p_conversation_id) then
    return false;
  end if;

  insert into direct_conversation_reads (conversation_id, user_id, last_read_at)
  values (p_conversation_id, auth.uid(), now())
  on conflict (conversation_id, user_id)
  do update set last_read_at = excluded.last_read_at;

  return true;
end;
$$;

create or replace function public.direct_unread_count(p_community_id text)
returns integer language sql security definer stable set search_path = public as $$
  select count(*)::integer
  from direct_conversations dc
  join direct_messages latest on latest.id = (
    select dm.id
    from direct_messages dm
    where dm.conversation_id = dc.id
    order by dm.created_at desc
    limit 1
  )
  left join direct_conversation_reads reads
    on reads.conversation_id = dc.id
   and reads.user_id = auth.uid()
  where dc.community_id = p_community_id
    and is_direct_conversation_participant(dc.id)
    and latest.author_id <> auth.uid()
    and latest.created_at > coalesce(reads.last_read_at, '-infinity'::timestamptz);
$$;

revoke execute on function public.start_direct_conversation(text, uuid) from public, anon;
revoke execute on function public.start_direct_conversation_with_organization_person(uuid) from public, anon;
revoke execute on function public.organization_person_dm_actions(text) from public, anon;
revoke execute on function public.direct_member_dm_actions(text) from public, anon;
revoke execute on function public.mark_direct_conversation_read(uuid) from public, anon;
revoke execute on function public.direct_unread_count(text) from public, anon;

grant execute on function public.start_direct_conversation(text, uuid) to authenticated;
grant execute on function public.start_direct_conversation_with_organization_person(uuid) to authenticated;
grant execute on function public.organization_person_dm_actions(text) to authenticated;
grant execute on function public.direct_member_dm_actions(text) to authenticated;
grant execute on function public.mark_direct_conversation_read(uuid) to authenticated;
grant execute on function public.direct_unread_count(text) to authenticated;

-- ── Triggers ───────────────────────────────────────────────────────────

create or replace function public.direct_message_after_insert()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_conversation direct_conversations%rowtype;
  v_recipient uuid;
  v_author_name text;
  v_community_name text;
  v_href text;
begin
  select * into v_conversation
  from direct_conversations
  where id = new.conversation_id;

  if not found then
    return new;
  end if;

  update direct_conversations
     set last_message_at = greatest(last_message_at, new.created_at)
   where id = new.conversation_id;

  v_recipient := case
    when v_conversation.participant_one_id = new.author_id then v_conversation.participant_two_id
    else v_conversation.participant_one_id
  end;

  v_href := '/community/' || v_conversation.community_id || '/messages/' || new.conversation_id;

  if coalesce(auth.role(), '') <> 'service_role' then
    select p.name, c.name into v_author_name, v_community_name
    from profiles p
    join communities c on c.id = v_conversation.community_id
    where p.id = new.author_id;

    insert into notifications (user_id, kind, community_id, title, body, href)
    select
      v_recipient,
      'direct_message',
      v_conversation.community_id,
      'Ny melding fra ' || coalesce(v_author_name, 'et medlem'),
      coalesce(v_community_name, 'Fellesskapet') || ' · ' || left(btrim(new.body), 120),
      v_href
    where not exists (
      select 1
      from notifications n
      where n.user_id = v_recipient
        and n.kind = 'direct_message'
        and n.href = v_href
        and n.read = false
    );
  end if;

  return new;
end;
$$;

revoke execute on function public.direct_message_after_insert()
  from public, anon, authenticated;

create trigger direct_messages_after_insert
after insert on direct_messages
for each row execute function public.direct_message_after_insert();

comment on table direct_conversations is
  'One-to-one, community-scoped direct message conversations. Created only through start_direct_conversation().';

comment on table direct_messages is
  'Persisted direct messages. author_id defaults to auth.uid(), and clients are granted INSERT only on conversation_id and body.';

comment on table direct_conversation_reads is
  'Lightweight per-user read state for direct conversations.';
