-- Editing, deleting, moderating and pinning chat messages.
--
-- Chat messages only: `messages` (community channels, lokallag chats, private
-- lokallag channels, group chats) and `direct_messages`. Feed posts and
-- comments have their own rules and are not touched; neither are
-- collaboration messages.
--
-- ── What changes for a message ──────────────────────────────────────────
--
--   edit      the author only, text only, no time limit. The id, author,
--             channel and created_at stay; `edited_at` records that it was
--             edited ("· redigert"). Attachments, their Ressurser placements
--             and pins are untouched. Empty text is refused unless the
--             message carries files.
--   delete    the author ("Meldingen er slettet."), or — in a channel, never
--             a direct message — someone who moderates that channel
--             ("Meldingen ble fjernet av en moderator."). The row stays as a
--             tombstone so ids, order and `?melding=` links keep working; its
--             text, reactions and legacy attachment card are erased in the
--             same statement and cannot come back. Its files are deleted:
--             the rows go at once (so the attachment route, the Storage read
--             policy and Ressurser stop serving them), their objects are
--             queued for the existing sweep by message_attachments_queue_purge,
--             and their folder placements and resource pins cascade.
--             Unrelated links, folders and files stay. A tombstone's
--             `deleted_at` never goes back to null.
--
-- ── Who moderates a channel ─────────────────────────────────────────────
--
-- channel_message_moderate_admits(user, channel). Always first: the person
-- can read the channel now (channel_access_admits — the rule its messages
-- follow). Then by the channel's kind, reusing the existing management rules:
--
--   community channel (no lokallag, no group)   an active admin or moderator
--                                                of its community
--   lokallag main chat                          an active admin, or that
--                                                lokallag's own leader
--                                                (local_group_manage_admits)
--   private lokallag channel                    whoever may manage that very
--                                                channel (private_channel_
--                                                manage_admits: an admin, or
--                                                a lokallagsleder who is one of
--                                                its managers)
--   group chat                                  whoever may manage the group
--                                                (subgroup_manage_admits: an
--                                                admin or its own managers)
--
-- A moderator's role is community-wide and is not a lokallag, group or
-- private-channel grant, so it moderates the community's own channels only.
-- Nobody gains read access here: a role that cannot read a channel cannot
-- moderate it. Direct messages have no moderators at all.
--
-- ── Pinned message ──────────────────────────────────────────────────────
--
-- At most one per channel (`channel_pinned_messages`, keyed by channel). It
-- points at the message by (id, channel_id) — nothing is copied, so an edit
-- shows in the pin at once and a message can only be pinned in its own
-- channel. Pinned and unpinned by whoever moderates the channel; pinning
-- another replaces it. Deleting the message clears the pin. An archived
-- channel keeps its pin and takes no change to it. Not for direct messages.
-- Separate from pinned feed posts and pinned resources.
--
-- ── Archived and restricted channels ────────────────────────────────────
--
-- An archived channel takes no edits and no pin changes from anyone; only its
-- moderators may still remove a message there. A restricted (read_only)
-- channel takes edits from those who may write in it (admins and moderators);
-- an author may always delete their own message unless the channel is
-- archived. A direct message is edited only while the conversation can be
-- replied to; it may always be deleted by its author.
--
-- ── Audit ───────────────────────────────────────────────────────────────
--
-- `message_moderation_log`: who removed someone else's message, or pinned or
-- unpinned one, where and when. Never the message's text. No API role can
-- read or write it; only the functions below append to it.
--
-- ── Enforcement ─────────────────────────────────────────────────────────
--
-- No API role gets UPDATE or DELETE on either message table. Every change is
-- one of the SECURITY DEFINER functions below, which find the row by id and
-- decide from the row's own channel or conversation — never one the caller
-- names. Guard triggers keep id, author, channel/conversation and created_at
-- fixed for every writer, the service role included, refuse to change a
-- tombstone, and refuse an insert that claims to be edited or deleted
-- (`messages` keeps its table-wide INSERT grant). Refusals are raised as
-- `message_error:<reason>`.

