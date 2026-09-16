import "server-only";

import { cache } from "react";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type {
  ChannelRow,
  CommunityRow,
  EventRow,
  MembershipRow,
  MessageRow,
  NotificationRow,
  PortalCommunityRow,
  PortalEventRow,
  AcceptInvitationRow,
  AccessRequestRow,
  CommentRow,
  CommunityEmojiRow,
  InvitationPreviewRow,
  InvitationRow,
  MintedInvitationRow,
  PostRow,
  ProfileRow,
  LocalGroupRow,
} from "@/lib/supabase/database.types";
import type {
  Channel,
  ChannelGroup,
  Comment,
  Community,
  CommunityEmoji,
  CommunityEvent,
  CommunityPublic,
  Membership,
  Message,
  Reaction,
  Notification,
  Post,
  RoleId,
  User,
  LocalGroup,
} from "@/lib/types";

export { getRole, roles } from "@/lib/roles";

/**
 * The single seam between the UI and the database.
 *
 * Every screen reads through these functions. They run as the signed-in user,
 * so row level security — not this file — decides what comes back; the code
 * here shapes rows into the domain types the components already expect.
 *
 * Reads that a single render repeats (profiles, the caller's memberships) are
 * wrapped in React's `cache`, which dedupes them for the duration of one
 * request. That is what keeps a feed of twenty posts from issuing twenty
 * author lookups.
 */

// ── Row → domain mapping ────────────────────────────────────────────────

/**
 * `data ?? []` produces `Row[] | never[]`, and TypeScript then infers the
 * callback parameter of a following `.map` as the intersection of both — that
 * is, `never`. Narrowing through this helper keeps a single array type.
 */
function rows<T>(data: T[] | null): T[] {
  return data ?? [];
}

function toUser(row: ProfileRow): User {
  return {
    id: row.id,
    name: row.name,
    handle: row.handle,
    initials: row.initials,
    email: row.email,
    pronoun: row.pronoun,
    location: row.location,
    bio: row.bio,
    joinedAt: row.joined_at,
  };
}

type LinkList = { label: string; href: string }[];

function toCommunityPublic(row: PortalCommunityRow): CommunityPublic {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    tagline: row.tagline,
    publicDescription: row.public_description,
    location: row.location,
    foundedYear: row.founded_year,
    branding: {
      accent: row.accent,
      accentSoft: row.accent_soft,
      monogram: row.monogram,
      markStyle: (row.mark_style as CommunityPublic["branding"]["markStyle"]) ?? "sans",
    },
    accessPolicy: row.access_policy,
    memberCount: row.member_count,
    links: (row.links as LinkList) ?? [],
  };
}

function toCommunity(row: CommunityRow): Community {
  return { ...toCommunityPublic(row), about: row.about };
}

/**
 * The membership columns a client may read.
 *
 * Spelled out rather than `*` because `accepts_member_dms` is not granted to
 * `authenticated` — a `select *` against this table is refused outright, not
 * quietly trimmed. Keeping the list here means the refusal cannot reappear as
 * a runtime surprise in one query that still asks for everything.
 */
const MEMBERSHIP_COLUMNS =
  "id, user_id, community_id, role, status, joined_at, title, invited_by, local_group_id" as const;

/**
 * Note the absence of `accepts_member_dms`. It is private to the person it
 * belongs to: `myAcceptsMemberDms()` reads the caller's own value, and
 * `can_send_dm()` reads it inside the database for an authorisation decision.
 * Nothing else sees it.
 */
function toMembership(row: Omit<MembershipRow, "accepts_member_dms">): Membership {
  return {
    userId: row.user_id,
    communityId: row.community_id,
    role: row.role,
    status: row.status,
    joinedAt: row.joined_at,
    title: row.title ?? undefined,
    invitedBy: row.invited_by ?? undefined,
    localGroupId: row.local_group_id ?? undefined,
  };
}

function toChannel(row: ChannelRow): Channel {
  return {
    id: row.id,
    communityId: row.community_id,
    groupId: row.group_id,
    name: row.name,
    purpose: row.purpose,
    readOnly: row.read_only || undefined,
  };
}

function toMessage(row: MessageRow): Message {
  return {
    id: row.id,
    channelId: row.channel_id,
    authorId: row.author_id,
    body: row.body,
    createdAt: row.created_at,
    reactions: (row.reactions as unknown as Message["reactions"]) ?? [],
    attachment: (row.attachment as Message["attachment"]) ?? undefined,
  };
}

function toPost(row: PostRow): Post {
  return {
    id: row.id,
    communityId: row.community_id,
    authorId: row.author_id,
    title: row.title ?? undefined,
    body: row.body,
    createdAt: row.created_at,
    editedAt: row.edited_at ?? undefined,
    kind: row.kind,
    pinned: row.pinned || undefined,
    commentCount: row.comment_count,
    reactions: (row.reactions as unknown as Reaction[]) ?? [],
  };
}

function toEvent(row: EventRow, attendeeIds: string[]): CommunityEvent {
  return {
    id: row.id,
    communityId: row.community_id,
    title: row.title,
    description: row.description,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    location: row.location,
    isPublic: row.is_public,
    hostId: row.host_id ?? "",
    attendeeIds,
    capacity: row.capacity ?? undefined,
  };
}

function toNotification(row: NotificationRow): Notification {
  return {
    id: row.id,
    userId: row.user_id,
    kind: row.kind,
    communityId: row.community_id ?? undefined,
    title: row.title,
    body: row.body,
    createdAt: row.created_at,
    read: row.read,
    href: row.href,
  };
}

// ── People ──────────────────────────────────────────────────────────────

/**
 * Every profile the caller is allowed to see — themselves, people they share a
 * community with, and anyone who invited them. Row level security draws that
 * line; here it is one query per request instead of one per author.
 */
const loadProfiles = cache(async (): Promise<Map<string, User>> => {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.from("profiles").select("*");
  return new Map(rows(data).map((row) => [row.id, toUser(row)]));
});

