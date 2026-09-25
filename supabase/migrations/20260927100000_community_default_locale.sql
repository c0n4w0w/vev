-- The language a community's interface is written in.
--
-- Until now every screen was Norwegian, which stopped being true when Under
-- The Rug joined: its members work in English. Inside a community the
-- interface should follow that community, not the platform, so the choice is
-- stored on the community itself rather than derived from its slug.
--
-- This is presentation, not authorisation. Nothing in a policy or function
-- reads it, and changing it grants or removes no access. It only decides which
-- dictionary the application picks its interface words from.
--
-- The allowed set is a constraint, not free text. Adding a language later is a
-- deliberate two-part change — a dictionary in the application and a widening
-- of this check — so a typo cannot leave a community with a locale nothing
-- can render.

alter table public.communities
  add column default_locale text not null default 'nb';

alter table public.communities
  add constraint communities_default_locale_allowed
  check (default_locale in ('nb', 'en'));

comment on column public.communities.default_locale is
  'Language of the interface inside this community: nb (Norwegian Bokmål) or en (English). Presentation only — never consulted for access.';

-- Existing deployments: Under The Rug works in English. A fresh database gets
-- this from the seed as well; the update keeps a migrated one in step.
update public.communities set default_locale = 'en' where id = 'under-the-rug';

-- ── Public surfaces that must know the language before anyone signs in ───
--
-- The portal and the invitation page render for people with no session, so the
-- locale has to come out of the same two functions that already expose one
-- community at a time. It adds one short code to what those return; it does
-- not add a way to list or discover communities.

drop function if exists public.portal_by_slug(text);

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
  member_count int,
  links jsonb,
  default_locale text
)
language sql security definer stable set search_path = public as $$
  select c.id, c.slug, c.name, c.tagline, c.public_description, c.location,
         c.founded_year, c.accent, c.accent_soft, c.monogram, c.mark_style,
         c.access_policy, c.member_count, c.links, c.default_locale
  from communities c
  where c.slug = p_slug;
$$;

revoke execute on function public.portal_by_slug(text) from public;
grant execute on function public.portal_by_slug(text) to anon, authenticated;

drop function if exists public.invitation_preview(text);

create function public.invitation_preview(p_token text)
returns table (
  community_id text,
  community_name text,
  community_slug text,
  email text,
  expires_at timestamptz,
  auto_activate boolean,
  community_default_locale text
)
language sql security definer stable set search_path = public, extensions as $$
  select c.id, c.name, c.slug, i.email, i.expires_at, i.request_id is not null,
         c.default_locale
  from invitations i
  join communities c on c.id = i.community_id
  where i.token_hash = hash_invitation_token(p_token)
    and i.accepted_at is null
    and i.revoked_at is null
    and i.expires_at > now();
$$;

revoke execute on function public.invitation_preview(text) from public;
grant execute on function public.invitation_preview(text) to anon, authenticated;
