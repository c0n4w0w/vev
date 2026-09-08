/**
 * Fills a fresh Supabase project with the prototype's content.
 *
 * Run with `npm run seed`. It is idempotent: application rows are cleared and
 * rewritten, and auth users are reused when the email already exists — so it
 * can be run again after schema changes without piling up duplicates.
 *
 * Uses the service-role key and therefore bypasses row level security. That is
 * appropriate here and nowhere else.
 */
import { readFile } from "node:fs/promises";
import { config } from "dotenv";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { channelGroups, channels, communities, memberships } from "@/lib/mock/communities";
import { comments } from "@/lib/mock/comments";
import { customEmojis } from "@/lib/mock/emojis";
import { events } from "@/lib/mock/events";
import { messages } from "@/lib/mock/messages";
import { notifications } from "@/lib/mock/notifications";
import { posts } from "@/lib/mock/posts";
import { users } from "@/lib/mock/users";

config({ path: ".env.local" });
config({ path: ".env" });

const DEMO_PASSWORD = process.env.DEMO_ACCOUNT_PASSWORD ?? "vev-demo-passord";

const supabase = createSupabaseAdminClient();

function fail(step: string, error: { message: string } | null) {
  if (error) {
    console.error(`\n✗ ${step}: ${error.message}`);
    process.exit(1);
  }
}

/**
 * Creates (or finds) an auth account per mock person and returns the mapping
 * from the mock string id to the real uuid. Everything downstream keys off it.
 */
async function seedAccounts(): Promise<Map<string, string>> {
  const idByHandle = new Map<string, string>();

  // One listing instead of a lookup per person.
  const existing = new Map<string, string>();
  for (let page = 1; ; page += 1) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 200 });
    fail("kunne ikke lese eksisterende kontoer", error);
    for (const user of data.users) {
      if (user.email) existing.set(user.email.toLowerCase(), user.id);
    }
    if (data.users.length < 200) break;
  }

  for (const user of users) {
    const email = user.email.toLowerCase();
    let id = existing.get(email);

    if (!id) {
      const { data, error } = await supabase.auth.admin.createUser({
        email: user.email,
        password: DEMO_PASSWORD,
        email_confirm: true,
        user_metadata: { name: user.name, handle: user.handle },
      });
      fail(`kunne ikke opprette konto for ${user.email}`, error);
      id = data.user!.id;
    } else {
      // Keep the demo password in step with the environment.
      await supabase.auth.admin.updateUserById(id, { password: DEMO_PASSWORD });
    }

    idByHandle.set(user.id, id);
  }

  const { error } = await supabase.from("profiles").upsert(
    users.map((user) => ({
      id: idByHandle.get(user.id)!,
      name: user.name,
      handle: user.handle,
      initials: user.initials,
      email: user.email,
      pronoun: user.pronoun,
      location: user.location,
      bio: user.bio,
      joined_at: user.joinedAt,
    })),
  );
  fail("kunne ikke skrive profiler", error);

  return idByHandle;
}

/** Clears application data, leaving auth accounts and profiles in place. */
async function clearContent() {
  // Order matters: children before parents. `event_attendees` is cleared by
  // the caller because it has a composite key rather than an `id`.
  const tables = [
    "notifications",
    "events",
    "messages",
    "posts",
    "memberships",
    "channels",
    "channel_groups",
    "communities",
  ] as const;

  for (const table of tables) {
    const { error } = await supabase.from(table).delete().not("id", "is", null);
    fail(`kunne ikke tømme ${table}`, error);
  }
}

/** Empties the emoji bucket, one community prefix at a time. */
async function clearEmojiFiles() {
  for (const community of communities) {
    const { data } = await supabase.storage.from("community-emoji").list(community.id);
    const paths = (data ?? []).map((entry) => `${community.id}/${entry.name}`);
    if (paths.length > 0) {
      await supabase.storage.from("community-emoji").remove(paths);
    }
  }
}

