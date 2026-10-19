-- Disappearing messages for direct conversations: optional, per
-- conversation, off by default.
--
-- There is still no automatic expiry for ordinary conversations: people who
-- meet once a year should find their conversation where they left it. What
-- this adds is a choice either participant can make for one conversation.
--
-- ── The setting ─────────────────────────────────────────────────────────
--
-- `direct_conversations.disappear_seconds`: null (off) or one of 1 hour,
-- 8 hours, 1 day, 1 week, 4 weeks. Either participant changes it through
-- set_direct_conversation_disappearing(), which takes the conversation's
-- lock, changes it for both and records a notice in the conversation
-- (direct_conversation_notices). No API role can write it directly.
--
-- ── What a message keeps ────────────────────────────────────────────────
--
-- Each message captures the setting when it is written, in the same
-- statement and under the same lock that numbers it
-- (direct_message_assign_seq). A change is itself numbered under that lock,
-- so every message numbered before the notice has the old duration and
-- every message after it the new one — whatever two devices do at once.
-- Nothing afterwards changes a message's captured duration: not a later
-- change or switching it off, not an edit, not another message.
--
--   disappear_seconds  the captured duration, or null for an ordinary
--                      message. Immutable.
--   read_at            the recipient's first read, stamped by the server
--                      (mark_direct_conversation_read) — never the sender's
--                      own view, never a notification or a preview. Set once.
--   expires_at         derived by the row's guard, for every writer:
--                        unread  created_at + 30 days
--                        read    read_at + disappear_seconds
--                      Nobody writes it; the guard recomputes it on every
--                      insert and update from the three columns above.
--
-- All three are server timestamps (now() in the database). The browser's
-- clock is never consulted.
--
-- ── Expired means gone, at once ─────────────────────────────────────────
--
-- From expires_at on, a message is unreadable to both participants on
-- every path, whether or not the cleanup below has run yet:
--
--   messages      direct_messages_select (any id, cursor, old URL)
--   inbox/unread  the same policy; direct_unread_count skips it
--   files         message_attachments_select and the Storage read policy
--                 (direct_attachment_message_visible)
--   notices       notifications_select (a disappearing message's notice
--                 names it and never quotes it)
--   edit/delete   refused as not found; the row guard refuses any update
--                 of an expired message, for every writer
--
-- ── Physical removal ────────────────────────────────────────────────────
--
-- purge_expired_direct_messages() (service role only) deletes expired rows.
-- Their files go by cascade into message_attachment_purges, the same queue
-- every other deletion uses, and the server removes the objects through the
-- Storage API (purgeAttachmentObjects). Their notices go by cascade. Rows
-- are locked and re-checked at deletion, so a late or repeated run never
-- deletes a message whose timer was (re)started meanwhile, and two runs at
-- once skip each other's rows. Backups are not touched: they follow their
-- own retention.

-- ── 1. The conversation's setting ──────────────────────────────────────

alter table public.direct_conversations
  add column disappear_seconds integer,
  add constraint direct_conversations_disappear_seconds_known
    check (disappear_seconds is null or disappear_seconds in (3600, 28800, 86400, 604800, 2419200));

comment on column public.direct_conversations.disappear_seconds is
  'Disappearing messages for new messages here: null (off) or the duration in seconds. Changed only by set_direct_conversation_disappearing(); captured by each message when written.';

-- New conversations start with it off; the counter and "wrote" flags as
-- 20261104100000 left them.
create or replace function public.direct_conversations_guard_wrote()
returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.participant_one_wrote := false;
    new.participant_two_wrote := false;
    new.message_seq := 0;
    new.disappear_seconds := null;
  else
    if (old.participant_one_wrote and not new.participant_one_wrote)
       or (old.participant_two_wrote and not new.participant_two_wrote)
    then
      raise exception 'direct_conversation_wrote_is_permanent' using errcode = 'check_violation';
    end if;
    if new.message_seq < old.message_seq then
      raise exception 'direct_conversation_seq_is_permanent' using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.direct_conversations_guard_wrote() from public, anon, authenticated, service_role;

