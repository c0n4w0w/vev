-- Storage for custom emoji images.
--
-- The bucket is private. That is the whole point: a community's emoji set is
-- as telling as its channel list, and several of these organisations work on
-- things where knowing who is involved is the sensitive part. Public portals
-- publish a description and public events; nothing here rides along with that.
--
-- Files are reached through short-lived signed URLs created server-side, so
-- the object is only ever handed to someone whose session already satisfies
-- the select policy below.
--
-- Path layout is `<community_id>/<emoji_id>.<ext>`, and every policy keys off
-- the first segment. Community ids are slugs — lowercase, hyphens, no slashes
-- — so the segment is unambiguous.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'community-emoji',
  'community-emoji',
  false,
  262144,                                    -- 256 KiB, generous for an emoji
  array['image/png', 'image/gif', 'image/webp']
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Members of the owning community may read the file. Nobody else can, and a
-- non-member cannot even confirm that a given path exists.
create policy community_emoji_read on storage.objects for select to authenticated
using (
  bucket_id = 'community-emoji'
  and is_member(split_part(name, '/', 1))
);

-- Uploading and removing follows the same role rule as the metadata row:
-- moderators and admins of that community, nobody else.
create policy community_emoji_write on storage.objects for insert to authenticated
with check (
  bucket_id = 'community-emoji'
  and can_moderate(split_part(name, '/', 1))
);

create policy community_emoji_delete on storage.objects for delete to authenticated
using (
  bucket_id = 'community-emoji'
  and can_moderate(split_part(name, '/', 1))
);

-- No update policy: an emoji file is written once and replaced by deleting the
-- emoji and adding a new one. Allowing an overwrite would let the image behind
-- an existing name change under everyone who has already reacted with it.
