-- Polls ("Avstemning") in community channels and group chats.
--
-- ── What a poll is ──────────────────────────────────────────────────────
--
-- A poll is a channel message with a question and 2–10 options. The message
-- (`messages`, body = the question) keeps its place in the channel's history
-- like any other: same ordering, same loading, same pin, same delete. The
-- poll itself lives beside it:
--
--   channel_polls          one row per poll message: the question, whether
--                          votes are anonymous or visible, and when and by
--                          whom it was closed
--   channel_poll_options   its options, in order
--   channel_poll_votes     one row per person per poll: which option they
--                          chose. Single choice, changed in place.
--
-- Only `messages` has channel messages, so a poll can never be in a direct
-- message (direct_messages) or a collaboration channel: there is nothing for
-- it to point at.
--
-- ── Who may create one ──────────────────────────────────────────────────
--
-- channel_poll_create_admits(), from the existing rules only:
--
--   the channel           readable by the caller now (channel_access_admits,
--                         the one channel access rule) and not archived
--   the caller            an active member of the channel's own community who
--                         is its admin or moderator (memberships.role); or
--                         gruppeansvarlig (community_subgroup_managers) of
--                         exactly the group whose chat this is; or an
--                         effective lokallagsleder (local_group_manage_admits)
--                         of exactly the lokallag whose main chat this is
--
-- A gruppeansvarlig mark and a lokallag leadership are each for one group:
-- they give nothing in a community channel, another group's or lokallag's
-- chat, or a private channel under the lokallag (those have their own
-- managers). A moderator who cannot read a group's chat (no moderators_read)
-- cannot create a poll there either. A restricted (read_only) channel takes
-- polls from admins and moderators only, as it takes messages. Nothing the
-- caller sends names a role or a group: both are looked up from the channel
-- id.
--
-- ── Anonymous or visible ────────────────────────────────────────────────
--
-- The creator chooses, once (`visibility`, immutable):
--
--   'anonymous'  the default. No function names a voter to anyone — not the
--                creator, the channel's moderators or the community's admins.
--                The vote rows still hold account ids: whoever operates the
--                database can see them. Anonymity is from other members.
--   'visible'    channel_poll_voters() names who chose an option, to someone
--                who can read the channel and may see results. A voter is
--                named only while they are an active member who can still
--                read the channel, and only if the viewer may already see
--                their identity in this community
--                (can_view_community_identity: the member directory where
--                the community opens it, otherwise shared authorship, a
--                mention, a shared group or private channel). Anyone else is
--                counted, not named. Community display names only — never an
--                account id, a global name or an email address.
--
-- ── Voting ──────────────────────────────────────────────────────────────
--
-- Everyone who can read the channel now may vote while the poll is open and
-- the channel is not archived — announcement channels included, as they take
-- reactions from everyone who reads them. One vote per person per poll
-- (primary key), an option of that poll only (composite foreign key), and
-- never on a closed poll (vote_channel_poll and a trigger on the table).
--
-- ── Who sees what ───────────────────────────────────────────────────────
--
--   the poll and options  readable exactly where the channel is
--   your own vote         channel_poll_votes' SELECT policy admits the
--                         caller's own row only
--   counts                channel_poll_states() alone: per option, and the
--                         total. Per-option counts — and, on a visible poll,
--                         the voter lists — are given once the caller has
--                         voted or the poll is closed. Nobody is excepted:
--                         not the creator, not moderators. The total always.
--
-- No table is in a realtime publication. Someone who loses access to the
-- channel loses the poll with it; their vote is still counted.
--
-- ── Closing ─────────────────────────────────────────────────────────────
--
-- The poll's creator (the message's author, while they can still read the
-- channel), or whoever moderates the channel's messages
-- (channel_message_moderate_admits: admins and moderators in community
-- channels, admins and lokallag leaders in a lokallag chat, managers of a
-- private channel or group in theirs). Closing is final; a closed poll stays
-- readable with its results.
--
-- ── With the message ────────────────────────────────────────────────────
--
-- Deleting or moderating the message removes the poll, its options and its
-- votes. A poll's question cannot be edited: the message's text is refused
-- while it carries a poll.

-- ── Tables ──────────────────────────────────────────────────────────────

