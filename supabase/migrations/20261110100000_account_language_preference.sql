-- No preference preserves each community's existing default. This belongs to
-- the private account, never to a community profile or a membership.
alter table public.profiles
  add column preferred_locale text
  constraint profiles_preferred_locale_allowed check (preferred_locale in ('nb', 'en'));

comment on column public.profiles.preferred_locale is
  'Optional account UI language. Overrides community defaults; null preserves them. Never shared with community members.';

-- Keep profiles locked. The sole member write takes its target from auth.uid()
-- and can change only this presentation preference, never identity or email.
create function public.set_my_locale(p_locale text)
returns text language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = 'insufficient_privilege';
  end if;
  if p_locale is null or p_locale not in ('nb', 'en') then
    raise exception 'Unsupported locale' using errcode = 'check_violation';
  end if;
  update public.profiles set preferred_locale = p_locale where id = auth.uid();
  if not found then
    raise exception 'Account not found' using errcode = 'insufficient_privilege';
  end if;
  return p_locale;
end;
$$;

revoke all on function public.set_my_locale(text) from public, anon, authenticated, service_role;
grant execute on function public.set_my_locale(text) to authenticated;