async function main() {
  console.log("Fyller databasen med testdata …\n");

  // event_attendees has a composite key, so it is cleared on its own first.
  await supabase.from("event_attendees").delete().not("event_id", "is", null);
  await clearContent();

  // Deleting the communities cascades to community_emojis, but nothing
  // cascades into Storage: without this, every re-seed would leave the
  // previous run's emoji images orphaned in the bucket.
  await clearEmojiFiles();

  const uid = await seedAccounts();
  console.log(`  ${users.length} kontoer`);

  fail(
    "fellesskap",
    (
      await supabase.from("communities").insert(
        communities.map((community) => ({
          id: community.id,
          slug: community.slug,
          name: community.name,
          tagline: community.tagline,
          public_description: community.publicDescription,
          about: community.about,
          location: community.location,
          founded_year: community.foundedYear,
          accent: community.branding.accent,
          accent_soft: community.branding.accentSoft,
          monogram: community.branding.monogram,
          mark_style: community.branding.markStyle,
          access_policy: community.accessPolicy,
          member_count: community.memberCount,
          links: community.links,
        })),
      )
    ).error,
  );
  console.log(`  ${communities.length} fellesskap`);

  fail(
    "kanalgrupper",
    (
      await supabase
        .from("channel_groups")
        .insert(
          channelGroups.map((group, index) => ({
            id: group.id,
            label: group.label,
            position: index,
          })),
        )
    ).error,
  );

  fail(
    "kanaler",
    (
      await supabase.from("channels").insert(
        channels.map((channel, index) => ({
          id: channel.id,
          community_id: channel.communityId,
          group_id: channel.groupId,
          name: channel.name,
          purpose: channel.purpose,
          read_only: Boolean(channel.readOnly),
          position: index,
        })),
      )
    ).error,
  );
  console.log(`  ${channels.length} kanaler`);

  fail(
    "medlemskap",
    (
      await supabase.from("memberships").insert(
        memberships.map((membership) => ({
          user_id: uid.get(membership.userId)!,
          community_id: membership.communityId,
          role: membership.role,
          status: membership.status,
          joined_at: membership.joinedAt,
          title: membership.title ?? null,
          invited_by: membership.invitedBy ? uid.get(membership.invitedBy)! : null,
        })),
      )
    ).error,
  );
  console.log(`  ${memberships.length} medlemskap`);

  // Real uuids for the mock string ids, so comments and reactions can point at
  // the right post. Note what is *not* written here: comment_count and
  // reactions. Those are aggregates the database derives from the rows below,
  // and the seed has no business asserting them.
  const postId = new Map(posts.map((post) => [post.id, crypto.randomUUID()]));

  fail(
    "innlegg",
    (
      await supabase.from("posts").insert(
        posts.map((post) => ({
          id: postId.get(post.id)!,
          community_id: post.communityId,
          author_id: uid.get(post.authorId)!,
          title: post.title ?? null,
          body: post.body,
          created_at: post.createdAt,
          kind: post.kind,
          pinned: Boolean(post.pinned),
        })),
      )
    ).error,
  );
  console.log(`  ${posts.length} innlegg`);

  // Parents must exist before their replies, and the guard trigger checks that
  // a reply sits on the same post as its parent.
  const commentId = new Map(comments.map((comment) => [comment.id, crypto.randomUUID()]));
  const ordered = [...comments].sort(
    (a, b) => Number(Boolean(a.parentId)) - Number(Boolean(b.parentId)),
  );

  fail(
    "kommentarer",
    (
      await supabase.from("comments").insert(
        ordered.map((comment) => ({
          id: commentId.get(comment.id)!,
          post_id: postId.get(comment.postId)!,
          parent_id: comment.parentId ? commentId.get(comment.parentId)! : null,
          author_id: uid.get(comment.authorId)!,
          body: comment.body,
          created_at: comment.createdAt,
        })),
      )
    ).error,
  );
  console.log(`  ${comments.length} kommentarer`);

  // The mock keeps reactions in the aggregate shape for readability; the seed
  // expands them into the one-row-per-person form the database actually holds.
  const reactionRows = posts.flatMap((post) =>
    post.reactions.flatMap((reaction) =>
      reaction.userIds.map((userId) => ({
        post_id: postId.get(post.id)!,
        user_id: uid.get(userId)!,
        emoji: reaction.emoji,
        created_at: post.createdAt,
      })),
    ),
  );

  // Custom emojis: the image goes into the private bucket under the owning
  // community's path prefix, then the metadata row points at it. Uploading as
  // service_role bypasses the storage policies, which is right for a seed and
  // nowhere else — a real upload goes through createEmojiAction, where the
  // policies apply.
  let uploaded = 0;
  for (const emoji of customEmojis) {
    const id = crypto.randomUUID();
    const storagePath = `${emoji.communityId}/${id}.png`;
    const bytes = await readFile(
      new URL(`../lib/mock/emoji-art/${emoji.file}`, import.meta.url),
    );

    fail(
      `emoji ${emoji.name}`,
      (
        await supabase.storage
          .from("community-emoji")
          .upload(storagePath, bytes, { contentType: "image/png", upsert: true })
      ).error,
    );

    fail(
      `emoji ${emoji.name}`,
      (
        await supabase.from("community_emojis").insert({
          id,
          community_id: emoji.communityId,
          name: emoji.name,
          storage_path: storagePath,
          content_type: "image/png",
          byte_size: bytes.byteLength,
          created_by: uid.get(emoji.createdBy)!,
        })
      ).error,
    );
    uploaded += 1;
  }
  console.log(`  ${uploaded} egne emojier`);

  fail("reaksjoner", (await supabase.from("post_reactions").insert(reactionRows)).error);
  console.log(`  ${reactionRows.length} reaksjoner`);

  fail(
    "meldinger",
    (
      await supabase.from("messages").insert(
        messages.map((message) => ({
          channel_id: message.channelId,
          author_id: uid.get(message.authorId)!,
          body: message.body,
          created_at: message.createdAt,
          attachment: message.attachment ?? null,
          reactions: (message.reactions ?? []).map((reaction) => ({
            emoji: reaction.emoji,
            userIds: reaction.userIds.map((id) => uid.get(id) ?? id),
          })),
        })),
      )
    ).error,
  );
  console.log(`  ${messages.length} meldinger`);

  const { data: insertedEvents, error: eventError } = await supabase
    .from("events")
    .insert(
      events.map((event) => ({
        community_id: event.communityId,
        title: event.title,
        description: event.description,
        starts_at: event.startsAt,
        ends_at: event.endsAt,
        location: event.location,
        is_public: event.isPublic,
        host_id: uid.get(event.hostId) ?? null,
        capacity: event.capacity ?? null,
      })),
    )
    .select("id, title, starts_at");
  fail("arrangementer", eventError);

  // Match the inserted rows back to the mock events to attach attendees.
  const eventIdByKey = new Map(
    (insertedEvents ?? []).map((row) => [`${row.title}|${row.starts_at}`, row.id]),
  );
  const attendees = events.flatMap((event) => {
    const key = [...eventIdByKey.keys()].find((k) => k.startsWith(`${event.title}|`));
    const id = key ? eventIdByKey.get(key) : undefined;
    if (!id) return [];
    return event.attendeeIds.map((attendee) => ({
      event_id: id,
      user_id: uid.get(attendee)!,
    }));
  });

  fail("påmeldinger", (await supabase.from("event_attendees").insert(attendees)).error);
  console.log(`  ${events.length} arrangementer, ${attendees.length} påmeldinger`);

  fail(
    "varsler",
    (
      await supabase.from("notifications").insert(
        notifications.map((notification) => ({
          user_id: uid.get(notification.userId)!,
          kind: notification.kind,
          community_id: notification.communityId ?? null,
          title: notification.title,
          body: notification.body,
          created_at: notification.createdAt,
          read: notification.read,
          href: notification.href,
        })),
      )
    ).error,
  );
  console.log(`  ${notifications.length} varsler`);

  console.log("\n✓ Ferdig. Logg inn med en av demokontoene på /login.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
