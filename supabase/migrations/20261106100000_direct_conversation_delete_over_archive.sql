-- Deleting a conversation takes precedence over archiving it.
--
-- delete_direct_conversation() (20261105100000) clears `archived_at`, so a
-- later message brings the conversation back to the inbox. But an archive
-- request that lands just after a delete — a second device, a double tap, a
-- stale page — would set `archived_at` again on a conversation that is
-- deleted and quiet, and its next message would then appear in the archive.
--
-- So the state row itself refuses the combination, for every writer: while
-- `hidden_at` is set (deleted, nothing new since), `archived_at` is null.
-- The rule lives in the row's guard, which both functions already pass
-- through under the row lock, so whichever order they commit in, the
-- result is the same. A new message clears `hidden_at`
-- (direct_message_assign_seq) and leaves `archived_at` null: the
-- conversation is back in the inbox, and archiving it from there works as
-- before. Nothing else in the guard changes; the deletion cutoff keeps its
-- protections.

create or replace function public.direct_conversation_states_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_conversation direct_conversations%rowtype;
begin
  if tg_op = 'DELETE' then
    -- Only with the conversation or the person: a boundary is not undone.
    if exists (select 1 from direct_conversations dc where dc.id = old.conversation_id)
       and exists (select 1 from profiles p where p.id = old.user_id)
    then
      raise exception 'direct_conversation_state_is_permanent' using errcode = 'check_violation';
    end if;
    return old;
  end if;

  select * into v_conversation from direct_conversations dc where dc.id = new.conversation_id;
  if not found or new.user_id not in (v_conversation.participant_one_id, v_conversation.participant_two_id) then
    raise exception 'direct_conversation_state_not_participant' using errcode = 'check_violation';
  end if;
  if new.cleared_through_seq > v_conversation.message_seq then
    raise exception 'direct_conversation_state_ahead' using errcode = 'check_violation';
  end if;

  if tg_op = 'UPDATE' then
    if new.conversation_id is distinct from old.conversation_id
       or new.user_id is distinct from old.user_id
    then
      raise exception 'direct_conversation_state_immutable' using errcode = 'check_violation';
    end if;
    if new.cleared_through_seq < old.cleared_through_seq
       or (old.cleared_at is not null and (new.cleared_at is null or new.cleared_at < old.cleared_at))
    then
      raise exception 'direct_conversation_state_is_permanent' using errcode = 'check_violation';
    end if;
  end if;

  -- Deleted and quiet is never archived: the next message goes to the inbox.
  if new.hidden_at is not null then
    new.archived_at := null;
  end if;

  new.updated_at := now();
  return new;
end;
$$;

revoke all on function public.direct_conversation_states_guard() from public, anon, authenticated, service_role;

-- Any row that already has both.
update public.direct_conversation_states
   set archived_at = null
 where hidden_at is not null
   and archived_at is not null;
