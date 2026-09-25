-- One account, a different face in each community.
--
-- Until now a person had exactly one presentation on TING: `profiles.name`,
-- `profiles.bio` and a monogram, the same everywhere. Every feed, thread, DM
-- and member card looked that one row up. That contradicts the model the
-- organisations actually need. Someone may be "Kari Moen" with a professional
-- bio in a civic organisation, "Kari" in its youth wing, and a pseudonym in an
-- independent cultural collective — and none of those communities should learn
-- how the person appears in the others.
--
-- ── The split ───────────────────────────────────────────────────────────
--
-- `profiles` stays what it has always been underneath: the account. Email,
-- handle, account creation date, and the default values a new community
-- profile may start from. It is not deleted and its columns are not moved.
--
-- `community_profiles` is new: one row per (community, person), holding the
-- display name, bio and profile photo that person uses *inside that one
-- community*. Membership is untouched and keeps meaning access, role, status
-- and local group; nothing about presentation is added to it.
--
-- ── Why `profiles` is closed to everyone but its owner ──────────────────
--
-- `profiles_select` let a co-member read the whole account row — real name,
-- bio, location, and email — for anyone whose content they could see in *any*
-- shared community. With a pseudonym in one community and a real name on the
-- account, that policy would hand the real name straight back to anyone who
-- asked. A community profile that can be bypassed by reading the account
-- underneath it protects nothing, so the account row is now readable by its
-- owner only. Everything that shows another person reads `community_profiles`
-- instead, through a visibility rule that is scoped to one community.
--
-- ── Where a community profile comes from ────────────────────────────────
--
-- A row is created whenever a membership becomes active, by a trigger, so the
-- application never has to handle an active member without one. The display
-- name is the one the person gave when they asked to join *this* community,
-- if they did; otherwise the account name. A request to a second community
-- therefore cannot touch the first: it is a different row, and an existing row
-- is never overwritten by initialisation. Existing memberships are backfilled
-- by the same rule, so nobody's name becomes blank.

-- ── Name normalisation ──────────────────────────────────────────────────
--
-- The same rule `request_community_access()` applies since 20260924100000:
-- ordinary whitespace and characters that draw nothing are trimmed from both
-- ends. Factored out so a display name typed on the portal and one typed in
-- the profile editor are held to exactly the same standard.

create or replace function public.normalize_display_name(p_value text)
returns text language sql immutable set search_path = public as $$
  select regexp_replace(
    coalesce(p_value, ''),
    '^[\s ​-‍⁠﻿]+|[\s ​-‍⁠﻿]+$',
    '',
    'g'
  );
$$;

-- Pure and harmless, and evaluated by a check constraint below, so it is
-- executable by whoever may write the table.
revoke execute on function public.normalize_display_name(text) from public, anon;
grant execute on function public.normalize_display_name(text) to authenticated;

-- ── Table ───────────────────────────────────────────────────────────────

create table public.community_profiles (
  community_id text not null references public.communities (id) on delete cascade,
  -- Deliberately not a foreign key to `memberships`. A person who leaves keeps
  -- the persona their old posts were written under; deleting it would leave
  -- that content either nameless or, worse, falling back to the account.
  user_id uuid not null references public.profiles (id) on delete cascade,
  display_name text not null,
  bio text not null default '',
  avatar_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (community_id, user_id),

  constraint community_profiles_display_name_present check (
    display_name = public.normalize_display_name(display_name)
    and length(display_name) between 1 and 80
  ),
  constraint community_profiles_bio_length check (length(bio) <= 500),
  -- `<community_id>/<user_id>/<uuid>.<ext>`: the photo can only ever point at
  -- this person's own files under this community's prefix.
  constraint community_profiles_avatar_path_shape check (
    avatar_path is null
    or (
      avatar_path ~ '^[^/]+/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpg|webp)$'
      and split_part(avatar_path, '/', 1) = community_id
      and split_part(avatar_path, '/', 2) = user_id::text
    )
  )
);

create index community_profiles_user_idx on public.community_profiles (user_id);

comment on table public.community_profiles is
  'How one person appears inside one community: display name, bio, profile photo. Readable per can_view_community_profile(); written only through the owner''s own functions.';
comment on column public.community_profiles.avatar_path is
  'Object path in the private member-avatars bucket, or null for the monogram fallback. Separate from communities.avatar_path, which is the community''s own image.';

alter table public.community_profiles enable row level security;

-- Reads only. There is no insert, update or delete grant: every write goes
-- through a SECURITY DEFINER function that decides whose row it touches from
-- auth.uid(), never from an argument.
revoke all on public.community_profiles from anon, authenticated;
grant select on public.community_profiles to authenticated;

