-- A community's profile image inside TING.
--
-- This is the small square identity shown in the signed-in app: the sidebar,
-- the switcher, the overview header. It is deliberately *not* part of the
-- public portal. `portal_by_slug()` names its columns and this one is not
-- among them, so nothing about it can ride along with a public page — the
-- portals keep their own branding, untouched.
--
-- What is stored is the object path inside the `community-avatars` bucket, not
-- a URL. A signed URL expires and a full URL bakes in the host; the path is
-- stable, and the app decides how to serve it.
--
-- Only the community's active administrator may change it. There is no UPDATE
-- policy on `communities`, so the only door is `set_community_avatar()` below,
-- and the storage policies independently require the same role for writes.

alter table public.communities
  add column avatar_path text;

-- The path must live under this community's own prefix and have the exact
-- shape the storage insert policy accepts. A row can therefore never point
-- into another community's files, or at anything that is not an avatar upload.
alter table public.communities
  add constraint communities_avatar_path_shape check (
    avatar_path is null
    or (
      avatar_path ~ '^[^/]+/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpg|webp)$'
      and split_part(avatar_path, '/', 1) = id
    )
  );

comment on column public.communities.avatar_path is
  'Object path in the private community-avatars bucket, or null for the monogram fallback. Internal to TING; never returned by the public portal functions.';

-- ── Storage ──────────────────────────────────────────────────────────────
--
-- Private, like the emoji bucket. Avatars are not secret in themselves, but
-- these are closed communities and a public-read bucket would confirm that a
-- given community exists, and what it looks like, to anyone holding the URL.
-- Members read through the select policy; nobody else can read or even probe
-- for a path.
--
-- Layout is `<community_id>/<uuid>.<ext>`. Every policy keys off the first
-- segment; community ids are slugs (no slashes), so it is unambiguous. Each
-- upload gets a fresh uuid, which is also the cache-busting: a replaced
-- avatar is a different object at a different path, never an overwrite.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'community-avatars',
  'community-avatars',
  false,
  5242880,                                        -- 5 MiB
  array['image/png', 'image/jpeg', 'image/webp']
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

create policy community_avatars_read on storage.objects for select to authenticated
using (
  bucket_id = 'community-avatars'
  and is_member(split_part(name, '/', 1))
);

-- Administrator only — not can_moderate(). The name must also match the exact
-- shape, so an admin cannot park arbitrary paths in the bucket either.
create policy community_avatars_write on storage.objects for insert to authenticated
with check (
  bucket_id = 'community-avatars'
  and is_admin(split_part(name, '/', 1))
  and name ~ '^[^/]+/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpg|webp)$'
);

create policy community_avatars_delete on storage.objects for delete to authenticated
using (
  bucket_id = 'community-avatars'
  and is_admin(split_part(name, '/', 1))
);

-- No update policy: an avatar object is written once. Replacing the image
-- means uploading a new object and swapping the reference, so the old image
-- keeps working until the moment the new one is in place.

-- ── Changing the reference ───────────────────────────────────────────────
--
-- Takes the community id and the new path (null clears it). The caller's
-- identity comes from auth.uid(); nothing here trusts a role or user id from
-- the client. Returns whether the change was applied and which path it
-- replaced, so the caller can tidy up the old object *after* the swap.
--
-- The new object has to exist already. That is what makes the sequence
-- upload -> swap -> clean up safe: a reference can never be set to a file that
-- is not there.

create or replace function public.set_community_avatar(
  p_community_id text,
  p_path text
)
returns table (applied boolean, previous_path text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_previous text;
begin
  if auth.uid() is null or not public.is_admin(p_community_id) then
    return query select false, null::text;
    return;
  end if;

  if p_path is not null then
    if split_part(p_path, '/', 1) <> p_community_id
       or p_path !~ '^[^/]+/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpg|webp)$'
       or not exists (
         select 1 from storage.objects o
          where o.bucket_id = 'community-avatars' and o.name = p_path
       )
    then
      return query select false, null::text;
      return;
    end if;
  end if;

  select c.avatar_path into v_previous
    from public.communities c
   where c.id = p_community_id
     for update;

  update public.communities
     set avatar_path = p_path
   where id = p_community_id;

  return query select true, v_previous;
end;
$$;

comment on function public.set_community_avatar(text, text) is
  'Admin-only. Sets or clears communities.avatar_path for one community and returns the path it replaced. The new object must already exist in community-avatars under that community''s prefix.';

revoke execute on function public.set_community_avatar(text, text) from public, anon;
grant execute on function public.set_community_avatar(text, text) to authenticated;
