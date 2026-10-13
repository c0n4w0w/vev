/**
 * Fills a **demo** Supabase project with showcase content.
 *
 * Run with `npm run seed`. It is idempotent: application rows are cleared and
 * rewritten, and auth users are reused when the email already exists — so it
 * can be run again after schema changes without piling up duplicates.
 *
 * Uses the service-role key and therefore bypasses row level security. That is
 * appropriate here and nowhere else.
 *
 * It refuses to run unless `TING_MODE=demo`. The refusal is not politeness:
 * this script deletes application rows belonging to any account whose address
 * matches a fixture, so pointing it at production would quietly destroy real
 * data. Production never sets TING_MODE, so the default answer is no.
 *
 * Accounts are created with no password, and nothing in the product signs
 * anyone in with one. Showcase entry is `/demo/<token>` (`lib/demo/entry.ts`),
 * which mints and redeems a one-time link and never needs a credential to
 * exist, so there is no password for this script to set and none for it to
 * require.
 */
import { readFile } from "node:fs/promises";
import { config } from "dotenv";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { assertDemoDeployment } from "@/lib/environment";
import { channelGroups, channels, communities, memberships } from "@/lib/mock/communities";
import { communityPeople } from "@/lib/mock/community-people";
import { avatarPng, communityProfiles } from "@/lib/mock/community-profiles";
import { accessRequests } from "@/lib/mock/access-requests";
import { comments } from "@/lib/mock/comments";
import { communityPolicies } from "@/lib/mock/community-policies";
import { localGroupAssignments, localGroupManagers, localGroups } from "@/lib/mock/local-groups";
import { subgroupManagers, subgroupMembers, subgroups } from "@/lib/mock/subgroups";
import { customEmojis } from "@/lib/mock/emojis";
import { events } from "@/lib/mock/events";
import { messages } from "@/lib/mock/messages";
import { notifications } from "@/lib/mock/notifications";
import { posts } from "@/lib/mock/posts";
import { users } from "@/lib/mock/users";
import { demoPersonaMemberships, demoPersonas } from "@/lib/mock/demo-personas";
import { fixtureTimeOffset, shiftDate, shiftTimestamp } from "@/lib/mock/fixture-time";

config({ path: ".env.local" });
config({ path: ".env" });

// Before anything else, and before a client is even constructed.
assertDemoDeployment("Seeding");

const supabase = createSupabaseAdminClient();

// Personas are seeded alongside the cast rather than as a special case: they
// need an auth account, a profile and memberships exactly like any other
// fixture. Keeping them in their own module is about not editing the
// organisations' content files, not about them being a different kind of thing.
const allUsers = [...users, ...demoPersonas];
const allMemberships = [...memberships, ...demoPersonaMemberships];

// One offset for the whole run, so every timestamp moves together and the
// spacing between them survives. Computed once: a seed that straddles midnight
// should not shift its later rows by a different amount than its earlier ones.
const TIME_OFFSET = fixtureTimeOffset();
const at = (iso: string) => shiftTimestamp(iso, TIME_OFFSET);
const on = (iso: string) => shiftDate(iso, TIME_OFFSET);

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

  for (const user of allUsers) {
    const email = user.email.toLowerCase();
    let id = existing.get(email);

    if (!id) {
      // No password: the only way in is `/demo/<token>`, which authenticates
      // by minting and redeeming a one-time link, not by checking a
      // credential. An account with no password cannot be signed into any
      // other way, which is one fewer secret this script has to hold.
      const { data, error } = await supabase.auth.admin.createUser({
        email: user.email,
        email_confirm: true,
        user_metadata: { name: user.name, handle: user.handle },
      });
      fail(`kunne ikke opprette konto for ${user.email}`, error);
      id = data.user!.id;
    }

    idByHandle.set(user.id, id);
  }

  const { error } = await supabase.from("profiles").upsert(
    allUsers.map((user) => ({
      id: idByHandle.get(user.id)!,
      name: user.name,
      handle: user.handle,
      initials: user.initials,
      email: user.email,
      pronoun: user.pronoun,
      location: user.location,
      bio: user.bio,
      joined_at: on(user.joinedAt),
    })),
  );
  fail("kunne ikke skrive profiler", error);

  return idByHandle;
}