export async function getUser(userId: string): Promise<User | undefined> {
  return (await loadProfiles()).get(userId);
}

export async function requireUser(userId: string): Promise<User> {
  const user = await getUser(userId);
  if (!user) throw new Error(`Ukjent bruker: ${userId}`);
  return user;
}

export async function getUsers(userIds: string[]): Promise<User[]> {
  const profiles = await loadProfiles();
  return userIds
    .map((id) => profiles.get(id))
    .filter((user): user is User => Boolean(user));
}

// ── Communities and membership ──────────────────────────────────────────
//
// There is deliberately no `getAllCommunities()`. A community is reachable
// only through a membership row or through its own portal slug, and the
// database enforces the same rule.

const loadCommunities = cache(async (): Promise<Map<string, Community>> => {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.from("communities").select("*");
  return new Map(rows(data).map((row) => [row.id, toCommunity(row)]));
});

export async function getCommunityById(communityId: string): Promise<Community | undefined> {
  return (await loadCommunities()).get(communityId);
}

/**
 * The public portal slug for a community id, regardless of whether the caller
 * can see the community itself. Used only by the access guard, so that someone
 * without a membership row is sent to the public portal instead of a dead end.
 * Returns nothing for an id that does not exist.
 */
export async function getPortalSlugForCommunity(
  communityId: string,
): Promise<string | undefined> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.rpc("portal_slug_by_id", {
    p_community_id: communityId,
  });
  return (data as string | null) ?? undefined;
}

/**
 * The public portal record, by exact slug.
 *
 * This goes through a database function rather than a table read, because the
 * table is unreadable to anyone without a membership. The function takes one
 * slug and returns one row, so a portal link resolves but the platform still
 * cannot be enumerated.
 */
export async function getPortalCommunity(slug: string): Promise<CommunityPublic | undefined> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.rpc("portal_by_slug", { p_slug: slug });
  const row = (data as PortalCommunityRow[] | null)?.[0];
  return row ? toCommunityPublic(row) : undefined;
}

/** Upcoming public events for a portal. Never includes who is hosting. */
export async function getPortalEvents(slug: string) {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.rpc("portal_events", { p_slug: slug });
  return rows(data as PortalEventRow[] | null).map((row) => ({
    id: row.id,
    title: row.title,
    description: row.description,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    location: row.location,
  }));
}

/** The caller's own membership rows, whatever their status. */
const loadOwnMemberships = cache(async (userId: string): Promise<Membership[]> => {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("memberships")
    .select(MEMBERSHIP_COLUMNS)
    .eq("user_id", userId);
  return rows(data).map(toMembership);
});

export async function getMembership(
  userId: string,
  communityId: string,
): Promise<Membership | undefined> {
  const own = await loadOwnMemberships(userId);
  return own.find((membership) => membership.communityId === communityId);
}

export async function hasAccess(userId: string, communityId: string): Promise<boolean> {
  return (await getMembership(userId, communityId))?.status === "active";
}

export interface CommunityWithMembership {
  community: Community;
  membership: Membership;
}

async function communitiesByStatus(
  userId: string,
  status: Membership["status"],
): Promise<CommunityWithMembership[]> {
  const [memberships, communities] = await Promise.all([
    loadOwnMemberships(userId),
    loadCommunities(),
  ]);
  return memberships
    .filter((membership) => membership.status === status)
    .map((membership) => ({
      community: communities.get(membership.communityId)!,
      membership,
    }))
    .filter((entry) => Boolean(entry.community))
    .sort((a, b) => a.community.name.localeCompare(b.community.name, "nb"));
}

/** The user's own communities — the only list "Mine fellesskap" ever shows. */
export function getCommunitiesForUser(userId: string) {
  return communitiesByStatus(userId, "active");
}

export interface CommunityMember {
  user: User;
  membership: Membership;
}

const roleWeight: Record<RoleId, number> = { admin: 0, moderator: 1, member: 2 };

const loadCommunityMemberships = cache(async (communityId: string): Promise<Membership[]> => {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("memberships")
    .select(MEMBERSHIP_COLUMNS)
    .eq("community_id", communityId);
  return rows(data).map(toMembership);
});

/**
 * Whether the caller may list this community's membership.
 *
 * Asks the database rather than reasoning about roles here: the rule depends on
 * the community's own `member_directory_visibility` setting, and the same
 * function backs the row level security on `memberships`. The UI uses this only
 * to choose what to render — a caller who ignores it still gets nothing back.
 */
export async function canViewMemberDirectory(communityId: string): Promise<boolean> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("can_view_member_directory", {
    cid: communityId,
  });
  return !error && data === true;
}

/**
 * A community's direct-message policy.
 *
 * Read on its own rather than added to `Community`, because that type is the
 * shape of the organisations' own content file and this is configuration. The
 * application uses it to decide what to explain, never to decide what is
 * allowed — `can_send_dm()` settles that in the database.
 */
export async function getCommunityDmPolicy(
  communityId: string,
): Promise<"staff_only" | "members" | undefined> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("communities")
    .select("dm_policy")
    .eq("id", communityId)
    .maybeSingle();
  return data?.dm_policy ?? undefined;
}

/**
 * The caller's own "members may message me" setting, in one community.
 *
 * Read through a function because the column itself is not granted to
 * `authenticated` — see the migration. The function is SECURITY DEFINER and
 * takes no argument naming a person, so it can only ever answer about whoever
 * is asking. There is no form of this call that reads somebody else's value.
 */
export async function myAcceptsMemberDms(communityId: string): Promise<boolean> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("my_accepts_member_dms", {
    p_community_id: communityId,
  });
  return !error && data === true;
}

