-- Per-community privacy policy: who may read the member registry, and who may
-- direct-message whom.
--
-- These are community settings, not platform rules. One organisation treats its
-- member list as ordinary information; another works in a field where knowing
-- who is involved is the sensitive part. The same account can belong to both,
-- so the answer has to be attached to the community rather than the person.
--
-- Deliberately expressed as configuration on `communities`, never as a check
-- against a name or slug: a community created next month picks its own setting
-- without anybody editing a policy.

create type member_directory_visibility as enum ('admin_only', 'members');
create type dm_policy as enum ('staff_only', 'members');

alter table communities
  add column member_directory_visibility member_directory_visibility not null default 'members',
  add column dm_policy dm_policy not null default 'members';

comment on column communities.member_directory_visibility is
  'admin_only: only administrators may list the membership. members: any active member may.';
comment on column communities.dm_policy is
  'staff_only: only admins/moderators may message each other. members: any two active members may.';

-- ── Who may read the registry ───────────────────────────────────────────
--
-- Administrators always can — membership administration is their job and they
-- need the list to do it. Everyone else depends on the community's setting.
--
-- Moderators are *not* included. A moderator follows up conversations and
-- content; that does not require knowing who is quietly on the list, and in
-- these two organisations that list is the sensitive part.

create or replace function public.can_view_member_directory(cid text)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1
    from memberships m
    join communities c on c.id = m.community_id
    where m.community_id = cid
      and m.user_id = auth.uid()
      and m.status = 'active'
      and (m.role = 'admin' or c.member_directory_visibility = 'members')
  );
$$;

revoke execute on function public.can_view_member_directory(text) from public, anon;
grant execute on function public.can_view_member_directory(text) to authenticated;

-- Your own membership row is always yours to read — it is how the application
-- knows which communities you belong to and in what role. Everyone else's row
-- is the registry, and takes the policy above.
drop policy memberships_select on memberships;

create policy memberships_select on memberships for select to authenticated
using (
  user_id = auth.uid()
  or can_view_member_directory(community_id)
);

-- ── Profiles ────────────────────────────────────────────────────────────
--
-- Closing `memberships` alone would not have been enough. `profiles_select`
-- previously granted access to anyone sharing a community via
-- shares_community(), which meant an ordinary member could list every
-- co-member's name straight out of `profiles` and reconstruct the registry the
-- other policy had just hidden.
--
-- But profiles cannot simply be closed either: it is also how a post, comment
-- or message gets an author's name, and shutting it would render every feed as
-- "Ukjent".
--
-- So co-membership is split in two. Sharing a community reveals a profile only
-- when that community's registry is open to the viewer. Separately, having
-- written something the viewer is allowed to read reveals the author — which
-- is unavoidable if the content is visible at all, and is categorically
-- different from enumerating people who have never posted.

create or replace function public.shares_visible_directory(other uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1
    from memberships mine
    join memberships theirs on theirs.community_id = mine.community_id
    join communities c on c.id = mine.community_id
    where mine.user_id = auth.uid() and mine.status = 'active'
      and theirs.user_id = other and theirs.status = 'active'
      and (c.member_directory_visibility = 'members' or mine.role = 'admin')
  );
$$;

-- Authorship the viewer can actually see: posts and comments in their
-- communities, messages in channels they can read, and hosts of events they
-- can see. Each is content already visible to them; this only puts a name on it.
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
    join memberships m on m.community_id = ch.community_id
    where msg.author_id = other and m.user_id = auth.uid() and m.status = 'active'
  ) or exists (
    select 1 from events e
    join memberships m on m.community_id = e.community_id
    where e.host_id = other and m.user_id = auth.uid() and m.status = 'active'
  );
$$;

revoke execute on function public.shares_visible_directory(uuid) from public, anon;
revoke execute on function public.shares_visible_authorship(uuid) from public, anon;
grant execute on function public.shares_visible_directory(uuid) to authenticated;
grant execute on function public.shares_visible_authorship(uuid) to authenticated;

drop policy profiles_select on profiles;

create policy profiles_select on profiles for select to authenticated
using (
  id = auth.uid()
  -- A community whose registry is open to you, or one you administer.
  or shares_visible_directory(id)
  -- Someone whose content you are already reading.
  or shares_visible_authorship(id)
  -- Whoever invited you, so an invitation can say who it came from.
  or exists (
    select 1 from memberships m
    where m.user_id = auth.uid() and m.invited_by = profiles.id
  )
  -- Someone waiting on a decision from a community you administer.
  or administers_pending_membership(id)
);

-- shares_community() is left in place but is no longer referenced by any
-- policy. Dropping it would break nothing today, but it is the kind of
-- general-purpose helper a future policy might reach for by accident, so the
-- comment is the warning.
comment on function public.shares_community(uuid) is
  'DEPRECATED: ignores member_directory_visibility. Use shares_visible_directory() instead.';

-- ── Direct messages ─────────────────────────────────────────────────────
--
-- There is no DM system yet — no table, no route, no UI. This is the
-- authorisation seam it will attach to, defined now so the policy model is
-- complete and testable, and so the rule is settled before there is a feature
-- arguing for a shortcut.
--
-- staff_only: both parties must be an admin or moderator of that community.
--             An ordinary member cannot open a conversation at all, and cannot
--             be the recipient of one.
-- members:    any two active members of the community.
--
-- Community-scoped on purpose: two people who share one community may be able
-- to message each other there and not somewhere else.

create or replace function public.can_send_dm(cid text, recipient uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1
    from memberships sender
    join memberships rec on rec.community_id = sender.community_id
    join communities c on c.id = sender.community_id
    where sender.community_id = cid
      and sender.user_id = auth.uid() and sender.status = 'active'
      and rec.user_id = recipient and rec.status = 'active'
      and recipient <> auth.uid()
      and (
        c.dm_policy = 'members'
        or (sender.role in ('admin', 'moderator') and rec.role in ('admin', 'moderator'))
      )
  );
$$;

revoke execute on function public.can_send_dm(text, uuid) from public, anon;
grant execute on function public.can_send_dm(text, uuid) to authenticated;
