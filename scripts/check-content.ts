/**
 * Validates the prototype's content before it is ever seeded into Supabase.
 *
 * Two jobs:
 *
 * 1. **Referential integrity.** Every id the mock data points at must exist,
 *    so the seed cannot insert a dangling row and the UI cannot render a blank
 *    name. The database has foreign keys, but failing here is a much shorter
 *    feedback loop than failing mid-seed.
 *
 * 2. **Organisational independence.** Tryggere Ruspolitikk and Tryggere Ungdom
 *    are related organisations. Under The Rug is not connected to either, and
 *    no piece of its content may suggest that it is. That is an editorial rule
 *    a reviewer would have to remember on every content change, so it is
 *    enforced here instead.
 *
 * Run with `npm run check:content`. No network, no database.
 */
import { existsSync } from "node:fs";
import { channels, communities, memberships } from "@/lib/mock/communities";
import { communityPeople, underTheRugCrew } from "@/lib/mock/community-people";
import { accessRequests } from "@/lib/mock/access-requests";
import { comments } from "@/lib/mock/comments";
import { communityPolicies } from "@/lib/mock/community-policies";
import { customEmojis } from "@/lib/mock/emojis";
import { events } from "@/lib/mock/events";
import { messages } from "@/lib/mock/messages";
import { notifications } from "@/lib/mock/notifications";
import { posts } from "@/lib/mock/posts";
import { localGroups, localGroupAssignments } from "@/lib/mock/local-groups";
import { demoUserIds, users } from "@/lib/mock/users";
import { demoPersonaMemberships, demoPersonas } from "@/lib/mock/demo-personas";

const failures: string[] = [];
let checks = 0;

function check(label: string, condition: boolean, detail?: string) {
  checks += 1;
  if (!condition) failures.push(detail ? `${label} — ${detail}` : label);
}

// The accounts the seed actually creates, which is `users` plus the
// showcase personas — `scripts/seed.ts` concatenates exactly these. Leaving the
// personas out made every fixture that names one look like a dangling
// reference, which is what happened the moment the notification fixtures were
// written around showcase-only people.
const userIds = new Set([...users, ...demoPersonas].map((user) => user.id));
const communityIds = new Set(communities.map((community) => community.id));
const channelIds = new Set(channels.map((channel) => channel.id));
const localGroupKeys = new Set(localGroups.map((group) => `${group.communityId}/${group.name}`));
const allMemberships = [...memberships, ...demoPersonaMemberships];

const activeMembers = (communityId: string) =>
  new Set(
    allMemberships
      .filter((m) => m.communityId === communityId && m.status === "active")
      .map((m) => m.userId),
  );

const TRYGGERE = ["tryggere-ruspolitikk", "tryggere-ungdom"];
const INDEPENDENT = "under-the-rug";
const intendedAdmins = new Map([
  ["under-the-rug", "octavio-esperanto"],
  ["tryggere-ruspolitikk", "lars-bror-kristiansen"],
  ["tryggere-ungdom", "emma-mortensen"],
]);
const TRYGGERE_ORGANIZATION_SHAPE = {
  "tryggere-ruspolitikk": {
    staff: [
      "Ina Roll Spinnangr",
      "Dagfinn Hessen Paust",
      "Lars Bror Kristiansen",
      "Emil Bjørnstad Belgau",
    ],
    board: [
      "Jonas Ali Werket Ghanizadeh",
      "Hallvar Hyldbakk",
      "Jørn Kløvvfjell Mjelva",
      "Armin Khoshneviszadeh",
      "Maren Vals Dekkerhus",
      "Gisle Vonen",
      "Line Rude Jacobsen",
      "Emil Bjørnstad Belgau",
    ],
    local_group_leader: [
      "Line Rude Jacobsen",
      "Christian T. Eikeland",
      "Bent Heier Johansen",
      "Morten Revheim",
      "Christian Øien",
      "Joachim Strandberg",
      "Eirik Olsen",
    ],
  },
  "tryggere-ungdom": {
    staff: [
      "Ingrid E. Gøranson",
      "Emma Mortensen",
      "Ole Thomas Lunde",
      "Thia Olivia Dahl",
      "Sofia Litland Eckblad",
    ],
    board: [
      "Emil Bjørnstad Belgau",
      "Emil Mikalsen",
      "Turid Elise Hennig",
      "Omar Nawaz",
      "Iver Strømsvold",
    ],
    local_group_leader: [],
  },
} as const;