/**
 * Turns this person's "members may message me" setting on or off, in one
 * community.
 *
 * The community is the only thing passed in. Who is asking comes from
 * auth.uid() inside the function, and the statement it runs touches that one
 * row and no other — so there is no user id here to get wrong, and no way to
 * aim this at somebody else's setting or another community's row.
 *
 * Returns what is actually stored afterwards. A caller who may not change it
 * — an ordinary member, or anyone outside the community — is told false
 * rather than given an error, because false is the truth about them.
 */
export async function setAcceptsMemberDms(
  communityId: string,
  value: boolean,
): Promise<boolean> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("set_accepts_member_dms", {
    p_community_id: communityId,
    p_value: value,
  });
  return !error && data === true;
}

// ── Local groups ────────────────────────────────────────────────────────
//
// Reads go straight to the table, which carries its own policy: active members
// of that community and nobody else. Writes go through functions, because
// every one of them has an authorisation question attached — is this your own
// membership, do you administer this community — and the answer belongs in the
// database rather than in a caller that could forget to ask.

function toLocalGroup(row: LocalGroupRow): LocalGroup {
  return {
    id: row.id,
    communityId: row.community_id,
    name: row.name,
    slug: row.slug,
    sortOrder: row.sort_order,
    active: row.active,
  };
}

/**
 * Every local group in a community, retired ones included.
 *
 * Retired groups are returned rather than filtered out here because a member
 * who belongs to one still needs to see its name. Callers offering a choice
 * filter on `active` themselves.
 */
export const getLocalGroups = cache(async (communityId: string): Promise<LocalGroup[]> => {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("community_local_groups")
    .select("*")
    .eq("community_id", communityId)
    .order("sort_order", { ascending: true });
  return rows(data).map(toLocalGroup);
});

/**
 * How many active members each local group has, keyed by group id.
 *
 * Every group in the community gets an entry, including those nobody has
 * joined — zero is a real answer and reads as one. Empty only for a caller who
 * is not an active member of the community, who should not be seeing this page
 * at all.
 *
 * Counts name nobody. Reading the membership itself is unchanged and still
 * follows member_directory_visibility.
 */
export async function getLocalGroupMemberCounts(
  communityId: string,
): Promise<Map<string, number>> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("local_group_member_counts", {
    p_community_id: communityId,
  });
  if (error) return new Map();
  return new Map(rows(data).map((row) => [row.local_group_id, Number(row.member_count)]));
}

/**
 * Chooses, changes or clears the caller's own local group.
 *
 * `null` clears it, and that is a real answer rather than a failure — it is
 * how "Jeg vil ikke velge lokallag nå" is stored. The community is the only
 * thing passed in: who is asking comes from auth.uid() inside the function, so
 * there is no membership here to aim at somebody else.
 */
export async function setMyLocalGroup(
  communityId: string,
  localGroupId: string | null,
): Promise<boolean> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("set_my_local_group", {
    p_community_id: communityId,
    // The generated argument type is non-nullable because Postgres does not
    // record argument nullability, but null is a meaningful value here: it is
    // how a member clears their selection. The function signature accepts it.
    p_local_group_id: localGroupId as unknown as string,
  });
  return !error && data === true;
}

/** Administrators only; the database decides that, not the caller. */
export async function createLocalGroup(communityId: string, name: string): Promise<boolean> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("create_local_group", {
    p_community_id: communityId,
    p_name: name,
  });
  return !error && typeof data === "string";
}

export async function renameLocalGroup(localGroupId: string, name: string): Promise<boolean> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("rename_local_group", {
    p_local_group_id: localGroupId,
    p_name: name,
  });
  return !error && data === true;
}

/** Retires or reinstates a group. Never deletes, never moves anyone. */
export async function setLocalGroupActive(
  localGroupId: string,
  active: boolean,
): Promise<boolean> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("set_local_group_active", {
    p_local_group_id: localGroupId,
    p_active: active,
  });
  return !error && data === true;
}

export async function getCommunityMembers(communityId: string): Promise<CommunityMember[]> {
  const [memberships, profiles] = await Promise.all([
    loadCommunityMemberships(communityId),
    loadProfiles(),
  ]);
  return memberships
    .filter((membership) => membership.status === "active")
    .map((membership) => ({ user: profiles.get(membership.userId)!, membership }))
    .filter((entry) => Boolean(entry.user))
    .sort(
      (a, b) =>
        roleWeight[a.membership.role] - roleWeight[b.membership.role] ||
        a.user.name.localeCompare(b.user.name, "nb"),
    );
}

// ── Channels ────────────────────────────────────────────────────────────

const loadChannelGroups = cache(async (): Promise<ChannelGroup[]> => {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("channel_groups")
    .select("*")
    .order("position", { ascending: true });
  return rows(data).map((row) => ({ id: row.id, label: row.label }));
});

export function getChannelGroups() {
  return loadChannelGroups();
}

const loadChannels = cache(async (communityId: string): Promise<Channel[]> => {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("channels")
    .select("*")
    .eq("community_id", communityId)
    .order("position", { ascending: true });
  return rows(data).map(toChannel);
});

export function getChannels(communityId: string) {
  return loadChannels(communityId);
}

export async function getChannel(channelId: string): Promise<Channel | undefined> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.from("channels").select("*").eq("id", channelId).maybeSingle();
  return data ? toChannel(data) : undefined;
}

/** Channels grouped for the sidebar, in the order the groups are declared. */
export async function getGroupedChannels(communityId: string) {
  const [groups, channels] = await Promise.all([
    loadChannelGroups(),
    loadChannels(communityId),
  ]);
  return groups
    .map((group) => ({
      group,
      channels: channels.filter((channel) => channel.groupId === group.id),
    }))
    .filter((entry) => entry.channels.length > 0);
}

export async function getDefaultChannel(communityId: string) {
  return (await loadChannels(communityId))[0];
}

// ── Messages ────────────────────────────────────────────────────────────

export async function getMessages(channelId: string): Promise<Message[]> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("messages")
    .select("*")
    .eq("channel_id", channelId)
    .order("created_at", { ascending: true });
  return rows(data).map(toMessage);
}

