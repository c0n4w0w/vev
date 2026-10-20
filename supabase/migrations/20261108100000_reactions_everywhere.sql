-- Reactions in every conversation, and who may see who reacted.
--
-- ── What changes ────────────────────────────────────────────────────────
--
-- Channel messages (`messages`: community channels, lokallag main chats,
-- private lokallag channels and group chats) and direct messages gain real
-- reactions: one row per person per emoji per message, added and withdrawn
-- through set_reaction(). Feed posts keep `post_reactions` and go through the
-- same function.
--
-- Until now `messages.reactions` was a seeded list of {emoji, userIds} that no
-- one could change, and `posts.reactions` was derived with every reactor's
-- account id in it. Both columns were readable by everyone who could read the
-- message or the post — so the identity of everyone who reacted travelled to
-- every reader's browser, whatever the screen drew. `post_reactions` could
-- also be listed whole by any reader.
--
-- From here on three things are kept apart:
--
--   counts        `reactions` on messages, direct_messages and posts:
--                 [{emoji, emojiId, name, count}], derived by trigger, never
--                 an account id. Readable exactly where the parent row is.
--   your own      each reaction table's SELECT policy admits the caller's own
--                 rows only (and only while the parent is readable), so a
--                 reader can tell which chips are theirs and nothing else.
--   who reacted   reaction_authors() alone, which decides per request whether
--                 the caller may see names (reaction_authors_admit) and then
--                 returns community display names — no ids, no photos.
--
-- ── Who may see who reacted ─────────────────────────────────────────────
--
--   community channel and community-wide post
--                         `communities.reaction_author_visibility`:
--                         'moderators' — the community's admins and moderators;
--                         'channel'    — everyone who can read it.
--   lokallag main chat, private lokallag channel, group chat, lokallag- or
--   group-scoped post     everyone who can read it now.
--   direct message        its two participants.
--
-- The setting only ever widens the one case it names; it never grants access
-- to a conversation, and private scopes are not narrowed by it. Moderators
-- gain nothing in conversations they cannot already read. It is evaluated on
-- every request, so changing it applies to every reaction at once, old or new.
--
-- Default 'moderators', and 'channel' for a community whose member directory
-- is already open to its members (member_directory_visibility = 'members'),
-- where knowing who is a member is not the sensitive fact. The seed and the
-- bootstrap write the value explicitly.
--
-- Names are given only for reactors who are still active members and can
-- still read that conversation; anyone else is counted but not named, so a
-- reaction never names someone who has since left.
--
-- ── Writing ─────────────────────────────────────────────────────────────
--
-- set_reaction(kind, id, emoji | emoji_id, on): `on` is the state asked for,
-- not a toggle, so a repeated or concurrent request lands on the same answer.
-- It finds the parent by id and asks its own conversation: readable now, not
-- deleted, not expired; a channel not archived; a direct conversation the
-- caller may still reply in. A custom emoji must belong to the parent's own
-- community. Read-only (announcement) channels take reactions from everyone
-- who reads them, as they always displayed them. At most 20 different
-- reactions per person per message. It returns the parent's fresh counts.
--
-- Deleting or moderating a message removes its reactions; a disappearing
-- direct message's reactions are unreadable the moment it expires and are
-- deleted with it. A deleted custom emoji takes its reactions with it.

-- ── The setting ─────────────────────────────────────────────────────────

create type public.reaction_author_visibility as enum ('moderators', 'channel');

alter table public.communities
  add column reaction_author_visibility public.reaction_author_visibility not null default 'moderators';

comment on column public.communities.reaction_author_visibility is
  'Who may see who reacted in this community''s own channels and community-wide posts: its admins and moderators, or everyone who can read them. Private scopes and direct messages are unaffected.';

update public.communities
   set reaction_author_visibility = 'channel'
 where member_directory_visibility = 'members';

