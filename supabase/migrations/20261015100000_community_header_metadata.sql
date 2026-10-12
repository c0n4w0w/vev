-- Corrects the organisation metadata shown in the community Overview header.
--
-- Fresh databases get this from lib/mock/communities.ts via `npm run seed`;
-- this brings existing databases to the same values. Each statement is keyed
-- by community id, so no other community is touched, and the guard on the old
-- value means a value someone has since edited on purpose is left alone.
-- `links[0]` is the organisation's official website (see communityWebsite()).

-- Tryggere Ungdom: nationwide, established 2018, official website.
update public.communities
   set location = 'Landsdekkende',
       founded_year = 2018,
       links = jsonb_set(
         links, '{0}',
         '{"label": "tryggereungdom.no", "href": "https://tryggereungdom.no"}'::jsonb)
 where id = 'tryggere-ungdom'
   and location = 'Oslo, Bergen, Trondheim'
   and founded_year = 2019;

-- Foreningen Tryggere Ruspolitikk: nationwide, official website rusreform.no.
-- Founding year is left as it is. The earlier tryggereruspolitikk.no links were
-- not the organisation's site; the unverified "Høringssvar" link is dropped.
update public.communities
   set location = 'Landsdekkende',
       links = '[{"label": "rusreform.no", "href": "https://rusreform.no"},
                 {"label": "Bli medlem", "href": "https://rusreform.no/bli-medlem"}]'::jsonb
 where id = 'tryggere-ruspolitikk'
   and location = 'Oslo, Bergen, Trondheim, Tromsø';