// ── 1. Referential integrity ────────────────────────────────────────────

for (const membership of allMemberships) {
  const where = `${membership.userId}/${membership.communityId}`;
  check("membership.userId finnes", userIds.has(membership.userId), where);
  check("membership.communityId finnes", communityIds.has(membership.communityId), where);
  if (membership.invitedBy) {
    check("membership.invitedBy finnes", userIds.has(membership.invitedBy), where);
  }
}

for (const person of communityPeople) {
  if (person.userId) {
    check("organisasjonsperson-kobling peker på bruker som finnes", userIds.has(person.userId), `${person.name}: ${person.userId}`);
    check(
      "organisasjonsperson-kobling peker på aktivt medlem i samme fellesskap",
      allMemberships.some(
        (membership) =>
          membership.userId === person.userId &&
          membership.communityId === person.communityId &&
          membership.status === "active",
      ),
      `${person.name}: ${person.userId}/${person.communityId}`,
    );
  }
}

for (const channel of channels) {
  check("channel.communityId finnes", communityIds.has(channel.communityId), channel.id);
}

for (const message of messages) {
  check("message.channelId finnes", channelIds.has(message.channelId), message.id);
  check("message.authorId finnes", userIds.has(message.authorId), message.id);

  const community = message.channelId.split("--")[0];
  check(
    "melding er skrevet av et aktivt medlem",
    activeMembers(community).has(message.authorId),
    `${message.id}: ${message.authorId} er ikke aktivt medlem i ${community}`,
  );

  for (const reaction of message.reactions ?? []) {
    for (const userId of reaction.userIds) {
      check("reaksjon peker på en ekte bruker", userIds.has(userId), `${message.id}: ${userId}`);
    }
  }
}

for (const post of posts) {
  check("post.communityId finnes", communityIds.has(post.communityId), post.id);
  check("post.authorId finnes", userIds.has(post.authorId), post.id);
  if (post.localGroupName) {
    check(
      "innleggets lokallag finnes i samme fellesskap",
      localGroupKeys.has(`${post.communityId}/${post.localGroupName}`),
      `${post.id}: ${post.communityId}/${post.localGroupName}`,
    );
  }
  check(
    "innlegg er skrevet av et aktivt medlem",
    activeMembers(post.communityId).has(post.authorId),
    `${post.id}: ${post.authorId}`,
  );
  for (const reaction of post.reactions) {
    for (const userId of reaction.userIds) {
      check("reaksjon peker på en ekte bruker", userIds.has(userId), `${post.id}: ${userId}`);
    }
  }
}

for (const event of events) {
  check("event.communityId finnes", communityIds.has(event.communityId), event.id);
  if (event.localGroupName) {
    check(
      "arrangementets lokallag finnes i samme fellesskap",
      localGroupKeys.has(`${event.communityId}/${event.localGroupName}`),
      `${event.id}: ${event.communityId}/${event.localGroupName}`,
    );
  }
  const members = activeMembers(event.communityId);
  check("arrangementets vert er aktivt medlem", members.has(event.hostId), `${event.id}: ${event.hostId}`);
  for (const attendeeId of event.attendeeIds) {
    check("påmeldt er aktivt medlem", members.has(attendeeId), `${event.id}: ${attendeeId}`);
  }
  check("arrangementet slutter etter at det starter", Date.parse(event.endsAt) > Date.parse(event.startsAt), event.id);
  if (event.capacity !== undefined) {
    check("påmeldte overstiger ikke kapasiteten", event.attendeeIds.length <= event.capacity, event.id);
  }
}