create or replace function public.set_community_reaction_visibility(p_community_id text, p_value text)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_stored public.reaction_author_visibility;
begin
  if auth.uid() is null or not is_admin(p_community_id) or p_value not in ('moderators', 'channel') then
    return null;
  end if;

  update communities
     set reaction_author_visibility = p_value::public.reaction_author_visibility
   where id = p_community_id
  returning reaction_author_visibility into v_stored;

  return v_stored::text;
end;
$$;

comment on function public.set_community_reaction_visibility(text, text) is
  'An active admin of the community sets who may see who reacted in its own channels. Null for anyone else or an unknown value.';

-- ── What a built-in reaction may be ─────────────────────────────────────
--
-- The application checks against the Unicode emoji list; this is the floor
-- under it for anything else that writes: short, no letters, spaces, control
-- characters or markup, and at least one character outside ASCII. The
-- constraints spell it out rather than call this function, because a CHECK
-- runs with the inserting role's own privileges and no API role may call it.

create or replace function public.reaction_emoji_shape_ok(p_emoji text)
returns boolean language sql immutable set search_path = public as $$
  select p_emoji is not null
     and length(p_emoji) between 1 and 16
     and p_emoji !~ '[[:space:][:cntrl:]A-Za-z<>&"''\\]'
     and p_emoji ~ '[^\x01-\x7f]';
$$;

-- ── Channel message reactions ───────────────────────────────────────────

