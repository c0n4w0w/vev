-- @mentions in multi-person chats.
--
-- Channel messages only (`messages`: community channels, lokallag main chats,
-- private lokallag channels and group chats). Direct messages have no
-- mentions; neither do feed posts, comments or collaboration messages.
--
-- ── How a mention is written ────────────────────────────────────────────
--
-- In the message text as `<@user-id>` — the account id, lower-case, nothing
-- else. The name is never stored with it: a message shows whatever the person
-- is called in that community now, so changing a display name never breaks a
-- mention. The composer writes a token only for a suggestion the author
-- picked; text that merely looks like "@Mia" stays text.
--
-- ── Who may be mentioned where (mention_target_admits) ──────────────────
--
-- Always: the person can read the channel now (channel_access_admits — the
-- rule the channel's own messages follow, so former members, people moved
-- out of a lokallag and people taken out of a private channel or group are
-- excluded) and has a profile in its community. Then:
--
--   community channel, lokallag main chat   they have a message in this very
--                                            channel that is not deleted
--   private lokallag channel                 they were invited to it
--                                            (channel_participants), or have
--                                            such a message there
--   group chat                               they belong to the group
--                                            (community_subgroup_members), or
--                                            have such a message there
--
-- Posting in one channel never makes anyone mentionable in another, and a
-- member who only reads is never found. Deleting one's last message there
-- takes one out of its suggestions again. Moderator removals count the same
-- as deletions. There are no system-written chat messages to exclude.
--
-- ── Enforcement ─────────────────────────────────────────────────────────
--
-- messages_sync_mentions, an AFTER trigger on every insert and on every
-- change of text or deletion, whoever writes (the insert policy,
-- send_channel_message_with_attachments, edit_channel_message,
-- delete_channel_message, the server's key). It reads the tokens from the
-- stored text and compares them with what the message mentioned before:
--
--   added      each must pass mention_target_admits now, or the whole write
--              is refused (`message_error:mention_not_allowed`). At most 20
--              different people per message (`message_error:too_many_mentions`).
--              Each gets a `message_mentions` row and — unless it is the
--              author — one in-app notice.
--   kept       left alone: no second notice, and no re-check, so an old
--              message can still be corrected after someone it named left.
--   removed    the row and its notice go. A deleted message removes all.
--
-- An archived channel takes no new message and no edit already
-- (messages_not_archived, edit_channel_message), so it takes no new mention.
--
-- ── Search (search_channel_mention_candidates) ──────────────────────────
--
-- For the composer: one channel, one query, at most 8 people, never the
-- caller. Answers only someone who may write in that channel now, and only
-- with people mention_target_admits would accept — never the membership
-- list. Returns the id (the mention needs it), the community display name and
-- the photo's file name, if any (it only versions the photo's URL); no
-- e-mail, role, lokallag or anything else.
--
-- ── Notices ─────────────────────────────────────────────────────────────
--
-- kind 'mention', «Mia nevnte deg i #prosjektarbeid», linking to the message
-- (`?melding=`). `notifications.message_id` ties the notice to the message:
-- notifications_select shows it only while its recipient can read that
-- channel and the message is not deleted, and it goes with the message. No
-- notice says more than its title (author and channel) and the community.
-- TING has no notification preferences yet; e-mail and push are not part of
-- this.
--
-- ── Who a member is to others: identity and profile ─────────────────────
--
-- Two levels, both community-scoped (community_profiles):
--
--   profile    the whole row: display name, photo and bio. Unchanged here:
--              can_view_community_profile (own, an open member registry,
--              people whose posts, comments, messages, events or direct
--              conversations the viewer can already see).
--   identity   display name and photo only (can_view_community_identity):
--              everyone whose profile the viewer may see, and, for an active
--              member, these active members of the same community —
--                · someone mentioned in a message that is not deleted, in a
--                  channel the viewer can read now;
--                · someone invited to a private lokallag channel, or a member
--                  of a group, whose conversation both of them can read now.
--
-- Sharing a private channel or a group therefore shows a name and a photo,
-- never a bio, e-mail or anything account-wide. A member who only reads a
-- public channel gains nothing here: nobody can mention them there, and only
-- private channels and groups list their people. Every clause asks about
-- access now, so leaving the community, the group or the channel ends it, and
-- knowing an account id grants nothing. Names and photos are read through
-- community_identities(), channel_person_card() and the member-avatars
-- policy; the bio only through can_view_community_profile.

-- ── Tokens ──────────────────────────────────────────────────────────────