-- ── Columns ─────────────────────────────────────────────────────────────

alter table public.messages
  add column edited_at timestamptz,
  add column deleted_at timestamptz,
  add column removed_by_moderator boolean not null default false,
  add constraint messages_removal_shape
    check (deleted_at is not null or not removed_by_moderator),
  add constraint messages_tombstone
    check (
      deleted_at is null
      or (body = '' and attachment is null and reactions = '[]'::jsonb and edited_at is null)
    ),
  add constraint messages_id_channel_key unique (id, channel_id);

comment on column public.messages.edited_at is
  'When the author last changed the text. Null if never edited.';
comment on column public.messages.deleted_at is
  'Set when the message was deleted. The row stays as a placeholder with no text, reactions or files.';
comment on column public.messages.removed_by_moderator is
  'True when someone other than the author removed it (deleted_at is set).';

alter table public.direct_messages
  add column edited_at timestamptz,
  add column deleted_at timestamptz;

alter table public.direct_messages drop constraint direct_messages_body_present;
alter table public.direct_messages
  add constraint direct_messages_body_present
    check (
      length(btrim(body)) <= 4000
      and (deleted_at is not null or length(btrim(body)) >= 1 or has_attachments)
    ),
  add constraint direct_messages_tombstone
    check (deleted_at is null or (body = '' and not has_attachments and edited_at is null));

comment on column public.direct_messages.edited_at is
  'When the author last changed the text. Null if never edited.';
comment on column public.direct_messages.deleted_at is
  'Set when the author deleted the message. The row stays as a placeholder with no text or files.';

-- ── Guards ──────────────────────────────────────────────────────────────

create or replace function public.messages_guard()
returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if new.edited_at is not null or new.deleted_at is not null or new.removed_by_moderator then
      raise exception 'message_error:not_allowed' using errcode = 'insufficient_privilege';
    end if;
    return new;
  end if;

  if new.id is distinct from old.id
     or new.channel_id is distinct from old.channel_id
     or new.author_id is distinct from old.author_id
     or new.created_at is distinct from old.created_at
  then
    raise exception 'message_error:immutable' using errcode = 'check_violation';
  end if;
  if old.deleted_at is not null then
    raise exception 'message_error:deleted' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger messages_guard
  before insert or update on public.messages
  for each row execute function public.messages_guard();

create or replace function public.direct_messages_guard()
returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if new.edited_at is not null or new.deleted_at is not null then
      raise exception 'message_error:not_allowed' using errcode = 'insufficient_privilege';
    end if;
    return new;
  end if;

  if new.id is distinct from old.id
     or new.conversation_id is distinct from old.conversation_id
     or new.author_id is distinct from old.author_id
     or new.created_at is distinct from old.created_at
  then
    raise exception 'message_error:immutable' using errcode = 'check_violation';
  end if;
  if old.deleted_at is not null then
    raise exception 'message_error:deleted' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger direct_messages_guard
  before insert or update on public.direct_messages
  for each row execute function public.direct_messages_guard();

revoke all on function public.messages_guard() from public, anon, authenticated, service_role;
revoke all on function public.direct_messages_guard() from public, anon, authenticated, service_role;

-- ── Pinned message ──────────────────────────────────────────────────────

create table public.channel_pinned_messages (
  channel_id text primary key references public.channels (id) on delete cascade,
  message_id uuid not null,
  pinned_by uuid references public.profiles (id) on delete set null,
  pinned_at timestamptz not null default now(),
  constraint channel_pinned_messages_message_fkey
    foreign key (message_id, channel_id)
    references public.messages (id, channel_id) on delete cascade,
  constraint channel_pinned_messages_message_key unique (message_id)
);

comment on table public.channel_pinned_messages is
  'The one message pinned beneath a channel''s header. Points at the message; nothing is copied. Written only by set_channel_message_pinned() and delete_channel_message().';

alter table public.channel_pinned_messages enable row level security;
create policy channel_pinned_messages_select on public.channel_pinned_messages
  for select to authenticated using (can_read_channel(channel_id));