for (const notification of notifications) {
  check("notification.userId finnes", userIds.has(notification.userId), notification.id);
  if (notification.communityId) {
    check("notification.communityId finnes", communityIds.has(notification.communityId), notification.id);
  }
  const href = notification.href;
  const target =
    href.startsWith("/community/")
      ? href.split("/")[2]
      : href.startsWith("/") && !href.includes("/", 1)
        ? href.slice(1)
        : null;
  if (target) {
    check(
      "varselets lenke peker på et fellesskap som finnes",
      communityIds.has(target) || communities.some((c) => c.slug === target),
      `${notification.id}: ${href}`,
    );
  }
  if (href.includes("/channel/")) {
    check("varselets kanallenke finnes", channelIds.has(href.split("/channel/")[1]), notification.id);
  }
}

// Comments: every one must hang off a real post, be written by someone who is
// actually a member of that post's community, and — if it is a reply — answer a
// top-level comment on the same post. The database enforces all three; failing
// here means the seed would not even load.
const postById = new Map(posts.map((post) => [post.id, post]));
const commentById = new Map(comments.map((comment) => [comment.id, comment]));

check("alle kommentar-ider er unike", commentById.size === comments.length);

for (const comment of comments) {
  const post = postById.get(comment.postId);
  check("comment.postId finnes", Boolean(post), `${comment.id} -> ${comment.postId}`);
  check("comment.authorId finnes", userIds.has(comment.authorId), comment.id);
  if (post) {
    check(
      "kommentaren er skrevet av et aktivt medlem",
      activeMembers(post.communityId).has(comment.authorId),
      `${comment.id}: ${comment.authorId} er ikke medlem i ${post.communityId}`,
    );
  }
  if (comment.parentId) {
    const parent = commentById.get(comment.parentId);
    check("svaret peker på en kommentar som finnes", Boolean(parent), comment.id);
    if (parent) {
      check(
        "svaret ligger på samme innlegg som forelderen",
        parent.postId === comment.postId,
        comment.id,
      );
      check("det svares ikke på et svar", !parent.parentId, comment.id);
      check(
        "svaret kommer etter kommentaren det svarer på",
        Date.parse(comment.createdAt) >= Date.parse(parent.createdAt),
        comment.id,
      );
    }
  }
}

// Custom emojis: scoped to one community, created by someone who may actually
// manage that community, and pointing at an image file that exists.
const emojiArtDir = new URL("../lib/mock/emoji-art/", import.meta.url);

const managers = (communityId: string) =>
  new Set(
    memberships
      .filter(
        (m) =>
          m.communityId === communityId &&
          m.status === "active" &&
          (m.role === "admin" || m.role === "moderator"),
      )
      .map((m) => m.userId),
  );

for (const emoji of customEmojis) {
  const where = `${emoji.communityId}/:${emoji.name}:`;
  check("emoji.communityId finnes", communityIds.has(emoji.communityId), where);
  check("emoji.createdBy finnes", userIds.has(emoji.createdBy), where);
  check(
    "emojien er laget av en som kan administrere fellesskapet",
    managers(emoji.communityId).has(emoji.createdBy),
    `${where}: ${emoji.createdBy} er verken moderator eller administrator`,
  );
  check(
    "emojinavnet er gyldig",
    /^[a-z0-9][a-z0-9_-]{1,31}$/.test(emoji.name),
    where,
  );
  check("emojibildet finnes", existsSync(new URL(emoji.file, emojiArtDir)), `${where} -> ${emoji.file}`);
}

// Unique per community, never globally.
const emojiKeys = customEmojis.map((emoji) => `${emoji.communityId}/${emoji.name}`);
check("emojinavn er unike innenfor hvert fellesskap", new Set(emojiKeys).size === emojiKeys.length);