-- ── Who may see a community profile ─────────────────────────────────────
--
-- Always your own. Otherwise only from inside that same community — the
-- caller must be an active member of `p_community_id` — and only for one of
-- the reasons a member already has to know the person there:
--
--   * the community's registry is open to the caller (member_directory
--     visibility, or the caller administers it) and the person is an active
--     member of it;
--   * the person wrote something the caller can read in this community — a
--     post, a comment, a channel message — or hosts one of its events;
--   * the caller and the person share a direct conversation in this community.
--
-- Every clause names `p_community_id`. Nothing here can be satisfied by what
-- happens in another community, which is the whole difference from the
-- account-level helpers the old `profiles_select` used. A community that hides
-- its member directory still shows the name on a post, because the post is
-- already visible; it does not show the people who never took part.

create or replace function public.can_view_community_profile(p_community_id text, p_user_id uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select auth.uid() is not null and (
    p_user_id = auth.uid()
    or (
      is_member(p_community_id)
      and (
        (
          can_view_member_directory(p_community_id)
          and exists (
            select 1 from memberships m
            where m.community_id = p_community_id
              and m.user_id = p_user_id
              and m.status = 'active'
          )
        )
        or exists (
          select 1 from posts p
          where p.community_id = p_community_id and p.author_id = p_user_id
        )
        or exists (
          select 1 from comments c
          join posts p on p.id = c.post_id
          where p.community_id = p_community_id and c.author_id = p_user_id
        )
        or exists (
          select 1 from messages msg
          join channels ch on ch.id = msg.channel_id
          where ch.community_id = p_community_id and msg.author_id = p_user_id
        )
        or exists (
          select 1 from events e
          where e.community_id = p_community_id and e.host_id = p_user_id
        )
        or exists (
          select 1 from direct_conversations dc
          where dc.community_id = p_community_id
            and auth.uid() in (dc.participant_one_id, dc.participant_two_id)
            and p_user_id in (dc.participant_one_id, dc.participant_two_id)
        )
      )
    )
  );
$$;

revoke execute on function public.can_view_community_profile(text, uuid) from public, anon;
grant execute on function public.can_view_community_profile(text, uuid) to authenticated;

create policy community_profiles_select on public.community_profiles
  for select to authenticated
  using (can_view_community_profile(community_id, user_id));

-- ── The account row is its owner's ──────────────────────────────────────

drop policy profiles_select on public.profiles;

create policy profiles_select on public.profiles for select to authenticated
using (id = auth.uid());

comment on function public.shares_visible_directory(uuid) is
  'DEPRECATED: account-level and cross-community. No longer used by any policy; community_profiles uses can_view_community_profile().';
comment on function public.shares_visible_authorship(uuid) is
  'DEPRECATED: account-level and cross-community. No longer used by any policy; community_profiles uses can_view_community_profile().';
comment on function public.shares_direct_conversation(uuid) is
  'DEPRECATED: account-level and cross-community. No longer used by any policy; community_profiles uses can_view_community_profile().';

-- ── Initialisation ──────────────────────────────────────────────────────
--
-- Internal: takes a user id, so it is never granted to an API role. Called by
-- the membership trigger below and by the owner-scoped functions further down,
-- which pass auth.uid().
--
-- `on conflict do nothing` is the idempotency: a repeated approval, a second
-- invitation, a re-seed or a status flip back to active finds the existing
-- row and leaves it exactly as the person last saved it.

create or replace function public.ensure_community_profile(p_community_id text, p_user_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_requested text;
  v_account profiles;
begin
  if exists (
    select 1 from community_profiles
    where community_id = p_community_id and user_id = p_user_id
  ) then
    return;
  end if;

  -- The name this person asked to be known by in *this* community, from the
  -- approved request that let them in. Bound to them by the request's own
  -- identity when it has one, otherwise by the address the request was for
  -- matching the account's — the same two ways approval itself resolves who
  -- a request belongs to.
  select normalize_display_name(ar.display_name) into v_requested
  from access_requests ar
  left join auth.users u on u.id = p_user_id
  where ar.community_id = p_community_id
    and ar.status = 'approved'
    and (
      ar.user_id = p_user_id
      or (ar.user_id is null and normalize_email(u.email) = ar.email)
    )
    and normalize_display_name(ar.display_name) <> ''
  order by ar.reviewed_at desc nulls last, ar.created_at desc
  limit 1;

  select * into v_account from profiles where id = p_user_id;
  if v_account.id is null then
    return;
  end if;

  insert into community_profiles (community_id, user_id, display_name, bio)
  values (
    p_community_id,
    p_user_id,
    left(
      coalesce(
        nullif(v_requested, ''),
        nullif(normalize_display_name(v_account.name), ''),
        'Medlem'
      ),
      80
    ),
    -- A name chosen for this community starts with an empty bio. Carrying the
    -- account bio over to a pseudonym would attach the person's account-level
    -- self-description to the one place they asked to be someone else.
    case when nullif(v_requested, '') is null then left(v_account.bio, 500) else '' end
  )
  on conflict (community_id, user_id) do nothing;
end;
$$;

revoke execute on function public.ensure_community_profile(text, uuid) from public, anon, authenticated;

create or replace function public.memberships_ensure_community_profile()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform ensure_community_profile(new.community_id, new.user_id);
  return new;
end;
$$;

revoke execute on function public.memberships_ensure_community_profile() from public, anon, authenticated;

create trigger memberships_ensure_community_profile
after insert or update of status on public.memberships
for each row
when (new.status = 'active')
execute function public.memberships_ensure_community_profile();

-- Backfill every existing active membership by the same rule.
select public.ensure_community_profile(m.community_id, m.user_id)
from public.memberships m
where m.status = 'active';

-- ── Editing your own ────────────────────────────────────────────────────
--
-- The community is the only thing a caller names. Whose row is changed comes
-- from auth.uid(), so there is no argument an administrator, a moderator or
-- anyone else could point at another member's profile. An inactive membership
-- (or none) is refused: is_member() requires status = 'active'.
--
-- Returns false for every refusal and every invalid value alike; the server
-- action validates first and is the place that explains what was wrong.

create or replace function public.update_my_community_profile(
  p_community_id text,
  p_display_name text,
  p_bio text
)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  v_name text := normalize_display_name(p_display_name);
  v_bio text := btrim(coalesce(p_bio, ''));
begin
  if auth.uid() is null or not is_member(p_community_id) then
    return false;
  end if;

  if v_name = '' or length(v_name) > 80 or length(v_bio) > 500 then
    return false;
  end if;

  insert into community_profiles (community_id, user_id, display_name, bio)
  values (p_community_id, auth.uid(), v_name, v_bio)
  on conflict (community_id, user_id) do update
    set display_name = excluded.display_name,
        bio = excluded.bio,
        updated_at = now();

  return true;
end;
$$;

revoke execute on function public.update_my_community_profile(text, text, text) from public, anon;
grant execute on function public.update_my_community_profile(text, text, text) to authenticated;

-- ── Profile photos ──────────────────────────────────────────────────────
--
-- A separate bucket from `community-avatars`, which holds each community's own
-- image. Layout: `<community_id>/<user_id>/<uuid>.<ext>`. Private, for the same
-- reasons as that bucket; a fresh uuid per upload doubles as cache-busting.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'member-avatars',
  'member-avatars',
  false,
  5242880,                                        -- 5 MiB
  array['image/png', 'image/jpeg', 'image/webp']
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Whether the caller may read one object in the bucket. Parsed defensively:
-- a name that is not exactly the upload shape is not anyone's avatar, and the
-- uuid cast only happens once the shape is known to be right.
create or replace function public.can_read_member_avatar_object(p_name text)
returns boolean language plpgsql security definer stable set search_path = public as $$
declare
  v_community text;
  v_user uuid;
begin
  if p_name is null
     or p_name !~ '^[^/]+/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpg|webp)$'
  then
    return false;
  end if;

  v_community := split_part(p_name, '/', 1);
  v_user := split_part(p_name, '/', 2)::uuid;

  -- Your own uploads, in a community you are active in.
  if v_user = auth.uid() then
    return is_member(v_community);
  end if;

  -- Someone else's: only the photo their profile currently uses, and only if
  -- that profile is one you may see. A replaced photo is not readable by
  -- anyone but its owner, even for the moment before it is cleaned up.
  return exists (
    select 1 from community_profiles cp
    where cp.community_id = v_community
      and cp.user_id = v_user
      and cp.avatar_path = p_name
  ) and can_view_community_profile(v_community, v_user);
end;
$$;

revoke execute on function public.can_read_member_avatar_object(text) from public, anon;
grant execute on function public.can_read_member_avatar_object(text) to authenticated;

create policy member_avatars_read on storage.objects for select to authenticated
using (
  bucket_id = 'member-avatars'
  and can_read_member_avatar_object(name)
);

-- Only into your own folder, only under a community you are active in, and
-- only in the exact shape the profile reference accepts.
create policy member_avatars_write on storage.objects for insert to authenticated
with check (
  bucket_id = 'member-avatars'
  and name ~ '^[^/]+/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpg|webp)$'
  and split_part(name, '/', 2) = auth.uid()::text
  and is_member(split_part(name, '/', 1))
);

create policy member_avatars_delete on storage.objects for delete to authenticated
using (
  bucket_id = 'member-avatars'
  and split_part(name, '/', 2) = auth.uid()::text
  and is_member(split_part(name, '/', 1))
);

-- No update policy: an object is written once. Replacing a photo uploads a
-- new object and swaps the reference, then removes the old one.

create or replace function public.set_my_community_avatar(
  p_community_id text,
  p_path text
)
returns table (applied boolean, previous_path text)
language plpgsql security definer set search_path = public as $$
declare
  v_previous text;
begin
  if auth.uid() is null or not is_member(p_community_id) then
    return query select false, null::text;
    return;
  end if;

  if p_path is not null then
    if split_part(p_path, '/', 1) <> p_community_id
       or split_part(p_path, '/', 2) <> auth.uid()::text
       or p_path !~ '^[^/]+/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpg|webp)$'
       or not exists (
         select 1 from storage.objects o
         where o.bucket_id = 'member-avatars' and o.name = p_path
       )
    then
      return query select false, null::text;
      return;
    end if;
  end if;

  perform ensure_community_profile(p_community_id, auth.uid());

  select cp.avatar_path into v_previous
  from community_profiles cp
  where cp.community_id = p_community_id and cp.user_id = auth.uid()
  for update;

  update community_profiles
     set avatar_path = p_path, updated_at = now()
   where community_id = p_community_id and user_id = auth.uid();

  return query select true, v_previous;
end;
$$;

comment on function public.set_my_community_avatar(text, text) is
  'Sets or clears the caller''s own profile photo in one community where they are an active member. The object must already exist in member-avatars under <community>/<caller>/. Returns the path it replaced.';

revoke execute on function public.set_my_community_avatar(text, text) from public, anon;
grant execute on function public.set_my_community_avatar(text, text) to authenticated;

-- ── Names written into notifications ────────────────────────────────────
--
-- Two triggers copy an author's name into a notification's text when it is
-- created. Both read `profiles.name`, the account name, which would put a
-- person's account identity into a notice about a community where they use a
-- different one. Both now read the author's profile in the notification's own
-- community. Existing notifications keep the text they were written with.

create or replace function public.notify_announcement()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- Only announcements. An ordinary post — pinned or not — returns here.
  if new.kind <> 'announcement' then
    return new;
  end if;

  -- The seed is not a broadcast. It loads fixtures as the service role,
  -- including three historical announcements, and its notifications are their
  -- own fixtures. Same exemption as the posts and notifications guards, and
  -- for the same reason: the service role is not a person.
  if coalesce(auth.role(), '') = 'service_role' then
    return new;
  end if;

  -- Independent of the policy that let this row in, and loud rather than
  -- silent. `posts_insert` already requires can_moderate() for an
  -- announcement, so this cannot fire today; it exists so that loosening that
  -- policy fails here instead of quietly turning a member's post into a
  -- notification for the whole community.
  if not can_moderate(new.community_id) then
    raise exception 'Bare moderatorer og administratorer kan publisere kunngjøringer'
      using errcode = 'insufficient_privilege';
  end if;

  -- Recipients are derived, never supplied: every active membership of this
  -- announcement's own community, minus the person who wrote it. The author
  -- is named as they appear in this community.
  insert into notifications (user_id, kind, community_id, title, body, href)
  select
    m.user_id,
    'announcement',
    new.community_id,
    'Ny kunngjøring: ' || coalesce(nullif(btrim(new.title), ''), left(btrim(new.body), 80)),
    coalesce(author.display_name, 'Et medlem') || ' publiserte en kunngjøring i ' || c.name,
    '/community/' || new.community_id || '/feed'
  from memberships m
  join communities c on c.id = new.community_id
  left join community_profiles author
    on author.community_id = new.community_id and author.user_id = new.author_id
  where m.community_id = new.community_id
    and m.status = 'active'
    and m.user_id <> new.author_id;

  return new;
end $$;

revoke execute on function public.notify_announcement() from public, anon, authenticated;

create or replace function public.direct_message_after_insert()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_conversation direct_conversations%rowtype;
  v_recipient uuid;
  v_author_name text;
  v_community_name text;
  v_href text;
begin
  select * into v_conversation
  from direct_conversations
  where id = new.conversation_id;

  if not found then
    return new;
  end if;

  update direct_conversations
     set last_message_at = greatest(last_message_at, new.created_at)
   where id = new.conversation_id;

  v_recipient := case
    when v_conversation.participant_one_id = new.author_id then v_conversation.participant_two_id
    else v_conversation.participant_one_id
  end;

  v_href := '/community/' || v_conversation.community_id || '/messages/' || new.conversation_id;

  if coalesce(auth.role(), '') <> 'service_role' then
    -- The author as they appear in the conversation's community.
    select cp.display_name, c.name into v_author_name, v_community_name
    from communities c
    left join community_profiles cp
      on cp.community_id = c.id and cp.user_id = new.author_id
    where c.id = v_conversation.community_id;

    insert into notifications (user_id, kind, community_id, title, body, href)
    select
      v_recipient,
      'direct_message',
      v_conversation.community_id,
      'Ny melding fra ' || coalesce(v_author_name, 'et medlem'),
      coalesce(v_community_name, 'Fellesskapet') || ' · ' || left(btrim(new.body), 120),
      v_href
    where not exists (
      select 1
      from notifications n
      where n.user_id = v_recipient
        and n.kind = 'direct_message'
        and n.href = v_href
        and n.read = false
    );
  end if;

  return new;
end;
$$;

revoke execute on function public.direct_message_after_insert()
  from public, anon, authenticated;

-- ── Organisation-directory links ────────────────────────────────────────
--
-- `community_people` stays its own thing. These two functions only change
-- where the *member* side of an explicit link takes its presentation from:
-- the linked person's profile in this community, not the account.

create or replace function public.community_person_account_links(p_community_id text)
returns table (
  person_id uuid,
  user_id uuid,
  member_name text,
  member_handle text,
  member_email text,
  membership_role community_role,
  membership_title text,
  membership_status membership_status
)
language plpgsql security definer stable set search_path = public as $$
begin
  if not is_admin(p_community_id) then
    raise exception 'Bare administratorer kan se TING-koblinger for organisasjonspersoner'
      using errcode = 'insufficient_privilege';
  end if;

  return query
    select
      cp.id,
      cp.user_id,
      prof.display_name,
      p.handle,
      p.email,
      m.role,
      m.title,
      m.status
    from community_people cp
    left join memberships m
      on m.community_id = cp.community_id
     and m.user_id = cp.user_id
    left join profiles p
      on p.id = cp.user_id
     and m.user_id is not null
    left join community_profiles prof
      on prof.community_id = cp.community_id
     and prof.user_id = cp.user_id
     and m.user_id is not null
    where cp.community_id = p_community_id
      and cp.active
      and cp.user_id is not null
    order by cp.section, cp.sort_order, cp.name;
end;
$$;

revoke execute on function public.community_person_account_links(text) from public, anon;
grant execute on function public.community_person_account_links(text) to authenticated;

create or replace function public.community_people_linked_member_details(p_community_id text)
returns table (
  person_id uuid,
  title text,
  bio text,
  location text
)
language sql security definer stable set search_path = public as $$
  select
    cp.id as person_id,
    m.title,
    prof.bio,
    p.location
  from public.community_people cp
  join public.memberships m
    on m.community_id = cp.community_id
   and m.user_id = cp.user_id
   and m.status = 'active'
  join public.profiles p
    on p.id = cp.user_id
  left join public.community_profiles prof
    on prof.community_id = cp.community_id
   and prof.user_id = cp.user_id
  where cp.community_id = p_community_id
    and cp.section = 'crew'
    and cp.active
    and cp.user_id is not null
    and public.is_member(p_community_id);
$$;

revoke execute on function public.community_people_linked_member_details(text) from public, anon;
grant execute on function public.community_people_linked_member_details(text) to authenticated;

-- ── The administrator's account picker ─────────────────────────────────
--
-- The organisation-links page lets an administrator pick which TING account
-- an official directory entry belongs to, and labels each candidate with the
-- account's handle and email so two people with similar display names can be
-- told apart. It used to read those from `profiles`, which administrators
-- could see through the old cross-community policy. That door is closed
-- above, so the picker gets exactly what it needs here: account identifiers
-- for the active members of one community, for its administrator only. An
-- administrator already sees applicants' addresses in the access-request
-- queue; this does not widen that.

create or replace function public.community_member_accounts(p_community_id text)
returns table (user_id uuid, handle text, email text)
language sql security definer stable set search_path = public as $$
  select p.id, p.handle, p.email
  from memberships m
  join profiles p on p.id = m.user_id
  where m.community_id = p_community_id
    and m.status = 'active'
    and is_admin(p_community_id);
$$;

revoke execute on function public.community_member_accounts(text) from public, anon;
grant execute on function public.community_member_accounts(text) to authenticated;