export async function getLatestMessage(channelId: string): Promise<Message | undefined> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("messages")
    .select("*")
    .eq("channel_id", channelId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data ? toMessage(data) : undefined;
}

export type MessageWriteResult =
  | { ok: true; message: Message }
  | { ok: false; error: string };

/**
 * Writes one message to a channel.
 *
 * Nothing here decides who may write. `author_id` is omitted so the column
 * default fills in auth.uid(), and `messages_insert` independently requires
 * the row's author to be the caller, the caller to be able to read the
 * channel, and the channel not to be read-only unless the caller moderates
 * the community. A member posting in #kunngjoringer is refused by the
 * database, not by this function.
 */
export async function createMessage(input: {
  channelId: string;
  body: string;
}): Promise<MessageWriteResult> {
  const body = input.body.trim();
  if (!body) return { ok: false, error: "Meldingen kan ikke være tom." };

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("messages")
    .insert({ channel_id: input.channelId, body })
    .select("*")
    .single();

  if (error) return { ok: false, error: messageWriteError(error.message) };
  return { ok: true, message: toMessage(data) };
}

function messageWriteError(message: string): string {
  if (message.includes("row-level security")) {
    return "Du har ikke tilgang til å skrive i denne kanalen.";
  }
  return "Meldingen kunne ikke sendes. Prøv igjen.";
}

// ── Posts ───────────────────────────────────────────────────────────────

/**
 * One community's feed: pinned posts first, then everything by recency.
 *
 * The ordering is the query's, not the caller's. A pinned post that only rose
 * to the top in component state would sink again the moment anyone posted —
 * which is exactly what the "Festet" badge used to promise and fail to do.
 *
 * `pinned` is a boolean and nothing constrains it to one row per community, so
 * several posts can be pinned at once; within that group the ordinary rule
 * applies and the newest comes first.
 */
export async function getFeed(communityId: string): Promise<Post[]> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("posts")
    .select("*")
    .eq("community_id", communityId)
    .order("pinned", { ascending: false })
    .order("created_at", { ascending: false });
  return rows(data).map(toPost);
}

export async function getAnnouncements(communityId: string): Promise<Post[]> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("posts")
    .select("*")
    .eq("community_id", communityId)
    .eq("kind", "announcement")
    .order("created_at", { ascending: false });
  return rows(data).map(toPost);
}

/**
 * Feed across every community the user belongs to.
 *
 * The user id is unused: row level security already limits `posts` to
 * communities the caller is an active member of, so filtering again here would
 * only be able to narrow the result, never widen it. The parameter stays so
 * call sites read the same as before.
 */
export async function getHomeFeed(_userId: string, limit = 8): Promise<Post[]> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("posts")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);
  return rows(data).map(toPost);
}

// ── Post writes ─────────────────────────────────────────────────────────
//
// These go through the ordinary table API rather than an RPC, because row
// level security can express every rule on its own: `posts_insert` pins the
// author to auth.uid() and requires membership, `posts_update` limits edits to
// the author, `posts_delete` allows the author or a moderator, and a trigger
// freezes the columns that must not move. There is nothing left for a
// SECURITY DEFINER function to check, and adding one would only move the rules
// somewhere they are easier to get wrong.
//
// Note what is *not* passed in: author_id. The database takes it from the
// authenticated session, so a caller cannot supply one.

export type PostWriteResult = { ok: true; id: string } | { ok: false; error: string };

export async function createPost(input: {
  communityId: string;
  body: string;
  title?: string;
  announcement?: boolean;
}): Promise<PostWriteResult> {
  const body = input.body.trim();
  if (!body) return { ok: false, error: "Innlegget kan ikke være tomt." };

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("posts")
    .insert({
      community_id: input.communityId,
      body,
      title: input.title?.trim() || null,
      kind: input.announcement ? "announcement" : "post",
      // author_id is deliberately absent: the column defaults to auth.uid(),
      // and posts_insert additionally requires it to equal auth.uid(). There is
      // no code path here that could carry a client-supplied author.
    })
    .select("id")
    .single();

  if (error) return { ok: false, error: postWriteError(error.message) };
  return { ok: true, id: data.id };
}

export async function updatePost(
  postId: string,
  input: { body: string; title?: string },
): Promise<PostWriteResult> {
  const body = input.body.trim();
  if (!body) return { ok: false, error: "Innlegget kan ikke være tomt." };

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("posts")
    .update({ body, title: input.title?.trim() || null })
    .eq("id", postId)
    .select("id")
    .maybeSingle();

  if (error) return { ok: false, error: postWriteError(error.message) };
  // No error and no row means row level security matched nothing — the caller
  // is not the author, or cannot see the post at all.
  if (!data) return { ok: false, error: "Du kan bare endre dine egne innlegg." };
  return { ok: true, id: data.id };
}

export async function deletePost(postId: string): Promise<PostWriteResult> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("posts")
    .delete()
    .eq("id", postId)
    .select("id")
    .maybeSingle();

  if (error) return { ok: false, error: postWriteError(error.message) };
  if (!data) return { ok: false, error: "Du har ikke tilgang til å slette dette innlegget." };
  return { ok: true, id: data.id };
}

/**
 * Pins or unpins a post.
 *
 * This one *does* go through an RPC, unlike its neighbours above, and the
 * reason is the shape of the existing policies rather than a change of mind.
 * `posts_update` restricts updates to the author, which is deliberate — a
 * moderator follows up conversations, they do not rewrite someone else's
 * words — but pinning is precisely a thing a moderator does to someone else's
 * post. Widening that policy would hand over the editing rights with it, so
 * pinning gets its own entry point that can change this single column.
 *
 * The post id is the only argument. The community, and therefore the
 * permission question, is read from the post itself inside the function, so
 * there is no community for a caller to supply or forge.
 */