create table public.message_reactions (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.messages (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  emoji text,
  emoji_id uuid references public.community_emojis (id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint message_reactions_one_kind check (num_nonnulls(emoji, emoji_id) = 1),
  constraint message_reactions_emoji_shape check (
    emoji is null or (length(emoji) between 1 and 16 and emoji !~ '[[:space:][:cntrl:]A-Za-z<>&"''\\]' and emoji ~ '[^\x01-\x7f]')
  )
);

create unique index message_reactions_unique_key
  on public.message_reactions (message_id, user_id, coalesce(emoji_id::text, emoji));
create index message_reactions_message_idx on public.message_reactions (message_id, created_at);
create index message_reactions_user_idx on public.message_reactions (user_id);
create index message_reactions_emoji_idx on public.message_reactions (emoji_id) where emoji_id is not null;

comment on table public.message_reactions is
  'One row per person per emoji per channel message. Written only by set_reaction(); a member reads their own rows, the counts on messages.reactions, and names only through reaction_authors().';

alter table public.message_reactions enable row level security;

-- Your own, while the message is one you can read (messages' own policy
-- decides, inside the subquery).
create policy message_reactions_select_own on public.message_reactions for select to authenticated
  using (
    user_id = auth.uid()
    and exists (select 1 from messages m where m.id = message_id and m.deleted_at is null)
  );

-- ── Direct message reactions ────────────────────────────────────────────

create table public.direct_message_reactions (
  id uuid primary key default gen_random_uuid(),
  direct_message_id uuid not null references public.direct_messages (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  emoji text,
  emoji_id uuid references public.community_emojis (id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint direct_message_reactions_one_kind check (num_nonnulls(emoji, emoji_id) = 1),
  constraint direct_message_reactions_emoji_shape check (
    emoji is null or (length(emoji) between 1 and 16 and emoji !~ '[[:space:][:cntrl:]A-Za-z<>&"''\\]' and emoji ~ '[^\x01-\x7f]')
  )
);

create unique index direct_message_reactions_unique_key
  on public.direct_message_reactions (direct_message_id, user_id, coalesce(emoji_id::text, emoji));
create index direct_message_reactions_message_idx on public.direct_message_reactions (direct_message_id, created_at);
create index direct_message_reactions_user_idx on public.direct_message_reactions (user_id);
create index direct_message_reactions_emoji_idx on public.direct_message_reactions (emoji_id) where emoji_id is not null;

comment on table public.direct_message_reactions is
  'One row per person per emoji per direct message. Written only by set_reaction(); readable by its own author while the message is (direct_messages_select: not cleared, not expired).';

alter table public.direct_message_reactions enable row level security;

create policy direct_message_reactions_select_own on public.direct_message_reactions for select to authenticated
  using (
    user_id = auth.uid()
    and exists (select 1 from direct_messages dm where dm.id = direct_message_id and dm.deleted_at is null)
  );

alter table public.direct_messages
  add column reactions jsonb not null default '[]'::jsonb;

comment on column public.direct_messages.reactions is
  'Counts per emoji, [{emoji, emojiId, name, count}], derived from direct_message_reactions. Never an account id.';

-- ── Feed reactions: your own rows only ──────────────────────────────────

drop policy post_reactions_select on public.post_reactions;
create policy post_reactions_select on public.post_reactions for select to authenticated
  using (user_id = auth.uid() and can_access_post(post_id));

alter table public.post_reactions
  add constraint post_reactions_emoji_shape check (
    emoji is null or (length(emoji) between 1 and 16 and emoji !~ '[[:space:][:cntrl:]A-Za-z<>&"''\\]' and emoji ~ '[^\x01-\x7f]')
  ) not valid;

-- ── Counts ──────────────────────────────────────────────────────────────
--
-- In order of each emoji's first reaction, so chips keep their place as
-- people add to them.

create or replace function public.message_reaction_counts(p_message_id uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(g.entry order by g.first_at, g.key), '[]'::jsonb)
  from (
    select jsonb_build_object('emoji', r.emoji, 'emojiId', r.emoji_id, 'name', e.name, 'count', count(*)) as entry,
           min(r.created_at) as first_at,
           coalesce(r.emoji_id::text, r.emoji) as key
    from message_reactions r
    left join community_emojis e on e.id = r.emoji_id
    where r.message_id = p_message_id
    group by r.emoji, r.emoji_id, e.name
  ) g;
$$;

create or replace function public.direct_message_reaction_counts(p_message_id uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(g.entry order by g.first_at, g.key), '[]'::jsonb)
  from (
    select jsonb_build_object('emoji', r.emoji, 'emojiId', r.emoji_id, 'name', e.name, 'count', count(*)) as entry,
           min(r.created_at) as first_at,
           coalesce(r.emoji_id::text, r.emoji) as key
    from direct_message_reactions r
    left join community_emojis e on e.id = r.emoji_id
    where r.direct_message_id = p_message_id
    group by r.emoji, r.emoji_id, e.name
  ) g;
$$;

create or replace function public.post_reaction_counts(p_post_id uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(g.entry order by g.first_at, g.key), '[]'::jsonb)
  from (
    select jsonb_build_object('emoji', r.emoji, 'emojiId', r.emoji_id, 'name', e.name, 'count', count(*)) as entry,
           min(r.created_at) as first_at,
           coalesce(r.emoji_id::text, r.emoji) as key
    from post_reactions r
    left join community_emojis e on e.id = r.emoji_id
    where r.post_id = p_post_id
    group by r.emoji, r.emoji_id, e.name
  ) g;
$$;

-- Each sync takes the parent row's lock in a statement of its own before it
-- counts. A plain UPDATE counts with the snapshot its statement started with,
-- so two reactions committed at the same moment could each overwrite the
-- other's count; after the lock, the counting statement sees both. FOR NO KEY
-- UPDATE does not conflict with the key-share lock each insert's foreign key
-- holds on the same row, so two concurrent reactions queue instead of
-- deadlocking.

create or replace function public.sync_message_reactions()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_id uuid := coalesce(new.message_id, old.message_id);
begin
  perform 1 from messages m where m.id = v_id for no key update;
  update messages
     set reactions = message_reaction_counts(v_id)
   where id = v_id and deleted_at is null;
  return null;
end;
$$;

create or replace function public.sync_direct_message_reactions()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_id uuid := coalesce(new.direct_message_id, old.direct_message_id);
begin
  perform 1 from direct_messages dm where dm.id = v_id for no key update;
  -- A deleted or expired message is frozen (direct_messages_guard); its
  -- reactions are leaving with it.
  update direct_messages
     set reactions = direct_message_reaction_counts(v_id)
   where id = v_id
     and deleted_at is null
     and (expires_at is null or expires_at > now());
  return null;
end;
$$;

create or replace function public.sync_post_reactions()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_id uuid := coalesce(new.post_id, old.post_id);
begin
  perform 1 from posts p where p.id = v_id for no key update;
  update posts
     set reactions = post_reaction_counts(v_id)
   where id = v_id;
  return null;
end;
$$;

create trigger message_reactions_sync
  after insert or delete on public.message_reactions
  for each row execute function public.sync_message_reactions();

create trigger direct_message_reactions_sync
  after insert or delete on public.direct_message_reactions
  for each row execute function public.sync_direct_message_reactions();

-- post_reactions_sync already calls sync_post_reactions().

create or replace function public.resync_posts_after_emoji_delete()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update posts p
     set reactions = post_reaction_counts(p.id)
   where p.community_id = old.community_id
     and p.reactions <> '[]'::jsonb;
  return null;
end;
$$;

-- ── A deleted message takes its reactions ───────────────────────────────

create or replace function public.messages_drop_reactions()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  delete from message_reactions r where r.message_id = new.id;
  return null;
end;
$$;

create trigger messages_drop_reactions
  after update of deleted_at on public.messages
  for each row
  when (new.deleted_at is not null and old.deleted_at is null)
  execute function public.messages_drop_reactions();

create or replace function public.direct_messages_clear_reactions()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.deleted_at is not null and old.deleted_at is null then
    new.reactions := '[]'::jsonb;
  end if;
  return new;
end;
$$;

create trigger direct_messages_clear_reactions
  before update of deleted_at on public.direct_messages
  for each row execute function public.direct_messages_clear_reactions();

create or replace function public.direct_messages_drop_reactions()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  delete from direct_message_reactions r where r.direct_message_id = new.id;
  return null;
end;
$$;

create trigger direct_messages_drop_reactions
  after update of deleted_at on public.direct_messages
  for each row
  when (new.deleted_at is not null and old.deleted_at is null)
  execute function public.direct_messages_drop_reactions();

-- ── Who may see what ────────────────────────────────────────────────────

-- Whether this person may read this reaction's parent now: the same question
-- the parent's own policy asks.
create or replace function public.reaction_target_readable(p_viewer uuid, p_kind text, p_target_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select p_viewer is not null and case p_kind
    when 'message' then exists (
      select 1 from messages m join channels c on c.id = m.channel_id
      where m.id = p_target_id and m.deleted_at is null
        and channel_access_admits(p_viewer, c.community_id, c.local_group_id, c.subgroup_id, c.id, c.is_private)
    )
    when 'direct' then exists (
      select 1 from direct_messages dm
      where dm.id = p_target_id and dm.deleted_at is null
        and (dm.expires_at is null or dm.expires_at > now())
        and direct_message_visible_to(p_viewer, dm.conversation_id, dm.seq)
    )
    when 'post' then exists (
      select 1 from posts p
      where p.id = p_target_id
        and content_scope_admits(p_viewer, p.community_id, p.local_group_id, p.subgroup_id)
    )
    else false
  end;
$$;

-- Whether this person may see who reacted to it.
create or replace function public.reaction_authors_admit(p_viewer uuid, p_kind text, p_target_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select reaction_target_readable(p_viewer, p_kind, p_target_id) and case p_kind
    when 'direct' then true
    when 'message' then exists (
      select 1 from messages m
      join channels c on c.id = m.channel_id
      join communities co on co.id = c.community_id
      where m.id = p_target_id
        and (
          c.is_private or c.local_group_id is not null or c.subgroup_id is not null
          or co.reaction_author_visibility = 'channel'
          or exists (
            select 1 from memberships mm
            where mm.community_id = c.community_id and mm.user_id = p_viewer
              and mm.status = 'active' and mm.role in ('admin', 'moderator')
          )
        )
    )
    when 'post' then exists (
      select 1 from posts p
      join communities co on co.id = p.community_id
      where p.id = p_target_id
        and (
          p.local_group_id is not null or p.subgroup_id is not null
          or co.reaction_author_visibility = 'channel'
          or exists (
            select 1 from memberships mm
            where mm.community_id = p.community_id and mm.user_id = p_viewer
              and mm.status = 'active' and mm.role in ('admin', 'moderator')
          )
        )
    )
    else false
  end;
$$;

-- For the channel page: whether names are offered on its reactions at all.
-- Presentation only; reaction_authors() asks reaction_authors_admit again.
create or replace function public.channel_reaction_authors_visible(p_channel_id text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from channels c
    join communities co on co.id = c.community_id
    where c.id = p_channel_id
      and channel_access_admits(auth.uid(), c.community_id, c.local_group_id, c.subgroup_id, c.id, c.is_private)
      and (
        c.is_private or c.local_group_id is not null or c.subgroup_id is not null
        or co.reaction_author_visibility = 'channel'
        or can_moderate(c.community_id)
      )
  );
$$;

-- ── The caller's view of one parent's reactions ─────────────────────────

create or replace function public.reaction_view(p_viewer uuid, p_kind text, p_target_id uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  with rows as (
    select r.emoji, r.emoji_id, r.user_id, r.created_at from message_reactions r
     where p_kind = 'message' and r.message_id = p_target_id
    union all
    select r.emoji, r.emoji_id, r.user_id, r.created_at from direct_message_reactions r
     where p_kind = 'direct' and r.direct_message_id = p_target_id
    union all
    select r.emoji, r.emoji_id, r.user_id, r.created_at from post_reactions r
     where p_kind = 'post' and r.post_id = p_target_id
  )
  select coalesce(jsonb_agg(g.entry order by g.first_at, g.key), '[]'::jsonb)
  from (
    select jsonb_build_object(
             'emoji', r.emoji, 'emojiId', r.emoji_id, 'name', e.name,
             'count', count(*), 'mine', bool_or(r.user_id = p_viewer)
           ) as entry,
           min(r.created_at) as first_at,
           coalesce(r.emoji_id::text, r.emoji) as key
    from rows r
    left join community_emojis e on e.id = r.emoji_id
    group by r.emoji, r.emoji_id, e.name
  ) g;
$$;

-- ── Adding and withdrawing ──────────────────────────────────────────────

create or replace function public.set_reaction(
  p_kind text,
  p_target_id uuid,
  p_emoji text,
  p_emoji_id uuid,
  p_on boolean
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_emoji text := nullif(btrim(coalesce(p_emoji, '')), '');
  v_community text;
  v_archived boolean := false;
  v_conversation uuid;
  v_mine integer;
begin
  if v_user is null or p_target_id is null or p_kind not in ('message', 'direct', 'post') then
    raise exception 'reaction_error:not_found' using errcode = 'insufficient_privilege';
  end if;
  if p_on is null or (v_emoji is null) = (p_emoji_id is null)
     or (v_emoji is not null and not reaction_emoji_shape_ok(v_emoji)) then
    raise exception 'reaction_error:invalid' using errcode = 'check_violation';
  end if;

  -- The parent, locked, under the same rules its readers meet. Anything the
  -- caller cannot read is the same "not found" as an id that is no one's.
  if p_kind = 'message' then
    select c.community_id, c.archived_at is not null into v_community, v_archived
      from messages m join channels c on c.id = m.channel_id
     where m.id = p_target_id and m.deleted_at is null
       and channel_access_admits(v_user, c.community_id, c.local_group_id, c.subgroup_id, c.id, c.is_private)
       for no key update of m;
  elsif p_kind = 'direct' then
    select dc.community_id, dc.id into v_community, v_conversation
      from direct_messages dm join direct_conversations dc on dc.id = dm.conversation_id
     where dm.id = p_target_id and dm.deleted_at is null
       and (dm.expires_at is null or dm.expires_at > now())
       and direct_message_visible_to(v_user, dm.conversation_id, dm.seq)
       for no key update of dm;
  else
    select p.community_id into v_community
      from posts p
     where p.id = p_target_id
       and content_scope_admits(v_user, p.community_id, p.local_group_id, p.subgroup_id)
       for no key update of p;
  end if;

  if v_community is null then
    raise exception 'reaction_error:not_found' using errcode = 'insufficient_privilege';
  end if;
  if v_archived then
    raise exception 'reaction_error:archived' using errcode = 'check_violation';
  end if;
  if v_conversation is not null and not can_reply_direct_conversation(v_conversation) then
    raise exception 'reaction_error:closed' using errcode = 'insufficient_privilege';
  end if;
  if p_emoji_id is not null and not exists (
    select 1 from community_emojis e where e.id = p_emoji_id and e.community_id = v_community
  ) then
    raise exception 'reaction_error:other_community' using errcode = 'check_violation';
  end if;

  if p_on then
    select count(*) into v_mine from (
      select 1 from message_reactions r where p_kind = 'message' and r.message_id = p_target_id and r.user_id = v_user
      union all
      select 1 from direct_message_reactions r where p_kind = 'direct' and r.direct_message_id = p_target_id and r.user_id = v_user
      union all
      select 1 from post_reactions r where p_kind = 'post' and r.post_id = p_target_id and r.user_id = v_user
    ) x;
    if v_mine >= 20 then
      raise exception 'reaction_error:too_many' using errcode = 'check_violation';
    end if;

    if p_kind = 'message' then
      insert into message_reactions (message_id, user_id, emoji, emoji_id)
      values (p_target_id, v_user, v_emoji, p_emoji_id) on conflict do nothing;
    elsif p_kind = 'direct' then
      insert into direct_message_reactions (direct_message_id, user_id, emoji, emoji_id)
      values (p_target_id, v_user, v_emoji, p_emoji_id) on conflict do nothing;
    else
      insert into post_reactions (post_id, user_id, emoji, emoji_id)
      values (p_target_id, v_user, v_emoji, p_emoji_id) on conflict do nothing;
    end if;
  else
    if p_kind = 'message' then
      delete from message_reactions r
       where r.message_id = p_target_id and r.user_id = v_user
         and (r.emoji = v_emoji or r.emoji_id = p_emoji_id);
    elsif p_kind = 'direct' then
      delete from direct_message_reactions r
       where r.direct_message_id = p_target_id and r.user_id = v_user
         and (r.emoji = v_emoji or r.emoji_id = p_emoji_id);
    else
      delete from post_reactions r
       where r.post_id = p_target_id and r.user_id = v_user
         and (r.emoji = v_emoji or r.emoji_id = p_emoji_id);
    end if;
  end if;

  return reaction_view(v_user, p_kind, p_target_id);
end;
$$;

comment on function public.set_reaction(text, uuid, text, uuid, boolean) is
  'Adds (p_on) or withdraws the caller''s reaction — a Unicode emoji or a custom emoji of the parent''s own community — on a channel message, direct message or post they may read and write in now. Idempotent. Returns the parent''s counts and which are the caller''s.';

-- ── Who reacted ─────────────────────────────────────────────────────────

-- The rows behind one chip. Internal: callable only from the functions below.
create or replace function public.reaction_rows(p_kind text, p_target_id uuid, p_emoji text, p_emoji_id uuid)
returns table (user_id uuid, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select r.user_id, r.created_at from message_reactions r
   where p_kind = 'message' and r.message_id = p_target_id and (r.emoji = p_emoji or r.emoji_id = p_emoji_id)
  union all
  select r.user_id, r.created_at from direct_message_reactions r
   where p_kind = 'direct' and r.direct_message_id = p_target_id and (r.emoji = p_emoji or r.emoji_id = p_emoji_id)
  union all
  select r.user_id, r.created_at from post_reactions r
   where p_kind = 'post' and r.post_id = p_target_id and (r.emoji = p_emoji or r.emoji_id = p_emoji_id);
$$;

create or replace function public.reaction_authors(
  p_kind text,
  p_target_id uuid,
  p_emoji text,
  p_emoji_id uuid
)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_emoji text := nullif(btrim(coalesce(p_emoji, '')), '');
  v_community text;
  v_total integer;
  v_mine boolean;
  v_people jsonb;
  v_named integer;
begin
  if (v_emoji is null) = (p_emoji_id is null) or not reaction_target_readable(v_user, p_kind, p_target_id) then
    return null;
  end if;

  select count(*)::integer, coalesce(bool_or(x.user_id = v_user), false) into v_total, v_mine
    from reaction_rows(p_kind, p_target_id, v_emoji, p_emoji_id) x;

  if not reaction_authors_admit(v_user, p_kind, p_target_id) then
    return jsonb_build_object('visible', false, 'total', v_total, 'mine', v_mine);
  end if;

  v_community := case p_kind
    when 'message' then (select c.community_id from messages m join channels c on c.id = m.channel_id where m.id = p_target_id)
    when 'direct' then (select dc.community_id from direct_messages dm join direct_conversations dc on dc.id = dm.conversation_id where dm.id = p_target_id)
    else (select p.community_id from posts p where p.id = p_target_id)
  end;

  -- Named: still an active member, with a profile here, who can still read
  -- this conversation. The caller first, then in the order they reacted.
  with named as (
    select x.user_id, x.created_at, cp.display_name
    from reaction_rows(p_kind, p_target_id, v_emoji, p_emoji_id) x
    join community_profiles cp on cp.community_id = v_community and cp.user_id = x.user_id
    where exists (
      select 1 from memberships m
      where m.community_id = v_community and m.user_id = x.user_id and m.status = 'active'
    )
      and reaction_target_readable(x.user_id, p_kind, p_target_id)
  ),
  shown as (
    select * from named order by (user_id = v_user) desc, created_at, user_id limit 30
  )
  select (select count(*)::integer from named),
         coalesce(
           (select jsonb_agg(jsonb_build_object('name', s.display_name, 'me', s.user_id = v_user)
                             order by (s.user_id = v_user) desc, s.created_at, s.user_id)
              from shown s),
           '[]'::jsonb)
    into v_named, v_people;

  return jsonb_build_object(
    'visible', true,
    'total', v_total,
    'mine', v_mine,
    'people', v_people,
    'unnamed', v_total - least(v_named, 30)
  );
end;
$$;

comment on function public.reaction_authors(text, uuid, text, uuid) is
  'Who reacted with one emoji to a channel message, direct message or post the caller can read: their community display names (at most 30, the caller first), if reaction_authors_admit lets the caller see them; otherwise only the count. Null for anything the caller cannot read.';

-- ── Carrying over what was already there ────────────────────────────────
--
-- The seeded {emoji, userIds} lists become rows, for the people who still
-- exist and can still read the channel; their order is kept. Every message's
-- counts are then rebuilt from the rows.

insert into public.message_reactions (message_id, user_id, emoji, created_at)
select m.id, u.value::uuid, e.value->>'emoji', m.created_at + make_interval(secs => (e.ordinality * 100 + u.ordinality)::double precision)
from public.messages m
join public.channels c on c.id = m.channel_id
cross join lateral jsonb_array_elements(case when jsonb_typeof(m.reactions) = 'array' then m.reactions else '[]'::jsonb end)
  with ordinality as e(value, ordinality)
cross join lateral jsonb_array_elements_text(
  case when jsonb_typeof(e.value->'userIds') = 'array' then e.value->'userIds' else '[]'::jsonb end
) with ordinality as u(value, ordinality)
where m.deleted_at is null
  and reaction_emoji_shape_ok(e.value->>'emoji')
  and u.value ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  and exists (select 1 from public.profiles p where p.id = u.value::uuid)
  and public.channel_access_admits(u.value::uuid, c.community_id, c.local_group_id, c.subgroup_id, c.id, c.is_private)
on conflict do nothing;

update public.messages m
   set reactions = public.message_reaction_counts(m.id)
 where m.deleted_at is null
   and m.reactions is distinct from public.message_reaction_counts(m.id);

-- Posts: the same rebuild, without account ids. posts_guard_immutable lets
-- only a nested trigger write this column, and no trigger fires on a
-- migration's own statement, so the guard steps aside for this one
-- statement, inside this migration's transaction.
alter table public.posts disable trigger posts_immutable;
update public.posts p set reactions = public.post_reaction_counts(p.id)
 where p.reactions is distinct from public.post_reaction_counts(p.id);
alter table public.posts enable trigger posts_immutable;

-- ── Who may call what ───────────────────────────────────────────────────

revoke all on table public.message_reactions from public, anon, authenticated, service_role;
revoke all on table public.direct_message_reactions from public, anon, authenticated, service_role;
grant select on public.message_reactions to authenticated;
grant select on public.direct_message_reactions to authenticated;
grant select, insert, update, delete on public.message_reactions to service_role;
grant select, insert, update, delete on public.direct_message_reactions to service_role;

revoke all on function public.set_community_reaction_visibility(text, text) from public, anon, authenticated, service_role;
revoke all on function public.reaction_emoji_shape_ok(text) from public, anon, authenticated, service_role;
revoke all on function public.message_reaction_counts(uuid) from public, anon, authenticated, service_role;
revoke all on function public.direct_message_reaction_counts(uuid) from public, anon, authenticated, service_role;
revoke all on function public.post_reaction_counts(uuid) from public, anon, authenticated, service_role;
revoke all on function public.sync_message_reactions() from public, anon, authenticated, service_role;
revoke all on function public.sync_direct_message_reactions() from public, anon, authenticated, service_role;
revoke all on function public.sync_post_reactions() from public, anon, authenticated, service_role;
revoke all on function public.resync_posts_after_emoji_delete() from public, anon, authenticated, service_role;
revoke all on function public.messages_drop_reactions() from public, anon, authenticated, service_role;
revoke all on function public.direct_messages_clear_reactions() from public, anon, authenticated, service_role;
revoke all on function public.direct_messages_drop_reactions() from public, anon, authenticated, service_role;
revoke all on function public.reaction_target_readable(uuid, text, uuid) from public, anon, authenticated, service_role;
revoke all on function public.reaction_authors_admit(uuid, text, uuid) from public, anon, authenticated, service_role;
revoke all on function public.channel_reaction_authors_visible(text) from public, anon, authenticated, service_role;
revoke all on function public.reaction_view(uuid, text, uuid) from public, anon, authenticated, service_role;
revoke all on function public.reaction_rows(text, uuid, text, uuid) from public, anon, authenticated, service_role;
revoke all on function public.set_reaction(text, uuid, text, uuid, boolean) from public, anon, authenticated, service_role;
revoke all on function public.reaction_authors(text, uuid, text, uuid) from public, anon, authenticated, service_role;

grant execute on function public.set_community_reaction_visibility(text, text) to authenticated;
grant execute on function public.channel_reaction_authors_visible(text) to authenticated;
grant execute on function public.set_reaction(text, uuid, text, uuid, boolean) to authenticated;
grant execute on function public.reaction_authors(text, uuid, text, uuid) to authenticated;