revoke all on public.channel_pinned_messages from public, anon, authenticated, service_role;
grant select on public.channel_pinned_messages to authenticated;
grant select, insert, update, delete on public.channel_pinned_messages to service_role;

-- ── Audit ───────────────────────────────────────────────────────────────

create table public.message_moderation_log (
  id uuid primary key default gen_random_uuid(),
  community_id text not null references public.communities (id) on delete cascade,
  channel_id text not null,
  message_id uuid not null,
  actor_id uuid references public.profiles (id) on delete set null,
  action text not null,
  created_at timestamptz not null default now(),
  constraint message_moderation_log_action check (action in ('remove', 'pin', 'unpin'))
);

create index message_moderation_log_community_idx
  on public.message_moderation_log (community_id, created_at desc);

comment on table public.message_moderation_log is
  'Who removed another person''s chat message, or pinned or unpinned one, where and when. Holds no message text. No client access; appended to by delete_channel_message() and set_channel_message_pinned().';

alter table public.message_moderation_log enable row level security;
revoke all on public.message_moderation_log from public, anon, authenticated, service_role;
grant select, insert, update, delete on public.message_moderation_log to service_role;

-- ── Who moderates a channel ─────────────────────────────────────────────

create or replace function public.channel_message_moderate_admits(p_user_id uuid, p_channel_id text)
returns boolean language sql stable security definer set search_path = public as $$
  select p_user_id is not null and exists (
    select 1
    from channels c
    where c.id = p_channel_id
      and channel_access_admits(p_user_id, c.community_id, c.local_group_id, c.subgroup_id, c.id, c.is_private)
      and case
        when c.is_private then private_channel_manage_admits(p_user_id, c.id)
        when c.subgroup_id is not null then subgroup_manage_admits(p_user_id, c.subgroup_id)
        when c.local_group_id is not null then
          local_group_manage_admits(p_user_id, c.local_group_id)
          or exists (
            select 1 from memberships m
            where m.community_id = c.community_id and m.user_id = p_user_id
              and m.status = 'active' and m.role = 'admin'
          )
        else exists (
          select 1 from memberships m
          where m.community_id = c.community_id and m.user_id = p_user_id
            and m.status = 'active' and m.role in ('admin', 'moderator')
        )
      end
  );
$$;

revoke all on function public.channel_message_moderate_admits(uuid, text) from public, anon, authenticated, service_role;

create or replace function public.can_moderate_channel_messages(p_channel_id text)
returns boolean language sql stable security definer set search_path = public as $$
  select channel_message_moderate_admits(auth.uid(), p_channel_id);
$$;

comment on function public.can_moderate_channel_messages(text) is
  'Whether the caller may remove others'' messages in this channel and pin one. Presentation only: every write asks again.';

-- ── Channel messages ────────────────────────────────────────────────────

create or replace function public.edit_channel_message(p_message_id uuid, p_body text)
returns public.messages language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_message messages%rowtype;
  v_channel channels%rowtype;
  v_body text := btrim(coalesce(p_body, ''), E' \t\n\r');
begin
  select * into v_message from messages m where m.id = p_message_id for update;
  if v_user is null or not found or not can_read_channel(v_message.channel_id) then
    raise exception 'message_error:not_found' using errcode = 'insufficient_privilege';
  end if;
  if v_message.author_id <> v_user then
    raise exception 'message_error:not_allowed' using errcode = 'insufficient_privilege';
  end if;
  if v_message.deleted_at is not null then
    raise exception 'message_error:deleted' using errcode = 'check_violation';
  end if;

  select * into v_channel from channels c where c.id = v_message.channel_id;
  if v_channel.archived_at is not null then
    raise exception 'message_error:archived' using errcode = 'check_violation';
  end if;
  if v_channel.read_only and not can_moderate(v_channel.community_id) then
    raise exception 'message_error:read_only' using errcode = 'insufficient_privilege';
  end if;

  if length(v_body) > 4000 then
    raise exception 'message_error:too_long' using errcode = 'check_violation';
  end if;
  if v_body = '' and not exists (select 1 from message_attachments a where a.message_id = v_message.id) then
    raise exception 'message_error:empty' using errcode = 'check_violation';
  end if;

  -- Saving the same text again is not an edit.
  if v_body = v_message.body then
    return v_message;
  end if;

  update messages set body = v_body, edited_at = now()
  where id = v_message.id
  returning * into v_message;
  return v_message;