create table public.channel_polls (
  message_id uuid primary key,
  channel_id text not null,
  question text not null,
  visibility text not null default 'anonymous',
  created_at timestamptz not null default now(),
  closed_at timestamptz,
  closed_by uuid references public.profiles (id) on delete set null,

  foreign key (message_id, channel_id) references public.messages (id, channel_id) on delete cascade,
  constraint channel_polls_question_valid check (
    question = btrim(question) and length(question) between 1 and 300 and question !~ '[[:cntrl:]]'
  ),
  constraint channel_polls_closed_shape check (closed_at is not null or closed_by is null),
  constraint channel_polls_visibility_valid check (visibility in ('anonymous', 'visible'))
);

create index channel_polls_channel_idx on public.channel_polls (channel_id, created_at);

comment on column public.channel_polls.visibility is
  'anonymous: no one is told who voted for what. visible: channel_poll_voters() names voters to those allowed. Chosen at creation, never changed.';

comment on table public.channel_polls is
  'A poll on one channel message (body = question). Written only by create_channel_poll() and close_channel_poll(); readable where the channel is.';

create table public.channel_poll_options (
  id uuid primary key default gen_random_uuid(),
  poll_id uuid not null references public.channel_polls (message_id) on delete cascade,
  position smallint not null,
  label text not null,

  unique (poll_id, position),
  unique (id, poll_id),
  constraint channel_poll_options_position_range check (position between 0 and 9),
  constraint channel_poll_options_label_valid check (
    label = btrim(label) and length(label) between 1 and 120 and label !~ '[[:cntrl:]]'
  )
);

create unique index channel_poll_options_label_key on public.channel_poll_options (poll_id, lower(label));

comment on table public.channel_poll_options is
  'The 2–10 options of a channel poll, in order. Written only by create_channel_poll(); carries no counts.';