-- ── 2. What each message keeps ─────────────────────────────────────────

alter table public.direct_messages
  add column disappear_seconds integer,
  add column read_at timestamptz,
  add column expires_at timestamptz,
  add constraint direct_messages_disappear_seconds_known
    check (disappear_seconds is null or disappear_seconds in (3600, 28800, 86400, 604800, 2419200)),
  add constraint direct_messages_retention_shape
    check (
      (disappear_seconds is null) = (expires_at is null)
      and (read_at is null or disappear_seconds is not null)
    );

comment on column public.direct_messages.disappear_seconds is
  'The conversation''s disappearing-message duration when this message was written, or null. Captured under the conversation''s lock; never changed afterwards.';
comment on column public.direct_messages.read_at is
  'When the recipient first read this disappearing message (server time). Set once, by mark_direct_conversation_read.';
comment on column public.direct_messages.expires_at is
  'When this disappearing message stops existing for both participants: read_at + disappear_seconds, or created_at + 30 days while unread. Derived by direct_messages_guard; nobody writes it.';

create index direct_messages_expires_idx
  on public.direct_messages (expires_at)
  where expires_at is not null;

-- Numbering and capture, in one statement under the conversation's lock.
-- Otherwise as 20261104100000: only a participant's message (or the
-- server's) takes a number, and a new message brings a deleted
-- conversation back.
create or replace function public.direct_message_assign_seq()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update direct_conversations dc
     set message_seq = dc.message_seq + 1
   where dc.id = new.conversation_id
     and (
       new.author_id in (dc.participant_one_id, dc.participant_two_id)
       or coalesce(auth.role(), '') = 'service_role'
     )
  returning dc.message_seq, dc.disappear_seconds into new.seq, new.disappear_seconds;

  new.seq := coalesce(new.seq, 0);

  if new.seq > 0 then
    update direct_conversation_states s
       set hidden_at = null
     where s.conversation_id = new.conversation_id
       and s.hidden_at is not null;
  end if;

  return new;
end;
$$;

revoke all on function public.direct_message_assign_seq() from public, anon, authenticated, service_role;

-- The row's own rules, for every writer. As 20261104100000, plus: the
-- captured duration never changes, the first read is set once and is the
-- server's time, expires_at is always derived, and an expired message takes
-- no change at all.
create or replace function public.direct_messages_guard()
returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if new.edited_at is not null or new.deleted_at is not null then
      raise exception 'message_error:not_allowed' using errcode = 'insufficient_privilege';
    end if;
    -- disappear_seconds was captured by direct_message_assign_seq (which
    -- runs first); a message is born unread.
    new.read_at := null;
  else
    if new.id is distinct from old.id
       or new.conversation_id is distinct from old.conversation_id
       or new.author_id is distinct from old.author_id
       or new.created_at is distinct from old.created_at
       or new.seq is distinct from old.seq
       or new.disappear_seconds is distinct from old.disappear_seconds
    then
      raise exception 'message_error:immutable' using errcode = 'check_violation';
    end if;
    if old.expires_at is not null and old.expires_at <= now() then
      raise exception 'message_error:expired' using errcode = 'check_violation';
    end if;
    if old.read_at is not null then
      if new.read_at is distinct from old.read_at then
        raise exception 'message_error:immutable' using errcode = 'check_violation';
      end if;
    elsif new.read_at is not null then
      -- The first read is now, whatever was asked for.
      new.read_at := now();
    end if;
    if old.deleted_at is not null then
      raise exception 'message_error:deleted' using errcode = 'check_violation';
    end if;
  end if;

  new.expires_at := case
    when new.disappear_seconds is null then null
    when new.read_at is null then new.created_at + interval '720 hours'
    else new.read_at + make_interval(secs => new.disappear_seconds)
  end;

  return new;
