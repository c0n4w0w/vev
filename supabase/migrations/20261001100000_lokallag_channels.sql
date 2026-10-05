-- Private chat channels for local groups ("lokallag").
--
-- Every active local group gets one chat channel, and that channel is readable
-- and writable only by active members of the community whose membership is in
-- exactly that group. Not the community's admins, not its moderators, not
-- members of another group, not members without one. Administering the roster
-- of groups (create, rename, retire) stays an admin task and never requires —
-- or grants — reading a group's conversation.
--
-- ── Why not `channels.group_id` ─────────────────────────────────────────
--
-- `channels.group_id` already exists, but it is the sidebar *section*
-- (`channel_groups`: "Generelt", "Prosjekter"), shared by every community, with
-- no relation to `community_local_groups`. Reusing it would mix "which heading
-- does this sit under" with "who may read this". So the affiliation gets its
-- own column, shaped exactly like `memberships.local_group_id` and
-- `posts.local_group_id`: nullable, and constrained to a group of the same
-- community by a composite foreign key.
--
--   local_group_id is null  — community-wide channel, unchanged: every active
--                             member of the community
--   local_group_id is set   — active members whose membership.local_group_id
--                             equals it. Nobody else.
--
-- Lokallag channels sit in their own sidebar section, `lokallag` ("Mitt
-- lokallag"), and only they do — a check constraint ties the two together so
-- a community-wide channel can never be filed under that heading.
--
-- ── Read live, never copied ─────────────────────────────────────────────
--
-- Access is decided from `memberships.local_group_id` on every query. There is
-- no channel-membership table to keep in step: a member who moves from
-- Trøndelag to Oslo loses Trøndelag and gains Oslo on the next request.
--
-- ── Retired groups ──────────────────────────────────────────────────────
--
-- Same promise as posts (20260930130000): retiring a group never touches
-- anybody's affiliation or any content. Members intentionally kept on a retired
-- group keep its channel and its history; nobody new can join it, because
-- set_my_local_group() refuses retired groups. A retired group that never had a
-- channel is not given one (that would be new access), and reinstating a group
-- ensures its channel exists. Nothing here deletes a channel or a message.
--
-- ── One rule, every path ────────────────────────────────────────────────
--
-- Written once in channel_scope_admits(), and used by:
--
--   channels_select           — the sidebar, the Overview card, the home page,
--                               the direct channel route, and raw PostgREST
--   can_read_channel()        — messages_select and messages_insert already
--                               call it, so they inherit the rule unchanged
--   messages_channel_access   — a RESTRICTIVE policy, so any UPDATE or DELETE
--                               policy added later still needs channel access
--   can_view_community_profile(), shares_visible_authorship()
--                             — "has written a message the caller can read"
--                               must mean readable under this rule, or a
--                               lokallag message would surface its author to
--                               the whole community
--   set_channel_details()     — refuses lokallag channels: their name follows
--                               the group, and the admin edit must not become
--                               a way to confirm or describe a group's chat

-- ── Column and invariants ───────────────────────────────────────────────

alter table public.channels add column if not exists local_group_id uuid;

-- NO ACTION (not RESTRICT) so that deleting a whole community, which cascades
-- to both channels and groups, completes; on its own a group with a channel
-- cannot be deleted, which protects the history. Groups are never deleted by
-- the application anyway — retiring is `active = false`.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'channels_local_group_fkey') then
    alter table public.channels
      add constraint channels_local_group_fkey
        foreign key (local_group_id, community_id)
        references public.community_local_groups (id, community_id);
  end if;
end $$;

-- Exactly one channel per group.
create unique index if not exists channels_local_group_key
  on public.channels (local_group_id) where local_group_id is not null;

