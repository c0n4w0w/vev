-- Adds the organisational contact address for two staff cards in Foreningen
-- Tryggere Ruspolitikk's directory.
--
-- Fresh databases get this from lib/mock/community-people.ts via
-- `npm run seed`; this brings existing databases to the same values.
--
-- These are the addresses the organisation publishes for its staff. They are
-- not sign-in addresses: auth.users, profiles and memberships are untouched,
-- and so is community_people.user_id, which keeps linking each card to the
-- same account as before.
--
-- Each statement names one existing card by community, section and name, so
-- nothing is inserted and no other community is touched. The guard on a
-- missing address means one somebody has since entered on purpose is left
-- alone, and running this twice changes nothing.

update public.community_people
   set email = 'mia@rusreform.no'
 where community_id = 'tryggere-ruspolitikk'
   and section = 'staff'
   and name = 'Mia Minge'
   and email is null;

update public.community_people
   set email = 'erlend@rusreform.no'
 where community_id = 'tryggere-ruspolitikk'
   and section = 'staff'
   and name = 'Erlend Thonstad'
   and email is null;