end;
$$;

revoke all on function public.direct_messages_guard() from public, anon, authenticated, service_role;

-- ── 3. Notices in the conversation ─────────────────────────────────────

-- A small record that someone changed the setting. Numbered from the same
-- counter as the messages, under the same lock, so it sits exactly between
-- the last message with the old duration and the first with the new one,
-- and a participant's deletion cutoff hides it like a message. It is not a
-- message: it is not counted as unread, does not raise a notification, does
-- not move the conversation in the inbox and does not count towards file
-- sharing (participant_*_wrote). It carries no message content.
create table public.direct_conversation_notices (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.direct_conversations (id) on delete cascade,
  seq bigint not null,
  actor_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null default 'disappearing',
  disappear_seconds integer,
  created_at timestamptz not null default now(),
  constraint direct_conversation_notices_seq_positive check (seq > 0),
  constraint direct_conversation_notices_kind_known check (kind = 'disappearing'),
  constraint direct_conversation_notices_disappear_seconds_known
    check (disappear_seconds is null or disappear_seconds in (3600, 28800, 86400, 604800, 2419200)),
  unique (conversation_id, seq)
);

comment on table public.direct_conversation_notices is
  'Notices in a direct conversation that are not messages: a participant changing disappearing messages. Numbered with the messages (direct_messages.seq) and hidden by the same deletion cutoff. Written only by set_direct_conversation_disappearing().';

alter table public.direct_conversation_notices enable row level security;

revoke all on public.direct_conversation_notices from public, anon, authenticated, service_role;
grant select on public.direct_conversation_notices to authenticated;
grant select, insert, update, delete on public.direct_conversation_notices to service_role;

create policy direct_conversation_notices_select on public.direct_conversation_notices
  for select to authenticated
  using (can_read_direct_message(conversation_id, seq));

-- ── 4. Changing the setting ────────────────────────────────────────────

-- Refusals are raised as `conversation_error:<reason>`. Returns the setting
-- now in force (null for off). Choosing what is already set changes
-- nothing and records nothing.
create or replace function public.set_direct_conversation_disappearing(
  p_conversation_id uuid,
  p_seconds integer
)
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_seconds integer := nullif(p_seconds, 0);
  v_conversation direct_conversations%rowtype;
  v_seq bigint;
begin
  if v_user is null or not is_direct_conversation_participant(p_conversation_id, v_user) then
    raise exception 'conversation_error:not_found' using errcode = 'insufficient_privilege';
  end if;
  if v_seconds is not null and v_seconds not in (3600, 28800, 86400, 604800, 2419200) then
    raise exception 'conversation_error:invalid_timer' using errcode = 'check_violation';
  end if;
  -- Only someone who could write here may decide how long what is written
  -- here lasts.
  if not can_reply_direct_conversation(p_conversation_id) then
    raise exception 'conversation_error:closed' using errcode = 'insufficient_privilege';
  end if;

  -- The message lock: a message being written right now is numbered either
  -- before this change (and keeps the old duration) or after it.
  select * into v_conversation from direct_conversations dc where dc.id = p_conversation_id for update;

  if v_conversation.disappear_seconds is not distinct from v_seconds then
    return v_seconds;
  end if;

  update direct_conversations dc
     set disappear_seconds = v_seconds,
         message_seq = dc.message_seq + 1
   where dc.id = p_conversation_id
  returning dc.message_seq into v_seq;

  insert into direct_conversation_notices (conversation_id, seq, actor_id, kind, disappear_seconds)
  values (p_conversation_id, v_seq, v_user, 'disappearing', v_seconds);

  return v_seconds;
end;
$$;

comment on function public.set_direct_conversation_disappearing(uuid, integer) is
  'Either participant turns disappearing messages off (null or 0) or sets the duration for new messages, for both of them, and records a notice. Messages already written keep their own duration.';

