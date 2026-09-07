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
  PostRow,
  ProfileRow,
} from "@/lib/supabase/database.types";
import type {
  Channel,
  ChannelGroup,
  Community,
  CommunityEvent,
  CommunityPublic,
  Membership,
  Message,
  Notification,
  Post,
  RoleId,
  User,
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

function toMembership(row: MembershipRow): Membership {
  return {
    userId: row.user_id,
    communityId: row.community_id,
    role: row.role,
    status: row.status,
    joinedAt: row.joined_at,
    title: row.title ?? undefined,
    invitedBy: row.invited_by ?? undefined,
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
    reactions: (row.reactions as Message["reactions"]) ?? [],
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
    kind: row.kind,
    pinned: row.pinned || undefined,
    commentCount: row.comment_count,
    reactions: (row.reactions as Post["reactions"]) ?? [],
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
  const { data } = await supabase.from("memberships").select("*").eq("user_id", userId);
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

export function getInvitationsForUser(userId: string) {
  return communitiesByStatus(userId, "invited");
}

export function getPendingRequestsForUser(userId: string) {
  return communitiesByStatus(userId, "requested");
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
    .select("*")
    .eq("community_id", communityId);
  return rows(data).map(toMembership);
});

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

/** Requests and unanswered invitations, shown to admins on the members screen. */
export async function getPendingMembers(communityId: string): Promise<CommunityMember[]> {
  const [memberships, profiles] = await Promise.all([
    loadCommunityMemberships(communityId),
    loadProfiles(),
  ]);
  return memberships
    .filter((membership) => membership.status !== "active")
    .map((membership) => ({ user: profiles.get(membership.userId)!, membership }))
    .filter((entry) => Boolean(entry.user));
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

// ── Posts ───────────────────────────────────────────────────────────────

export async function getFeed(communityId: string): Promise<Post[]> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("posts")
    .select("*")
    .eq("community_id", communityId)
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

// ── Membership transitions ──────────────────────────────────────────────
//
// Each of these is a database function that checks its own preconditions —
// that the invitation is still open, that the caller really administers this
// community — so the rules hold no matter what calls them.

async function rpcBoolean(
  fn: "request_access" | "accept_invitation" | "decline_invitation",
  communityId: string,
): Promise<boolean> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc(fn, { p_community_id: communityId });
  if (error) return false;
  return data === true;
}

export function acceptInvitation(communityId: string) {
  return rpcBoolean("accept_invitation", communityId);
}

export function declineInvitation(communityId: string) {
  return rpcBoolean("decline_invitation", communityId);
}

export function requestAccess(communityId: string) {
  return rpcBoolean("request_access", communityId);
}

export async function approveMembership(communityId: string, userId: string): Promise<boolean> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("approve_membership", {
    p_community_id: communityId,
    p_user_id: userId,
  });
  return !error && data === true;
}

export async function rejectMembership(communityId: string, userId: string): Promise<boolean> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("reject_membership", {
    p_community_id: communityId,
    p_user_id: userId,
  });
  return !error && data === true;
}