// The scoping is only demonstrated if a shared name actually exists.
const namesPerCommunity = new Map<string, Set<string>>();
for (const emoji of customEmojis) {
  const set = namesPerCommunity.get(emoji.name) ?? new Set<string>();
  set.add(emoji.communityId);
  namesPerCommunity.set(emoji.name, set);
}
check(
  "minst ett emojinavn finnes i to fellesskap samtidig",
  [...namesPerCommunity.values()].some((set) => set.size > 1),
  "uten dette demonstrerer ikke datasettet at navn er per fellesskap",
);

// ── 2. Slugs and demo states ────────────────────────────────────────────

check("alle slugs er unike", new Set(communities.map((c) => c.slug)).size === communities.length);
check("alle bruker-handles er unike", new Set(users.map((u) => u.handle)).size === users.length);

for (const community of communities) {
  check(
    `${community.id}: slug er URL-trygg`,
    /^[a-z0-9]+(-[a-z0-9]+)*$/.test(community.slug),
    community.slug,
  );
  check(`${community.id}: har kanaler`, channels.some((c) => c.communityId === community.id));
  const activeAdmins = allMemberships.filter(
    (m) => m.communityId === community.id && m.status === "active" && m.role === "admin",
  );
  check(`${community.id}: har nøyaktig én administrator`, activeAdmins.length === 1, activeAdmins.map((m) => m.userId).join(", "));
  check(
    `${community.id}: administratoren er tilsiktet fixture-identitet`,
    activeAdmins[0]?.userId === intendedAdmins.get(community.id),
    activeAdmins[0]?.userId,
  );
  check(
    `${community.id}: har minst ett offentlig arrangement til portalen`,
    events.some((e) => e.communityId === community.id && e.isPublic),
  );
}

for (const group of localGroups) {
  check("lokallagets fellesskap finnes", communityIds.has(group.communityId), group.name);
  check("lokallag har ikke tomt navn", group.name.trim().length > 0, group.communityId);
}

check(
  "lokallag er unike innenfor hvert fellesskap",
  localGroupKeys.size === localGroups.length,
);

for (const assignment of localGroupAssignments) {
  check("lokallagstilknytning peker på bruker som finnes", userIds.has(assignment.userId), assignment.userId);
  check(
    "lokallagstilknytning peker på aktivt medlemskap",
    activeMembers(assignment.communityId).has(assignment.userId),
    `${assignment.userId}/${assignment.communityId}`,
  );
  check(
    "lokallagstilknytning peker på lokallag i samme fellesskap",
    localGroupKeys.has(`${assignment.communityId}/${assignment.localGroupName}`),
    `${assignment.communityId}/${assignment.localGroupName}`,
  );
}

for (const person of communityPeople) {
  const where = `${person.communityId}/${person.section}/${person.name}`;
  check("organisasjonspersonens fellesskap finnes", communityIds.has(person.communityId), where);
  check("organisasjonsperson har navn", person.name.trim().length > 0, where);
  check(
    "organisasjonspersonens seksjon er gyldig",
    ["staff", "board", "local_group_leader", "crew"].includes(person.section),
    where,
  );
  if (person.email) {
    check(
      "organisasjonspersonens e-post er normalisert",
      person.email === person.email.trim().toLowerCase(),
      `${where}: ${person.email}`,
    );
  }
  if (person.section === "local_group_leader") {
    check("lokallagsleder peker på lokallag", Boolean(person.localGroupName), where);
    check(
      "lokallagsleder peker på lokallag i samme fellesskap",
      Boolean(person.localGroupName) &&
        localGroupKeys.has(`${person.communityId}/${person.localGroupName}`),
      `${person.communityId}/${person.localGroupName ?? "mangler"}`,
    );
  } else {
    check("bare lokallagsledere peker på lokallag", !person.localGroupName, where);
  }
}

