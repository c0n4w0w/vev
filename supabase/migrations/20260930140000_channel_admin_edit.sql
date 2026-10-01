-- Lets a community's active administrator change a channel's display name and
-- description (`channels.name`, `channels.purpose`) from the channel page.
--
-- `channels.id` is the stable key: routes, messages (`messages.channel_id`)
-- and the sidebar link all use it, never the name. Only the two display
-- fields can change here; id, community_id, group_id, read_only and position
-- are untouched, so a channel cannot be renamed out from under its URL,
-- moved to another community, or have its permissions altered.
--
-- No UPDATE policy is added to `channels`, for the same reason as
-- `set_community_about()`: a policy cannot tell "changed name" from "changed
-- community_id". The one column pair goes through one admin-only function.
--
-- Duplicate names inside a community were always allowed (no unique
-- constraint exists); that model is kept.

alter table public.channels
  add constraint channels_name_valid
    check (name = btrim(name) and length(name) between 1 and 40 and name !~ '[[:cntrl:]]'),
  add constraint channels_purpose_length check (length(purpose) <= 200);

create or replace function public.set_channel_details(
  p_community_id text,
  p_channel_id text,
  p_name text,
  p_purpose text
)
returns table (name text, purpose text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text := btrim(coalesce(p_name, ''));
  v_purpose text := btrim(coalesce(p_purpose, ''));
begin
  if auth.uid() is null or not public.is_admin(p_community_id) then
    return;
  end if;

  if length(v_name) not between 1 and 40 or v_name ~ '[[:cntrl:]]' then
    return;
  end if;

  -- Newlines are not allowed in the description either: it is one line of
  -- plain text in the header.
  if length(v_purpose) > 200 or v_purpose ~ '[[:cntrl:]]' then
    return;
  end if;

  return query
    update public.channels c
       set name = v_name, purpose = v_purpose
     where c.id = p_channel_id
       and c.community_id = p_community_id
    returning c.name, c.purpose;
end;
$$;

comment on function public.set_channel_details(text, text, text, text) is
  'Admin-only. Sets name and purpose of one channel of the given community and returns the stored values; returns no row when the caller is not an active admin of that community, the channel is not in it, or the input is invalid.';

revoke execute on function public.set_channel_details(text, text, text, text) from public, anon;
grant execute on function public.set_channel_details(text, text, text, text) to authenticated;
