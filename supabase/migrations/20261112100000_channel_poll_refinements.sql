-- Polls, refined (builds on 20261111100000_channel_polls). Forward only:
-- existing polls, options and votes are kept exactly as they are.
--
-- ── Withdrawing a vote ──────────────────────────────────────────────────
--
-- withdraw_channel_poll_vote() removes the caller's own vote from an open
-- poll in a channel they can read and that is not archived. A closed poll
-- keeps every vote. Withdrawing is the same as never having voted: the
-- results rule (counts and voter lists only after one's own vote or once
-- closed) hides them again until the caller votes. Members still have no
-- DELETE grant on channel_poll_votes; this function is the only way.
--
-- ── Visible polls: voting is the disclosure ─────────────────────────────
--
-- On a visible poll, voting deliberately shows one's community name, photo
-- and choice to the other voters in that channel. So channel_poll_voters()
-- no longer asks can_view_community_identity(): a restricted member
-- directory does not hide a name someone attached to a visible vote. What
-- still holds:
--
--   * the viewer must read the channel now and have voted (or the poll be
--     closed) — the results rule, unchanged;
--   * a voter is named only while they can still read the channel (an
--     active member, by the channel rule); anyone who left is counted only;
--   * community display name and photo only — never an account id, a global
--     name or an email address. Each vote row gets an opaque `voter_ref`, so
--     the page can ask for a voter's photo without learning who they are;
--   * nothing else opens: profiles, the member directory, bios and the
--     ordinary member-avatar route keep their own rules.
--
-- Anonymous polls are untouched: no function names their voters to anyone,
-- creators, moderators and admins included. Whoever operates the database
-- can still read the vote rows.

-- ── An opaque handle per vote ───────────────────────────────────────────

-- Volatile default: every existing row gets its own value.
alter table public.channel_poll_votes
  add column voter_ref uuid not null default gen_random_uuid();

create unique index channel_poll_votes_voter_ref_key on public.channel_poll_votes (poll_id, voter_ref);

comment on column public.channel_poll_votes.voter_ref is
  'Opaque per-vote handle, used to fetch a visible poll voter''s community photo without naming their account. Fixed for the life of the vote.';

-- Recreated from 20261111100000 with one addition: voter_ref is fixed.
create or replace function public.channel_poll_votes_guard()
returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'UPDATE' and (
    new.poll_id is distinct from old.poll_id
    or new.user_id is distinct from old.user_id
    or new.voter_ref is distinct from old.voter_ref
  ) then
    raise exception 'poll_error:immutable' using errcode = 'check_violation';
  end if;
  if exists (select 1 from channel_polls p where p.message_id = new.poll_id and p.closed_at is not null) then
    raise exception 'poll_error:closed' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

-- ── Withdrawing ─────────────────────────────────────────────────────────