const utrCrew = communityPeople.filter(
  (person) => person.communityId === INDEPENDENT && person.section === "crew",
);
const expectedCrewByName = new Map(underTheRugCrew.map((person) => [person.name, person]));
check("Under The Rug har nøyaktig 24 Crew-rader", utrCrew.length === 24, `${utrCrew.length}`);
check(
  "Under The Rug Crew-navn er unike",
  new Set(utrCrew.map((person) => person.name)).size === utrCrew.length,
);
check(
  "Under The Rug Crew-fixturen er source of truth",
  utrCrew.every((person) => {
    const expected = expectedCrewByName.get(person.name);
    return (
      expected !== undefined &&
      expected.role === person.role &&
      expected.sortOrder === person.sortOrder &&
      person.localGroupName === undefined &&
      person.email === undefined &&
      person.description === undefined
    );
  }) && expectedCrewByName.size === utrCrew.length,
);
check(
  "Under The Rug har bare Crew som organisasjonspersoner",
  communityPeople
    .filter((person) => person.communityId === INDEPENDENT)
    .every((person) => person.section === "crew"),
);

const userNameById = new Map([...users, ...demoPersonas].map((user) => [user.id, user.name]));
const crewNames = new Set(underTheRugCrew.map((person) => person.name));
const unexpectedCrewMemberships = allMemberships.filter(
  (membership) =>
    membership.communityId === INDEPENDENT &&
    crewNames.has(userNameById.get(membership.userId) ?? "") &&
    membership.userId !== "octavio-esperanto",
);
check(
  "Crew-rader lager ikke falske UTR-medlemskap utover eksplisitt Octavio-kobling",
  unexpectedCrewMemberships.length === 0,
  unexpectedCrewMemberships.map((membership) => membership.userId).join(", "),
);

for (const [communityId, expected] of Object.entries(TRYGGERE_ORGANIZATION_SHAPE)) {
  for (const [section, names] of Object.entries(expected)) {
    const actual = communityPeople
      .filter((person) => person.communityId === communityId && person.section === section)
      .map((person) => person.name);
    check(
      `${communityId}/${section}: organisasjonspersoner er uendret`,
      actual.join("|") === names.join("|"),
      actual.join(", "),
    );
  }
}

check(
  "Under The Rug Crew-roller matcher source of truth",
  underTheRugCrew.every((expected) =>
    utrCrew.some(
      (person) =>
        person.name === expected.name &&
        person.role === expected.role &&
        person.sortOrder === expected.sortOrder,
    ),
  ),
);

check(
  "Tryggere Ungdom har ikke seedede lokallagsledere uten reelle data",
  !communityPeople.some(
    (person) =>
      person.communityId === "tryggere-ungdom" && person.section === "local_group_leader",
  ),
);

check(
  "Under The Rug har ingen lokallag",
  !localGroups.some((group) => group.communityId === INDEPENDENT),
);
check(
  "Under The Rug har ikke lokalt skopet innhold",
  !posts.some((post) => post.communityId === INDEPENDENT && post.localGroupName) &&
    !events.some((event) => event.communityId === INDEPENDENT && event.localGroupName),
);

// The three demo accounts exist to show the many / one / none cases.
const [manyId, oneId, noneId] = demoUserIds;
const activeCount = (userId: string) =>
  memberships.filter((m) => m.userId === userId && m.status === "active").length;

check(`${manyId} er med i alle tre fellesskapene`, activeCount(manyId) === communities.length);
check(`${oneId} er med i nøyaktig ett fellesskap`, activeCount(oneId) === 1);
check(`${noneId} er ikke med i noe fellesskap`, activeCount(noneId) === 0);
// The cold-start account has no membership row of any kind, not even a
// pending one. Whatever access she gains has to come through the request and
// invitation lifecycle, which is the point of seeding her empty.
check(
  `${noneId} har ingen medlemskapsrad i det hele tatt`,
  memberships.filter((m) => m.userId === noneId).length === 0,
);

