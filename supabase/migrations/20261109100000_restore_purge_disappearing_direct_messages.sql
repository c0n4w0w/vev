-- After a database restore: delete every disappearing direct message that
-- the restore brought back.
--
-- A disappearing message's timer starts at the recipient's first read
-- (20261107100000). A restore to a point before that read brings the row
-- back with read_at null, so its expires_at is created_at + 30 days again:
-- a message that had already disappeared — or been deleted by the sweep —
-- becomes readable to both participants once more. The same goes for every
-- disappearing message whose timer had run out after the restore target but
-- before the restore itself.
--
-- The restored database cannot tell which of its disappearing messages were
-- still meant to exist. So the rule after any restore is: before the app
-- opens again, every disappearing message created before the restore target
-- is deleted, unread or not, expired or not. Ordinary messages are not
-- touched. See docs/ops/post-restore.md.
--
-- Files go by cascade into message_attachment_purges, the same queue every
-- other deletion uses; `npm run attachments:sweep` then removes the objects
-- through the Storage API. Notices that name a message go by cascade. The
-- conversations' own setting (direct_conversations.disappear_seconds) and
-- the setting notices stay: they carry no message content.

-- p_conversation_ids limits it to those conversations, for the check suite;
-- after a real restore it is left out (all conversations).
create or replace function public.purge_restored_disappearing_direct_messages(
  p_restored_to timestamptz,
  p_conversation_ids uuid[] default null
)
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_count integer;
begin
  -- A cutoff in the future would also take messages written after the app
  -- reopened; a missing one is a mistake, not "everything".
  if p_restored_to is null or p_restored_to > now() then
    raise exception 'restore_purge:invalid_cutoff' using errcode = 'check_violation';
  end if;

  with gone as (
    delete from direct_messages dm
    where dm.disappear_seconds is not null
      and dm.created_at < p_restored_to
      and (p_conversation_ids is null or dm.conversation_id = any(p_conversation_ids))
    returning 1
  )
  select count(*)::integer into v_count from gone;
  return v_count;
end;
$$;

comment on function public.purge_restored_disappearing_direct_messages(timestamptz, uuid[]) is
  'Post-restore step: deletes every disappearing direct message created before the restore target (files by cascade into the Storage purge queue, notices by cascade), whether or not it has expired. Run before the app reopens, then run the sweep. Service role only.';

revoke all on function public.purge_restored_disappearing_direct_messages(timestamptz, uuid[]) from public, anon, authenticated, service_role;
grant execute on function public.purge_restored_disappearing_direct_messages(timestamptz, uuid[]) to service_role;