/** Clears application data, leaving auth accounts and profiles in place. */
async function clearContent() {
  // Order matters: children before parents. `event_attendees` is cleared by
  // the caller because it has a composite key rather than an `id`.
  await supabase
    .from("direct_conversation_reads")
    .delete()
    .not("conversation_id", "is", null);

  // Collaborations first: their participant rows point at communities and
  // local groups, and a check run may have left some behind. Deleting the
  // collaboration cascades to every collaboration_* table.
  const tables = [
    "collaborations",
    "access_requests",
    "notifications",
    "direct_messages",
    "direct_conversations",
    "events",
    "messages",
    "posts",
    "community_people",
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

/** Empties the emoji and avatar buckets, one community prefix at a time. */
async function clearEmojiFiles() {
  for (const bucket of ["community-emoji", "community-avatars"]) {
    for (const community of communities) {
      const { data } = await supabase.storage.from(bucket).list(community.id);
      const paths = (data ?? []).map((entry) => `${community.id}/${entry.name}`);
      if (paths.length > 0) {
        await supabase.storage.from(bucket).remove(paths);
      }
    }
  }

  // Member photos sit one level deeper: <community>/<user>/<file>.
  for (const community of communities) {
    const { data: folders } = await supabase.storage.from("member-avatars").list(community.id);
    for (const folder of folders ?? []) {
      const prefix = `${community.id}/${folder.name}`;
      const { data: files } = await supabase.storage.from("member-avatars").list(prefix);
      const paths = (files ?? []).map((entry) => `${prefix}/${entry.name}`);
      if (paths.length > 0) {
        await supabase.storage.from("member-avatars").remove(paths);
      }
    }
  }
}

/**
 * Empties the collaboration buckets. Deleting a collaboration cascades to its
 * file and publication rows but, as with emoji, not into Storage. Both
 * buckets are laid out `<folder>/<file>`, one folder per collaboration or
 * published event.
 */
async function clearCollaborationFiles() {
  for (const bucket of ["collaboration-files", "published-event-images"]) {
    const { data: folders } = await supabase.storage.from(bucket).list("", { limit: 1000 });
    for (const folder of folders ?? []) {
      const { data: files } = await supabase.storage.from(bucket).list(folder.name, { limit: 1000 });
      const paths = (files ?? []).map((entry) => `${folder.name}/${entry.name}`);
      if (paths.length > 0) await supabase.storage.from(bucket).remove(paths);
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
  // previous run's emoji images and community avatars orphaned in their
  // buckets.
  await clearEmojiFiles();
  await clearCollaborationFiles();

  const uid = await seedAccounts();
  console.log(`  ${allUsers.length} kontoer (${demoPersonas.length} showcase-personaer)`);

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
          default_locale: community.defaultLocale,
          links: community.links,
        })),
      )
    ).error,
  );
  console.log(`  ${communities.length} fellesskap`);

  // Privacy settings are configuration rather than content, so they live in
  // their own file and are applied here. The database is authoritative: the
  // application never branches on a community's name or slug.
  for (const policy of communityPolicies) {
    fail(
      `personverninnstillinger for ${policy.communityId}`,
      (
        await supabase
          .from("communities")
          .update({
            member_directory_visibility: policy.memberDirectoryVisibility,
            dm_policy: policy.dmPolicy,
          })
          .eq("id", policy.communityId)
      ).error,
    );
  }
  console.log(
    `  ${communityPolicies.length} personverninnstillinger ` +
      `(${communityPolicies.filter((p) => p.memberDirectoryVisibility === "admin_only").length} med lukket medlemsliste)`,
  );

  // Channel sections, before local groups: inserting a group creates its
  // lokallag chat channel (local_group_channel_sync), which is filed under the
  // `lokallag` section.
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

  // Local groups, before memberships so an affiliation has something to point
  // at. Communities absent from the fixture get none, which is how the feature
  // stays out of Under The Rug without anything checking its slug.
  const localGroupId = new Map<string, string>();
  for (const group of localGroups) {
    const { data, error } = await supabase
      .from("community_local_groups")
      .insert({
        community_id: group.communityId,
        name: group.name,
        slug: group.name
          .toLowerCase()
          .replace(/[æ]/g, "a")
          .replace(/[ø]/g, "o")
          .replace(/[å]/g, "a")
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-|-$/g, ""),
        sort_order: group.sortOrder,
      })
      .select("id")
      .single();
    fail(`lokallag ${group.name}`, error);
    localGroupId.set(`${group.communityId}|${group.name}`, data!.id);
  }
  console.log(
    `  ${localGroups.length} lokallag ` +
      `(${new Set(localGroups.map((g) => g.communityId)).size} fellesskap)`,
  );

  // Subgroups (teams), keyed on slug. Like a local group, inserting one creates
  // its private chat channel (subgroup_channel_sync), under `grupper`.
  const subgroupId = new Map<string, string>();
  for (const subgroup of subgroups) {
    const { data, error } = await supabase
      .from("community_subgroups")
      .insert({
        community_id: subgroup.communityId,
        slug: subgroup.slug,
        name: subgroup.name,
        description: subgroup.description,
        moderators_read: subgroup.moderatorsRead,
      })
      .select("id")
      .single();
    fail(`gruppe ${subgroup.slug}`, error);
    subgroupId.set(`${subgroup.communityId}|${subgroup.slug}`, data!.id);
  }
  console.log(`  ${subgroups.length} grupper`);

  fail(
    "offentlige organisasjonspersoner",
    (
      await supabase.from("community_people").insert(
        communityPeople.map((person) => {
          const groupId = person.localGroupName
            ? localGroupId.get(`${person.communityId}|${person.localGroupName}`)
            : null;
          if (person.localGroupName && !groupId) {
            console.error(`\n✗ ukjent lokallag for organisasjonsperson: ${person.localGroupName}`);
            process.exit(1);
          }

          return {
            community_id: person.communityId,
            section: person.section,
            local_group_id: groupId,
            name: person.name,
            role: person.role ?? null,
            email: person.email ?? null,
            description: person.description ?? null,
            sort_order: person.sortOrder,
            user_id: person.userId ? uid.get(person.userId)! : null,
          };
        }),
      )
    ).error,
  );
  console.log(`  ${communityPeople.length} offentlige organisasjonspersoner`);

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
  console.log(
    `  ${channels.length} kanaler (+ ${localGroups.length} lokallagskanaler og ${subgroups.length} gruppekanaler fra databasen)`,
  );

  fail(
    "medlemskap",
    (
      await supabase.from("memberships").insert(
        allMemberships.map((membership) => ({
          user_id: uid.get(membership.userId)!,
          community_id: membership.communityId,
          role: membership.role,
          status: membership.status,
          joined_at: on(membership.joinedAt),
          title: membership.title ?? null,
          invited_by: membership.invitedBy ? uid.get(membership.invitedBy)! : null,
          // Fixture members are established members, not people who just
          // joined: their Overview has no welcome card. Pending fixtures stay
          // NULL, so accepting one shows the card like any real activation.
          onboarding_dismissed_at: membership.status === "active" ? new Date().toISOString() : null,
        })),
      )
    ).error,
  );
  console.log(`  ${allMemberships.length} medlemskap`);

  // Affiliations are applied after the memberships exist, and only for the
  // people the fixture names. Everyone else keeps local_group_id null, which
  // is the state the feature has to handle well and the demo should show.
  let applied = 0;
  for (const assignment of localGroupAssignments) {
    const groupId = localGroupId.get(`${assignment.communityId}|${assignment.localGroupName}`);
    if (!groupId) {
      console.error(`\n✗ ukjent lokallag: ${assignment.localGroupName}`);
      process.exit(1);
    }

    // The fixture names people from more than one cast — the organisations'
    // own, and the showcase personas, which are seeded only when that module
    // is in play. An assignment for somebody absent is skipped rather than
    // treated as an error: a group that does not exist is a typo, a person who
    // is not in this run is a configuration.
    const userId = uid.get(assignment.userId);
    if (!userId) continue;
    applied += 1;

    fail(
      `lokallagstilknytning for ${assignment.userId}`,
      (
        await supabase
          .from("memberships")
          .update({ local_group_id: groupId })
          .eq("user_id", userId)
          .eq("community_id", assignment.communityId)
      ).error,
    );
  }
  console.log(
    `  ${applied} lokallagstilknytninger ` +
      `(${allMemberships.length - applied} uten lokallag)`,
  );

  // Lokallagsledere, after the affiliations: a grant names a lokallag the
  // person is in, and the composite foreign keys refuse a lokallag or person
  // outside the community.
  const managerRows = localGroupManagers.flatMap((manager) => {
    const groupId = localGroupId.get(`${manager.communityId}|${manager.localGroupName}`);
    const userId = uid.get(manager.userId);
    if (!groupId) {
      console.error(`\n✗ ukjent lokallag for lokallagsleder: ${manager.localGroupName}`);
      process.exit(1);
    }
    return userId ? [{ local_group_id: groupId, community_id: manager.communityId, user_id: userId }] : [];
  });
  fail(
    "lokallagsledere",
    (await supabase.from("community_local_group_managers").insert(managerRows)).error,
  );
  console.log(`  ${managerRows.length} lokallagsledere`);

  // Subgroup members and managers, after the memberships they point at. The
  // composite foreign key refuses anyone without a membership in that
  // community, so a fixture typo fails here rather than granting anything.
  for (const [table, fixtures] of [
    ["community_subgroup_members", subgroupMembers],
    ["community_subgroup_managers", subgroupManagers],
  ] as const) {
    const rows = fixtures.map((fixture) => {
      const id = subgroupId.get(`${fixture.communityId}|${fixture.subgroupSlug}`);
      const userId = uid.get(fixture.userId);
      if (!id || !userId) {
        console.error(`\n✗ ukjent gruppe eller person: ${fixture.subgroupSlug}/${fixture.userId}`);
        process.exit(1);
      }
      return { subgroup_id: id, community_id: fixture.communityId, user_id: userId };
    });
    fail(table, (await supabase.from(table).insert(rows)).error);
  }
  console.log(`  ${subgroupMembers.length} gruppemedlemmer, ${subgroupManagers.length} gruppeansvarlige`);

  // Every active membership already has a community profile — the membership
  // trigger created it from the account. These fixtures replace a few of them
  // with deliberately different names, bios and photos per community.
  let photos = 0;
  for (const fixture of communityProfiles) {
    const userId = uid.get(fixture.userId);
    if (!userId) continue;

    let avatarPath: string | null = null;
    if (fixture.avatar) {
      avatarPath = `${fixture.communityId}/${userId}/${crypto.randomUUID()}.png`;
      fail(
        `profilbilde for ${fixture.userId} i ${fixture.communityId}`,
        (
          await supabase.storage
            .from("member-avatars")
            .upload(avatarPath, avatarPng(fixture.avatar.background, fixture.avatar.foreground), {
              contentType: "image/png",
              upsert: true,
            })
        ).error,
      );
      photos += 1;
    }

    fail(
      `fellesskapsprofil for ${fixture.userId} i ${fixture.communityId}`,
      (
        await supabase.from("community_profiles").upsert({
          community_id: fixture.communityId,
          user_id: userId,
          display_name: fixture.displayName,
          bio: fixture.bio,
          avatar_path: avatarPath,
        })
      ).error,
    );
  }
  console.log(`  ${communityProfiles.length} egne fellesskapsprofiler (${photos} med bilde)`);

  const subgroupScopeId = (communityId: string, slug?: string) => {
    if (!slug) return null;
    const id = subgroupId.get(`${communityId}|${slug}`);
    if (!id) {
      console.error(`\n✗ ukjent gruppe for innhold: ${communityId}/${slug}`);
      process.exit(1);
    }
    return id;
  };

  const localScopeId = (communityId: string, groupName?: string) => {
    if (!groupName) return null;
    const id = localGroupId.get(`${communityId}|${groupName}`);
    if (!id) {
      console.error(`\n✗ ukjent lokallag for innhold: ${communityId}/${groupName}`);
      process.exit(1);
    }
    return id;
  };

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
          local_group_id: localScopeId(post.communityId, post.localGroupName),
          subgroup_id: subgroupScopeId(post.communityId, post.subgroupSlug),
          author_id: uid.get(post.authorId)!,
          title: post.title ?? null,
          body: post.body,
          created_at: at(post.createdAt),
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
          created_at: at(comment.createdAt),
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
        created_at: at(post.createdAt),
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
          created_at: at(message.createdAt),
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
        local_group_id: localScopeId(event.communityId, event.localGroupName),
        subgroup_id: subgroupScopeId(event.communityId, event.subgroupSlug),
        title: event.title,
        description: event.description,
        starts_at: at(event.startsAt),
        ends_at: at(event.endsAt),
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
          created_at: at(notification.createdAt),
          read: notification.read,
          href: notification.href,
        })),
      )
    ).error,
  );
  fail(
    "tilgangsforespørsler",
    (
      await supabase.from("access_requests").insert(
        accessRequests.map((request) => ({
          community_id: request.communityId,
          email: request.email,
          display_name: request.displayName ?? null,
          status: "pending" as const,
          created_at: new Date(Date.now() - request.daysAgo * 86400000).toISOString(),
        })),
      )
    ).error,
  );
  console.log(`  ${accessRequests.length} tilgangsforespørsler`);

  console.log(`  ${notifications.length} varsler`);

  console.log("\n✓ Ferdig. Gå inn via showcase-lenken: /demo/<DEMO_TOKEN_*>.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