revoke all on function public.set_direct_conversation_disappearing(uuid, integer) from public, anon, service_role;
grant execute on function public.set_direct_conversation_disappearing(uuid, integer) to authenticated;

-- ── 5. Reading ─────────────────────────────────────────────────────────

-- Expired is unreadable, to both, on the spot.
drop policy direct_messages_select on public.direct_messages;
create policy direct_messages_select on public.direct_messages
  for select to authenticated
  using (
    can_read_direct_message(conversation_id, seq)
    and (expires_at is null or expires_at > now())
  );

-- Files: readable exactly as long as their message is.
create or replace function public.direct_attachment_message_visible(p_direct_message_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select p_direct_message_id is null or exists (
    select 1 from direct_messages dm
    where dm.id = p_direct_message_id
      and direct_message_visible_to(auth.uid(), dm.conversation_id, dm.seq)
      and (dm.expires_at is null or dm.expires_at > now())
  );
$$;

revoke all on function public.direct_attachment_message_visible(uuid) from public, anon, service_role;
grant execute on function public.direct_attachment_message_visible(uuid) to authenticated;

-- The first read. The recipient's own reads only: messages from the other
-- participant that they can see, that have not expired, and — when the page
-- says how far it showed — no further than that. Last-read state is as
-- before. A notification, a preview or the sender's own view never comes
-- here.
drop function public.mark_direct_conversation_read(uuid);

create or replace function public.mark_direct_conversation_read(
  p_conversation_id uuid,
  p_through_seq bigint default null
)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null or not is_direct_conversation_participant(p_conversation_id, v_user) then
    return false;
  end if;

  insert into direct_conversation_reads (conversation_id, user_id, last_read_at)
  values (p_conversation_id, v_user, now())
  on conflict (conversation_id, user_id)
  do update set last_read_at = excluded.last_read_at;

  update direct_messages dm
     set read_at = now()
   where dm.conversation_id = p_conversation_id
     and dm.author_id <> v_user
     and dm.disappear_seconds is not null
     and dm.read_at is null
     and dm.deleted_at is null
     and dm.expires_at > now()
     and (p_through_seq is null or dm.seq <= p_through_seq)
     and dm.seq > coalesce((
       select s.cleared_through_seq from direct_conversation_states s
       where s.conversation_id = p_conversation_id and s.user_id = v_user
     ), 0);

  return true;
end;
$$;

revoke all on function public.mark_direct_conversation_read(uuid, bigint) from public, anon, service_role;
grant execute on function public.mark_direct_conversation_read(uuid, bigint) to authenticated;

-- Unread: as 20261104100000, among messages that still exist for the caller.
create or replace function public.direct_unread_count(p_community_id text)
returns integer language sql security definer stable set search_path = public as $$
  select count(*)::integer
  from direct_conversations dc
  left join direct_conversation_states st
    on st.conversation_id = dc.id
   and st.user_id = auth.uid()
  join lateral (
    select dm.author_id, dm.created_at
    from direct_messages dm
    where dm.conversation_id = dc.id
      and dm.seq > coalesce(st.cleared_through_seq, 0)
      and (dm.expires_at is null or dm.expires_at > now())
    order by dm.seq desc
    limit 1
  ) latest on true
  left join direct_conversation_reads reads
    on reads.conversation_id = dc.id
   and reads.user_id = auth.uid()
  where dc.community_id = p_community_id
    and is_direct_conversation_participant(dc.id)
    and st.hidden_at is null
    and latest.author_id <> auth.uid()
    and latest.created_at > coalesce(reads.last_read_at, '-infinity'::timestamptz);
$$;

-- ── 6. Edit and delete ─────────────────────────────────────────────────

-- An expired message is not found, also by its author. Otherwise identical
-- to 20261104100000. Editing never touches the timer: the guard derives
-- expires_at from created_at and read_at, which an edit does not change.
create or replace function public.edit_direct_message(p_message_id uuid, p_body text)
returns public.direct_messages language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_message direct_messages%rowtype;
  v_old_body text;
  v_body text := btrim(coalesce(p_body, ''), E' \t\n\r');
begin
  select * into v_message from direct_messages dm where dm.id = p_message_id for update;
  if v_user is null or not found
     or not direct_message_visible_to(v_user, v_message.conversation_id, v_message.seq)
     or (v_message.expires_at is not null and v_message.expires_at <= now())
  then
    raise exception 'message_error:not_found' using errcode = 'insufficient_privilege';
  end if;
  if v_message.author_id <> v_user then
    raise exception 'message_error:not_allowed' using errcode = 'insufficient_privilege';
  end if;
  if v_message.deleted_at is not null then
    raise exception 'message_error:deleted' using errcode = 'check_violation';
  end if;
  if not can_reply_direct_conversation(v_message.conversation_id) then
    raise exception 'message_error:closed' using errcode = 'insufficient_privilege';
  end if;

  if length(v_body) > 4000 then
    raise exception 'message_error:too_long' using errcode = 'check_violation';
  end if;
  if v_body = '' and not v_message.has_attachments then
    raise exception 'message_error:empty' using errcode = 'check_violation';
  end if;
  if v_body = v_message.body then
    return v_message;
  end if;

  v_old_body := v_message.body;
  update direct_messages set body = v_body, edited_at = now()
  where id = v_message.id
  returning * into v_message;

  perform direct_message_requote_notification(
    v_message, v_old_body, case when v_body = '' then 'Vedlegg' else left(v_body, 120) end
  );
  return v_message;
end;
$$;

create or replace function public.delete_direct_message(p_message_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_message direct_messages%rowtype;
  v_old_body text;
begin
  select * into v_message from direct_messages dm where dm.id = p_message_id for update;
  if v_user is null or not found
     or not direct_message_visible_to(v_user, v_message.conversation_id, v_message.seq)
     or (v_message.expires_at is not null and v_message.expires_at <= now())
  then
    raise exception 'message_error:not_found' using errcode = 'insufficient_privilege';
  end if;
  if v_message.author_id <> v_user then
    raise exception 'message_error:not_allowed' using errcode = 'insufficient_privilege';
  end if;
  if v_message.deleted_at is not null then
    return 'author';
  end if;

  v_old_body := v_message.body;
  delete from message_attachments a where a.direct_message_id = v_message.id;
  update direct_messages
     set body = '', has_attachments = false, edited_at = null, deleted_at = now()
   where id = v_message.id
   returning * into v_message;

  perform direct_message_requote_notification(v_message, v_old_body, 'Meldingen er slettet.');
  return 'author';
end;
$$;

-- ── 7. Notifications ───────────────────────────────────────────────────

-- A disappearing message's notice names the message instead of quoting it,
-- goes with it when it is deleted, and is unreadable from the moment the
-- message expires.
alter table public.notifications
  add column direct_message_id uuid references public.direct_messages (id) on delete cascade;

comment on column public.notifications.direct_message_id is
  'The disappearing direct message this notice is about. Such a notice never quotes the message, is readable only while the message is, and is deleted with it.';

create index notifications_direct_message_idx
  on public.notifications (direct_message_id)
  where direct_message_id is not null;

create or replace function public.can_read_notified_direct_message(p_direct_message_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from direct_messages dm
    where dm.id = p_direct_message_id
      and direct_message_visible_to(auth.uid(), dm.conversation_id, dm.seq)
      and (dm.expires_at is null or dm.expires_at > now())
  );
$$;

revoke all on function public.can_read_notified_direct_message(uuid) from public, anon, service_role;
grant execute on function public.can_read_notified_direct_message(uuid) to authenticated;

drop policy notifications_select on public.notifications;
create policy notifications_select on public.notifications
  for select to authenticated
  using (
    user_id = auth.uid()
    and (post_id is null or can_access_post(post_id))
    and (event_id is null or can_read_event(event_id))
    and (message_id is null or can_read_notified_message(message_id))
    and (direct_message_id is null or can_read_notified_direct_message(direct_message_id))
  );

-- A member may still only mark a notice read; the new column is as fixed as
-- the others.
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
     or new.message_id is distinct from old.message_id
     or new.direct_message_id is distinct from old.direct_message_id then
    raise exception 'Et varsel kan bare markeres som lest eller ulest'
      using errcode = 'insufficient_privilege';
  end if;

  return new;
end $$;

revoke all on function public.notifications_guard_immutable() from public, anon, authenticated, service_role;

-- The recipient's notice for a new message. As 20261102100000, except for a
-- disappearing message: the notice names it and says only that a
-- disappearing message arrived. An unread notice still waiting for a
-- disappearing message gives way to one for the newest message, so it
-- cannot take the only notice for a later message with it when it expires.
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
    -- A member's own text, sent through the insert policy or
    -- send_direct_message_with_attachments(): the author has now written
    -- here. Files alone do not count, and neither does anything the server
    -- writes with its own key.
    if new.body ~ '\S' then
      update direct_conversations
         set participant_one_wrote = participant_one_wrote or new.author_id = participant_one_id,
             participant_two_wrote = participant_two_wrote or new.author_id = participant_two_id
       where id = new.conversation_id
         and new.author_id in (participant_one_id, participant_two_id);
    end if;

    -- The author as they appear in the conversation's community.
    select cp.display_name, c.name into v_author_name, v_community_name
    from communities c
    left join community_profiles cp
      on cp.community_id = c.id and cp.user_id = new.author_id
    where c.id = v_conversation.community_id;

    delete from notifications n
    where n.user_id = v_recipient
      and n.kind = 'direct_message'
      and n.href = v_href
      and n.read = false
      and n.direct_message_id is not null;

    insert into notifications (user_id, kind, community_id, title, body, href, direct_message_id)
    select
      v_recipient,
      'direct_message',
      v_conversation.community_id,
      'Ny melding fra ' || coalesce(v_author_name, 'et medlem'),
      coalesce(v_community_name, 'Fellesskapet') || ' · ' || case
        when new.disappear_seconds is not null then 'Forsvinnende melding'
        when btrim(new.body) = '' then 'Vedlegg'
        else left(btrim(new.body), 120)
      end,
      v_href,
      case when new.disappear_seconds is not null then new.id end
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

revoke all on function public.direct_message_after_insert() from public, anon, authenticated, service_role;

-- An edit or deletion re-quotes the recipient's notice — never for a
-- disappearing message, whose notice quotes nothing, and never onto a
-- notice that names one. Otherwise identical to 20261104100000.
create or replace function public.direct_message_requote_notification(
  p_message direct_messages,
  p_old_body text,
  p_new_quote text
)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_conversation direct_conversations%rowtype;
  v_recipient uuid;
  v_community_name text;
  v_prefix text;
begin
  if p_message.disappear_seconds is not null then
    return;
  end if;

  select * into v_conversation from direct_conversations dc where dc.id = p_message.conversation_id;
  if not found then
    return;
  end if;

  v_recipient := case
    when v_conversation.participant_one_id = p_message.author_id then v_conversation.participant_two_id
    else v_conversation.participant_one_id
  end;
  if exists (
    select 1 from direct_conversation_states s
    where s.conversation_id = v_conversation.id
      and s.user_id = v_recipient
      and s.cleared_through_seq >= p_message.seq
  ) then
    return;
  end if;

  select c.name into v_community_name from communities c where c.id = v_conversation.community_id;
  v_prefix := coalesce(v_community_name, 'Fellesskapet') || ' · ';

  with gone as (
    delete from notifications n
    where n.user_id = v_recipient
      and n.kind = 'direct_message'
      and n.href = '/community/' || v_conversation.community_id || '/messages/' || v_conversation.id
      and n.direct_message_id is null
      and n.created_at >= p_message.created_at
      and n.body = v_prefix || case
            when btrim(p_old_body) = '' then 'Vedlegg'
            else left(btrim(p_old_body), 120)
          end
    returning n.*
  )
  insert into notifications (id, user_id, kind, community_id, title, body, created_at, read, href, post_id, event_id)
  select g.id, g.user_id, g.kind, g.community_id, g.title, v_prefix || p_new_quote, g.created_at, g.read, g.href, g.post_id, g.event_id
  from gone g;
end;
$$;

revoke all on function public.direct_message_requote_notification(direct_messages, text, text)
  from public, anon, authenticated, service_role;

-- ── 8. Physical removal ────────────────────────────────────────────────

-- Deletes expired messages, oldest first, at most p_limit per call;
-- p_conversation_ids limits it to those conversations (the check suite's
-- own, or the conversation someone just opened). Each row is locked and its
-- expiry re-read before deletion: a row another run holds is skipped, and a
-- row whose first read was stamped meanwhile is no longer expired and stays.
-- Files and notices go by cascade; file objects are queued in
-- message_attachment_purges for the server's Storage purge. Returns how
-- many messages were deleted. Repeating it is harmless.
create or replace function public.purge_expired_direct_messages(
  p_limit integer default 500,
  p_conversation_ids uuid[] default null
)
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_count integer;
begin
  with doomed as (
    select dm.id
    from direct_messages dm
    where dm.expires_at <= now()
      and (p_conversation_ids is null or dm.conversation_id = any(p_conversation_ids))
    order by dm.expires_at
    limit least(greatest(coalesce(p_limit, 500), 1), 5000)
    for update skip locked
  ),
  gone as (
    delete from direct_messages dm
    using doomed
    where dm.id = doomed.id
      and dm.expires_at <= now()
    returning 1
  )
  select count(*)::integer into v_count from gone;
  return v_count;
end;
$$;

comment on function public.purge_expired_direct_messages(integer, uuid[]) is
  'Deletes expired disappearing direct messages (rows, files by cascade into the Storage purge queue, notices by cascade). Service role only; reading is already refused from expires_at on. Safe to run repeatedly and concurrently.';

revoke all on function public.purge_expired_direct_messages(integer, uuid[]) from public, anon, authenticated, service_role;
grant execute on function public.purge_expired_direct_messages(integer, uuid[]) to service_role;

-- Messages neither participant can read any more, and the notices between
-- them. Otherwise as 20261105100000.
create or replace function public.purge_unreachable_direct_messages(p_conversation_id uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_conversation direct_conversations%rowtype;
  v_floor bigint;
  v_count integer;
begin
  select * into v_conversation from direct_conversations dc where dc.id = p_conversation_id;
  if not found then
    return 0;
  end if;

  -- A participant without a row has cut nothing off: the floor is 0.
  select least(
    coalesce((select s.cleared_through_seq from direct_conversation_states s
              where s.conversation_id = v_conversation.id and s.user_id = v_conversation.participant_one_id), 0),
    coalesce((select s.cleared_through_seq from direct_conversation_states s
              where s.conversation_id = v_conversation.id and s.user_id = v_conversation.participant_two_id), 0)
  ) into v_floor;

  if v_floor <= 0 then
    return 0;
  end if;

  delete from direct_conversation_notices n
  where n.conversation_id = v_conversation.id
    and n.seq <= v_floor;

  -- Files go by cascade and queue their objects for removal.
  with gone as (
    delete from direct_messages dm
    where dm.conversation_id = v_conversation.id
      and dm.seq <= v_floor
    returning 1
  )
  select count(*)::integer into v_count from gone;
  return v_count;
end;
$$;

revoke all on function public.purge_unreachable_direct_messages(uuid) from public, anon, authenticated, service_role;