// Nothing should seed the legacy 'invited' or 'requested' states any more:
// they are unreachable now that approval issues an invitation instead of
// flipping a membership row.
check(
  "ingen medlemskap er seedet i en utdatert tilstand",
  memberships.every((m) => m.status === "active"),
  memberships.filter((m) => m.status !== "active").map((m) => `${m.userId}/${m.communityId}=${m.status}`).join(", "),
);
check(
  `${manyId} har fortsatt tre fellesskap uten administratorrolle`,
  memberships.filter((m) => m.userId === manyId && m.status === "active").length === 3 &&
    memberships
      .filter((m) => m.userId === manyId && m.status === "active")
      .every((m) => m.role !== "admin"),
);

const membershipShape = (userId: string) =>
  new Map(
    allMemberships
      .filter((m) => m.userId === userId && m.status === "active")
      .map((m) => [m.communityId, m.role]),
  );
const tryggereMember = membershipShape("demo-tryggere-member");
check(
  "ordinær Tryggere-showcase er medlem i FTR og TU",
  tryggereMember.get("tryggere-ruspolitikk") === "member" &&
    tryggereMember.get("tryggere-ungdom") === "member",
);
check(
  "ordinær Tryggere-showcase er ikke medlem i UTR",
  !tryggereMember.has("under-the-rug"),
);
const utrMember = membershipShape("demo-utr-member");
check(
  "ordinær UTR-showcase er bare vanlig UTR-medlem",
  utrMember.size === 1 && utrMember.get("under-the-rug") === "member",
);
check(
  "ordinære showcase-personaer har ingen privilegerte roller",
  [...tryggereMember.values(), ...utrMember.values()].every((role) => role === "member"),
);
// A request is now a row in `access_requests`, keyed by email, not a
// membership in a pending state.
check(
  "minst én tilgangsforespørsel venter på en administrator",
  accessRequests.length > 0,
);

for (const request of accessRequests) {
  const where = `${request.communityId}/${request.email}`;
  check("forespørselens fellesskap finnes", communityIds.has(request.communityId), where);
  check(
    "forespørselen går til et fellesskap som tar imot søknader",
    communities.find((c) => c.id === request.communityId)?.accessPolicy === "request-to-join",
    where,
  );
  check(
    "e-postadressen er normalisert",
    request.email === request.email.trim().toLowerCase(),
    where,
  );
  // A seeded request must not name someone who is already a member — the
  // database suppresses that case, so it would never appear in a real queue.
  check(
    "forespørselen er ikke fra et eksisterende medlem",
    !memberships.some(
      (m) =>
        m.communityId === request.communityId &&
        m.status === "active" &&
        users.find((u) => u.id === m.userId)?.email.toLowerCase() === request.email,
    ),
    where,
  );
}

check(
  "ingen to forespørsler er duplikater",
  new Set(accessRequests.map((r) => `${r.communityId}/${r.email}`)).size === accessRequests.length,
);

// Privacy policy: every community must declare one, exactly once, and the
// values must be ones the database enum accepts. A community added without a
// setting would silently inherit the permissive default.
const policyById = new Map(communityPolicies.map((p) => [p.communityId, p]));

check(
  "hvert fellesskap har personverninnstillinger",
  policyById.size === communities.length,
  `${policyById.size} innstillinger for ${communities.length} fellesskap`,
);

for (const community of communities) {
  const policy = policyById.get(community.id);
  check(`${community.id}: har personverninnstilling`, Boolean(policy));
  if (!policy) continue;
  check(
    `${community.id}: gyldig medlemsliste-innstilling`,
    ["admin_only", "members"].includes(policy.memberDirectoryVisibility),
    policy.memberDirectoryVisibility,
  );
  check(
    `${community.id}: gyldig DM-innstilling`,
    ["staff_only", "members"].includes(policy.dmPolicy),
    policy.dmPolicy,
  );
  check(
    `${community.id}: innstillingen er begrunnet`,
    policy.rationale.trim().length > 40,
  );
}