export async function setPostPinned(
  postId: string,
  pinned: boolean,
): Promise<PostWriteResult> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("set_post_pinned", {
    p_post_id: postId,
    p_pinned: pinned,
  });

  if (error) return { ok: false, error: postWriteError(error.message) };
  // Null is the function's single answer to every refusal — not a moderator,
  // wrong community, no such post — so there is nothing to tell apart here.
  if (data === null) {
    return { ok: false, error: "Du har ikke tilgang til å feste innlegg her." };
  }
  return { ok: true, id: postId };
}

/** Turns a Postgres message into something worth showing a person. */
function postWriteError(message: string): string {
  if (message.includes("row-level security")) {
    return "Du har ikke tilgang til å publisere dette her.";
  }
  return "Innlegget kunne ikke lagres. Prøv igjen.";
}

// ── Comments ────────────────────────────────────────────────────────────
//
// A comment carries no community. Authorisation is derived from the post it
// hangs off, through `can_access_post()` inside the policies, so there is no
// community id for a caller to supply — or to forge.

function toComment(row: CommentRow): Comment {
  return {
    id: row.id,
    postId: row.post_id,
    parentId: row.parent_id ?? undefined,
    authorId: row.author_id,
    body: row.body,
    createdAt: row.created_at,
    editedAt: row.edited_at ?? undefined,
  };
}

/** Every comment on one post, oldest first, replies included. */
export async function getComments(postId: string): Promise<Comment[]> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("comments")
    .select("*")
    .eq("post_id", postId)
    .order("created_at", { ascending: true });
  return rows(data).map(toComment);
}

/** Comments for several posts at once, so a feed does not issue one query each. */
export async function getCommentsForPosts(
  postIds: string[],
): Promise<Map<string, Comment[]>> {
  const grouped = new Map<string, Comment[]>();
  if (postIds.length === 0) return grouped;

  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("comments")
    .select("*")
    .in("post_id", postIds)
    .order("created_at", { ascending: true });

  for (const comment of rows(data).map(toComment)) {
    const list = grouped.get(comment.postId);
    if (list) list.push(comment);
    else grouped.set(comment.postId, [comment]);
  }
  return grouped;
}

export type CommentWriteResult = { ok: true; id: string } | { ok: false; error: string };

export async function createComment(input: {
  postId: string;
  body: string;
  parentId?: string;
}): Promise<CommentWriteResult> {
  const body = input.body.trim();
  if (!body) return { ok: false, error: "Kommentaren kan ikke være tom." };

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("comments")
    .insert({
      post_id: input.postId,
      parent_id: input.parentId ?? null,
      body,
      // author_id is absent on purpose: it defaults to auth.uid(), and the
      // insert policy requires it to match.
    })
    .select("id")
    .single();

  if (error) return { ok: false, error: commentWriteError(error.message) };
  return { ok: true, id: data.id };
}

export async function updateComment(
  commentId: string,
  body: string,
): Promise<CommentWriteResult> {
  const trimmed = body.trim();
  if (!trimmed) return { ok: false, error: "Kommentaren kan ikke være tom." };

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("comments")
    .update({ body: trimmed })
    .eq("id", commentId)
    .select("id")
    .maybeSingle();

  if (error) return { ok: false, error: commentWriteError(error.message) };
  if (!data) return { ok: false, error: "Du kan bare endre dine egne kommentarer." };
  return { ok: true, id: data.id };
}

export async function deleteComment(commentId: string): Promise<CommentWriteResult> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("comments")
    .delete()
    .eq("id", commentId)
    .select("id")
    .maybeSingle();

  if (error) return { ok: false, error: commentWriteError(error.message) };
  if (!data) return { ok: false, error: "Du har ikke tilgang til å slette denne kommentaren." };
  return { ok: true, id: data.id };
}

function commentWriteError(message: string): string {
  if (message.includes("row-level security")) {
    return "Du har ikke tilgang til å kommentere her.";
  }
  if (message.includes("svare på et svar")) {
    return "Det går ikke an å svare på et svar.";
  }
  return "Kommentaren kunne ikke lagres. Prøv igjen.";
}

// ── Reactions ───────────────────────────────────────────────────────────
//
// One row per person per emoji per post; the primary key is what makes a
// double reaction impossible. The count on a post is recomputed by a trigger,
// so nothing here ever writes an aggregate.

export type ReactionResult = { ok: true; reacted: boolean } | { ok: false; error: string };

/**
 * Adds the caller's reaction, or withdraws it if it is already there.
 *
 * Tries the insert first and treats a unique-violation as "already reacted",
 * which is both one round trip in the common case and correct if two clicks
 * race each other.
 */