create table public.channel_poll_votes (
  poll_id uuid not null references public.channel_polls (message_id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  option_id uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  primary key (poll_id, user_id),
  -- The option must be one of this poll's.
  foreign key (option_id, poll_id) references public.channel_poll_options (id, poll_id) on delete cascade
);

create index channel_poll_votes_option_idx on public.channel_poll_votes (poll_id, option_id);
create index channel_poll_votes_user_idx on public.channel_poll_votes (user_id);

comment on table public.channel_poll_votes is
  'One single-choice vote per person per channel poll. Written only by vote_channel_poll(); a member reads their own row, and counts only through channel_poll_states(). Never names a voter to anyone else.';

-- ── Guards ──────────────────────────────────────────────────────────────
--
-- For every path, the service role and later functions included.

-- A poll's question and message are facts; closing is once and for good.
create or replace function public.channel_polls_guard()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.message_id is distinct from old.message_id
     or new.channel_id is distinct from old.channel_id
     or new.question is distinct from old.question
     or new.visibility is distinct from old.visibility
     or new.created_at is distinct from old.created_at
  then
    raise exception 'poll_error:immutable' using errcode = 'check_violation';
  end if;
  if old.closed_at is not null and new.closed_at is distinct from old.closed_at then
    raise exception 'poll_error:closed' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger channel_polls_guard
  before update on public.channel_polls
  for each row execute function public.channel_polls_guard();

create or replace function public.channel_poll_options_guard()
returns trigger language plpgsql set search_path = public as $$
begin
  raise exception 'poll_error:immutable' using errcode = 'check_violation';
end;
$$;

create trigger channel_poll_options_guard
  before update on public.channel_poll_options
  for each row execute function public.channel_poll_options_guard();

-- No vote lands on, or moves within, a closed poll.
create or replace function public.channel_poll_votes_guard()
returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'UPDATE' and (new.poll_id is distinct from old.poll_id or new.user_id is distinct from old.user_id) then
    raise exception 'poll_error:immutable' using errcode = 'check_violation';
  end if;
  if exists (select 1 from channel_polls p where p.message_id = new.poll_id and p.closed_at is not null) then
    raise exception 'poll_error:closed' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger channel_poll_votes_guard
  before insert or update on public.channel_poll_votes
  for each row execute function public.channel_poll_votes_guard();

-- The question is the message's text; it is not edited.
create or replace function public.messages_guard_poll_body()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.deleted_at is null
     and new.body is distinct from old.body
     and exists (select 1 from channel_polls p where p.message_id = old.id)
  then
    raise exception 'message_error:poll' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger messages_guard_poll_body
  before update of body on public.messages
  for each row execute function public.messages_guard_poll_body();

-- A deleted or moderated message takes its poll, options and votes with it.
create or replace function public.messages_drop_poll()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  delete from channel_polls p where p.message_id = new.id;
  return null;
end;
$$;

create trigger messages_drop_poll
  after update of deleted_at on public.messages
  for each row
  when (new.deleted_at is not null and old.deleted_at is null)
  execute function public.messages_drop_poll();

-- ── Reading ─────────────────────────────────────────────────────────────

alter table public.channel_polls enable row level security;
alter table public.channel_poll_options enable row level security;
alter table public.channel_poll_votes enable row level security;

create policy channel_polls_select on public.channel_polls for select to authenticated
  using (can_read_channel(channel_id));

-- channel_polls' own policy decides, inside the subquery.
create policy channel_poll_options_select on public.channel_poll_options for select to authenticated
  using (exists (select 1 from channel_polls p where p.message_id = poll_id));

create policy channel_poll_votes_select_own on public.channel_poll_votes for select to authenticated
  using (
    user_id = auth.uid()
    and exists (select 1 from channel_polls p where p.message_id = poll_id)
  );

-- ── Who may create, who may close ───────────────────────────────────────
--
-- Internal: these take a user id and are never granted to an API role.

create or replace function public.channel_poll_create_admits(p_user_id uuid, p_channel_id text)
returns boolean language sql stable security definer set search_path = public as $$
  select p_user_id is not null and exists (
    select 1
    from channels c
    join memberships m
      on m.community_id = c.community_id and m.user_id = p_user_id and m.status = 'active'
    where c.id = p_channel_id
      and c.archived_at is null
      and channel_access_admits(p_user_id, c.community_id, c.local_group_id, c.subgroup_id, c.id, c.is_private)
      and (
        m.role in ('admin', 'moderator')
        or (
          c.subgroup_id is not null
          and not c.read_only
          and exists (
            select 1 from community_subgroup_managers mg
            where mg.subgroup_id = c.subgroup_id
              and mg.community_id = c.community_id
              and mg.user_id = p_user_id
          )
        )
        or (
          c.local_group_id is not null
          and not c.is_private
          and not c.read_only
          and local_group_manage_admits(p_user_id, c.local_group_id)
        )
      )
  );
$$;

comment on function public.channel_poll_create_admits(uuid, text) is
  'Whether a user may create a poll in this channel: it is readable by them and not archived, and they are an active admin or moderator of its community, gruppeansvarlig of exactly the group whose chat it is, or an effective lokallagsleder of exactly the lokallag whose main chat it is (neither in a restricted channel). Internal; takes a user id.';

create or replace function public.channel_poll_close_admits(p_user_id uuid, p_message_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select p_user_id is not null and exists (
    select 1
    from channel_polls p
    join messages m on m.id = p.message_id
    join channels c on c.id = p.channel_id
    where p.message_id = p_message_id
      and m.deleted_at is null
      and channel_access_admits(p_user_id, c.community_id, c.local_group_id, c.subgroup_id, c.id, c.is_private)
      and (m.author_id = p_user_id or channel_message_moderate_admits(p_user_id, c.id))
  );
$$;

comment on function public.channel_poll_close_admits(uuid, uuid) is
  'Whether a user may close this poll: its creator, or whoever moderates the channel''s messages (channel_message_moderate_admits), while they can read the channel. Internal; takes a user id.';

-- Presentation only: every write asks again.
create or replace function public.can_create_channel_poll(p_channel_id text)
returns boolean language sql stable security definer set search_path = public as $$
  select channel_poll_create_admits(auth.uid(), p_channel_id);
$$;

comment on function public.can_create_channel_poll(text) is
  'Whether the caller may create a poll in this channel. Presentation only: create_channel_poll() asks again.';

-- ── One poll as the viewer sees it ──────────────────────────────────────
--
-- Internal. Null for a poll the viewer cannot read. Counts come from the
-- vote rows and never carry an account id.
create or replace function public.channel_poll_view(p_viewer uuid, p_message_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_poll channel_polls%rowtype;
  v_archived boolean;
  v_channel text;
  v_mine uuid;
  v_total integer;
  v_can_close boolean;
  v_results boolean;
  v_options jsonb;
begin
  select c.id, (c.archived_at is not null) into v_channel, v_archived
    from channel_polls p
    join messages m on m.id = p.message_id
    join channels c on c.id = p.channel_id
   where p.message_id = p_message_id
     and m.deleted_at is null
     and channel_access_admits(p_viewer, c.community_id, c.local_group_id, c.subgroup_id, c.id, c.is_private);
  if not found then
    return null;
  end if;
  select * into v_poll from channel_polls p where p.message_id = p_message_id;

  select v.option_id into v_mine from channel_poll_votes v where v.poll_id = v_poll.message_id and v.user_id = p_viewer;
  select count(*) into v_total from channel_poll_votes v where v.poll_id = v_poll.message_id;
  v_can_close := v_poll.closed_at is null and channel_poll_close_admits(p_viewer, v_poll.message_id);
  -- Results after one's own vote or once closed. No exception for the
  -- creator or for moderators.
  v_results := v_mine is not null or v_poll.closed_at is not null;

  select coalesce(jsonb_agg(
           jsonb_build_object(
             'id', o.id,
             'label', o.label,
             'count', case when v_results then coalesce(n.votes, 0) end
           ) order by o.position), '[]'::jsonb)
    into v_options
    from channel_poll_options o
    left join (
      select v.option_id, count(*)::integer as votes
        from channel_poll_votes v where v.poll_id = v_poll.message_id
       group by v.option_id
    ) n on n.option_id = o.id
   where o.poll_id = v_poll.message_id;

  return jsonb_build_object(
    'messageId', v_poll.message_id,
    'question', v_poll.question,
    'visibility', v_poll.visibility,
    'closedAt', v_poll.closed_at,
    'total', v_total,
    'myOptionId', v_mine,
    'resultsVisible', v_results,
    'canVote', v_poll.closed_at is null and not v_archived,
    'canClose', v_can_close,
    'options', v_options
  );
end;
$$;

-- The channel page's polls, or some of them: in the order they were asked.
-- An unreadable channel is the same empty list as one with no polls.
create or replace function public.channel_poll_states(p_channel_id text, p_message_ids uuid[])
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(v.view order by v.created_at), '[]'::jsonb)
  from (
    select channel_poll_view(auth.uid(), p.message_id) as view, p.created_at
    from channel_polls p
    where p.channel_id = p_channel_id
      and (p_message_ids is null or p.message_id = any (p_message_ids[1:200]))
  ) v
  where v.view is not null;
$$;

comment on function public.channel_poll_states(text, uuid[]) is
  'The caller''s view of the polls in one channel they can read (all, or the given message ids): question, mode, options, total, their own choice, per-option counts once they voted or it closed, and what they may do. Never who voted.';

-- ── Creating ────────────────────────────────────────────────────────────

create or replace function public.create_channel_poll(
  p_channel_id text,
  p_question text,
  p_options text[],
  p_visibility text default 'anonymous'
)
returns public.messages language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_visibility text := coalesce(p_visibility, 'anonymous');
  v_question text := btrim(coalesce(p_question, ''), E' \t\n\r');
  v_options text[];
  v_message messages%rowtype;
  i integer;
begin
  if v_user is null or p_channel_id is null or not can_read_channel(p_channel_id) then
    raise exception 'poll_error:not_found' using errcode = 'insufficient_privilege';
  end if;
  if exists (select 1 from channels c where c.id = p_channel_id and c.archived_at is not null) then
    raise exception 'poll_error:archived' using errcode = 'check_violation';
  end if;
  if not channel_poll_create_admits(v_user, p_channel_id) then
    raise exception 'poll_error:not_allowed' using errcode = 'insufficient_privilege';
  end if;

  if v_visibility not in ('anonymous', 'visible') then
    raise exception 'poll_error:visibility' using errcode = 'check_violation';
  end if;
  if v_question = '' or length(v_question) > 300 or v_question ~ '[[:cntrl:]]' then
    raise exception 'poll_error:question' using errcode = 'check_violation';
  end if;

  select coalesce(array_agg(btrim(o, E' \t\n\r') order by n), '{}'::text[])
    into v_options
    from unnest(coalesce(p_options, '{}'::text[])) with ordinality as x(o, n);
  if cardinality(v_options) < 2 or cardinality(v_options) > 10 then
    raise exception 'poll_error:option_count' using errcode = 'check_violation';
  end if;
  if exists (select 1 from unnest(v_options) o where o is null or o = '' or length(o) > 120 or o ~ '[[:cntrl:]]') then
    raise exception 'poll_error:option' using errcode = 'check_violation';
  end if;
  if (select count(distinct lower(o)) from unnest(v_options) o) <> cardinality(v_options) then
    raise exception 'poll_error:duplicate' using errcode = 'check_violation';
  end if;

  insert into messages (channel_id, author_id, body)
  values (p_channel_id, v_user, v_question)
  returning * into v_message;

  insert into channel_polls (message_id, channel_id, question, visibility, created_at)
  values (v_message.id, v_message.channel_id, v_question, v_visibility, v_message.created_at);

  for i in 1 .. cardinality(v_options) loop
    insert into channel_poll_options (poll_id, position, label)
    values (v_message.id, i - 1, v_options[i]);
  end loop;

  return v_message;
end;
$$;

comment on function public.create_channel_poll(text, text, text[], text) is
  'Posts a poll (a question, 2–10 distinct options, anonymous or visible votes) as a message from the caller in a channel where channel_poll_create_admits() lets them. Returns the stored message.';

-- ── Voting ──────────────────────────────────────────────────────────────

create or replace function public.vote_channel_poll(p_message_id uuid, p_option_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_poll channel_polls%rowtype;
  v_archived boolean;
begin
  if v_user is null or p_message_id is null then
    raise exception 'poll_error:not_found' using errcode = 'insufficient_privilege';
  end if;

  -- Locked, so a close and a vote cannot pass each other.
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
  if p_option_id is null or not exists (
    select 1 from channel_poll_options o where o.id = p_option_id and o.poll_id = v_poll.message_id
  ) then
    raise exception 'poll_error:invalid_option' using errcode = 'check_violation';
  end if;

  insert into channel_poll_votes as v (poll_id, user_id, option_id)
  values (v_poll.message_id, v_user, p_option_id)
  on conflict (poll_id, user_id) do update
     set option_id = excluded.option_id, updated_at = now()
   where v.option_id is distinct from excluded.option_id;

  return channel_poll_view(v_user, v_poll.message_id);
end;
$$;

comment on function public.vote_channel_poll(uuid, uuid) is
  'The caller''s single-choice vote on an open poll in a channel they can read, not archived: cast, or moved to another option of the same poll. Idempotent. Returns the poll as the caller sees it.';

-- ── Closing ─────────────────────────────────────────────────────────────

create or replace function public.close_channel_poll(p_message_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_poll channel_polls%rowtype;
begin
  if v_user is null or p_message_id is null then
    raise exception 'poll_error:not_found' using errcode = 'insufficient_privilege';
  end if;

  select p.* into v_poll
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
  if not channel_poll_close_admits(v_user, v_poll.message_id) then
    raise exception 'poll_error:not_allowed' using errcode = 'insufficient_privilege';
  end if;

  -- Already closed: the same answer again.
  if v_poll.closed_at is null then
    update channel_polls set closed_at = now(), closed_by = v_user where message_id = v_poll.message_id;
  end if;

  return channel_poll_view(v_user, v_poll.message_id);
end;
$$;

comment on function public.close_channel_poll(uuid) is
  'Closes a poll for good: its creator, or whoever moderates the channel''s messages. Idempotent. Returns the poll as the caller sees it.';

-- ── Who chose an option (visible polls only) ────────────────────────────
--
-- Null for anything the caller cannot read, an option of another poll, an
-- anonymous poll, or before the caller has voted on an open poll. Otherwise
-- how many chose the option and the community display names of those the
-- caller may identify (see the header); everyone else is in `unnamed`.
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
  if v_user is null or p_message_id is null or p_option_id is null then
    return null;
  end if;

  select c.community_id into v_community
    from channel_polls p
    join messages m on m.id = p.message_id
    join channels c on c.id = p.channel_id
   where p.message_id = p_message_id
     and m.deleted_at is null
     and channel_access_admits(v_user, c.community_id, c.local_group_id, c.subgroup_id, c.id, c.is_private);
  if not found then
    return null;
  end if;
  select * into v_poll from channel_polls p where p.message_id = p_message_id;

  if v_poll.visibility <> 'visible'
     or not exists (select 1 from channel_poll_options o where o.id = p_option_id and o.poll_id = v_poll.message_id)
     or (
       v_poll.closed_at is null
       and not exists (select 1 from channel_poll_votes v where v.poll_id = v_poll.message_id and v.user_id = v_user)
     )
  then
    return null;
  end if;

  select count(*)::integer into v_total
    from channel_poll_votes v where v.poll_id = v_poll.message_id and v.option_id = p_option_id;

  with named as (
    select v.user_id, v.updated_at, cp.display_name
    from channel_poll_votes v
    join channels c on c.id = v_poll.channel_id
    join community_profiles cp on cp.community_id = v_community and cp.user_id = v.user_id
    where v.poll_id = v_poll.message_id
      and v.option_id = p_option_id
      -- Still able to read the channel (an active member of it, by the rule).
      and channel_access_admits(v.user_id, c.community_id, c.local_group_id, c.subgroup_id, c.id, c.is_private)
      -- And someone the caller may already identify in this community.
      and (v.user_id = v_user or can_view_community_identity(v_community, v.user_id))
  ),
  shown as (
    select * from named order by (user_id = v_user) desc, updated_at, user_id limit 50
  )
  select (select count(*)::integer from named),
         coalesce(
           (select jsonb_agg(jsonb_build_object('name', s.display_name, 'me', s.user_id = v_user)
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
  'On a visible poll the caller can read, once they voted or it closed: how many chose this option and the community display names of those still in the channel whom the caller may identify (can_view_community_identity). Null otherwise; never an account id.';

-- ── Privileges ──────────────────────────────────────────────────────────
--
-- As 20261026100000: members read through the policies above and write
-- through the functions only; the server's key reads and writes.

revoke all on table public.channel_polls from public, anon, authenticated, service_role;
revoke all on table public.channel_poll_options from public, anon, authenticated, service_role;
revoke all on table public.channel_poll_votes from public, anon, authenticated, service_role;
grant select on public.channel_polls to authenticated;
grant select on public.channel_poll_options to authenticated;
grant select on public.channel_poll_votes to authenticated;
grant select, insert, update, delete on public.channel_polls to service_role;
grant select, insert, update, delete on public.channel_poll_options to service_role;
grant select, insert, update, delete on public.channel_poll_votes to service_role;

revoke all on function public.channel_polls_guard() from public, anon, authenticated, service_role;
revoke all on function public.channel_poll_options_guard() from public, anon, authenticated, service_role;
revoke all on function public.channel_poll_votes_guard() from public, anon, authenticated, service_role;
revoke all on function public.messages_guard_poll_body() from public, anon, authenticated, service_role;
revoke all on function public.messages_drop_poll() from public, anon, authenticated, service_role;
revoke all on function public.channel_poll_create_admits(uuid, text) from public, anon, authenticated, service_role;
revoke all on function public.channel_poll_close_admits(uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function public.channel_poll_view(uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function public.can_create_channel_poll(text) from public, anon, authenticated, service_role;
revoke all on function public.channel_poll_states(text, uuid[]) from public, anon, authenticated, service_role;
revoke all on function public.create_channel_poll(text, text, text[], text) from public, anon, authenticated, service_role;
revoke all on function public.vote_channel_poll(uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function public.close_channel_poll(uuid) from public, anon, authenticated, service_role;
revoke all on function public.channel_poll_voters(uuid, uuid) from public, anon, authenticated, service_role;

grant execute on function public.can_create_channel_poll(text) to authenticated;
grant execute on function public.channel_poll_states(text, uuid[]) to authenticated;
grant execute on function public.create_channel_poll(text, text, text[], text) to authenticated;
grant execute on function public.vote_channel_poll(uuid, uuid) to authenticated;
grant execute on function public.close_channel_poll(uuid) to authenticated;
grant execute on function public.channel_poll_voters(uuid, uuid) to authenticated;