for (const policy of communityPolicies) {
  check(
    "innstillingen peker på et fellesskap som finnes",
    communityIds.has(policy.communityId),
    policy.communityId,
  );
}

// ── 3. Organisational independence ──────────────────────────────────────

/** Every string a reader can see for one community. */
function contentFor(communityId: string): { where: string; text: string }[] {
  const community = communities.find((c) => c.id === communityId)!;
  return [
    { where: "tagline", text: community.tagline },
    { where: "publicDescription", text: community.publicDescription },
    { where: "about", text: community.about },
    ...community.links.map((l) => ({ where: `link ${l.label}`, text: `${l.label} ${l.href}` })),
    ...channels
      .filter((c) => c.communityId === communityId)
      .map((c) => ({ where: `#${c.name}`, text: c.purpose })),
    ...posts
      .filter((p) => p.communityId === communityId)
      .map((p) => ({ where: p.id, text: `${p.title ?? ""} ${p.body}` })),
    ...messages
      .filter((m) => m.channelId.startsWith(`${communityId}--`))
      .map((m) => ({ where: m.id, text: m.body })),
    ...events
      .filter((e) => e.communityId === communityId)
      .map((e) => ({ where: e.id, text: `${e.title} ${e.description} ${e.location}` })),
    ...comments
      .filter((c) => postById.get(c.postId)?.communityId === communityId)
      .map((c) => ({ where: c.id, text: c.body })),
  ];
}

// Under The Rug must not name either Tryggere organisation anywhere.
for (const { where, text } of contentFor(INDEPENDENT)) {
  check(
    "Under The Rug nevner ikke Tryggere-organisasjonene",
    !/tryggere/i.test(text),
    `${where}: «${text.slice(0, 80)}…»`,
  );
}

// And neither Tryggere organisation may claim a tie to Under The Rug.
for (const communityId of TRYGGERE) {
  for (const { where, text } of contentFor(communityId)) {
    check(
      `${communityId} nevner ikke Under The Rug`,
      !/under the rug/i.test(text),
      `${where}: «${text.slice(0, 80)}…»`,
    );
  }
}

// Nobody holds a role in both Under The Rug and a Tryggere organisation in a
// way the content narrates — shared people are fine (accounts are personal),
// but their titles must not describe a link between the organisations.
for (const membership of memberships.filter((m) => m.communityId === INDEPENDENT)) {
  check(
    "verv i Under The Rug viser ikke til en annen organisasjon",
    !/tryggere|moderorganisasjon/i.test(membership.title ?? ""),
    `${membership.userId}: ${membership.title}`,
  );
}

// The relationship that *is* real should be stated, so the sibling framing
// does not rest on the reader guessing it.
check(
  "Tryggere Ungdom oppgir at den hører til Tryggere Ruspolitikk",
  /tryggere ruspolitikk/i.test(
    communities.find((c) => c.id === "tryggere-ungdom")!.publicDescription,
  ),
);

// No stale references to communities that have been removed.
const everyString = JSON.stringify([communities, channels, memberships, posts, comments, customEmojis, messages, events, notifications, users, communityPeople]);
check("ingen referanser til fjernede fellesskap", !/mnmt/i.test(everyString));

// ── Report ──────────────────────────────────────────────────────────────

if (failures.length > 0) {
  console.error(`\n✗ ${failures.length} av ${checks} kontroller feilet:\n`);
  for (const failure of failures) console.error(`  · ${failure}`);
  process.exit(1);
}

console.log(`✓ ${checks} kontroller passerte`);
console.log(
  `  ${communities.length} fellesskap · ${users.length} personer · ${memberships.length} medlemskap`,
);
console.log(
  `  ${posts.length} innlegg · ${comments.length} kommentarer · ${customEmojis.length} egne emojier · ${messages.length} meldinger · ${events.length} arrangementer · ${notifications.length} varsler · ${communityPeople.length} organisasjonspersoner`,
);
