-- Two corrections to 20261101100000 (editing, deleting and moderating chat
-- messages).
--
-- ── 1. Own messages may be deleted in an archived channel ───────────────
--
-- delete_channel_message() no longer refuses an author because the channel
-- is archived. Everything else about it is unchanged: the author must still
-- be able to read the channel now (can_read_channel), moderators keep their
-- scope, the placeholder and the attachment cleanup are the same. An archived
-- channel still takes no new message, upload, edit or pin change:
-- messages_not_archived, message_attachment_policy_for ('archived'),
-- edit_channel_message and set_channel_message_pinned are untouched.
--
-- ── 2. DM file sharing stays open once both have written ────────────────
--
-- Between two ordinary members, files unlock once each has sent a message
-- with text. That used to be read from the messages themselves, so deleting
-- (or editing away) one's only text closed it again. Now the conversation
-- records it: `participant_one_wrote` / `participant_two_wrote`, set by
-- direct_message_after_insert when a participant's message with text is
-- inserted under a member's session — the insert policy (author is the
-- caller, both still active members) or send_direct_message_with_attachments.
-- An attachment-only message (empty body) does not count; neither does a row
-- written with the server's key. A guard keeps the flags false on insert and
-- one-way afterwards, and no API role may insert or update
-- direct_conversations at all. message_attachment_policy_for reads the flags.
-- Membership, blocking by status and the "closed" rule are checked as before,
-- at every upload and send. The flags say only that each person has written,
-- which both already know; they expose no message content.
--
-- Existing conversations: each flag is set from the participant's own
-- messages that still have text — exactly what the old rule read, so no
-- conversation gains or loses access by this migration.

-- ── 1 ───────────────────────────────────────────────────────────────────

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

  -- An archived channel takes no new messages, edits or pins, but its
  -- readers may still take their own words back, and its moderators may
  -- still remove anyone's.
  select * into v_channel from channels c where c.id = v_message.channel_id;

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

-- ── 2 ───────────────────────────────────────────────────────────────────

alter table public.direct_conversations
  add column participant_one_wrote boolean not null default false,
  add column participant_two_wrote boolean not null default false;

comment on column public.direct_conversations.participant_one_wrote is
  'participant_one has sent at least one message with text here. Set by direct_message_after_insert; never reset, also when that message is edited or deleted.';
comment on column public.direct_conversations.participant_two_wrote is
  'participant_two has sent at least one message with text here. Set by direct_message_after_insert; never reset, also when that message is edited or deleted.';

update public.direct_conversations dc
   set participant_one_wrote = exists (
         select 1 from public.direct_messages dm
         where dm.conversation_id = dc.id and dm.author_id = dc.participant_one_id and dm.body ~ '\S'
       ),
       participant_two_wrote = exists (
         select 1 from public.direct_messages dm
         where dm.conversation_id = dc.id and dm.author_id = dc.participant_two_id and dm.body ~ '\S'
       );

create or replace function public.direct_conversations_guard_wrote()
returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.participant_one_wrote := false;
    new.participant_two_wrote := false;
  elsif (old.participant_one_wrote and not new.participant_one_wrote)
     or (old.participant_two_wrote and not new.participant_two_wrote)
  then
    raise exception 'direct_conversation_wrote_is_permanent' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

revoke all on function public.direct_conversations_guard_wrote() from public, anon, authenticated, service_role;

create trigger direct_conversations_guard_wrote
  before insert or update on public.direct_conversations
  for each row execute function public.direct_conversations_guard_wrote();

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

    insert into notifications (user_id, kind, community_id, title, body, href)
    select
      v_recipient,
      'direct_message',
      v_conversation.community_id,
      'Ny melding fra ' || coalesce(v_author_name, 'et medlem'),
      coalesce(v_community_name, 'Fellesskapet') || ' · ' || case
        when btrim(new.body) = '' then 'Vedlegg'
        else left(btrim(new.body), 120)
      end,
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

revoke all on function public.direct_message_after_insert() from public, anon, authenticated, service_role;

create or replace function public.message_attachment_policy_for(p_user_id uuid, p_channel_id text, p_conversation_id uuid)
 RETURNS TABLE(allowed boolean, reason text, max_bytes bigint, max_files integer, community_id text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
#variable_conflict use_column
declare
  v_channel channels%rowtype;
  v_conversation direct_conversations%rowtype;
  v_other uuid;
  v_organizational boolean;
begin
  allowed := false;
  reason := 'not_found';
  max_bytes := 0;
  max_files := 0;
  community_id := null;

  if p_user_id is null or (p_channel_id is null) = (p_conversation_id is null) then
    return next;
    return;
  end if;

  -- ── Channels ──
  if p_channel_id is not null then
    select * into v_channel from channels c where c.id = p_channel_id;
    if not found or not channel_access_admits(
      p_user_id, v_channel.community_id, v_channel.local_group_id,
      v_channel.subgroup_id, v_channel.id, v_channel.is_private
    ) then
      return next;
      return;
    end if;

    community_id := v_channel.community_id;

    -- Private lokallag channels and group chats always; a community's own
    -- channel or a lokallag's main chat while file sharing is switched on
    -- (channels_file_sharing_scope keeps the flag off everything else).
    if not (
      v_channel.is_private
      or v_channel.subgroup_id is not null
      or v_channel.file_sharing_enabled
    ) then
      reason := 'unsupported';
      return next;
      return;
    end if;

    max_bytes := 26214400;
    max_files := 5;

    if v_channel.archived_at is not null then
      reason := 'archived';
    elsif v_channel.read_only and not exists (
      select 1 from memberships m
      where m.community_id = v_channel.community_id
        and m.user_id = p_user_id
        and m.status = 'active'
        and m.role in ('admin', 'moderator')
    ) then
      reason := 'read_only';
    else
      allowed := true;
      reason := 'ok';
    end if;

    return next;
    return;
  end if;

  -- ── Direct messages ──
  select * into v_conversation from direct_conversations dc where dc.id = p_conversation_id;
  if not found
     or p_user_id not in (v_conversation.participant_one_id, v_conversation.participant_two_id)
     or not exists (
       select 1 from memberships m
       where m.community_id = v_conversation.community_id
         and m.user_id = p_user_id
         and m.status = 'active'
     )
  then
    return next;
    return;
  end if;

  community_id := v_conversation.community_id;
  v_other := case
    when v_conversation.participant_one_id = p_user_id then v_conversation.participant_two_id
    else v_conversation.participant_one_id
  end;

  v_organizational :=
    exists (
      select 1 from communities c
      where c.id = v_conversation.community_id and c.dm_policy = 'staff_only'
    )
    and exists (
      select 1 from memberships m
      where m.community_id = v_conversation.community_id
        and m.user_id in (p_user_id, v_other)
        and m.status = 'active'
        and m.role in ('admin', 'moderator')
    );

  if v_organizational then
    max_bytes := 26214400;
    max_files := 5;
  else
    max_bytes := 10485760;
    max_files := 3;
  end if;

  if not exists (
    select 1 from memberships m
    where m.community_id = v_conversation.community_id
      and m.user_id = v_other
      and m.status = 'active'
  ) then
    reason := 'closed';
  -- Both have sent text at some point (recorded on the conversation by
  -- direct_message_after_insert), whatever has since been edited or deleted.
  elsif not v_organizational
    and not (v_conversation.participant_one_wrote and v_conversation.participant_two_wrote)
  then
    reason := 'needs_mutual';
  else
    allowed := true;
    reason := 'ok';
  end if;

  return next;
end;
$function$;