create or replace function public.withdraw_channel_poll_vote(p_message_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_poll channel_polls%rowtype;
  v_archived boolean;
begin
  if v_user is null or p_message_id is null then
    raise exception 'poll_error:not_found' using errcode = 'insufficient_privilege';
  end if;

  -- Locked, as a vote and a close are: a withdrawal cannot pass a close.
  select (c.archived_at is not null) into v_archived
    from channel_polls p
    join messages m on m.id = p.message_id
    join channels c on c.id = p.channel_id
   where p.message_id = p_message_id
     and m.deleted_at is null
     and channel_access_admits(v_user, c.community_id, c.local_group_id, c.subgroup_id, c.id, c.is_private)
     for no key update of p;
  if not found then
    raise exception 'poll_error:not_found' using errcode = 'insufficient_privilege';
  end if;
  select * into v_poll from channel_polls p where p.message_id = p_message_id;
  if v_archived then
    raise exception 'poll_error:archived' using errcode = 'check_violation';
  end if;
  if v_poll.closed_at is not null then
    raise exception 'poll_error:closed' using errcode = 'check_violation';
  end if;

  -- No vote to withdraw is the same answer: idempotent.
  delete from channel_poll_votes v where v.poll_id = v_poll.message_id and v.user_id = v_user;

  return channel_poll_view(v_user, v_poll.message_id);
end;
$$;

comment on function public.withdraw_channel_poll_vote(uuid) is
  'Removes the caller''s own vote from an open poll in a channel they can read, not archived. Idempotent. Returns the poll as the caller now sees it — without results until they vote again.';

-- ── Who chose an option ─────────────────────────────────────────────────

-- Internal: whether this viewer may see a visible poll's voters now.
create or replace function public.channel_poll_voters_admit(p_viewer uuid, p_message_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select p_viewer is not null and exists (
    select 1
    from channel_polls p
    join messages m on m.id = p.message_id
    join channels c on c.id = p.channel_id
    where p.message_id = p_message_id
      and p.visibility = 'visible'
      and m.deleted_at is null
      and channel_access_admits(p_viewer, c.community_id, c.local_group_id, c.subgroup_id, c.id, c.is_private)
      and (
        p.closed_at is not null
        or exists (select 1 from channel_poll_votes v where v.poll_id = p.message_id and v.user_id = p_viewer)
      )
  );
$$;

comment on function public.channel_poll_voters_admit(uuid, uuid) is
  'Whether a viewer may see who voted on this poll: a visible poll in a channel they can read now, and they voted or it is closed. Never for an anonymous poll. Internal; takes a user id.';

-- Recreated from 20261111100000: names every voter still in the channel,
-- whatever the member directory says, with an opaque ref and the photo's
-- version (its file name) — not its path, which holds the account id.
create or replace function public.channel_poll_voters(p_message_id uuid, p_option_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_poll channel_polls%rowtype;
  v_community text;
  v_total integer;
  v_named integer;
  v_people jsonb;
begin
  if p_option_id is null or not channel_poll_voters_admit(v_user, p_message_id) then
    return null;
  end if;
  select * into v_poll from channel_polls p where p.message_id = p_message_id;
  select c.community_id into v_community from channels c where c.id = v_poll.channel_id;
  if not exists (select 1 from channel_poll_options o where o.id = p_option_id and o.poll_id = v_poll.message_id) then
    return null;
  end if;

  select count(*)::integer into v_total
    from channel_poll_votes v where v.poll_id = v_poll.message_id and v.option_id = p_option_id;

  with named as (
    select v.user_id, v.voter_ref, v.updated_at, cp.display_name, cp.avatar_path
    from channel_poll_votes v
    join channels c on c.id = v_poll.channel_id
    join community_profiles cp on cp.community_id = v_community and cp.user_id = v.user_id
    where v.poll_id = v_poll.message_id
      and v.option_id = p_option_id
      -- Still able to read the channel; anyone who left is counted only.
      and channel_access_admits(v.user_id, c.community_id, c.local_group_id, c.subgroup_id, c.id, c.is_private)
  ),
  shown as (
    select * from named order by (user_id = v_user) desc, updated_at, user_id limit 50
  )
  select (select count(*)::integer from named),
         coalesce(
           (select jsonb_agg(
                     jsonb_build_object(
                       'ref', s.voter_ref,
                       'name', s.display_name,
                       'me', s.user_id = v_user,
                       'avatar', nullif(regexp_replace(coalesce(s.avatar_path, ''), '^.*/', ''), '')
                     )
                     order by (s.user_id = v_user) desc, s.updated_at, s.user_id)
              from shown s),
           '[]'::jsonb)
    into v_named, v_people;

  return jsonb_build_object(
    'total', v_total,
    'people', v_people,
    'unnamed', v_total - least(v_named, 50)
  );
end;
$$;

comment on function public.channel_poll_voters(uuid, uuid) is
  'On a visible poll the caller can read, once they voted or it closed: how many chose this option, and for each voter still in the channel their community display name, photo version and an opaque ref. Not limited by the member directory: voting on a visible poll is the disclosure. Null otherwise; never an account id.';

-- For the server's photo route only. The viewer is the signed-in person the
-- server verified; the answer is the photo's storage path (it holds the
-- account id, so it never goes to a browser), or null.
create or replace function public.channel_poll_voter_avatar_path(p_viewer uuid, p_message_id uuid, p_voter_ref uuid)
returns text language sql stable security definer set search_path = public as $$
  select cp.avatar_path
  from channel_poll_votes v
  join channel_polls p on p.message_id = v.poll_id
  join channels c on c.id = p.channel_id
  join community_profiles cp on cp.community_id = c.community_id and cp.user_id = v.user_id
  where v.poll_id = p_message_id
    and v.voter_ref = p_voter_ref
    and channel_poll_voters_admit(p_viewer, p_message_id)
    and channel_access_admits(v.user_id, c.community_id, c.local_group_id, c.subgroup_id, c.id, c.is_private)
    and cp.avatar_path is not null;
$$;

comment on function public.channel_poll_voter_avatar_path(uuid, uuid, uuid) is
  'Storage path of a visible poll voter''s community photo, when that viewer may see the poll''s voters and the voter is still in the channel. Service role only: the server passes the verified signed-in user.';

-- ── Privileges ──────────────────────────────────────────────────────────

revoke all on function public.withdraw_channel_poll_vote(uuid) from public, anon, authenticated, service_role;
revoke all on function public.channel_poll_voters_admit(uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function public.channel_poll_voters(uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function public.channel_poll_voter_avatar_path(uuid, uuid, uuid) from public, anon, authenticated, service_role;

grant execute on function public.withdraw_channel_poll_vote(uuid) to authenticated;
grant execute on function public.channel_poll_voters(uuid, uuid) to authenticated;
grant execute on function public.channel_poll_voter_avatar_path(uuid, uuid, uuid) to service_role;
