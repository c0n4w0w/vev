-- Private lokallag channels: permanent deletion, and a participant list for
-- everyone in the channel.
--
-- Builds on 20261020100000_private_lokallag_channels. Nothing about who may
-- read, write, create or manage a private channel changes here; both additions
-- are answered by the rules that migration wrote:
--
--   delete_private_channel()   private_channel_manage_admits() — whoever may
--                              rename and archive the channel may delete it
--   private_channel_roster()   channel_access_admits() — whoever may read the
--                              channel may see who else is in it
--
-- ── Permanent deletion ──────────────────────────────────────────────────
--
-- Who: an active admin of the channel's community, for any private channel in
-- it; a lokallagsleder for a channel they manage — a participant marked
-- `is_manager` who is, at that moment, still an effective lokallagsleder of
-- the channel's lokallag. A leader whose grant has ended has no manager mark
-- left (channel_managers_follow_leadership) and would not pass the leadership
-- half of the rule anyway. Participating is not managing; moderating the
-- community is neither.
--
-- What: only a channel with `is_private`. The main lokallag chat, community
-- channels and team channels are not reachable through this function whoever
-- calls it, and there is still no DELETE policy on `channels`, so the function
-- is the only way an API role removes a channel at all.
--
-- What goes with it, read off the schema rather than assumed:
--
--   messages               messages.channel_id → channels, ON DELETE CASCADE
--   channel_participants   composite key → channels, ON DELETE CASCADE
--   notifications          no foreign key to a channel exists, and channel
--                          messages create no notifications today. Rows whose
--                          `href` is this channel's own address are removed
--                          here, so a later feature that notifies about a
--                          private channel cannot leave its title behind.
--   attachments            `messages.attachment` is a JSON description on the
--                          message row; there is no storage bucket for channel
--                          messages, so nothing is left in storage.
--
-- Nothing references `messages`, and nothing else references `channels`. The
-- people — profiles, memberships, lokallag, lokallagsleder grants — are not
-- touched: the cascades run from the channel downwards only.
--
-- One function call is one transaction: either the channel and everything
-- under it is gone, or nothing is. There is no undelete.

create or replace function public.delete_private_channel(p_channel_id text)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  v_channel channels%rowtype;
  v_href text;
  v_deleted text;
begin
  if auth.uid() is null or not private_channel_manage_admits(auth.uid(), p_channel_id) then
    return false;
  end if;

  -- Locked, so an archive, a rename or a second delete arriving at the same
  -- moment waits for this one.
  select * into v_channel
  from channels c
  where c.id = p_channel_id and c.is_private
  for update;
  if not found then
    return false;
  end if;

  v_href := '/community/' || v_channel.community_id || '/channel/' || v_channel.id;
  delete from notifications n
  where n.community_id = v_channel.community_id
    and (
      n.href = v_href
      or starts_with(n.href, v_href || '?')
      or starts_with(n.href, v_href || '#')
      or starts_with(n.href, v_href || '/')
    );

  -- Messages and participant rows follow by their ON DELETE CASCADE keys.
  delete from channels c
  where c.id = v_channel.id and c.is_private
  returning c.id into v_deleted;

  return v_deleted is not null;
end;
$$;

revoke execute on function public.delete_private_channel(text) from public, anon;
grant execute on function public.delete_private_channel(text) to authenticated;

comment on function public.delete_private_channel(text) is
  'Channel managers only (community admin, or a participating lokallagsleder marked as manager). Permanently deletes one private lokallag channel, active or archived, with its messages, participant rows and any notifications addressed to it. Never deletes a channel that is not private. False when the caller may not or the channel is not a private channel.';

-- ── The participant list ────────────────────────────────────────────────
--
-- Recreated from 20261020100000, where it answered managers only. A private
-- channel is a small room: the people in it should know who else is reading.
-- It now answers anyone who may read the channel — its participants and the
-- community's admins — and still nobody else, so someone who was never
-- invited, or was removed, cannot list a channel they cannot open.
--
-- What a row says is deliberately little, and all of it is about this channel:
--
--   user_id        the id the conversation already shows as each message's
--                  author; needed to key the list and to show the person's
--                  community photo where the viewer may see that profile
--   display_name   the name chosen for this community — never the account
--                  name, handle or email
--   is_manager     who runs the channel
--   is_leader      still admins only: they are the ones who can act on it
--   added_at       managers only; when someone was added is not a
--                  participant's business
--
-- The table itself keeps its narrow SELECT policy (managers, and each person's
-- own row): `added_by` and `created_at` stay out of ordinary participants'
-- reach, and this function is the participant view.
create or replace function public.private_channel_roster(p_channel_id text)
returns table (user_id uuid, display_name text, is_manager boolean, is_leader boolean, added_at timestamptz)
language sql stable security definer set search_path = public as $$
  select
    cp.user_id,
    coalesce(prof.display_name, 'Medlem'),
    cp.is_manager and local_group_manage_admits(cp.user_id, cp.local_group_id),
    case when is_admin(cp.community_id) then local_group_manage_admits(cp.user_id, cp.local_group_id) end,
    case when private_channel_manage_admits(auth.uid(), cp.channel_id) then cp.created_at end
  from channel_participants cp
  join channels c
    on c.id = cp.channel_id and c.is_private
  join memberships m
    on m.user_id = cp.user_id
   and m.community_id = cp.community_id
   and m.status = 'active'
   and m.local_group_id = cp.local_group_id
  left join community_profiles prof
    on prof.community_id = cp.community_id and prof.user_id = cp.user_id
  where cp.channel_id = p_channel_id
    and channel_access_admits(auth.uid(), c.community_id, c.local_group_id, c.subgroup_id, c.id, c.is_private)
  order by lower(coalesce(prof.display_name, 'Medlem'));
$$;

revoke execute on function public.private_channel_roster(text) from public, anon;
grant execute on function public.private_channel_roster(text) to authenticated;

comment on function public.private_channel_roster(text) is
  'The participants of a private lokallag channel, for anyone who may read it (participants and the community''s admins). Display name in this community and whether the person manages the channel; is_leader for admins only, added_at for managers only. Empty for everyone else.';