export async function toggleReaction(
  postId: string,
  choice: { emoji?: string; emojiId?: string },
): Promise<ReactionResult> {
  const emoji = choice.emoji?.trim() || undefined;
  const emojiId = choice.emojiId?.trim() || undefined;

  // Exactly one kind, matching the database's own check constraint.
  if ((emoji === undefined) === (emojiId === undefined)) {
    return { ok: false, error: "Ugyldig reaksjon." };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("post_reactions").insert({
    post_id: postId,
    emoji: emoji ?? null,
    emoji_id: emojiId ?? null,
  });

  if (!error) return { ok: true, reacted: true };

  // 23505 = unique violation: the reaction exists, so this click removes it.
  if (error.code === "23505") {
    const query = supabase.from("post_reactions").delete().eq("post_id", postId);
    const { data: removed, error: deleteError } = await (emojiId
      ? query.eq("emoji_id", emojiId)
      : query.eq("emoji", emoji!)
    )
      .select("id")
      .maybeSingle();

    if (deleteError) return { ok: false, error: "Reaksjonen kunne ikke fjernes." };
    return { ok: true, reacted: !removed };
  }

  if (error.message.includes("row-level security")) {
    return { ok: false, error: "Du har ikke tilgang til å reagere her." };
  }
  // Raised by post_reactions_guard when the emoji belongs elsewhere.
  if (error.message.includes("annet fellesskap")) {
    return { ok: false, error: "Denne emojien hører til et annet fellesskap." };
  }
  return { ok: false, error: "Reaksjonen kunne ikke lagres." };
}

// ── Custom emojis ───────────────────────────────────────────────────────
//
// A custom emoji belongs to exactly one community, and both its metadata and
// its image are members-only. The bucket is private, so images are handed out
// as short-lived signed URLs created with the caller's own session — a
// non-member cannot obtain one, and a URL that leaks stops working.

const EMOJI_BUCKET = "community-emoji";
const EMOJI_URL_TTL_SECONDS = 60 * 60;

function toEmoji(row: CommunityEmojiRow, url?: string): CommunityEmoji {
  return {
    id: row.id,
    communityId: row.community_id,
    name: row.name,
    createdBy: row.created_by,
    createdAt: row.created_at,
    url,
  };
}

/**
 * Every custom emoji in one community, with a signed image URL each.
 *
 * Row level security already limits this to communities the caller belongs to,
 * so passing another community's id returns nothing rather than anything.
 */
export async function getCommunityEmojis(communityId: string): Promise<CommunityEmoji[]> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("community_emojis")
    .select("*")
    .eq("community_id", communityId)
    .order("name", { ascending: true });

  const emojiRows = rows(data) as CommunityEmojiRow[];
  if (emojiRows.length === 0) return [];

  const { data: signed } = await supabase.storage
    .from(EMOJI_BUCKET)
    .createSignedUrls(emojiRows.map((row) => row.storage_path), EMOJI_URL_TTL_SECONDS);

  const urlByPath = new Map((signed ?? []).map((entry) => [entry.path, entry.signedUrl]));
  return emojiRows.map((row) => toEmoji(row, urlByPath.get(row.storage_path) ?? undefined));
}

/** Emojis for every community the caller belongs to, keyed by community. */
export async function getEmojisForCommunities(
  communityIds: string[],
): Promise<Map<string, CommunityEmoji[]>> {
  const grouped = new Map<string, CommunityEmoji[]>();
  for (const communityId of communityIds) {
    grouped.set(communityId, await getCommunityEmojis(communityId));
  }
  return grouped;
}

export type EmojiWriteResult = { ok: true; id: string } | { ok: false; error: string };

/**
 * Uploads the image, then records the metadata.
 *
 * Both steps are policed independently: the storage policies require
 * can_moderate() on the community named by the path prefix, and the table
 * policy requires it again for the row. If the row insert fails the object is
 * removed, so a rejected emoji does not leave a file behind.
 */
export async function createCommunityEmoji(input: {
  communityId: string;
  name: string;
  bytes: Uint8Array;
  contentType: string;
  extension: string;
}): Promise<EmojiWriteResult> {
  const supabase = await createSupabaseServerClient();
  const id = crypto.randomUUID();
  const storagePath = `${input.communityId}/${id}.${input.extension}`;

  const { error: uploadError } = await supabase.storage
    .from(EMOJI_BUCKET)
    .upload(storagePath, input.bytes, { contentType: input.contentType, upsert: false });

  if (uploadError) {
    return {
      ok: false,
      error: uploadError.message.toLowerCase().includes("row-level security")
        ? "Du har ikke tilgang til å legge til emojier her."
        : "Bildet kunne ikke lastes opp.",
    };
  }

  const { data, error } = await supabase
    .from("community_emojis")
    .insert({
      id,
      community_id: input.communityId,
      name: input.name,
      storage_path: storagePath,
      content_type: input.contentType,
      byte_size: input.bytes.byteLength,
      // created_by is absent on purpose: it defaults to auth.uid() and the
      // policy requires it to match.
    })
    .select("id")
    .single();

  if (error) {
    await supabase.storage.from(EMOJI_BUCKET).remove([storagePath]);
    if (error.code === "23505") {
      return { ok: false, error: `:${input.name}: finnes allerede i dette fellesskapet.` };
    }
    if (error.message.includes("row-level security")) {
      return { ok: false, error: "Du har ikke tilgang til å legge til emojier her." };
    }
    return { ok: false, error: "Emojien kunne ikke lagres." };
  }
  return { ok: true, id: data.id };
}

export async function deleteCommunityEmoji(emojiId: string): Promise<EmojiWriteResult> {
  const supabase = await createSupabaseServerClient();

  // The path has to be read before anything is removed: once the row is gone
  // there is nothing left that knows which file belonged to it.
  const { data: existing } = await supabase
    .from("community_emojis")
    .select("id, storage_path")
    .eq("id", emojiId)
    .maybeSingle();

  // Nothing readable under this id — it does not exist, or it belongs to a
  // community the caller is not in. Both get the same answer, which is also
  // what stops an id from another community being probed for existence.
  if (!existing) {
    return { ok: false, error: "Du har ikke tilgang til å slette denne emojien." };
  }

  // The file goes first, deliberately.
  //
  // Both steps require can_moderate() on the same community, so a caller who
  // may not delete the row cannot delete the file either — they are stopped
  // here, with the row untouched. Doing it in this order means the failure
  // that remains possible is a row whose image is gone, which renders as the
  // emoji's name and can be cleared by deleting it again. The other order
  // risks a file nothing references, which is invisible and accumulates.
  const { error: storageError } = await supabase.storage
    .from(EMOJI_BUCKET)
    .remove([existing.storage_path]);

  if (storageError) {
    return {
      ok: false,
      error: storageError.message.toLowerCase().includes("unauthorized")
        ? "Du har ikke tilgang til å slette denne emojien."
        : "Emojibildet kunne ikke fjernes. Prøv igjen.",
    };
  }

  const { data, error } = await supabase
    .from("community_emojis")
    .delete()
    .eq("id", emojiId)
    .select("id")
    .maybeSingle();

  if (error || !data) {
    return { ok: false, error: "Emojien kunne ikke slettes." };
  }
  return { ok: true, id: data.id };
}

