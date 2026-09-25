-- The account row is written by the server, never by its owner directly.
--
-- `profiles` is the account: id, email, handle, account name and creation
-- date. How a person appears to others lives in `community_profiles` since
-- 20260926100000. Until now the first migration's `profiles_update_self`
-- policy, together with the default table grants, let a signed-in user rewrite
-- any column of their own row — including `email` and `id` — straight through
-- the API. Nothing in the application writes this table (the only writers are
-- the sign-up trigger and the service-role seed), so there is no legitimate
-- client write to preserve, and the narrowest correct answer is none at all.
--
-- The login address belongs to Supabase Auth. It changes only through Auth's
-- own email-change flow, and `profiles.email` follows it by trigger, so the
-- copy here can never be set to anything Auth has not confirmed.

drop policy if exists profiles_update_self on public.profiles;

revoke insert, update, delete, truncate, references, trigger on public.profiles from anon, authenticated;
-- anon has no select policy either; take away the grant too so the table is
-- plainly not part of the anonymous surface.
revoke select on public.profiles from anon;

-- ── Email follows Auth ──────────────────────────────────────────────────

create or replace function public.sync_profile_email()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.profiles
     set email = new.email
   where id = new.id
     and email is distinct from new.email;
  return new;
end;
$$;

revoke execute on function public.sync_profile_email() from public, anon, authenticated;

create trigger on_auth_user_email_changed
after update of email on auth.users
for each row
when (new.email is distinct from old.email and new.email is not null)
execute function public.sync_profile_email();

-- Any drift that already exists is corrected once, from the same source.
update public.profiles p
   set email = u.email
  from auth.users u
 where u.id = p.id
   and u.email is not null
   and p.email is distinct from u.email;
