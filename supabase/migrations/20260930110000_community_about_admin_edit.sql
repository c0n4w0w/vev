-- Lets a community's active administrator edit `communities.about` — the
-- "Om fellesskapet" text on the overview page — from the app.
--
-- The column already exists (`init.sql`) and was write-once, filled only by
-- the seed script. This adds the one door through which it can change
-- afterwards: an admin-only, length-checked function, mirroring
-- `set_community_avatar()` and `update_my_community_profile()`.
--
-- No UPDATE policy is added to `communities` — same reasoning as those two.
-- A policy permissive enough to let an admin change `about` would have to be
-- expressed against the finished row, which cannot tell "changed about" apart
-- from "changed name" or "changed access_policy". Routing the one column
-- through a function keeps the statement narrow and written once.

alter table public.communities
  add constraint communities_about_length check (length(about) <= 1500);

create or replace function public.set_community_about(
  p_community_id text,
  p_about text
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_about text := btrim(coalesce(p_about, ''));
  v_stored text;
begin
  if auth.uid() is null or not public.is_admin(p_community_id) then
    return null;
  end if;

  if length(v_about) > 1500 then
    return null;
  end if;

  update public.communities
     set about = v_about
   where id = p_community_id
  returning about into v_stored;

  return v_stored;
end;
$$;

comment on function public.set_community_about(text, text) is
  'Admin-only. Sets communities.about for one community and returns the stored value, or null when the caller is not an active admin of that community or the text is too long.';

revoke execute on function public.set_community_about(text, text) from public, anon;
grant execute on function public.set_community_about(text, text) to authenticated;