// ── Access requests and invitations ─────────────────────────────────────
//
// Asking for access is anonymous and says nothing back. Approving it mints an
// invitation. Only redeeming that invitation creates a membership. Each step
// is a database function that checks its own preconditions, so none of the
// rules depend on this file being called correctly.

export interface AccessRequest {
  id: string;
  communityId: string;
  email: string;
  displayName?: string;
  status: "pending" | "approved" | "rejected" | "cancelled";
  createdAt: string;
  reviewedAt?: string;
  reviewedBy?: string;
}

export interface CommunityInvitation {
  id: string;
  communityId: string;
  email: string;
  createdAt: string;
  expiresAt: string;
  /** Decided against the server's clock, not the browser's. */
  expired: boolean;
  acceptedAt?: string;
  revokedAt?: string;
}

function toAccessRequest(row: AccessRequestRow): AccessRequest {
  return {
    id: row.id,
    communityId: row.community_id,
    email: row.email,
    displayName: row.display_name ?? undefined,
    status: row.status,
    createdAt: row.created_at,
    reviewedAt: row.reviewed_at ?? undefined,
    reviewedBy: row.reviewed_by ?? undefined,
  };
}

/**
 * Submits a request. Always resolves the same way.
 *
 * The database returns true for an accepted request, an already-pending one,
 * an address that already belongs to a member, a rate-limited caller and an
 * unknown community alike — so there is nothing here to translate into a
 * message that would distinguish them. Only a malformed address differs.
 */
export async function requestCommunityAccess(input: {
  slug: string;
  email: string;
  displayName?: string;
}): Promise<boolean> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("request_community_access", {
    p_slug: input.slug,
    p_email: input.email,
    p_display_name: input.displayName ?? undefined,
  });
  return !error && data === true;
}

/** The pending queue for one community. Empty unless the caller administers it. */
export async function getAccessRequests(communityId: string): Promise<AccessRequest[]> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("access_requests")
    .select("*")
    .eq("community_id", communityId)
    .eq("status", "pending")
    .order("created_at", { ascending: true });
  return (rows(data) as AccessRequestRow[]).map(toAccessRequest);
}

/** Live invitations for one community, so an admin can see what is outstanding. */
export async function getInvitations(communityId: string): Promise<CommunityInvitation[]> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("invitations")
    .select("*")
    .eq("community_id", communityId)
    .is("accepted_at", null)
    .is("revoked_at", null)
    .order("created_at", { ascending: false });
  return (rows(data) as InvitationRow[]).map((row) => ({
    id: row.id,
    communityId: row.community_id,
    email: row.email,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    expired: Date.parse(row.expires_at) <= now().getTime(),
    acceptedAt: row.accepted_at ?? undefined,
    revokedAt: row.revoked_at ?? undefined,
  }));
}

export interface MintedInvitation {
  token: string | null;
  email: string;
  communityId: string;
  expiresAt: string;
}

/**
 * Approves a request and returns the invitation to send.
 *
 * `token` is null when the request was already approved and a live invitation
 * exists — the caller should not send a second email, and there is no second
 * token to send. That is what makes a double-click harmless.
 */
export async function approveAccessRequest(requestId: string): Promise<MintedInvitation | null> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("approve_access_request", {
    p_request_id: requestId,
  });
  const row = (data as MintedInvitationRow[] | null)?.[0];
  if (error || !row) return null;
  return {
    token: row.token,
    email: row.email,
    communityId: row.community_id,
    expiresAt: row.expires_at,
  };
}

export async function rejectAccessRequest(requestId: string): Promise<boolean> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("reject_access_request", {
    p_request_id: requestId,
  });
  return !error && data === true;
}

/** Issues a fresh token and revokes the previous one. */
export async function resendInvitation(invitationId: string): Promise<MintedInvitation | null> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("resend_invitation", {
    p_invitation_id: invitationId,
  });
  const row = (data as MintedInvitationRow[] | null)?.[0];
  if (error || !row) return null;
  return {
    token: row.token,
    email: row.email,
    communityId: row.community_id,
    expiresAt: row.expires_at,
  };
}

export interface InvitationPreview {
  communityId: string;
  communityName: string;
  communitySlug: string;
  email: string;
  expiresAt: string;
}

/**
 * What the acceptance page may show before anyone has signed in: the community
 * and the invited address. A spent, revoked, expired or invented token returns
 * nothing, so the page cannot be used to test tokens.
 */
export async function getInvitationPreview(token: string): Promise<InvitationPreview | undefined> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.rpc("invitation_preview", { p_token: token });
  const row = (data as InvitationPreviewRow[] | null)?.[0];
  if (!row) return undefined;
  return {
    communityId: row.community_id,
    communityName: row.community_name,
    communitySlug: row.community_slug,
    email: row.email,
    expiresAt: row.expires_at,
  };
}

export type AcceptInvitationResult =
  | { ok: true; communityId: string; alreadyMember: boolean }
  | { ok: false; reason: string };

/** The only path from an invitation to a membership. */
export async function acceptInvitationToken(token: string): Promise<AcceptInvitationResult> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("accept_invitation_token", { p_token: token });
  const row = (data as AcceptInvitationRow[] | null)?.[0];
  if (error || !row) return { ok: false, reason: "invalid" };
  if (!row.ok || !row.community_id) return { ok: false, reason: row.reason };
  return { ok: true, communityId: row.community_id, alreadyMember: row.reason === "already-member" };
}

// ── Events ──────────────────────────────────────────────────────────────

/**
 * Current time.
 *
 * A function, not a constant: a module-level `new Date()` is evaluated once
 * when the server first imports this file, and every "upcoming events" query
 * would then be filtered against the moment the process booted.
 */
export function now(): Date {
  return new Date();
}