end;
$$;

comment on function public.edit_channel_message(uuid, text) is
  'The author changes the text of their own channel message. Not in an archived channel, not a deleted message; on a restricted channel only while they may write there. Returns the stored row.';

create or replace function public.delete_channel_message(p_message_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_message messages%rowtype;
  v_channel channels%rowtype;
  v_own boolean;
  v_moderates boolean;
begin
  select * into v_message from messages m where m.id = p_message_id for update;
  if v_user is null or not found or not can_read_channel(v_message.channel_id) then
    raise exception 'message_error:not_found' using errcode = 'insufficient_privilege';
  end if;

  v_own := v_message.author_id = v_user;
  v_moderates := channel_message_moderate_admits(v_user, v_message.channel_id);
  if not v_own and not v_moderates then
    raise exception 'message_error:not_allowed' using errcode = 'insufficient_privilege';
  end if;

  -- Already gone: the same answer again, for anyone who could have done it.
  if v_message.deleted_at is not null then
    return case when v_message.removed_by_moderator then 'moderator' else 'author' end;
  end if;

  select * into v_channel from channels c where c.id = v_message.channel_id;
  if v_channel.archived_at is not null and not v_moderates then
    raise exception 'message_error:archived' using errcode = 'check_violation';
  end if;

  -- Files: rows now (placements and resource pins cascade, objects are
  -- queued for the sweep), the pin of the message itself, then the text.
  delete from message_attachments a where a.message_id = v_message.id;
  delete from channel_pinned_messages p where p.message_id = v_message.id;

  update messages
     set body = '',
         attachment = null,
         reactions = '[]'::jsonb,
         edited_at = null,
         deleted_at = now(),
         removed_by_moderator = not v_own
   where id = v_message.id;

  if not v_own then
    insert into message_moderation_log (community_id, channel_id, message_id, actor_id, action)
    values (v_channel.community_id, v_channel.id, v_message.id, v_user, 'remove');
  end if;

  return case when v_own then 'author' else 'moderator' end;
end;
$$;

comment on function public.delete_channel_message(uuid) is
  'Deletes a channel message, leaving a placeholder: its author, or someone who moderates the channel (channel_message_moderate_admits; logged). Text, reactions and files go; the pin goes. Returns ''author'' or ''moderator'', the same again on a repeat.';

create or replace function public.set_channel_message_pinned(p_message_id uuid, p_pinned boolean)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_message messages%rowtype;
  v_channel channels%rowtype;
  v_current uuid;
begin
  select * into v_message from messages m where m.id = p_message_id;
  if v_user is null or p_pinned is null or not found or not can_read_channel(v_message.channel_id) then
    raise exception 'message_error:not_found' using errcode = 'insufficient_privilege';
  end if;
  if not channel_message_moderate_admits(v_user, v_message.channel_id) then
    raise exception 'message_error:not_allowed' using errcode = 'insufficient_privilege';
  end if;

  -- One channel's pin at a time, so two replacements cannot interleave.
  select * into v_channel from channels c where c.id = v_message.channel_id for update;
  if v_channel.archived_at is not null then
    raise exception 'message_error:archived' using errcode = 'check_violation';
  end if;

  select p.message_id into v_current from channel_pinned_messages p where p.channel_id = v_channel.id;

  if not p_pinned then
    if v_current is distinct from v_message.id then
      return true;
    end if;
    delete from channel_pinned_messages p where p.channel_id = v_channel.id;
    insert into message_moderation_log (community_id, channel_id, message_id, actor_id, action)
    values (v_channel.community_id, v_channel.id, v_message.id, v_user, 'unpin');
    return true;
  end if;

  if v_message.deleted_at is not null then
    raise exception 'message_error:deleted' using errcode = 'check_violation';
  end if;
  if v_current = v_message.id then
    return true;
  end if;

  insert into channel_pinned_messages (channel_id, message_id, pinned_by)
  values (v_channel.id, v_message.id, v_user)
  on conflict (channel_id) do update
    set message_id = excluded.message_id, pinned_by = excluded.pinned_by, pinned_at = now();
  insert into message_moderation_log (community_id, channel_id, message_id, actor_id, action)
  values (v_channel.community_id, v_channel.id, v_message.id, v_user, 'pin');
  return true;
end;
$$;

comment on function public.set_channel_message_pinned(uuid, boolean) is
  'Pins a message beneath its channel''s header, replacing any other, or unpins it. For whoever moderates the channel; not in an archived channel; never a deleted message. Logged.';

-- ── Direct messages ─────────────────────────────────────────────────────

-- The recipient's unread notice quotes the start of the message it was raised
-- for (direct_message_after_insert). When that text changes or goes, the
-- quote follows. Notices may not be updated in place (notifications_guard_
-- immutable), so the row is replaced with the same id, time and read state.
create or replace function public.direct_message_requote_notification(
  p_message direct_messages,
  p_old_body text,
  p_new_quote text
)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_conversation direct_conversations%rowtype;
  v_community_name text;
  v_prefix text;
begin
  select * into v_conversation from direct_conversations dc where dc.id = p_message.conversation_id;
  if not found then
    return;
  end if;
  select c.name into v_community_name from communities c where c.id = v_conversation.community_id;
  v_prefix := coalesce(v_community_name, 'Fellesskapet') || ' · ';

  with gone as (
    delete from notifications n
    where n.user_id = case
            when v_conversation.participant_one_id = p_message.author_id then v_conversation.participant_two_id
            else v_conversation.participant_one_id
          end
      and n.kind = 'direct_message'
      and n.href = '/community/' || v_conversation.community_id || '/messages/' || v_conversation.id
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

create or replace function public.edit_direct_message(p_message_id uuid, p_body text)
returns public.direct_messages language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_message direct_messages%rowtype;
  v_old_body text;
  v_body text := btrim(coalesce(p_body, ''), E' \t\n\r');
begin
  select * into v_message from direct_messages dm where dm.id = p_message_id for update;
  if v_user is null or not found or not is_direct_conversation_participant(v_message.conversation_id, v_user) then
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

comment on function public.edit_direct_message(uuid, text) is
  'The author changes the text of their own direct message while the conversation can be replied to. Never the other participant''s. Returns the stored row.';

create or replace function public.delete_direct_message(p_message_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_message direct_messages%rowtype;
  v_old_body text;
begin
  select * into v_message from direct_messages dm where dm.id = p_message_id for update;
  if v_user is null or not found or not is_direct_conversation_participant(v_message.conversation_id, v_user) then
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

comment on function public.delete_direct_message(uuid) is
  'The author deletes their own direct message, leaving a placeholder. Its text and files go, and the recipient''s notice stops quoting it. Returns ''author'', the same again on a repeat.';

-- ── Who may call what ───────────────────────────────────────────────────

revoke all on function public.can_moderate_channel_messages(text) from public, anon;
revoke all on function public.edit_channel_message(uuid, text) from public, anon;
revoke all on function public.delete_channel_message(uuid) from public, anon;
revoke all on function public.set_channel_message_pinned(uuid, boolean) from public, anon;
revoke all on function public.edit_direct_message(uuid, text) from public, anon;
revoke all on function public.delete_direct_message(uuid) from public, anon;

grant execute on function public.can_moderate_channel_messages(text) to authenticated;
grant execute on function public.edit_channel_message(uuid, text) to authenticated;
grant execute on function public.delete_channel_message(uuid) to authenticated;
grant execute on function public.set_channel_message_pinned(uuid, boolean) to authenticated;
grant execute on function public.edit_direct_message(uuid, text) to authenticated;
grant execute on function public.delete_direct_message(uuid) to authenticated;
