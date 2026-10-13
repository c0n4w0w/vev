-- A community's member count is counted, not kept.
--
-- `communities.member_count` was a number somebody wrote down: the showcase
-- seed set it to a figure of its own choosing, nothing changed it when a
-- membership did, and a community with two members said "1 medlem". It was
-- also the one figure about a community's membership that anyone could read:
-- portal_by_slug() returned it to every visitor, signed in or not, and every
-- member saw it in the community's header — in communities whose member list
-- is closed to members precisely because who, and how many, is the sensitive
-- part (member_directory_visibility = 'admin_only').
--
-- There is nothing to keep in step if the number is not stored. Whoever may
-- already list a community's membership — can_view_member_directory(), the
-- same rule the row level security on `memberships` rests on — counts the
-- active rows they can read. Nobody else is shown a number, and there is none
-- left to ask the database for.
--
-- No policy changes and no new function: the count needs neither. Lokallag
-- counts are a separate matter and already work this way
-- (local_group_member_counts, 20261019100000).

-- The public portal no longer says how many members a community has. The
-- function is recreated because its return type changes; everything else
-- about it is as 20260927100000 left it.
drop function public.portal_by_slug(text);

create function public.portal_by_slug(p_slug text)
returns table (
  id text,
  slug text,
  name text,
  tagline text,
  public_description text,
  location text,
  founded_year int,
  accent text,
  accent_soft text,
  monogram text,
  mark_style text,
  access_policy access_policy,
  links jsonb,
  default_locale text
)
language sql security definer stable set search_path = public as $$
  select c.id, c.slug, c.name, c.tagline, c.public_description, c.location,
         c.founded_year, c.accent, c.accent_soft, c.monogram, c.mark_style,
         c.access_policy, c.links, c.default_locale
  from communities c
  where c.slug = p_slug;
$$;

-- A new function is callable by everyone until told otherwise
-- (20261026100000). The portal is for visitors and members alike, and for
-- nobody as PUBLIC.
revoke all on function public.portal_by_slug(text) from public;
grant execute on function public.portal_by_slug(text) to anon, authenticated;

alter table public.communities drop column member_count;