const loadAttendees = cache(async (): Promise<Map<string, string[]>> => {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.from("event_attendees").select("*");
  const byEvent = new Map<string, string[]>();
  for (const row of rows(data)) {
    byEvent.set(row.event_id, [...(byEvent.get(row.event_id) ?? []), row.user_id]);
  }
  return byEvent;
});

async function withAttendees(rows: EventRow[]): Promise<CommunityEvent[]> {
  const attendees = await loadAttendees();
  return rows.map((row) => toEvent(row, attendees.get(row.id) ?? []));
}

export async function getCommunityEvents(communityId: string): Promise<CommunityEvent[]> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("events")
    .select("*")
    .eq("community_id", communityId)
    .order("starts_at", { ascending: true });
  return withAttendees(rows(data));
}

export async function getUpcomingCommunityEvents(communityId: string) {
  const events = await getCommunityEvents(communityId);
  return events.filter((event) => Date.parse(event.endsAt) >= now().getTime());
}

export async function getPastCommunityEvents(communityId: string) {
  const events = await getCommunityEvents(communityId);
  return events.filter((event) => Date.parse(event.endsAt) < now().getTime()).reverse();
}

/** Upcoming events across the caller's communities. Scoped by RLS, as above. */
export async function getEventsForUser(_userId: string): Promise<CommunityEvent[]> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("events")
    .select("*")
    .gte("ends_at", now().toISOString())
    .order("starts_at", { ascending: true });
  return withAttendees(rows(data));
}

export type EventWriteResult = { ok: true } | { ok: false; error: "full" | "refused" };

/**
 * Signs the caller up for an event.
 *
 * `user_id` is deliberately absent: the column defaults to auth.uid(), and
 * `event_attendees_write` independently requires the row to be the caller's
 * own and the caller to be an active member of the event's community. There is
 * no code path here that could carry a client-supplied attendee.
 *
 * A second RSVP hits the (event_id, user_id) primary key rather than creating
 * a duplicate, and a full event is refused by the capacity trigger.
 */
export async function joinEvent(eventId: string): Promise<EventWriteResult> {
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("event_attendees").insert({ event_id: eventId });

  if (!error) return { ok: true };
  // Already attending is the state the caller wanted; treat it as success so a
  // double submit is not reported as a failure.
  if (error.code === "23505") return { ok: true };
  if (error.message.includes("event_full")) return { ok: false, error: "full" };
  return { ok: false, error: "refused" };
}

/**
 * Withdraws the caller from an event.
 *
 * The delete is filtered by the policy to the caller's own row, so cancelling
 * somebody else's place removes nothing rather than erroring.
 */
export async function leaveEvent(eventId: string): Promise<EventWriteResult> {
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("event_attendees").delete().eq("event_id", eventId);
  return error ? { ok: false, error: "refused" } : { ok: true };
}

/**
 * Creates an event in one community.
 *
 * `host_id` is omitted for the same reason as above — it defaults to
 * auth.uid() — and `events_insert` requires the caller to administer the
 * community named in the row. Field limits and the ends-after-starts rule are
 * in the policy too, so a caller that skips this function still meets them.
 */
export async function createEvent(input: {
  communityId: string;
  title: string;
  description: string;
  startsAt: string;
  endsAt: string;
  location: string;
  isPublic: boolean;
  capacity?: number;
}): Promise<{ ok: true; id: string } | { ok: false }> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("events")
    .insert({
      community_id: input.communityId,
      title: input.title.trim(),
      description: input.description.trim(),
      starts_at: input.startsAt,
      ends_at: input.endsAt,
      location: input.location.trim(),
      is_public: input.isPublic,
      capacity: input.capacity ?? null,
    })
    .select("id")
    .single();

  return error ? { ok: false } : { ok: true, id: data.id };
}

export async function getEvent(eventId: string): Promise<CommunityEvent | undefined> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.from("events").select("*").eq("id", eventId).maybeSingle();
  return data ? (await withAttendees([data]))[0] : undefined;
}

// ── Notifications ───────────────────────────────────────────────────────

export async function getNotifications(userId: string): Promise<Notification[]> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("notifications")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  return rows(data).map(toNotification);
}

export async function getUnreadCount(userId: string): Promise<number> {
  const supabase = await createSupabaseServerClient();
  const { count } = await supabase
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("read", false);
  return count ?? 0;
}

// ── Notification read state ─────────────────────────────────────────────
//
// Marking one notification read goes through the ordinary table API rather
// than an RPC, and deliberately so: after 20260916160000 there is nothing left
// for a SECURITY DEFINER function to check that the database does not already
// enforce on its own.
//
//   which row    — `notifications_update` admits only `user_id = auth.uid()`,
//                  so an id belonging to someone else matches nothing. There
//                  is no ownership test to write here, and writing one would
//                  only be able to disagree with the policy that actually runs.
//   which column — `authenticated` holds UPDATE on `read` and on no other
//                  column, so a request naming any other column is refused
//                  before a policy is consulted, and the notifications_immutable
//                  trigger refuses the write even if that grant were restored.
//
// A function would add authority rather than remove it — it would run as the
// table's owner, outside both of those — so the narrow thing is the plain
// update.

/**
 * Marks one of the caller's notifications read.
 *
 * Returns whether a row was actually affected. A false means the notification
 * is not the caller's or does not exist; the two are not distinguished, and
 * the caller should not tell the user which it was.
 */
export async function markNotificationRead(notificationId: string): Promise<boolean> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("notifications")
    .update({ read: true })
    .eq("id", notificationId)
    .select("id")
    .maybeSingle();
  return data !== null;
}

/**
 * Marks everything the caller has not read.
 *
 * This one *is* an RPC, because `mark_notifications_read()` has existed since
 * the first migration and already scopes itself with `where user_id =
 * auth.uid()`. It has simply never been called from anywhere.
 */
export async function markAllNotificationsRead(): Promise<boolean> {
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("mark_notifications_read");
  return !error;
}