-- The section exists before any channel can point at it. Labels in
-- `channel_groups` are shown as-is in the sidebar. Each member only ever sees
-- their own group's channel there, hence "Mitt lokallag".
insert into public.channel_groups (id, label, position)
values (
  'lokallag',
  'Mitt lokallag',
  coalesce((select max(position) + 1 from public.channel_groups where id <> 'lokallag'), 0)
)
on conflict (id) do nothing;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'channels_local_group_section') then
    alter table public.channels
      add constraint channels_local_group_section
        check ((local_group_id is not null) = (group_id = 'lokallag'));
  end if;
end $$;

comment on column public.channels.local_group_id is
  'Set for a lokallag chat channel: only active members whose membership.local_group_id equals this may read or write it (no staff override). Null means a community-wide channel. One channel per group; name follows the group.';

-- ── The rule ────────────────────────────────────────────────────────────
--
-- Internal: takes a user id, so it is never granted to an API role — same
-- arrangement as post_scope_admits(). Policies reach it through
-- can_read_channel_scope() / can_read_channel(), which supply auth.uid().
--
-- Deliberately no role test. Compare post_scope_admits(), where staff read every
-- scope because publishing and moderating posts is their job; a lokallag chat
-- is the group's own conversation.
create or replace function public.channel_scope_admits(
  p_user_id uuid,
  p_community_id text,
  p_local_group_id uuid
)
returns boolean language sql security definer stable set search_path = public as $$
  select p_user_id is not null and exists (
    select 1
    from memberships m
    where m.user_id = p_user_id
      and m.community_id = p_community_id
      and m.status = 'active'
      and (p_local_group_id is null or m.local_group_id = p_local_group_id)
  );
$$;

revoke execute on function public.channel_scope_admits(uuid, text, uuid) from public, anon, authenticated;

comment on function public.channel_scope_admits(uuid, text, uuid) is
  'Whether a user may read/write a channel in this community and local-group scope: any active member for community-wide (null) scope; for a local group, only active members whose membership is in exactly that group. No admin/moderator override. Internal; takes a user id.';

create or replace function public.can_read_channel_scope(p_community_id text, p_local_group_id uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select channel_scope_admits(auth.uid(), p_community_id, p_local_group_id);
$$;

revoke execute on function public.can_read_channel_scope(text, uuid) from public, anon;
grant execute on function public.can_read_channel_scope(text, uuid) to authenticated;

-- Same signature as before, so messages_select and messages_insert follow the
-- channel's scope without being recreated. For a community-wide channel this is
-- exactly the old definition: an active membership in the channel's community.
create or replace function public.can_read_channel(chid text)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1
    from channels c
    where c.id = chid
      and channel_scope_admits(auth.uid(), c.community_id, c.local_group_id)
  );
$$;

revoke execute on function public.can_read_channel(text) from public, anon;
grant execute on function public.can_read_channel(text) to authenticated;

-- ── Channels ────────────────────────────────────────────────────────────

drop policy if exists channels_select on public.channels;

create policy channels_select on public.channels for select to authenticated
using (can_read_channel_scope(community_id, local_group_id));

comment on policy channels_select on public.channels is
  'Community-wide channels: active members. Lokallag channels: active members of exactly that local group. A channel the caller cannot read does not exist for them: no name, purpose or id.';

-- ── Messages ────────────────────────────────────────────────────────────
--
-- messages_select and messages_insert are unchanged and already require
-- can_read_channel(). There is no UPDATE or DELETE policy today, so nobody can
-- edit or delete a channel message through the API. This restrictive policy
-- makes the channel boundary hold for any command a later migration opens up:
-- a permissive author/moderator rule added then is ANDed with channel access,
-- so it cannot reach into a group's chat the caller is not in.
drop policy if exists messages_channel_access on public.messages;

create policy messages_channel_access on public.messages
  as restrictive for all to authenticated
  using (can_read_channel(channel_id))
  with check (can_read_channel(channel_id));

-- ── Creating, naming and backfilling the channel ────────────────────────