create or replace function public.message_mention_ids(p_body text)
returns uuid[] language sql immutable set search_path = public as $$
  select coalesce(array_agg(distinct m[1]::uuid), '{}'::uuid[])
  from regexp_matches(
    coalesce(p_body, ''),
    '<@([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})>',
    'g'
  ) as m;
$$;

comment on function public.message_mention_ids(text) is
  'The distinct account ids mentioned in a message text as <@id>.';

-- ── Mentions ────────────────────────────────────────────────────────────

create table public.message_mentions (
  message_id uuid not null,
  channel_id text not null,
  user_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (message_id, user_id),
  constraint message_mentions_message_fkey
    foreign key (message_id, channel_id)
    references public.messages (id, channel_id) on delete cascade
);

create index message_mentions_user_idx on public.message_mentions (user_id, channel_id);
create index message_mentions_channel_idx on public.message_mentions (channel_id);

comment on table public.message_mentions is
  'Who each channel message mentions. Written only by messages_sync_mentions from the stored text; no API role reads or writes it.';

alter table public.message_mentions enable row level security;
revoke all on public.message_mentions from public, anon, authenticated, service_role;
grant select, insert, update, delete on public.message_mentions to service_role;

-- Contributors of one channel, found without reading the rest of it.
create index messages_channel_author_live_idx
  on public.messages (channel_id, author_id)
  where deleted_at is null;

-- ── Who may be mentioned ────────────────────────────────────────────────

