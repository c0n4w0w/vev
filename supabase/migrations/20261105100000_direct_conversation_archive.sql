-- Archive and delete for direct conversations, replacing «Fjern fra
-- innboksen» and «Slett samtalehistorikk» (20261104100000).
--
-- Builds on that migration: the same per-participant row
-- (direct_conversation_states), the same message numbering under the
-- conversation's lock, the same read rules. What changes is what a member
-- can ask for.
--
-- ── Arkiver samtale (archive) ───────────────────────────────────────────
--
-- Personal and reversible. The conversation moves from the caller's inbox
-- to their «Arkiverte samtaler» and stays there — also when new messages
-- arrive, when the caller replies, and when they open it through a contact
-- flow — until they restore it (restore_direct_conversation). Nothing about
-- the conversation itself changes: messages, files, notices and unread
-- state work as before, for both. The other participant is not affected.
--
-- ── Slett samtale (delete) ──────────────────────────────────────────────
--
-- What clear_direct_conversation_history did, under its new name: every
-- message so far becomes permanently unreadable to the caller (the cutoff
-- in cleared_through_seq, taken under the conversation's lock), with its
-- files and the caller's notices; the conversation leaves the inbox and the
-- archive (`hidden_at`) until a later message brings it back to the inbox,
-- showing only what came after. The thread is reused; nothing is duplicated.
-- The other participant keeps their copy.
--
-- ── Physical purge ──────────────────────────────────────────────────────
--
-- A message numbered at or below BOTH participants' cutoffs can never be
-- read by anyone again: the cutoffs only move forward (the guard from
-- 20261104100000), and the conversation has exactly two participants. Such
-- messages are deleted in the same transaction as the delete that made
-- them unreachable, while it still holds the conversation's lock — so a
-- message sent at that moment is numbered above the cutoff and is never
-- touched. Their files go by cascade: each attachment row leaves its object
-- names in message_attachment_purges (20261024100000), and the server
-- removes those through the Storage API after the delete
-- (purgeAttachmentObjects). A failed removal stays queued and is retried by
-- the next purge or `npm run attachments:sweep`. Nothing else is purged:
-- a message either participant can still read — including one whose reader
-- has merely lost their membership for now — is left alone.
--
-- `hidden_at` now means only "deleted, and nothing new since". The rows it
-- was set on by «Fjern fra innboksen» alone (no cutoff) become archived.

-- ── State ───────────────────────────────────────────────────────────────

alter table public.direct_conversation_states
  add column archived_at timestamptz;

comment on column public.direct_conversation_states.archived_at is
  'Set while the conversation is in this person''s «Arkiverte samtaler». Only archive_direct_conversation() and restore_direct_conversation() change it, and delete_direct_conversation() clears it. New messages do not.';
comment on column public.direct_conversation_states.hidden_at is
  'Set when this person deleted the conversation: out of their inbox and archive until the next message in it (direct_message_assign_seq).';

-- Hidden without a cutoff was «Fjern fra innboksen»: now an archive.
update public.direct_conversation_states
   set archived_at = hidden_at,
       hidden_at = null
 where hidden_at is not null
   and cleared_at is null;

create index direct_conversation_states_archived_idx
  on public.direct_conversation_states (user_id) where archived_at is not null;

-- ── Replaced functions ──────────────────────────────────────────────────

drop function public.hide_direct_conversation(uuid);
drop function public.clear_direct_conversation_history(uuid);
drop function public.direct_inbox(text, integer);

-- The caller's inbox (p_archived false) or archive (true) in one
-- community, newest first. A deleted conversation with nothing new is in
-- neither. Runs as the caller, under the conversations' own policy.
create or replace function public.direct_inbox(
  p_community_id text,
  p_limit integer default null,
  p_archived boolean default false
)
returns setof public.direct_conversations
language sql stable security invoker set search_path = public as $$
  select dc.*
  from direct_conversations dc
  left join direct_conversation_states s
    on s.conversation_id = dc.id
   and s.user_id = auth.uid()
  where dc.community_id = p_community_id
    and s.hidden_at is null
    and (s.archived_at is not null) = coalesce(p_archived, false)
  order by dc.last_message_at desc, dc.id
  limit p_limit;
$$;

revoke all on function public.direct_inbox(text, integer, boolean) from public, anon, service_role;
grant execute on function public.direct_inbox(text, integer, boolean) to authenticated;

-- Refusals are raised as `conversation_error:<reason>`.

create or replace function public.archive_direct_conversation(p_conversation_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null or not is_direct_conversation_participant(p_conversation_id, v_user) then
    raise exception 'conversation_error:not_found' using errcode = 'insufficient_privilege';
  end if;

  insert into direct_conversation_states (conversation_id, user_id, archived_at)
  values (p_conversation_id, v_user, now())
  on conflict (conversation_id, user_id) do update
    set archived_at = coalesce(direct_conversation_states.archived_at, excluded.archived_at);

  return true;
end;
$$;

comment on function public.archive_direct_conversation(uuid) is
  'Moves a conversation to the caller''s own «Arkiverte samtaler» until they restore it. Nothing else changes, for either participant. Returns true; the same again on a repeat.';

create or replace function public.restore_direct_conversation(p_conversation_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null or not is_direct_conversation_participant(p_conversation_id, v_user) then
    raise exception 'conversation_error:not_found' using errcode = 'insufficient_privilege';
  end if;

  update direct_conversation_states s
     set archived_at = null
   where s.conversation_id = p_conversation_id
     and s.user_id = v_user
     and s.archived_at is not null;

  return true;
end;
$$;

comment on function public.restore_direct_conversation(uuid) is
  'Moves an archived conversation back to the caller''s inbox. Returns true; the same again when it was not archived.';

-- Deletes, for good, the messages in one conversation that neither
-- participant can read any more: numbered at or below both cutoffs. The
-- caller holds the conversation's lock. Not for clients.
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

create or replace function public.delete_direct_conversation(p_conversation_id uuid)
returns bigint language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_conversation direct_conversations%rowtype;
  v_stored bigint;
begin
  if v_user is null or not is_direct_conversation_participant(p_conversation_id, v_user) then
    raise exception 'conversation_error:not_found' using errcode = 'insufficient_privilege';
  end if;

  -- Numbering takes this lock and keeps it to commit, so once it is ours
  -- every number up to message_seq belongs to a committed message.
  select * into v_conversation from direct_conversations dc where dc.id = p_conversation_id for update;

  insert into direct_conversation_states (conversation_id, user_id, hidden_at, cleared_through_seq, cleared_at)
  values (p_conversation_id, v_user, now(), v_conversation.message_seq, now())
  on conflict (conversation_id, user_id) do update
    set cleared_through_seq = greatest(direct_conversation_states.cleared_through_seq, excluded.cleared_through_seq),
        cleared_at = greatest(direct_conversation_states.cleared_at, excluded.cleared_at),
        hidden_at = coalesce(direct_conversation_states.hidden_at, excluded.hidden_at),
        archived_at = null
  returning cleared_through_seq into v_stored;

  -- The caller's own notices for it quote messages that are gone for them.
  delete from notifications n
  where n.user_id = v_user
    and n.kind = 'direct_message'
    and n.href = '/community/' || v_conversation.community_id || '/messages/' || v_conversation.id;

  -- The caller's own files that were never sent here.
  delete from message_attachments a
  where a.conversation_id = v_conversation.id
    and a.uploader_id = v_user
    and a.status <> 'sent';

  insert into direct_conversation_reads (conversation_id, user_id, last_read_at)
  values (v_conversation.id, v_user, now())
  on conflict (conversation_id, user_id) do update set last_read_at = excluded.last_read_at;

  -- Whatever neither participant can read any more, still under the lock.
  perform purge_unreachable_direct_messages(v_conversation.id);

  return v_stored;
end;
$$;

comment on function public.delete_direct_conversation(uuid) is
  'Makes every message in the conversation so far — sent and received — permanently unreadable to the caller, with its files and their notices, and removes it from their inbox and archive until a later message. The other participant keeps their copy; messages neither can read any more are deleted. Returns the stored cutoff; repeating it is harmless.';

revoke all on function public.archive_direct_conversation(uuid) from public, anon, service_role;
revoke all on function public.restore_direct_conversation(uuid) from public, anon, service_role;
revoke all on function public.delete_direct_conversation(uuid) from public, anon, service_role;
grant execute on function public.archive_direct_conversation(uuid) to authenticated;
grant execute on function public.restore_direct_conversation(uuid) to authenticated;
grant execute on function public.delete_direct_conversation(uuid) to authenticated;

-- Opening a conversation through a contact flow returns the existing thread
-- and changes nothing about where the caller keeps it: an archived one
-- stays archived, a deleted one stays out of sight until a message. As
-- 20260919191000 had it.
create or replace function public.start_direct_conversation(
  p_community_id text,
  p_recipient_id uuid
)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_sender uuid := auth.uid();
  v_one uuid;
  v_two uuid;
  v_conversation_id uuid;
begin
  if v_sender is null then
    raise exception 'Du må være logget inn for å starte en samtale'
      using errcode = 'insufficient_privilege';
  end if;

  if p_recipient_id is null or p_recipient_id = v_sender then
    raise exception 'Du kan ikke starte en samtale med deg selv'
      using errcode = 'check_violation';
  end if;

  if not exists (
    select 1 from memberships
    where community_id = p_community_id
      and user_id = v_sender
      and status = 'active'
  ) then
    raise exception 'Du er ikke aktivt medlem av dette fellesskapet'
      using errcode = 'insufficient_privilege';
  end if;

  if not exists (
    select 1 from memberships
    where community_id = p_community_id
      and user_id = p_recipient_id
      and status = 'active'
  ) then
    raise exception 'Mottakeren er ikke aktivt medlem av dette fellesskapet'
      using errcode = 'insufficient_privilege';
  end if;

  v_one := least(v_sender, p_recipient_id);
  v_two := greatest(v_sender, p_recipient_id);

  select id into v_conversation_id
  from direct_conversations
  where community_id = p_community_id
    and participant_one_id = v_one
    and participant_two_id = v_two;

  if v_conversation_id is not null then
    return v_conversation_id;
  end if;

  if not can_send_dm(p_community_id, p_recipient_id) then
    raise exception 'Du kan ikke starte en direkte melding med denne personen'
      using errcode = 'insufficient_privilege';
  end if;

  insert into direct_conversations (
    community_id,
    participant_one_id,
    participant_two_id,
    created_by
  )
  values (p_community_id, v_one, v_two, v_sender)
  on conflict (community_id, participant_one_id, participant_two_id)
  do update set last_message_at = direct_conversations.last_message_at
  returning id into v_conversation_id;

  return v_conversation_id;
end;
$$;

-- Conversations both participants had already cleared before this
-- migration: what neither can read goes now.
do $$
declare
  v_id uuid;
begin
  for v_id in
    select s.conversation_id
    from direct_conversation_states s
    group by s.conversation_id
    having count(*) = 2 and min(s.cleared_through_seq) > 0
  loop
    perform 1 from direct_conversations dc where dc.id = v_id for update;
    perform purge_unreachable_direct_messages(v_id);
  end loop;
end;
$$;