-- The channel name constraint (channels_name_valid) allows 40 characters; a
-- group name may be up to 80. Truncate rather than refuse a rename.
create or replace function public.local_group_channel_name(p_name text)
returns text language sql immutable set search_path = public as $$
  select btrim(left(btrim(p_name), 40));
$$;

revoke execute on function public.local_group_channel_name(text) from public, anon, authenticated;

-- Idempotent: returns the existing channel's id, or creates it for an active
-- group. Never creates one for a retired group. Internal — called by the
-- trigger below and by the backfill; no API role can call it.
--
-- The id is `<community>--lokallag-<group slug>`. The slug is the group's
-- stable handle (rename_local_group() deliberately never changes it), so the
-- id — and with it the URL and every message — survives renames. The
-- `lokallag-` prefix keeps it out of the namespace of the community-wide
-- channels (`<community>--generelt`).
create or replace function public.ensure_local_group_channel(p_local_group_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_group community_local_groups%rowtype;
  v_id text;
begin
  select * into v_group from community_local_groups g where g.id = p_local_group_id;
  if not found then
    return null;
  end if;

  select c.id into v_id from channels c where c.local_group_id = v_group.id;
  if v_id is not null or not v_group.active then
    return v_id;
  end if;

  insert into channel_groups (id, label, position)
  values ('lokallag', 'Mitt lokallag', coalesce((select max(position) + 1 from channel_groups), 0))
  on conflict (id) do nothing;

  insert into channels (id, community_id, group_id, local_group_id, name, purpose, read_only, position)
  values (
    v_group.community_id || '--lokallag-' || v_group.slug,
    v_group.community_id,
    'lokallag',
    v_group.id,
    local_group_channel_name(v_group.name),
    'Samtaler i lokallaget. Bare medlemmer av lokallaget kan se og skrive her.',
    false,
    1000 + v_group.sort_order
  )
  on conflict (local_group_id) where local_group_id is not null do nothing;

  select c.id into v_id from channels c where c.local_group_id = v_group.id;
  return v_id;
end;
$$;

revoke execute on function public.ensure_local_group_channel(uuid) from public, anon, authenticated;

comment on function public.ensure_local_group_channel(uuid) is
  'Returns the lokallag chat channel id for a group, creating it if the group is active and has none. Idempotent. Internal.';

-- The invariant lives on the table, not in each caller: create_local_group(),
-- the seed, and any future path that inserts a group all get a channel in the
-- same transaction. A rename updates the channel's display name in the same
-- transaction too; id and messages are untouched.
create or replace function public.local_group_channel_sync()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' or (new.active and not old.active) then
    perform ensure_local_group_channel(new.id);
  end if;

  if tg_op = 'UPDATE' and new.name is distinct from old.name then
    update channels c
       set name = local_group_channel_name(new.name)
     where c.local_group_id = new.id;
  end if;

  return null;
end;
$$;

revoke execute on function public.local_group_channel_sync() from public, anon, authenticated;

drop trigger if exists community_local_groups_channel on public.community_local_groups;

create trigger community_local_groups_channel
  after insert or update of name, active on public.community_local_groups
  for each row execute function public.local_group_channel_sync();

-- Backfill: one channel for every active group. Safe to run again — existing
-- channels are found and left alone. Retired groups are skipped (see above).
select public.ensure_local_group_channel(g.id)
from public.community_local_groups g
where g.active;

-- ── Admin channel editing ───────────────────────────────────────────────
--
-- Recreated from 20260930140000_channel_admin_edit with one change: lokallag
-- channels are excluded. Their name is derived from the group, and an admin who
-- is not in the group must not be able to confirm the channel exists or read
-- back its name and purpose through RETURNING.
create or replace function public.set_channel_details(
  p_community_id text,
  p_channel_id text,
  p_name text,
  p_purpose text
)
returns table (name text, purpose text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text := btrim(coalesce(p_name, ''));
  v_purpose text := btrim(coalesce(p_purpose, ''));
begin
  if auth.uid() is null or not public.is_admin(p_community_id) then
    return;
  end if;

  if length(v_name) not between 1 and 40 or v_name ~ '[[:cntrl:]]' then
    return;
  end if;

  if length(v_purpose) > 200 or v_purpose ~ '[[:cntrl:]]' then
    return;
  end if;

  return query
    update public.channels c
       set name = v_name, purpose = v_purpose
     where c.id = p_channel_id
       and c.community_id = p_community_id
       and c.local_group_id is null
    returning c.name, c.purpose;
end;
$$;

comment on function public.set_channel_details(text, text, text, text) is
  'Admin-only. Sets name and purpose of one community-wide channel of the given community and returns the stored values; returns no row when the caller is not an active admin of that community, the channel is not in it, the channel is a lokallag channel, or the input is invalid.';

revoke execute on function public.set_channel_details(text, text, text, text) from public, anon;
grant execute on function public.set_channel_details(text, text, text, text) to authenticated;

-- ── Profile visibility derived from messages ────────────────────────────
--
-- Recreated from 20260930130000_lokallag_post_visibility. The only change is
-- the message clause: authorship counts only in a channel the caller can read.
create or replace function public.can_view_community_profile(p_community_id text, p_user_id uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select auth.uid() is not null and (
    p_user_id = auth.uid()
    or (
      is_member(p_community_id)
      and (
        (
          can_view_member_directory(p_community_id)
          and exists (
            select 1 from memberships m
            where m.community_id = p_community_id
              and m.user_id = p_user_id
              and m.status = 'active'
          )
        )
        or exists (
          select 1 from posts p
          where p.community_id = p_community_id and p.author_id = p_user_id
            and post_scope_admits(auth.uid(), p.community_id, p.local_group_id)
        )
        or exists (
          select 1 from comments c
          join posts p on p.id = c.post_id
          where p.community_id = p_community_id and c.author_id = p_user_id
            and post_scope_admits(auth.uid(), p.community_id, p.local_group_id)
        )
        or exists (
          select 1 from messages msg
          join channels ch on ch.id = msg.channel_id
          where ch.community_id = p_community_id and msg.author_id = p_user_id
            and channel_scope_admits(auth.uid(), ch.community_id, ch.local_group_id)
        )
        or exists (
          select 1 from events e
          where e.community_id = p_community_id and e.host_id = p_user_id
        )
        or exists (
          select 1 from direct_conversations dc
          where dc.community_id = p_community_id
            and auth.uid() in (dc.participant_one_id, dc.participant_two_id)
            and p_user_id in (dc.participant_one_id, dc.participant_two_id)
        )
      )
    )
  );
$$;

revoke execute on function public.can_view_community_profile(text, uuid) from public, anon;
grant execute on function public.can_view_community_profile(text, uuid) to authenticated;

-- Recreated from 20260912100000_community_privacy_policy. No policy calls it any
-- more, but it is still executable by signed-in users, so it must not answer
-- "has this person written in a channel I cannot read". Only the message clause
-- changes.
create or replace function public.shares_visible_authorship(other uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from posts p
    join memberships m on m.community_id = p.community_id
    where p.author_id = other and m.user_id = auth.uid() and m.status = 'active'
  ) or exists (
    select 1 from comments cm
    join posts p on p.id = cm.post_id
    join memberships m on m.community_id = p.community_id
    where cm.author_id = other and m.user_id = auth.uid() and m.status = 'active'
  ) or exists (
    select 1 from messages msg
    join channels ch on ch.id = msg.channel_id
    where msg.author_id = other
      and channel_scope_admits(auth.uid(), ch.community_id, ch.local_group_id)
  ) or exists (
    select 1 from events e
    join memberships m on m.community_id = e.community_id
    where e.host_id = other and m.user_id = auth.uid() and m.status = 'active'
  );
$$;

revoke execute on function public.shares_visible_authorship(uuid) from public, anon;
grant execute on function public.shares_visible_authorship(uuid) to authenticated;