create or replace function public.mention_target_admits(p_channel_id text, p_user_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select p_user_id is not null and exists (
    select 1
    from channels c
    where c.id = p_channel_id
      and channel_access_admits(p_user_id, c.community_id, c.local_group_id, c.subgroup_id, c.id, c.is_private)
      and exists (
        select 1 from community_profiles cp
        where cp.community_id = c.community_id and cp.user_id = p_user_id
      )
      and (
        exists (
          select 1 from messages m
          where m.channel_id = c.id and m.author_id = p_user_id and m.deleted_at is null
        )
        or (
          c.is_private and exists (
            select 1 from channel_participants cp
            where cp.channel_id = c.id and cp.user_id = p_user_id
          )
        )
        or (
          c.subgroup_id is not null and exists (
            select 1 from community_subgroup_members sm
            where sm.subgroup_id = c.subgroup_id and sm.user_id = p_user_id
          )
        )
      )
  );
$$;

comment on function public.mention_target_admits(text, uuid) is
  'Whether this person may be mentioned in this channel now: they can read it, and have a message there that is not deleted — or, in a private lokallag channel or group chat, were invited to it.';

-- ── Search ──────────────────────────────────────────────────────────────

create or replace function public.search_channel_mention_candidates(p_channel_id text, p_query text)
returns table (user_id uuid, display_name text, avatar_version text)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare
  v_user uuid := auth.uid();
  v_channel channels%rowtype;
  v_query text := lower(normalize(btrim(coalesce(p_query, '')), NFC));
  v_pattern text;
begin
  if v_user is null or length(v_query) > 40 then
    return;
  end if;

  select * into v_channel from channels c where c.id = p_channel_id;
  if not found
     or not channel_access_admits(v_user, v_channel.community_id, v_channel.local_group_id,
                                  v_channel.subgroup_id, v_channel.id, v_channel.is_private)
     or v_channel.archived_at is not null
     or (v_channel.read_only and not exists (
          select 1 from memberships m
          where m.community_id = v_channel.community_id and m.user_id = v_user
            and m.status = 'active' and m.role in ('admin', 'moderator')
        ))
  then
    return;
  end if;

  -- A literal match on the start of the name or of any word in it.
  v_pattern := replace(replace(replace(v_query, '\', '\\'), '%', '\%'), '_', '\_');

  return query
  with candidates as (
    select m.author_id as uid
    from messages m
    where m.channel_id = v_channel.id and m.deleted_at is null
    union
    select cp.user_id
    from channel_participants cp
    where v_channel.is_private and cp.channel_id = v_channel.id
    union
    select sm.user_id
    from community_subgroup_members sm
    where v_channel.subgroup_id is not null and sm.subgroup_id = v_channel.subgroup_id
  )
  select p.user_id, p.display_name, split_part(p.avatar_path, '/', 3)
  from candidates k
  join community_profiles p
    on p.community_id = v_channel.community_id and p.user_id = k.uid
  where k.uid <> v_user
    and (
      v_pattern = ''
      or lower(p.display_name) like v_pattern || '%' escape '\'
      or lower(p.display_name) like '% ' || v_pattern || '%' escape '\'
      or lower(p.display_name) like '%-' || v_pattern || '%' escape '\'
    )
    and channel_access_admits(k.uid, v_channel.community_id, v_channel.local_group_id,
                              v_channel.subgroup_id, v_channel.id, v_channel.is_private)
  order by (lower(p.display_name) like v_pattern || '%' escape '\') desc,
           lower(p.display_name),
           p.user_id
  limit 8;
end;
$$;

comment on function public.search_channel_mention_candidates(text, text) is
  'Mention suggestions for one channel the caller may write in: at most 8 people mention_target_admits would accept, matched on the start of their community display name or of a word in it. Never the caller, never anyone else. Id, display name and the photo''s file name (its cache key) only.';

-- ── Notices tied to a message ───────────────────────────────────────────

alter table public.notifications
  add column message_id uuid references public.messages (id) on delete cascade;

create index notifications_message_idx on public.notifications (message_id) where message_id is not null;

comment on column public.notifications.message_id is
  'The channel message a mention notice is about. The notice is shown only while its recipient can read that channel and the message is not deleted, and goes with the message.';

create or replace function public.can_read_notified_message(p_message_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from messages m
    where m.id = p_message_id and m.deleted_at is null and can_read_channel(m.channel_id)
  );
$$;

drop policy if exists notifications_select on public.notifications;
create policy notifications_select on public.notifications for select to authenticated
  using (
    user_id = auth.uid()
    and (post_id is null or can_access_post(post_id))
    and (event_id is null or can_read_event(event_id))
    and (message_id is null or can_read_notified_message(message_id))
  );

create or replace function public.notifications_guard_immutable()
returns trigger language plpgsql set search_path = public as $$
begin
  if coalesce(auth.role(), '') = 'service_role' then
    return new;
  end if;

  if new.id is distinct from old.id
     or new.user_id is distinct from old.user_id
     or new.kind is distinct from old.kind
     or new.community_id is distinct from old.community_id
     or new.title is distinct from old.title
     or new.body is distinct from old.body
     or new.href is distinct from old.href
     or new.created_at is distinct from old.created_at
     or new.post_id is distinct from old.post_id
     or new.event_id is distinct from old.event_id
     or new.message_id is distinct from old.message_id then
    raise exception 'Et varsel kan bare markeres som lest eller ulest'
      using errcode = 'insufficient_privilege';
  end if;

  return new;
end $$;

-- ── Keeping mentions and notices in step with the text ──────────────────

create or replace function public.messages_sync_mentions()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_now uuid[] := case when new.deleted_at is null then message_mention_ids(new.body) else '{}'::uuid[] end;
  v_before uuid[] := '{}'::uuid[];
  v_added uuid[];
  v_removed uuid[];
  v_target uuid;
  v_channel channels%rowtype;
  v_author_name text;
  v_community_name text;
begin
  if tg_op = 'UPDATE' then
    if new.body is not distinct from old.body and new.deleted_at is not distinct from old.deleted_at then
      return new;
    end if;
    select coalesce(array_agg(mm.user_id), '{}'::uuid[]) into v_before
    from message_mentions mm where mm.message_id = new.id;
  end if;

  v_added := array(select unnest(v_now) except select unnest(v_before));
  v_removed := array(select unnest(v_before) except select unnest(v_now));

  if cardinality(v_removed) > 0 then
    delete from notifications n
    where n.message_id = new.id and n.kind = 'mention' and n.user_id = any (v_removed);
    delete from message_mentions mm
    where mm.message_id = new.id and mm.user_id = any (v_removed);
  end if;

  if cardinality(v_added) = 0 then
    return new;
  end if;

  if cardinality(v_now) > 20 then
    raise exception 'message_error:too_many_mentions' using errcode = 'check_violation';
  end if;

  select * into v_channel from channels c where c.id = new.channel_id;
  if v_channel.archived_at is not null then
    raise exception 'message_error:archived' using errcode = 'check_violation';
  end if;

  foreach v_target in array v_added loop
    if not mention_target_admits(new.channel_id, v_target) then
      raise exception 'message_error:mention_not_allowed' using errcode = 'insufficient_privilege';
    end if;
  end loop;

  insert into message_mentions (message_id, channel_id, user_id)
  select new.id, new.channel_id, t from unnest(v_added) as t
  on conflict do nothing;

  select cp.display_name, c.name into v_author_name, v_community_name
  from communities c
  left join community_profiles cp on cp.community_id = c.id and cp.user_id = new.author_id
  where c.id = v_channel.community_id;

  insert into notifications (user_id, kind, community_id, title, body, href, message_id)
  select
    t,
    'mention',
    v_channel.community_id,
    coalesce(v_author_name, 'Et medlem') || ' nevnte deg i #' || v_channel.name,
    coalesce(v_community_name, 'Fellesskapet'),
    '/community/' || v_channel.community_id || '/channel/' || v_channel.id || '?melding=' || new.id,
    new.id
  from unnest(v_added) as t
  where t <> new.author_id
    and not exists (
      select 1 from notifications n
      where n.user_id = t and n.message_id = new.id and n.kind = 'mention'
    );

  return new;
end;
$$;

create trigger messages_sync_mentions
  after insert or update of body, deleted_at on public.messages
  for each row execute function public.messages_sync_mentions();

-- ── Identity: name and photo ────────────────────────────────────────────

create or replace function public.community_identity_admits(p_viewer uuid, p_community_id text, p_user_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select p_viewer is not null and p_user_id is not null
    and exists (
      select 1 from memberships m
      where m.community_id = p_community_id and m.user_id = p_viewer and m.status = 'active'
    )
    and exists (
      select 1 from memberships m
      where m.community_id = p_community_id and m.user_id = p_user_id and m.status = 'active'
    )
    and (
      -- Mentioned in a message the viewer can read.
      exists (
        select 1 from message_mentions mm
        join messages msg on msg.id = mm.message_id
        join channels ch on ch.id = mm.channel_id
        where ch.community_id = p_community_id and mm.user_id = p_user_id and msg.deleted_at is null
          and channel_access_admits(p_viewer, ch.community_id, ch.local_group_id, ch.subgroup_id, ch.id, ch.is_private)
      )
      -- Both in a private lokallag channel, both still able to read it.
      or exists (
        select 1 from channel_participants cp
        join channels ch on ch.id = cp.channel_id
        where cp.community_id = p_community_id and cp.user_id = p_user_id
          and channel_access_admits(p_viewer, ch.community_id, ch.local_group_id, ch.subgroup_id, ch.id, ch.is_private)
          and channel_access_admits(p_user_id, ch.community_id, ch.local_group_id, ch.subgroup_id, ch.id, ch.is_private)
      )
      -- Both able to read a group's chat, the person as a member of the group.
      or exists (
        select 1 from community_subgroup_members sm
        join channels ch on ch.subgroup_id = sm.subgroup_id
        where sm.community_id = p_community_id and sm.user_id = p_user_id
          and channel_access_admits(p_viewer, ch.community_id, ch.local_group_id, ch.subgroup_id, ch.id, ch.is_private)
          and channel_access_admits(p_user_id, ch.community_id, ch.local_group_id, ch.subgroup_id, ch.id, ch.is_private)
      )
    );
$$;

comment on function public.community_identity_admits(uuid, text, uuid) is
  'Beyond can_view_community_profile: whether the viewer may see this active member''s name and photo because a message they can read mentions them, or they share a private lokallag channel or a group. Never the bio.';

create or replace function public.can_view_community_identity(p_community_id text, p_user_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select can_view_community_profile(p_community_id, p_user_id)
      or community_identity_admits(auth.uid(), p_community_id, p_user_id);
$$;

comment on function public.can_view_community_identity(text, uuid) is
  'Whether the caller may see this person''s display name and photo in this community: their whole profile is visible to them, or community_identity_admits. The bio follows can_view_community_profile alone.';

create or replace function public.community_identities(p_community_id text, p_user_ids uuid[])
returns table (user_id uuid, display_name text, avatar_version text)
language sql stable security definer set search_path = public as $$
  select cp.user_id, cp.display_name, split_part(cp.avatar_path, '/', 3)
  from community_profiles cp
  where cp.community_id = p_community_id
    and cp.user_id = any (p_user_ids[1:200])
    and can_view_community_identity(cp.community_id, cp.user_id);
$$;

comment on function public.community_identities(text, uuid[]) is
  'Names and photo file names (their cache keys) of those among at most 200 given people whose identity the caller may see in this community. Nothing for anyone else, the same as an id that is no one.';

-- ── The profile card in a conversation ──────────────────────────────────
--
-- What a member sees when they open a name in a channel — a mention or a
-- message's author — without leaving it. Answered only when the caller can
-- read that channel now and the person belongs to its conversation there:
-- they wrote in it, a message in it that is not deleted mentions them, or
-- they were invited to it (a private lokallag channel) or belong to its group
-- — and only while they are still an active member of the community.
-- On top of that, their identity must be one the caller may see. The bio
-- comes back only where can_view_community_profile admits the whole profile;
-- otherwise it is null, the same as an empty one. Nothing at all for anyone
-- else, so an account id alone opens nothing, in this channel or any other.
create or replace function public.channel_person_card(p_channel_id text, p_user_id uuid)
returns table (user_id uuid, display_name text, avatar_version text, bio text)
language sql stable security definer set search_path = public as $$
  select cp.user_id, cp.display_name, split_part(cp.avatar_path, '/', 3),
         case when can_view_community_profile(c.community_id, cp.user_id) then nullif(cp.bio, '') end
  from channels c
  join community_profiles cp on cp.community_id = c.community_id and cp.user_id = p_user_id
  where c.id = p_channel_id
    and can_read_channel(c.id)
    and exists (
      select 1 from memberships m
      where m.community_id = c.community_id and m.user_id = p_user_id and m.status = 'active'
    )
    and (
      exists (select 1 from messages m where m.channel_id = c.id and m.author_id = p_user_id)
      or exists (
        select 1 from message_mentions mm
        join messages m on m.id = mm.message_id
        where mm.channel_id = c.id and mm.user_id = p_user_id and m.deleted_at is null
      )
      or (c.is_private and exists (
        select 1 from channel_participants pp where pp.channel_id = c.id and pp.user_id = p_user_id
      ))
      or (c.subgroup_id is not null and exists (
        select 1 from community_subgroup_members sm where sm.subgroup_id = c.subgroup_id and sm.user_id = p_user_id
      ))
    )
    and can_view_community_identity(c.community_id, p_user_id);
$$;

comment on function public.channel_person_card(text, uuid) is
  'Name, photo file name and — only where the whole profile is visible — bio of someone who belongs to this channel''s conversation, for a caller who can read it now and may see their identity. Nothing for anyone else.';

-- The photo is part of identity: whoever may see the name may see the photo
-- the profile currently uses. Otherwise as before.
create or replace function public.can_read_member_avatar_object(p_name text)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare
  v_community text;
  v_user uuid;
begin
  if p_name is null
     or p_name !~ '^[^/]+/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpg|webp)$'
  then
    return false;
  end if;

  v_community := split_part(p_name, '/', 1);
  v_user := split_part(p_name, '/', 2)::uuid;

  -- Your own uploads, in a community you are active in.
  if v_user = auth.uid() then
    return is_member(v_community);
  end if;

  -- Someone else's: only the photo their profile currently uses, and only if
  -- their identity is one you may see. A replaced photo is not readable by
  -- anyone but its owner, even for the moment before it is cleaned up.
  return exists (
    select 1 from community_profiles cp
    where cp.community_id = v_community
      and cp.user_id = v_user
      and cp.avatar_path = p_name
  ) and can_view_community_identity(v_community, v_user);
end;
$$;

-- ── Who may call what ───────────────────────────────────────────────────

revoke all on function public.message_mention_ids(text) from public, anon, authenticated, service_role;
revoke all on function public.mention_target_admits(text, uuid) from public, anon, authenticated, service_role;
revoke all on function public.messages_sync_mentions() from public, anon, authenticated, service_role;
revoke all on function public.notifications_guard_immutable() from public, anon, authenticated, service_role;
revoke all on function public.can_read_notified_message(uuid) from public, anon, authenticated, service_role;
revoke all on function public.search_channel_mention_candidates(text, text) from public, anon, authenticated, service_role;
revoke all on function public.community_identity_admits(uuid, text, uuid) from public, anon, authenticated, service_role;
revoke all on function public.can_view_community_identity(text, uuid) from public, anon, authenticated, service_role;
revoke all on function public.community_identities(text, uuid[]) from public, anon, authenticated, service_role;
revoke all on function public.channel_person_card(text, uuid) from public, anon, authenticated, service_role;

grant execute on function public.can_read_notified_message(uuid) to authenticated;
grant execute on function public.search_channel_mention_candidates(text, text) to authenticated;
grant execute on function public.can_view_community_identity(text, uuid) to authenticated;
grant execute on function public.community_identities(text, uuid[]) to authenticated;
grant execute on function public.channel_person_card(text, uuid) to authenticated;
