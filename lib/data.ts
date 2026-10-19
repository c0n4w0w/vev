import { MESSAGE_BODY_MAX, messageBodyError } from "@/lib/message-form";
import "server-only";

import { cache } from "react";
import { isAuthRetryableFetchError, type AuthError } from "@supabase/supabase-js";
import { createSupabaseScratchClient, createSupabaseServerClient } from "@/lib/supabase/server";
import { countActiveMembers } from "@/lib/member-count";
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
  AccessRequestHistoryRow,
  AccessRequestRow,
  CommentRow,
  CommunityEmojiRow,
  InvitationPreviewRow,
  InvitationRow,
  MintedInvitationRow,
  PostRow,
  ProfileRow,
  LocalGroupRow,
  CommunityPersonRow,
  CommunityProfileRow,
  DirectConversationReadRow,
  DirectConversationRow,
  DirectMessageRow,
  SubgroupRow,
  ChannelSectionRow,
} from "@/lib/supabase/database.types";
import type {
  Channel,
  ChannelGroup,
  ChannelSection,
  Comment,
  Community,
  CommunityEmoji,
  CommunityEvent,
  CommunityPublic,
  EventAttendee,
  Membership,
  Message,
  MessageDeletion,
  Reaction,
  Notification,
  Post,
  RoleId,
  User,
  LocalGroup,
  CommunityPerson,
  CommunityPersona,
  DirectConversation,
  DirectConversationSummary,
  DirectMessage,
  Subgroup,
  SubgroupRosterEntry,
  LocalGroupLeadership,
  PrivateChannelParticipant,
  ChannelContentCounts,
} from "@/lib/types";
import { initialsFor } from "@/lib/format";
import type { MentionCandidate } from "@/lib/mentions";
import { parseLocale, type Locale, type MessageKey } from "@/lib/i18n";
import { getRelatedCommunityConfig, isActiveMember, type RelatedCommunityConfig } from "@/lib/related-communities";
import {
  getChannelAttachments,
  getConversationAttachments,
  sendWithAttachments,
  toMessageAttachment,
  type AttachmentRefusal,
} from "@/lib/attachment-data";


/**
 * The single seam between the UI and the database.
 *
 * Every screen reads through these functions. They run as the signed-in user,
 * so row level security — not this file — decides what comes back; the code
 * here shapes rows into the domain types the components already expect.
 *
 * Reads that a single render repeats (a community's profiles, the caller's
 * memberships) are wrapped in React's `cache`, which dedupes them for the
 * duration of one request. That is what keeps a feed of twenty posts from
 * issuing twenty author lookups.
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

/**
 * Where the signed-in app fetches a community's profile image.
 *
 * A same-origin route that checks membership and streams the private object,
 * rather than a signed storage URL: the address is stable, so the browser can
 * cache it, and it does not expire under a page someone leaves open. `v` is
 * the object's own name. Every upload gets a new one, so replacing the image
 * changes the URL and the old cached copy is simply never asked for again.
 */
function communityAvatarUrl(communityId: string, avatarPath: string): string {
  return `/community/${communityId}/avatar?v=${encodeURIComponent(avatarPath.split("/").pop() ?? "")}`;
}

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
    defaultLocale: parseLocale(row.default_locale),
    links: (row.links as LinkList) ?? [],
  };
}

function toCommunity(row: CommunityRow): Community {
  return {
    ...toCommunityPublic(row),
    about: row.about,
    avatarUrl: row.avatar_path ? communityAvatarUrl(row.id, row.avatar_path) : undefined,
  };
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
 * Nothing else sees it. `onboarding_dismissed_at` is private the same way and
 * is read only through `isOnboardingVisible()`.
 */
function toMembership(
  row: Omit<MembershipRow, "accepts_member_dms" | "onboarding_dismissed_at">,
): Membership {
  return {
    id: row.id,
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
    groupId: row.group_id ?? undefined,
    sectionId: row.section_id ?? undefined,
    position: row.position,
    name: row.name,
    purpose: row.purpose,
    readOnly: row.read_only || undefined,
    localGroupId: row.local_group_id ?? undefined,
    subgroupId: row.subgroup_id ?? undefined,
    isPrivate: row.is_private || undefined,
    archived: row.archived_at ? true : undefined,
    fileSharing: row.file_sharing_enabled || undefined,
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
    editedAt: row.edited_at ?? undefined,
    deleted: row.deleted_at ? (row.removed_by_moderator ? "moderator" : "author") : undefined,
  };
}

function toDirectMessage(row: DirectMessageRow): DirectMessage {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    authorId: row.author_id,
    body: row.body,
    createdAt: row.created_at,
    hasAttachments: row.has_attachments || undefined,
    editedAt: row.edited_at ?? undefined,
    deleted: row.deleted_at ? "author" : undefined,
  };
}

/**
 * Every post read selects its scoped local group in the same request, so a
 * feed of twenty posts is one query rather than twenty-one, and no card ever
 * looks its own group up.
 *
 * The embed runs under `community_local_groups_select`, which admits exactly
 * the active members of the community — the same predicate as
 * `posts_select`. Whoever can read the post can read its group's name, and
 * the embed cannot surface a group the post does not already point at.
 */
const POST_SELECT =
  "*, local_group:community_local_groups!posts_local_group_fkey(id, name), subgroup:community_subgroups!posts_subgroup_fkey(id, name, slug)" as const;

type PostWithGroupRow = PostRow & {
  local_group: { id: string; name: string } | null;
  subgroup: { id: string; name: string; slug: string } | null;
};

function toPost(row: PostWithGroupRow): Post {
  return {
    id: row.id,
    communityId: row.community_id,
    localGroupId: row.local_group_id ?? undefined,
    localGroup: row.local_group ? { id: row.local_group.id, name: row.local_group.name } : undefined,
    subgroup: row.subgroup ? { id: row.subgroup.id, name: row.subgroup.name, slug: row.subgroup.slug } : undefined,
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

/**
 * Events are read with the name of the lokallag or subgroup they are limited
 * to. Both embeds run under their own table's RLS, and anyone who can read a
 * scoped event can also read its group, so the label never names a group the
 * row does not already point at.
 */
const EVENT_SELECT =
  "*, local_group:community_local_groups!events_local_group_fkey(name), subgroup:community_subgroups!events_subgroup_fkey(name, slug)" as const;

type EventWithScopeRow = EventRow & {
  local_group?: { name: string } | null;
  subgroup?: { name: string; slug: string } | null;
};

type Attendance = { attendeeCount: number; attending: boolean };

function toEvent(row: EventWithScopeRow, attendance: Attendance): CommunityEvent {
  return {
    id: row.id,
    communityId: row.community_id,
    localGroupId: row.local_group_id ?? undefined,
    subgroupId: row.subgroup_id ?? undefined,
    subgroupSlug: row.subgroup?.slug ?? undefined,
    scopeName: row.local_group?.name ?? row.subgroup?.name ?? undefined,
    title: row.title,
    description: row.description,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    location: row.location,
    isPublic: row.is_public,
    hostId: row.host_id ?? "",
    attendeeCount: attendance.attendeeCount,
    attending: attendance.attending,
    capacity: row.capacity ?? undefined,
    cancelledAt: row.cancelled_at ?? undefined,
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
//
// Two different things, kept apart on purpose.
//
// The *account* (`profiles`) is readable by its owner and nobody else — row
// level security says so. `getUser` is therefore only ever the signed-in
// person's own record, and is what the session and /profile use.
//
// Everyone else, and the signed-in person too wherever they appear *inside* a
// community, is a `CommunityPersona`: that community's profile of them. It is
// resolved per community and never falls back to the account, so a
// pseudonym in one community cannot be undone by a lookup that reaches for
// the account name, and one community's persona never stands in for another's.

const loadAccount = cache(async (userId: string): Promise<User | undefined> => {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.from("profiles").select("*").eq("id", userId).maybeSingle();
  return data ? toUser(data) : undefined;
});

/** The signed-in person's own account. Row level security returns nothing for anyone else. */
export async function getUser(userId: string): Promise<User | undefined> {
  return loadAccount(userId);
}

/**
 * Where the signed-in app fetches a member's profile photo in one community.
 * Same pattern as `communityAvatarUrl`: a stable same-origin route that checks
 * access on every request, with `v` changing whenever the photo does.
 */
function memberAvatarUrl(communityId: string, userId: string, avatarPath: string): string {
  return `/community/${communityId}/member-avatar/${userId}?v=${encodeURIComponent(avatarPath.split("/").pop() ?? "")}`;
}

function toPersona(row: CommunityProfileRow): CommunityPersona {
  return {
    id: row.user_id,
    communityId: row.community_id,
    name: row.display_name,
    initials: initialsFor(row.display_name),
    bio: row.bio,
    avatarUrl: row.avatar_path
      ? memberAvatarUrl(row.community_id, row.user_id, row.avatar_path)
      : undefined,
  };
}

/**
 * The deliberate answer for someone whose profile in this community the
 * caller may not see, or who has none. Never the account, never another
 * community's persona.
 */
function unknownPersona(communityId: string, userId: string): CommunityPersona {
  return { id: userId, communityId, name: "Ukjent", initials: "?", bio: "" };
}

/**
 * Every profile in one community the caller may see. Row level security
 * (`can_view_community_profile`) draws that line: your own, people in an
 * open registry, and people whose content or conversation you can already
 * see there. One query per community per request.
 */
const loadCommunityPersonas = cache(
  async (communityId: string): Promise<Map<string, CommunityPersona>> => {
    const supabase = await createSupabaseServerClient();
    const { data } = await supabase
      .from("community_profiles")
      .select("*")
      .eq("community_id", communityId);
    return new Map(rows(data).map((row) => [row.user_id, toPersona(row)]));
  },
);

/** One person as they appear in one community. */
export async function getCommunityPersona(
  communityId: string,
  userId: string,
): Promise<CommunityPersona> {
  return (await loadCommunityPersonas(communityId)).get(userId) ?? unknownPersona(communityId, userId);
}

/**
 * Several people as they appear in one community, keyed by user id. Every id
 * asked for gets an entry; one the caller may not see is "Ukjent".
 */
export async function getCommunityPersonas(
  communityId: string,
  userIds: string[],
): Promise<Map<string, CommunityPersona>> {
  const personas = await loadCommunityPersonas(communityId);
  return new Map(
    userIds.map((id) => [id, personas.get(id) ?? unknownPersona(communityId, id)]),
  );
}

/**
 * Name and photo of the people among `userIds` whose identity here the caller
 * may see (community_identities → can_view_community_identity): everyone
 * whose profile they may see, plus people a message they can read mentions
 * and people they share a private channel or group with. Nobody else gets an
 * entry, not even a placeholder. Never the bio: `bio` is always empty here.
 */
export async function getVisibleCommunityPersonas(
  communityId: string,
  userIds: string[],
): Promise<Map<string, CommunityPersona>> {
  const ids = [...new Set(userIds)].slice(0, 200);
  if (ids.length === 0) return new Map();
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("community_identities", {
    p_community_id: communityId,
    p_user_ids: ids,
  });
  if (error) return new Map();
  return new Map(
    rows(data).map((row) => [
      row.user_id,
      {
        id: row.user_id,
        communityId,
        name: row.display_name,
        initials: initialsFor(row.display_name),
        bio: "",
        avatarUrl: row.avatar_version
          ? memberAvatarUrl(communityId, row.user_id, `${communityId}/${row.user_id}/${row.avatar_version}`)
          : undefined,
      },
    ]),
  );
}

/** A name opened in a channel: who they are here, as the database allows. */
export interface ChannelPersonCard {
  persona: CommunityPersona;
  /** Only when the caller may see the whole profile, and it is not empty. */
  bio?: string;
  /**
   * Under The Rug only: the caller may write to this person
   * (can_send_dm), and the conversation if it exists already.
   */
  dm?: { conversationId?: string };
}

/**
 * Members message each other from a name in a chat in Under The Rug alone.
 * Tryggere Ruspolitikk and Tryggere Ungdom keep their own direct-message
 * policy, reached from their member pages; the card never offers it there,
 * whatever can_send_dm would answer — including between two people who both
 * also belong to Under The Rug.
 */
const CARD_DM_COMMUNITY = "under-the-rug";

/**
 * The card for a name in a channel (channel_person_card): only someone who
 * belongs to that channel's conversation, for a caller who can read it now
 * and may see their identity. The bio only where the whole profile is
 * visible. Undefined for anyone else.
 */
export async function getChannelPersonCard(
  communityId: string,
  channelId: string,
  userId: string,
): Promise<ChannelPersonCard | undefined> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .rpc("channel_person_card", { p_channel_id: channelId, p_user_id: userId })
    .maybeSingle();
  if (error || !data) return undefined;
  const persona: CommunityPersona = {
    id: data.user_id,
    communityId,
    name: data.display_name,
    initials: initialsFor(data.display_name),
    bio: data.bio ?? "",
    avatarUrl: data.avatar_version
      ? memberAvatarUrl(communityId, data.user_id, `${communityId}/${data.user_id}/${data.avatar_version}`)
      : undefined,
  };

  let dm: ChannelPersonCard["dm"];
  const viewer = (await supabase.auth.getUser()).data.user?.id;
  if (communityId === CARD_DM_COMMUNITY && viewer && viewer !== userId) {
    const { data: allowed } = await supabase.rpc("can_send_dm", { cid: communityId, recipient: userId });
    if (allowed === true) {
      // Read under the conversations' own policy: only one the caller is in.
      const { data: existing } = await supabase
        .from("direct_conversations")
        .select("id")
        .eq("community_id", communityId)
        .or(
          `and(participant_one_id.eq.${viewer},participant_two_id.eq.${userId}),and(participant_one_id.eq.${userId},participant_two_id.eq.${viewer})`,
        )
        .maybeSingle();
      dm = { conversationId: existing?.id ?? undefined };
    }
  }
  return { persona, bio: data.bio ?? undefined, dm };
}

/** Key for `getPersonasAcrossCommunities`. */
export function personaKey(communityId: string, userId: string): string {
  return `${communityId}|${userId}`;
}

/**
 * For pages that list content from several communities at once — the home
 * feed, the combined calendar. Each item is resolved in *its own* community,
 * so the same person can appear under two different names on one page, which
 * is exactly how they appear inside each of those communities. Keyed by
 * `personaKey(communityId, userId)`.
 */
export async function getPersonasAcrossCommunities(
  entries: { communityId: string; userId: string }[],
): Promise<Map<string, CommunityPersona>> {
  const result = new Map<string, CommunityPersona>();
  const byCommunity = new Map<string, Set<string>>();
  for (const { communityId, userId } of entries) {
    if (!userId) continue;
    byCommunity.set(communityId, (byCommunity.get(communityId) ?? new Set()).add(userId));
  }
  await Promise.all(
    [...byCommunity].map(async ([communityId, ids]) => {
      for (const [userId, persona] of await getCommunityPersonas(communityId, [...ids])) {
        result.set(personaKey(communityId, userId), persona);
      }
    }),
  );
  return result;
}

/**
 * The caller's own profiles, keyed by community. Only their own rows are
 * read, so this is safe to show together on /profile — the one page where a
 * person sees all of their communities side by side.
 */
export async function getMyCommunityPersonas(
  userId: string,
): Promise<Map<string, CommunityPersona>> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("community_profiles")
    .select("*")
    .eq("user_id", userId);
  return new Map(rows(data).map((row) => [row.community_id, toPersona(row)]));
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

export type SetCommunityAboutResult = { ok: true; about: string } | { ok: false; error: MessageKey };

/**
 * Changes the "Om fellesskapet" text on the overview page.
 *
 * Goes through `set_community_about()`, not a table write: the function is
 * the only door, checks the caller is an active admin of exactly this
 * community, and enforces the length limit itself, so this is a courtesy
 * check rather than the authority.
 */
export async function setCommunityAbout(
  communityId: string,
  about: string,
): Promise<SetCommunityAboutResult> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("set_community_about", {
    p_community_id: communityId,
    p_about: about,
  });
  if (error || data === null) return { ok: false, error: "err.communityAboutSaveFailed" };
  return { ok: true, about: data };
}

/**
 * How the database says a private channel's name is already used in its
 * lokallag: raised by create_private_channel() and set_channel_details(), or
 * by the unique index behind them when two saves race.
 */
const PRIVATE_CHANNEL_NAME_TAKEN = "private_channel_name_taken";
const PRIVATE_CHANNEL_NAME_INDEX = "channels_private_name_key";

function privateChannelNameTaken(message: string): boolean {
  return message.includes(PRIVATE_CHANNEL_NAME_TAKEN) || message.includes(PRIVATE_CHANNEL_NAME_INDEX);
}

export type SetChannelDetailsResult =
  | { ok: true; name: string; purpose: string }
  | { ok: false; error: MessageKey };

/**
 * Changes a channel's display name and description.
 *
 * Goes through `set_channel_details()`, which decides from `auth.uid()` that
 * the caller may edit this channel — an active admin of `communityId` for a
 * community-wide channel, whoever may manage it for a private lokallag
 * channel — that the channel belongs to that community, and that the text is
 * valid. It touches nothing but the two display fields, so the channel id
 * (and with it URLs and message history) stays put. An empty result means the
 * function refused.
 */
export async function setChannelDetails(
  communityId: string,
  channelId: string,
  name: string,
  purpose: string,
): Promise<SetChannelDetailsResult> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("set_channel_details", {
    p_community_id: communityId,
    p_channel_id: channelId,
    p_name: name,
    p_purpose: purpose,
  });
  const row = data?.[0];
  if (error && privateChannelNameTaken(error.message)) {
    return { ok: false, error: "err.privateChannelNameTaken" };
  }
  if (error && communityChannelNameTaken(error.message)) {
    return { ok: false, error: "err.channelNameTaken" };
  }
  if (error || !row) return { ok: false, error: "err.channelEditFailed" };
  return { ok: true, name: row.name, purpose: row.purpose };
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

export interface RelatedCommunity {
  config: RelatedCommunityConfig;
  /** The target's public portal record — the same fields its portal shows anyone. */
  target: CommunityPublic;
  /** Whether the current account itself is an active member of the target. */
  joined: boolean;
}

/**
 * The related-community card for one Overview: the configured target and
 * whether the signed-in account already belongs to it.
 *
 * The target comes from its public portal record, and membership is read from
 * the caller's own rows only — nothing about anyone else in the target is
 * fetched, so no RLS is widened.
 */
export async function getRelatedCommunity(
  userId: string,
  sourceSlug: string,
): Promise<RelatedCommunity | undefined> {
  const config = getRelatedCommunityConfig(sourceSlug);
  if (!config) return undefined;
  const target = await getPortalCommunity(config.targetSlug);
  if (!target) return undefined;
  const joined = isActiveMember(await getMembership(userId, target.id));
  return { config, target, joined };
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
  /** As they appear in this community. */
  persona: CommunityPersona;
  membership: Membership;
}

export interface CommunityPersonAccountLink {
  personId: string;
  userId: string;
  memberName?: string;
  memberHandle?: string;
  memberEmail?: string;
  membershipRole?: RoleId;
  membershipTitle?: string;
  membershipStatus?: Membership["status"];
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
 * The community's active member count, or `null` for a caller who may not
 * list its membership — see lib/member-count.ts. A page that gets `null`
 * shows no number.
 */
export async function getActiveMemberCount(communityId: string): Promise<number | null> {
  return countActiveMembers(await createSupabaseServerClient(), communityId);
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

type PublicCommunityPersonRow = Omit<CommunityPersonRow, "user_id">;

function toCommunityPerson(row: PublicCommunityPersonRow, localGroup?: LocalGroup): CommunityPerson {
  return {
    id: row.id,
    communityId: row.community_id,
    section: row.section,
    localGroupId: row.local_group_id ?? undefined,
    localGroupName: localGroup?.name,
    name: row.name,
    role: row.role ?? undefined,
    email: row.email ?? undefined,
    description: row.description ?? undefined,
    sortOrder: row.sort_order,
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
 * Organisation-published people for one community.
 *
 * This is separate from `profiles` and `memberships`: no user id is read, and
 * no membership metadata is inferred. RLS limits rows to active members of the
 * same community and active records only.
 */
export const getCommunityPeople = cache(
  async (communityId: string): Promise<CommunityPerson[]> => {
    const supabase = await createSupabaseServerClient();
    const { data } = await supabase
      .from("community_people")
      .select("id, community_id, section, local_group_id, name, role, email, description, sort_order, active, created_at")
      .eq("community_id", communityId)
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true });

    const localGroups = new Map((await getLocalGroups(communityId)).map((group) => [group.id, group]));
    return rows(data).map((row) =>
      toCommunityPerson(
        row,
        row.local_group_id ? localGroups.get(row.local_group_id) : undefined,
      ),
    );
  },
);

/** The public contact for one selected local group, if the organisation has one. */
export async function getLocalGroupLeader(
  communityId: string,
  localGroupId: string,
): Promise<CommunityPerson | undefined> {
  return (await getCommunityPeople(communityId)).find(
    (person) => person.section === "local_group_leader" && person.localGroupId === localGroupId,
  );
}

/**
 * How many active members each local group has, keyed by group id — for the
 * people who manage it, and nobody else.
 *
 * An admin of the community gets every group, including those nobody has
 * joined: zero is a real answer and reads as one. A lokallagsleder gets their
 * own lokallag only. Moderators, ordinary members and non-members get an
 * empty map: `local_group_member_counts` decides that in the database, so a
 * headcount cannot be fetched by anyone it is not shown to.
 *
 * Reading the membership itself is unchanged and still follows
 * member_directory_visibility.
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

// ── Lokallagsledere ─────────────────────────────────────────────────────
//
// Appointing and removing go through add_local_group_manager() and
// remove_local_group_manager(), which decide everything from auth.uid(): only
// an active admin of the lokallag's community, and only an active member of
// exactly that lokallag. Nothing here widens that; the reads below are what an
// administrator can already see under row level security.

/**
 * Leaders and appointable members per lokallag, for the administration
 * section. Empty for anyone who is not an admin of the community: the grant
 * table answers admins (and each leader's own row) only, and the member list
 * follows the community's directory rule.
 */
export async function getLocalGroupLeadership(
  communityId: string,
): Promise<Map<string, LocalGroupLeadership>> {
  const supabase = await createSupabaseServerClient();
  const [{ data: grants }, members] = await Promise.all([
    supabase
      .from("community_local_group_managers")
      .select("local_group_id, user_id")
      .eq("community_id", communityId),
    getCommunityMembers(communityId),
  ]);

  const byGroup = new Map<string, LocalGroupLeadership>();
  const entry = (groupId: string) => {
    if (!byGroup.has(groupId)) byGroup.set(groupId, { leaders: [], candidates: [] });
    return byGroup.get(groupId)!;
  };
  const nameOf = new Map(members.map((m) => [m.membership.userId, m.persona.name]));
  const leaderKeys = new Set<string>();

  for (const grant of rows(grants)) {
    leaderKeys.add(`${grant.local_group_id}|${grant.user_id}`);
    entry(grant.local_group_id).leaders.push({
      userId: grant.user_id,
      name: nameOf.get(grant.user_id) ?? "Ukjent",
    });
  }
  for (const { membership, persona } of members) {
    if (!membership.localGroupId) continue;
    if (leaderKeys.has(`${membership.localGroupId}|${membership.userId}`)) continue;
    entry(membership.localGroupId).candidates.push({ userId: membership.userId, name: persona.name });
  }
  for (const leadership of byGroup.values()) {
    leadership.leaders.sort((a, b) => a.name.localeCompare(b.name, "nb"));
    leadership.candidates.sort((a, b) => a.name.localeCompare(b.name, "nb"));
  }
  return byGroup;
}

/** Appoints a lokallagsleder. The database decides whether the caller may. */
export async function addLocalGroupLeader(localGroupId: string, userId: string): Promise<boolean> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("add_local_group_manager", {
    p_local_group_id: localGroupId,
    p_user_id: userId,
  });
  return !error && data === true;
}

/** Removes a lokallagsleder appointment; effective on the next request. */
export async function removeLocalGroupLeader(localGroupId: string, userId: string): Promise<boolean> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("remove_local_group_manager", {
    p_local_group_id: localGroupId,
    p_user_id: userId,
  });
  return !error && data === true;
}

export async function getCommunityMembers(communityId: string): Promise<CommunityMember[]> {
  const [memberships, personas] = await Promise.all([
    loadCommunityMemberships(communityId),
    loadCommunityPersonas(communityId),
  ]);
  return memberships
    .filter((membership) => membership.status === "active")
    .map((membership) => ({ persona: personas.get(membership.userId)!, membership }))
    .filter((entry) => Boolean(entry.persona))
    .sort(
      (a, b) =>
        roleWeight[a.membership.role] - roleWeight[b.membership.role] ||
        a.persona.name.localeCompare(b.persona.name, "nb"),
    );
}

export async function getCommunityPersonAccountLinks(
  communityId: string,
): Promise<Map<string, CommunityPersonAccountLink>> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("community_person_account_links", {
    p_community_id: communityId,
  });
  if (error) return new Map();

  return new Map(
    rows(data).map((row) => [
      row.person_id,
      {
        personId: row.person_id,
        userId: row.user_id,
        memberName: row.member_name ?? undefined,
        memberHandle: row.member_handle ?? undefined,
        memberEmail: row.member_email ?? undefined,
        membershipRole: row.membership_role ?? undefined,
        membershipTitle: row.membership_title ?? undefined,
        membershipStatus: row.membership_status ?? undefined,
      },
    ]),
  );
}

/**
 * Account identifiers (handle, email) for a community's active members, for
 * its administrator's account-link picker only. Empty for anyone else — the
 * function checks is_admin() itself.
 */
export async function getCommunityMemberAccounts(
  communityId: string,
): Promise<Map<string, { handle: string; email: string }>> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("community_member_accounts", {
    p_community_id: communityId,
  });
  if (error) return new Map();
  return new Map(rows(data).map((row) => [row.user_id, { handle: row.handle, email: row.email }]));
}

export async function setCommunityPersonAccountLink(input: {
  personId: string;
  userId: string | null;
}): Promise<boolean> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("set_community_person_user", {
    p_person_id: input.personId,
    // Postgres accepts null here to unlink; generated RPC argument types do
    // not record argument nullability.
    p_user_id: input.userId as unknown as string,
  });
  return !error && data === true;
}

export async function setMembershipRole(input: {
  membershipId: string;
  role: "member" | "moderator";
}): Promise<boolean> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("set_membership_role", {
    p_membership_id: input.membershipId,
    p_role: input.role,
  });
  return !error && data === true;
}

// ── Channels ────────────────────────────────────────────────────────────

/** The platform headings the database files channels under itself. */
const loadSystemChannelGroups = cache(async (): Promise<{ id: string; label: string }[]> => {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("channel_groups")
    .select("*")
    .order("position", { ascending: true });
  return rows(data).map((row) => ({ id: row.id, label: row.label }));
});

function toChannelSection(row: ChannelSectionRow): ChannelSection {
  return { id: row.id, communityId: row.community_id, name: row.name, position: row.position };
}

/** A community's own sections, in order. Members read them; nobody else does. */
const loadChannelSections = cache(async (communityId: string): Promise<ChannelSection[]> => {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("channel_sections")
    .select("*")
    .eq("community_id", communityId)
    .order("position", { ascending: true })
    .order("created_at", { ascending: true });
  return rows(data).map(toChannelSection);
});

export function getChannelSections(communityId: string) {
  return loadChannelSections(communityId);
}

const loadChannels = cache(async (communityId: string): Promise<Channel[]> => {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("channels")
    .select("*")
    .eq("community_id", communityId)
    .order("position", { ascending: true })
    .order("id", { ascending: true });
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

/**
 * Puts each private channel directly after its lokallag's main chat, active
 * ones by name and archived ones last. Order only: which channels are in the
 * list at all was decided by `channels_select`. A private channel whose main
 * chat is not in the list keeps its place at the end.
 */
function nestPrivateChannels(channels: Channel[]): Channel[] {
  const children = channels
    .filter((channel) => channel.isPrivate)
    .sort(
      (a, b) =>
        Number(Boolean(a.archived)) - Number(Boolean(b.archived)) || a.name.localeCompare(b.name, "nb"),
    );
  if (children.length === 0) return channels;

  const placed = new Set<string>();
  const ordered: Channel[] = [];
  for (const channel of channels) {
    if (channel.isPrivate) continue;
    ordered.push(channel);
    for (const child of children) {
      if (child.localGroupId && child.localGroupId === channel.localGroupId) {
        ordered.push(child);
        placed.add(child.id);
      }
    }
  }
  return [...ordered, ...children.filter((child) => !placed.has(child.id))];
}

export interface ChannelNavigation {
  /**
   * What the sidebar lists, in order: the community's channels that are in no
   * section (no heading), then its sections, then the platform headings.
   * Archived community channels are not here. Empty sections are left out.
   */
  groups: { group: ChannelGroup; channels: Channel[] }[];
  /** Archived community channels: out of ordinary navigation, still readable. */
  archived: Channel[];
  /** Every section of the community, empty ones included, in order. */
  sections: ChannelSection[];
  /** Whether the community has any channel of its own that is not archived. */
  hasCommunityChannels: boolean;
}

function byPosition(a: Channel, b: Channel) {
  return a.position - b.position || a.id.localeCompare(b.id);
}

/**
 * A community's channels, arranged for navigation.
 *
 * Which channels appear is decided entirely by `channels_select`; nothing here
 * assumes any channel, section or name exists. The viewer is used only to word
 * two platform headings honestly: "Mitt lokallag" and "Mine grupper" describe
 * the viewer's own groups, so an admin who also sees other lokallag chats, or
 * staff who see a team they are not on, get the neutral "Lokallag" / "Grupper".
 */
export async function getChannelNavigation(
  communityId: string,
  viewer?: { localGroupId?: string; subgroupIds?: string[] },
): Promise<ChannelNavigation> {
  const [systemGroups, sections, channels] = await Promise.all([
    loadSystemChannelGroups(),
    loadChannelSections(communityId),
    loadChannels(communityId),
  ]);

  const own = channels.filter((channel) => !channel.localGroupId && !channel.subgroupId);
  const active = own.filter((channel) => !channel.archived);
  const sectionIds = new Set(sections.map((section) => section.id));

  const groups: ChannelNavigation["groups"] = [];
  const unsectioned = active
    .filter((channel) => !channel.sectionId || !sectionIds.has(channel.sectionId))
    .sort(byPosition);
  if (unsectioned.length > 0) {
    groups.push({ group: { id: "", label: "", kind: "unsectioned" }, channels: unsectioned });
  }
  for (const section of sections) {
    const inSection = active.filter((channel) => channel.sectionId === section.id).sort(byPosition);
    if (inSection.length > 0) {
      groups.push({ group: { id: section.id, label: section.name, kind: "section" }, channels: inSection });
    }
  }

  for (const system of systemGroups) {
    const inGroup = nestPrivateChannels(channels.filter((channel) => channel.groupId === system.id));
    if (inGroup.length === 0) continue;
    let label = system.label;
    if (viewer && system.id === "lokallag" && inGroup.some((c) => c.localGroupId !== viewer.localGroupId)) {
      label = "Lokallag";
    }
    if (
      viewer &&
      system.id === "grupper" &&
      inGroup.some((c) => !c.subgroupId || !(viewer.subgroupIds ?? []).includes(c.subgroupId))
    ) {
      label = "Grupper";
    }
    groups.push({ group: { id: system.id, label, kind: "system" }, channels: inGroup });
  }

  return {
    groups,
    archived: own.filter((channel) => channel.archived).sort((a, b) => a.name.localeCompare(b.name, "nb")),
    sections,
    hasCommunityChannels: active.length > 0,
  };
}

/** The navigation's channel list alone, for pages that only list channels. */
export async function getGroupedChannels(
  communityId: string,
  viewer?: { localGroupId?: string; subgroupIds?: string[] },
) {
  return (await getChannelNavigation(communityId, viewer)).groups;
}

// ── Community channel management ────────────────────────────────────────
//
// Every write below goes through a function in 20261028100000 that decides
// from auth.uid() that the caller is an active administrator of the community
// the channel or section belongs to. Nothing here decides access; a refusal
// comes back as `false`/null, and the few refusals that are about the
// caller's own input come back as a message key.

function communityChannelNameTaken(message: string): boolean {
  return message.includes("channel_name_taken") || message.includes("channels_community_name_key");
}

function sectionNameTaken(message: string): boolean {
  return message.includes("channel_section_name_taken") || message.includes("channel_sections_name_key");
}

export type ChannelManageResult<T = true> = { ok: true; value: T } | { ok: false; error: MessageKey };

export async function createCommunityChannel(input: {
  communityId: string;
  name: string;
  purpose: string;
  sectionId: string | null;
  creationKey: string | null;
  /** Only administrators and moderators write (`channels.read_only`). */
  readOnly: boolean;
  /** Members who may write may also attach files (`channels.file_sharing_enabled`). */
  fileSharing: boolean;
}): Promise<ChannelManageResult<string>> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("create_community_channel", {
    p_community_id: input.communityId,
    p_name: input.name,
    p_purpose: input.purpose,
    // Null means "no section" / "no key"; generated RPC argument types do not
    // record argument nullability.
    p_section_id: input.sectionId as unknown as string,
    p_creation_key: input.creationKey as unknown as string,
    p_read_only: input.readOnly,
    p_file_sharing: input.fileSharing,
  });
  if (error && communityChannelNameTaken(error.message)) return { ok: false, error: "err.channelNameTaken" };
  if (error || !data) return { ok: false, error: "err.channelCreateRefused" };
  return { ok: true, value: data };
}

/**
 * Name, description, who may write and whether files may be attached, in one
 * call. The id — and with it the address, every message and every file
 * already sent — never changes.
 */
export async function updateCommunityChannel(input: {
  channelId: string;
  name: string;
  purpose: string;
  readOnly: boolean;
  fileSharing: boolean;
}): Promise<ChannelManageResult> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("update_community_channel", {
    p_channel_id: input.channelId,
    p_name: input.name,
    p_purpose: input.purpose,
    p_read_only: input.readOnly,
    p_file_sharing: input.fileSharing,
  });
  if (error && communityChannelNameTaken(error.message)) return { ok: false, error: "err.channelNameTaken" };
  if (error || data !== true) return { ok: false, error: "err.channelManageRefused" };
  return { ok: true, value: true };
}

export async function moveCommunityChannel(
  channelId: string,
  sectionId: string | null,
  position: number | null,
): Promise<boolean> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("move_community_channel", {
    p_channel_id: channelId,
    p_section_id: sectionId as unknown as string,
    p_position: position as unknown as number,
  });
  return !error && data === true;
}

export async function setCommunityChannelArchived(channelId: string, archived: boolean): Promise<boolean> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("set_community_channel_archived", {
    p_channel_id: channelId,
    p_archived: archived,
  });
  return !error && data === true;
}

/** What deleting would remove. Undefined for anyone but the community's admins. */
export async function getCommunityChannelContentCounts(
  channelId: string,
): Promise<ChannelContentCounts | undefined> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.rpc("community_channel_content_counts", { p_channel_id: channelId });
  const row = data?.[0];
  return row
    ? { messages: row.message_count, attachments: row.attachment_count, links: row.link_count, folders: row.folder_count }
    : undefined;
}

export async function deleteCommunityChannel(
  channelId: string,
  confirmName: string,
): Promise<ChannelManageResult> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("delete_community_channel", {
    p_channel_id: channelId,
    p_confirm_name: confirmName,
  });
  if (error?.message.includes("channel_delete_unconfirmed")) return { ok: false, error: "err.channelDeleteUnconfirmed" };
  if (error || data !== true) return { ok: false, error: "err.channelDeleteRefused" };
  return { ok: true, value: true };
}

export async function createChannelSection(
  communityId: string,
  name: string,
  creationKey: string | null,
): Promise<ChannelManageResult<string>> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("create_channel_section", {
    p_community_id: communityId,
    p_name: name,
    p_creation_key: creationKey as unknown as string,
  });
  if (error && sectionNameTaken(error.message)) return { ok: false, error: "err.sectionNameTaken" };
  if (error || !data) return { ok: false, error: "err.sectionRefused" };
  return { ok: true, value: data };
}

export async function renameChannelSection(sectionId: string, name: string): Promise<ChannelManageResult> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("rename_channel_section", {
    p_section_id: sectionId,
    p_name: name,
  });
  if (error && sectionNameTaken(error.message)) return { ok: false, error: "err.sectionNameTaken" };
  if (error || data !== true) return { ok: false, error: "err.sectionRefused" };
  return { ok: true, value: true };
}

export async function moveChannelSection(sectionId: string, position: number): Promise<boolean> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("move_channel_section", {
    p_section_id: sectionId,
    p_position: position,
  });
  return !error && data === true;
}

/**
 * Deletes a section. `channelsTo` is where its channels go: "none" for no
 * section, another section's id, or null when the caller expects it empty.
 */
export async function deleteChannelSection(
  sectionId: string,
  channelsTo: string | null,
): Promise<ChannelManageResult> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("delete_channel_section", {
    p_section_id: sectionId,
    p_channels_to: channelsTo as unknown as string,
  });
  if (error?.message.includes("channel_section_not_empty")) return { ok: false, error: "err.sectionNotEmpty" };
  if (error || data !== true) return { ok: false, error: "err.sectionRefused" };
  return { ok: true, value: true };
}

// ── Subgroups ───────────────────────────────────────────────────────────
//
// Private teams. Every read below is filtered by row level security: a
// subgroup is visible only to people who may read its content or manage it,
// its member list only to its managers (and each person's own row to them).
// Nothing here decides access.

function toSubgroup(row: SubgroupRow): Subgroup {
  return {
    id: row.id,
    communityId: row.community_id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    active: row.active,
    moderatorsRead: row.moderators_read,
  };
}

/** Subgroups of a community the caller may read or manage. */
export const getSubgroups = cache(async (communityId: string): Promise<Subgroup[]> => {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("community_subgroups")
    .select("*")
    .eq("community_id", communityId)
    .order("name", { ascending: true });
  return rows(data).map(toSubgroup);
});

/** Ids of the subgroups the caller is an explicit member of, in one community. */
export const getMySubgroupIds = cache(
  async (communityId: string, userId: string): Promise<string[]> => {
    const supabase = await createSupabaseServerClient();
    const { data } = await supabase
      .from("community_subgroup_members")
      .select("subgroup_id")
      .eq("community_id", communityId)
      .eq("user_id", userId);
    return rows(data).map((row) => row.subgroup_id);
  },
);

/** Whether the caller may add and remove members (admin or explicit manager). */
export async function canManageSubgroup(subgroupId: string): Promise<boolean> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("can_manage_subgroup", { p_subgroup_id: subgroupId });
  return !error && data === true;
}

/** The subgroups the caller may manage in one community. */
export const getManageableSubgroups = cache(async (communityId: string): Promise<Subgroup[]> => {
  const subgroups = await getSubgroups(communityId);
  const allowed = await Promise.all(subgroups.map((subgroup) => canManageSubgroup(subgroup.id)));
  return subgroups.filter((_, index) => allowed[index]);
});

/** Members of a subgroup, for its managers. Empty for anyone else. */
export async function getSubgroupRoster(subgroupId: string): Promise<SubgroupRosterEntry[]> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.rpc("subgroup_roster", { p_subgroup_id: subgroupId });
  return rows(data).map((row) => ({
    userId: row.user_id,
    displayName: row.display_name,
    role: row.role ?? undefined,
    isManager: row.is_manager,
  }));
}

/**
 * Active members of the community, not yet in the subgroup, whose community
 * display name matches a search — for the subgroup's managers. The database
 * answers only a manager, only for at least two characters, with at most ten
 * matches and nothing but each person's id and display name, so no one is
 * handed the community roster.
 */
export async function searchSubgroupCandidates(
  subgroupId: string,
  query: string,
): Promise<{ userId: string; displayName: string }[]> {
  if (query.trim().length < 2) return [];
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.rpc("search_subgroup_candidates", {
    p_subgroup_id: subgroupId,
    p_query: query,
  });
  return rows(data).map((row) => ({ userId: row.user_id, displayName: row.display_name }));
}

/** Adds an active community member. False when refused or already a member. */
export async function addSubgroupMember(subgroupId: string, userId: string): Promise<boolean> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("add_subgroup_member", {
    p_subgroup_id: subgroupId,
    p_user_id: userId,
  });
  return !error && data === true;
}

/** Removes subgroup membership only — never the community membership or lokallag. */
export async function removeSubgroupMember(subgroupId: string, userId: string): Promise<boolean> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("remove_subgroup_member", {
    p_subgroup_id: subgroupId,
    p_user_id: userId,
  });
  return !error && data === true;
}

/** Whether the caller may create a group here: an active admin or moderator. */
export async function canCreateSubgroup(communityId: string): Promise<boolean> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("can_create_subgroup", { p_community_id: communityId });
  return !error && data === true;
}

export type CreateSubgroupResult =
  | { ok: true; subgroupId: string }
  | { ok: false; error: MessageKey };

/**
 * Creates a private group with the chosen members.
 *
 * `create_subgroup()` decides everything: that the caller is an admin or
 * moderator of this community, and that every chosen member is an active
 * member of it. The caller becomes a member and a manager, and the group's
 * chat is created with it. Either all of that exists afterwards, or nothing.
 */
export async function createSubgroup(input: {
  communityId: string;
  name: string;
  description: string;
  memberIds: string[];
}): Promise<CreateSubgroupResult> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("create_subgroup", {
    p_community_id: input.communityId,
    p_name: input.name,
    p_description: input.description,
    p_member_ids: input.memberIds,
  });
  if (error) {
    if (error.message.includes("subgroup_member_ineligible")) {
      return { ok: false, error: "err.subgroupMemberIneligible" };
    }
    return { ok: false, error: "err.subgroupCreateRefused" };
  }
  if (!data) return { ok: false, error: "err.subgroupCreateRefused" };
  return { ok: true, subgroupId: data };
}

/**
 * Active members of the community whose display name matches a search, for
 * choosing the members of a group about to be created. The database answers
 * only someone who may create a group here, only for at least two characters,
 * with at most ten matches and nothing but an id and a display name.
 */
export async function searchNewSubgroupCandidates(
  communityId: string,
  query: string,
): Promise<{ userId: string; displayName: string }[]> {
  if (query.trim().length < 2) return [];
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.rpc("search_new_subgroup_candidates", {
    p_community_id: communityId,
    p_query: query,
  });
  return rows(data).map((row) => ({ userId: row.user_id, displayName: row.display_name }));
}

/** Sets a group's name and description; its chat follows. Managers only. */
export async function setSubgroupDetails(
  subgroupId: string,
  name: string,
  description: string,
): Promise<boolean> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("set_subgroup_details", {
    p_subgroup_id: subgroupId,
    p_name: name,
    p_description: description,
  });
  return !error && data === true;
}

/** Archives (nothing new, history kept) or reopens a group. Managers only. */
export async function setSubgroupArchived(subgroupId: string, archived: boolean): Promise<boolean> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("set_subgroup_archived", {
    p_subgroup_id: subgroupId,
    p_archived: archived,
  });
  return !error && data === true;
}

/**
 * Gives or takes the manager mark (gruppeansvarlig) of a group member,
 * whatever their community role. Community admins only.
 */
export async function setSubgroupManager(
  subgroupId: string,
  userId: string,
  isManager: boolean,
): Promise<boolean> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("set_subgroup_manager", {
    p_subgroup_id: subgroupId,
    p_user_id: userId,
    p_is_manager: isManager,
  });
  return !error && data === true;
}

/**
 * How many posts and events are scoped to a group — what `delete_subgroup()`
 * refuses to destroy. Answered for the group's managers only.
 */
export async function getSubgroupContentCounts(
  subgroupId: string,
): Promise<{ posts: number; events: number }> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.rpc("subgroup_content_counts", { p_subgroup_id: subgroupId });
  const row = rows(data)[0];
  return { posts: row?.post_count ?? 0, events: row?.event_count ?? 0 };
}

export type DeleteSubgroupResult = { ok: true } | { ok: false; error: MessageKey };

/**
 * Permanently deletes a group with its chat, the chat's messages and its
 * member and manager rows. `delete_subgroup()` decides: only someone who may
 * manage the group, and never while a post or event is still scoped to it.
 */
export async function deleteSubgroup(subgroupId: string): Promise<DeleteSubgroupResult> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("delete_subgroup", { p_subgroup_id: subgroupId });
  if (error) {
    return {
      ok: false,
      error: error.message.includes("subgroup_has_content")
        ? "err.subgroupDeleteHasContent"
        : "err.subgroupDeleteRefused",
    };
  }
  return data === true ? { ok: true } : { ok: false, error: "err.subgroupDeleteRefused" };
}

/**
 * The main chat channel of one local group, if the caller may read it — never
 * one of the private channels under it.
 *
 * `channels_select` admits a lokallag channel only to members whose membership
 * is in exactly that group, and to the community's admins, so this returns
 * nothing for anyone else. No access decision is made here.
 */
export async function getLocalGroupChannel(
  communityId: string,
  localGroupId: string,
): Promise<Channel | undefined> {
  return (await loadChannels(communityId)).find(
    (channel) => channel.localGroupId === localGroupId && !channel.isPrivate,
  );
}

// ── Private lokallag channels ───────────────────────────────────────────
//
// Invitation-only channels under a lokallag. They are ordinary `channels`
// rows, so reading them, their messages and the sidebar goes through the same
// functions as every other channel above. What is here is only what is new:
// creating one, and managing who is in it. Nothing below decides access —
// every function asks the database, which answers from auth.uid().

/** Whether the caller may create a private channel under this lokallag. */
export async function canCreatePrivateChannel(localGroupId: string): Promise<boolean> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("can_create_private_channel", {
    p_local_group_id: localGroupId,
  });
  return !error && data === true;
}

/** Whether the caller may rename, archive and change the participants of this channel. */
export async function canManagePrivateChannel(channelId: string): Promise<boolean> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("can_manage_private_channel", {
    p_channel_id: channelId,
  });
  return !error && data === true;
}

export type CreatePrivateChannelResult =
  | { ok: true; channelId: string }
  | { ok: false; error: MessageKey };

/**
 * Creates a private channel under a lokallag with the chosen participants.
 *
 * `create_private_channel()` decides everything: that the caller is an admin
 * of the lokallag's community or its lokallagsleder, that every participant
 * is an active member of that lokallag, and that the name is free. Either the
 * channel and all its participants exist afterwards, or nothing does.
 */
export async function createPrivateChannel(input: {
  localGroupId: string;
  name: string;
  purpose: string;
  participantIds: string[];
}): Promise<CreatePrivateChannelResult> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("create_private_channel", {
    p_local_group_id: input.localGroupId,
    p_name: input.name,
    p_purpose: input.purpose,
    p_participant_ids: input.participantIds,
  });
  if (error) {
    if (privateChannelNameTaken(error.message)) return { ok: false, error: "err.privateChannelNameTaken" };
    if (error.message.includes("private_channel_participant_ineligible")) {
      return { ok: false, error: "err.privateChannelParticipantIneligible" };
    }
    return { ok: false, error: "err.privateChannelCreateRefused" };
  }
  if (!data) return { ok: false, error: "err.privateChannelCreateRefused" };
  return { ok: true, channelId: data };
}

/**
 * Participants of a private channel, for anyone who may read it — its
 * participants and the community's admins. Empty for anyone else:
 * `private_channel_roster()` answers from `channel_access_admits()`.
 *
 * The name is the display name the function returns. The photo is taken from
 * the profiles the caller may already see in this community
 * (`can_view_community_profile`), so being in the same channel shows a
 * person's name but opens nothing more of their profile than was open before.
 */
export async function getPrivateChannelRoster(
  communityId: string,
  channelId: string,
): Promise<PrivateChannelParticipant[]> {
  const supabase = await createSupabaseServerClient();
  const [{ data }, personas] = await Promise.all([
    supabase.rpc("private_channel_roster", { p_channel_id: channelId }),
    loadCommunityPersonas(communityId),
  ]);
  return rows(data).map((row) => ({
    userId: row.user_id,
    displayName: row.display_name,
    initials: initialsFor(row.display_name),
    avatarUrl: personas.get(row.user_id)?.avatarUrl,
    isManager: row.is_manager,
    isLeader: row.is_leader ?? undefined,
  }));
}

/**
 * Permanently deletes a private lokallag channel with its messages and
 * participant rows. `delete_private_channel()` decides: only a private
 * channel, only for someone who may manage it. There is no undo.
 */
export async function deletePrivateChannel(channelId: string): Promise<boolean> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("delete_private_channel", { p_channel_id: channelId });
  return !error && data === true;
}

/**
 * Active members of one lokallag whose community display name matches a
 * search, for someone choosing participants: before the channel exists
 * (`channelId` omitted — the caller must be allowed to create one there), or
 * for an existing channel (the caller must manage it; people already in it are
 * left out). At least two characters, at most ten matches, id and display name
 * only, so nobody is handed the lokallag's roster.
 */
export async function searchPrivateChannelCandidates(
  localGroupId: string,
  query: string,
  channelId?: string,
): Promise<{ userId: string; displayName: string }[]> {
  if (query.trim().length < 2) return [];
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.rpc("search_private_channel_candidates", {
    p_local_group_id: localGroupId,
    // Null means "a channel about to be created"; generated RPC argument types
    // do not record argument nullability.
    p_channel_id: (channelId ?? null) as unknown as string,
    p_query: query,
  });
  return rows(data).map((row) => ({ userId: row.user_id, displayName: row.display_name }));
}

/** Adds an active member of the channel's lokallag. False when refused or already in it. */
export async function addPrivateChannelParticipant(channelId: string, userId: string): Promise<boolean> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("add_private_channel_participant", {
    p_channel_id: channelId,
    p_user_id: userId,
  });
  return !error && data === true;
}

/** Removes the participation only — never the membership, role or lokallag. */
export async function removePrivateChannelParticipant(channelId: string, userId: string): Promise<boolean> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("remove_private_channel_participant", {
    p_channel_id: channelId,
    p_user_id: userId,
  });
  return !error && data === true;
}

/** Community admins only: lets a participating lokallagsleder manage the channel, or stops it. */
export async function setPrivateChannelManager(
  channelId: string,
  userId: string,
  isManager: boolean,
): Promise<boolean> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("set_private_channel_manager", {
    p_channel_id: channelId,
    p_user_id: userId,
    p_is_manager: isManager,
  });
  return !error && data === true;
}

/** Archives (no new messages, history kept) or reopens a private channel. */
export async function setPrivateChannelArchived(channelId: string, archived: boolean): Promise<boolean> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("set_private_channel_archived", {
    p_channel_id: channelId,
    p_archived: archived,
  });
  return !error && data === true;
}

// ── Messages ────────────────────────────────────────────────────────────

export async function getMessages(channelId: string): Promise<Message[]> {
  const supabase = await createSupabaseServerClient();
  const [{ data }, attachments] = await Promise.all([
    supabase
      .from("messages")
      .select("*")
      .eq("channel_id", channelId)
      .order("created_at", { ascending: true }),
    // Read under its own policy, which asks the same question as the
    // messages': can the caller read this channel right now.
    getChannelAttachments(channelId),
  ]);
  return rows(data).map((row) => ({ ...toMessage(row), attachments: attachments.get(row.id) }));
}

// ── Mentions ────────────────────────────────────────────────────────────

/**
 * Mention suggestions for the composer in one channel.
 *
 * search_channel_mention_candidates() decides everything: it answers only
 * someone who may write in that channel now, and only with people who may be
 * mentioned there (contributors in an open channel; invited people in a
 * private lokallag channel or a group), at most 8, never the caller. An
 * unreadable channel, an archived one or a query nobody matches is the same
 * empty list.
 */
export async function searchMentionCandidates(
  communityId: string,
  channelId: string,
  query: string,
): Promise<MentionCandidate[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("search_channel_mention_candidates", {
    p_channel_id: channelId,
    p_query: query,
  });
  if (error) return [];
  return rows(data).map((row) => ({
    id: row.user_id,
    name: row.display_name,
    initials: initialsFor(row.display_name),
    avatarUrl: row.avatar_version
      ? memberAvatarUrl(communityId, row.user_id, `${communityId}/${row.user_id}/${row.avatar_version}`)
      : undefined,
  }));
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
  | { ok: false; error: MessageKey };

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
  const invalid = messageBodyError(body);
  if (invalid) return { ok: false, error: invalid };

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("messages")
    .insert({ channel_id: input.channelId, body })
    .select("*")
    .single();

  if (error) return { ok: false, error: messageWriteError(error.message) };
  return { ok: true, message: toMessage(data) };
}

/** A refused attachment send, in words — the same for channels and direct messages. */
function attachmentSendError(refusal: AttachmentRefusal, denied: MessageKey): MessageKey {
  switch (refusal) {
    case "needsMutual":
      return "err.attachmentNeedsMutual";
    case "archived":
      return "err.attachmentArchived";
    case "notAllowed":
      return denied;
    case "tooMany":
      return "err.attachmentTooManySent";
    case "tooLong":
      return "err.messageTooLong";
    case "mention":
      return "err.mentionNotAllowed";
    case "tooManyMentions":
      return "err.mentionTooMany";
    case "invalid":
    case "type":
    case "tooLarge":
      return "err.attachmentInvalid";
    default:
      return "err.messageSendFailed";
  }
}

/**
 * Writes one channel message with files.
 *
 * The files were uploaded beforehand and are named here only by id. Whether
 * each is the caller's own, ready, uploaded into this very channel and within
 * its limits — and whether the caller may write here at all — is decided by
 * `send_channel_message_with_attachments()`, which writes the message and
 * attaches them in one transaction. The body may be empty.
 */
export async function createMessageWithAttachments(input: {
  channelId: string;
  body: string;
  attachmentIds: string[];
}): Promise<MessageWriteResult> {
  const body = input.body.trim();
  if (body.length > MESSAGE_BODY_MAX) return { ok: false, error: "err.messageTooLong" };

  const sent = await sendWithAttachments({ channelId: input.channelId }, body, input.attachmentIds);
  if (!sent.ok) return { ok: false, error: attachmentSendError(sent.refusal, "err.channelWriteDenied") };

  const supabase = await createSupabaseServerClient();
  const [{ data: row }, { data: attachmentRows }] = await Promise.all([
    supabase.from("messages").select("*").eq("id", sent.messageId).maybeSingle(),
    supabase
      .from("message_attachments")
      .select("*")
      .eq("message_id", sent.messageId)
      .order("position", { ascending: true }),
  ]);
  if (!row) return { ok: false, error: "err.messageSendFailed" };
  return {
    ok: true,
    message: { ...toMessage(row), attachments: rows(attachmentRows).map(toMessageAttachment) },
  };
}

function messageWriteError(message: string): MessageKey {
  // The restrictive policy that closes an archived private channel.
  if (message.includes("messages_not_archived")) {
    return "err.channelArchived";
  }
  // messages_sync_mentions: someone who may not be mentioned here.
  if (message.includes("message_error:mention_not_allowed")) return "err.mentionNotAllowed";
  if (message.includes("message_error:too_many_mentions")) return "err.mentionTooMany";
  if (message.includes("message_error:archived")) return "err.channelArchived";
  if (message.includes("row-level security")) {
    return "err.channelWriteDenied";
  }
  return "err.messageSendFailed";
}

// ── Editing, deleting and pinning messages ──────────────────────────────
//
// Nothing here decides who may do what. Each function calls one RPC from
// 20261101100000, which finds the message by id and asks its own channel or
// conversation: the author edits, the author or the channel's moderators
// delete, the channel's moderators pin. A forged id, someone else's message or
// another community's channel is refused there.

/** A refused change to a message, in words. `fallback` covers anything unexpected. */
function messageChangeError(message: string | undefined, fallback: MessageKey): MessageKey {
  const reason = /message_error:([a-z_]+)/.exec(message ?? "")?.[1];
  switch (reason) {
    case "not_found":
      return "err.messageNotFound";
    case "not_allowed":
      return "err.messageActionDenied";
    case "deleted":
      return "err.messageDeleted";
    case "archived":
      return "err.channelArchived";
    case "read_only":
      return "err.channelWriteDenied";
    case "closed":
      return "err.conversationWriteDenied";
    case "empty":
      return "err.messageEmpty";
    case "too_long":
      return "err.messageTooLong";
    case "mention_not_allowed":
      return "err.mentionNotAllowed";
    case "too_many_mentions":
      return "err.mentionTooMany";
    default:
      return fallback;
  }
}

export type MessageEditResult<T> = { ok: true; message: T } | { ok: false; error: MessageKey };
export type MessageDeleteResult = { ok: true; deleted: MessageDeletion } | { ok: false; error: MessageKey };

/** The author changes the text of their own channel message. Attachments stay as they are. */
export async function editChannelMessage(messageId: string, body: string): Promise<MessageEditResult<Message>> {
  const text = body.trim();
  if (text.length > MESSAGE_BODY_MAX) return { ok: false, error: "err.messageTooLong" };
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("edit_channel_message", { p_message_id: messageId, p_body: text });
  if (error || !data) return { ok: false, error: messageChangeError(error?.message, "err.messageEditFailed") };
  return { ok: true, message: toMessage(data) };
}

/** Deletes a channel message — the caller's own, or one they moderate — leaving a placeholder. */
export async function deleteChannelMessage(messageId: string): Promise<MessageDeleteResult> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("delete_channel_message", { p_message_id: messageId });
  if (error || (data !== "author" && data !== "moderator")) {
    return { ok: false, error: messageChangeError(error?.message, "err.messageDeleteFailed") };
  }
  return { ok: true, deleted: data };
}

/** Pins a message beneath its channel's header (replacing any other), or unpins it. */
export async function setChannelMessagePinned(
  messageId: string,
  pinned: boolean,
): Promise<{ ok: true } | { ok: false; error: MessageKey }> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("set_channel_message_pinned", {
    p_message_id: messageId,
    p_pinned: pinned,
  });
  if (error || data !== true) return { ok: false, error: messageChangeError(error?.message, "err.messagePinFailed") };
  return { ok: true };
}

/** The message pinned in a channel the caller can read, if any. */
export async function getPinnedMessageId(channelId: string): Promise<string | undefined> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("channel_pinned_messages")
    .select("message_id")
    .eq("channel_id", channelId)
    .maybeSingle();
  return data?.message_id ?? undefined;
}

/** Whether the caller may remove others' messages here and pin one. Presentation only. */
export async function canModerateChannelMessages(channelId: string): Promise<boolean> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("can_moderate_channel_messages", { p_channel_id: channelId });
  return !error && data === true;
}

/** The author changes the text of their own direct message. */
export async function editDirectMessage(
  messageId: string,
  body: string,
): Promise<MessageEditResult<DirectMessage>> {
  const text = body.trim();
  if (text.length > MESSAGE_BODY_MAX) return { ok: false, error: "err.messageTooLong" };
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("edit_direct_message", { p_message_id: messageId, p_body: text });
  if (error || !data) return { ok: false, error: messageChangeError(error?.message, "err.messageEditFailed") };
  return { ok: true, message: toDirectMessage(data) };
}

/** The author deletes their own direct message, leaving a placeholder. */
export async function deleteDirectMessage(messageId: string): Promise<MessageDeleteResult> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("delete_direct_message", { p_message_id: messageId });
  if (error || data !== "author") {
    return { ok: false, error: messageChangeError(error?.message, "err.messageDeleteFailed") };
  }
  return { ok: true, deleted: "author" };
}

// ── Direct messages ────────────────────────────────────────────────────

function otherParticipantId(row: DirectConversationRow, userId: string): string {
  return row.participant_one_id === userId ? row.participant_two_id : row.participant_one_id;
}

async function directReadState(
  conversationIds: string[],
): Promise<Map<string, DirectConversationReadRow>> {
  if (conversationIds.length === 0) return new Map();

  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("direct_conversation_reads")
    .select("*")
    .in("conversation_id", conversationIds);

  return new Map(rows(data).map((row) => [row.conversation_id, row]));
}

async function latestDirectMessages(
  conversationIds: string[],
): Promise<Map<string, DirectMessage>> {
  if (conversationIds.length === 0) return new Map();

  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("direct_messages")
    .select("*")
    .in("conversation_id", conversationIds)
    .order("created_at", { ascending: false });

  const latest = new Map<string, DirectMessage>();
  for (const row of rows(data)) {
    if (!latest.has(row.conversation_id)) latest.set(row.conversation_id, toDirectMessage(row));
  }
  return latest;
}

async function latestDirectMessageMeta(
  conversationIds: string[],
): Promise<Map<string, { authorId: string; createdAt: string }>> {
  if (conversationIds.length === 0) return new Map();

  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("direct_messages")
    .select("conversation_id, author_id, created_at")
    .in("conversation_id", conversationIds)
    .order("created_at", { ascending: false });

  const latest = new Map<string, { authorId: string; createdAt: string }>();
  for (const row of rows(data)) {
    if (!latest.has(row.conversation_id)) {
      latest.set(row.conversation_id, {
        authorId: row.author_id,
        createdAt: row.created_at,
      });
    }
  }
  return latest;
}

export async function getDirectConversations(
  communityId: string,
  userId: string,
): Promise<DirectConversationSummary[]> {
  const supabase = await createSupabaseServerClient();
  // The caller's inbox: their conversations here, without the ones they took
  // out of it (direct_inbox, under the conversations' own policy).
  const { data } = await supabase.rpc("direct_inbox", { p_community_id: communityId });

  const conversations = rows(data);
  const conversationIds = conversations.map((conversation) => conversation.id);
  const otherIds = conversations.map((conversation) => otherParticipantId(conversation, userId));
  const [users, latest, reads] = await Promise.all([
    getCommunityPersonas(communityId, [...new Set(otherIds)]),
    latestDirectMessages(conversationIds),
    directReadState(conversationIds),
  ]);

  return conversations
    .map((conversation) => {
      const other = users.get(otherParticipantId(conversation, userId));
      if (!other) return undefined;
      const message = latest.get(conversation.id);
      const read = reads.get(conversation.id);
      const summary: DirectConversationSummary = {
        id: conversation.id,
        communityId: conversation.community_id,
        participantIds: [
          conversation.participant_one_id,
          conversation.participant_two_id,
        ] as [string, string],
        otherParticipant: other,
        latestMessage: message,
        lastMessageAt: conversation.last_message_at,
        unread: Boolean(
          message &&
            message.authorId !== userId &&
            Date.parse(message.createdAt) > Date.parse(read?.last_read_at ?? "0001-01-01T00:00:00.000Z"),
        ),
      };
      return summary;
    })
    .filter((conversation): conversation is DirectConversationSummary => Boolean(conversation));
}

export async function getRecentDirectConversations(
  communityId: string,
  userId: string,
  limit = 5,
): Promise<DirectConversationSummary[]> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.rpc("direct_inbox", { p_community_id: communityId, p_limit: limit });

  const conversations = rows(data);
  const conversationIds = conversations.map((conversation) => conversation.id);
  const otherIds = conversations.map((conversation) => otherParticipantId(conversation, userId));
  const [users, latest, reads] = await Promise.all([
    getCommunityPersonas(communityId, [...new Set(otherIds)]),
    latestDirectMessageMeta(conversationIds),
    directReadState(conversationIds),
  ]);

  return conversations
    .map((conversation) => {
      const other = users.get(otherParticipantId(conversation, userId));
      if (!other) return undefined;
      const message = latest.get(conversation.id);
      const read = reads.get(conversation.id);
      const summary: DirectConversationSummary = {
        id: conversation.id,
        communityId: conversation.community_id,
        participantIds: [
          conversation.participant_one_id,
          conversation.participant_two_id,
        ] as [string, string],
        otherParticipant: other,
        lastMessageAt: conversation.last_message_at,
        unread: Boolean(
          message &&
            message.authorId !== userId &&
            Date.parse(message.createdAt) > Date.parse(read?.last_read_at ?? "0001-01-01T00:00:00.000Z"),
        ),
      };
      return summary;
    })
    .filter((conversation): conversation is DirectConversationSummary => Boolean(conversation));
}

export async function getDirectConversation(
  conversationId: string,
  userId: string,
): Promise<DirectConversation | undefined> {
  const supabase = await createSupabaseServerClient();
  const { data: conversation } = await supabase
    .from("direct_conversations")
    .select("*")
    .eq("id", conversationId)
    .maybeSingle();

  if (!conversation) return undefined;

  // Messages the caller cleared are not returned at all (direct_messages_select
  // compares each one's number with the caller's own boundary), and neither
  // are their files.
  const [{ data: messageRows }, attachments, readMap, other, { data: state }] = await Promise.all([
    supabase
      .from("direct_messages")
      .select("*")
      .eq("conversation_id", conversation.id)
      .order("seq", { ascending: true }),
    getConversationAttachments(conversation.id),
    directReadState([conversation.id]),
    // The other participant as they appear in this conversation's own
    // community — the only identity this conversation has ever known them by.
    getCommunityPersona(conversation.community_id, otherParticipantId(conversation, userId)),
    supabase
      .from("direct_conversation_states")
      .select("cleared_at")
      .eq("conversation_id", conversation.id)
      .eq("user_id", userId)
      .maybeSingle(),
  ]);

  const messages = rows(messageRows).map((row) => ({
    ...toDirectMessage(row),
    attachments: attachments.get(row.id),
  }));
  const last = messages[messages.length - 1];
  const read = readMap.get(conversation.id);

  return {
    id: conversation.id,
    communityId: conversation.community_id,
    participantIds: [
      conversation.participant_one_id,
      conversation.participant_two_id,
    ],
    wroteIds: [
      ...(conversation.participant_one_wrote ? [conversation.participant_one_id] : []),
      ...(conversation.participant_two_wrote ? [conversation.participant_two_id] : []),
    ],
    otherParticipant: other,
    messages,
    unread: Boolean(
      last &&
        last.authorId !== userId &&
        Date.parse(last.createdAt) > Date.parse(read?.last_read_at ?? "0001-01-01T00:00:00.000Z"),
    ),
    historyClearedAt: state?.cleared_at ?? undefined,
  };
}

export type DirectConversationChangeResult = { ok: true } | { ok: false; error: MessageKey };

function directConversationChangeError(message: string | undefined, fallback: MessageKey): MessageKey {
  return /conversation_error:not_found/.test(message ?? "") ? "err.conversationNotFound" : fallback;
}

/**
 * Takes a conversation out of the caller's own inbox until the next message
 * in it. Nothing else changes, for either participant.
 */
export async function hideDirectConversation(conversationId: string): Promise<DirectConversationChangeResult> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("hide_direct_conversation", { p_conversation_id: conversationId });
  if (error || data !== true) {
    return { ok: false, error: directConversationChangeError(error?.message, "err.conversationHideFailed") };
  }
  return { ok: true };
}

/**
 * Clears the caller's own copy of a conversation's history: every message so
 * far becomes unreadable to them, with its files and their notices. The other
 * participant keeps theirs. The database sets the boundary under the
 * conversation's lock (20261104100000); nothing here sends a time or a cursor.
 */
export async function clearDirectConversationHistory(
  conversationId: string,
): Promise<DirectConversationChangeResult> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("clear_direct_conversation_history", {
    p_conversation_id: conversationId,
  });
  if (error || typeof data !== "number") {
    return { ok: false, error: directConversationChangeError(error?.message, "err.conversationClearFailed") };
  }
  return { ok: true };
}

export async function startDirectConversation(input: {
  communityId: string;
  recipientId: string;
}): Promise<{ ok: true; conversationId: string } | { ok: false; error: MessageKey }> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("start_direct_conversation", {
    p_community_id: input.communityId,
    p_recipient_id: input.recipientId,
  });

  if (error || !data) return { ok: false, error: directConversationError() };
  return { ok: true, conversationId: data };
}

export async function startDirectConversationWithOrganizationPerson(
  personId: string,
): Promise<
  | { ok: true; conversationId: string; communityId: string }
  | { ok: false; error: MessageKey }
> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc(
    "start_direct_conversation_with_organization_person",
    { p_person_id: personId },
  );
  const row = rows(data)[0];

  if (error || !row) return { ok: false, error: directConversationError() };
  return { ok: true, conversationId: row.conversation_id, communityId: row.community_id };
}

export async function getOrganizationPersonDmActions(
  communityId: string,
): Promise<Map<string, string | undefined>> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.rpc("organization_person_dm_actions", {
    p_community_id: communityId,
  });
  return new Map(rows(data).map((row) => [row.person_id, row.conversation_id ?? undefined]));
}

/**
 * Active membership user ids that are also an explicit community_people link
 * in this community — for hiding a membership from a plain member list when
 * the same person is already shown as a published organisation/Crew card.
 *
 * Reads through `community_people_linked_member_ids`, which never returns
 * `community_people.user_id` itself; it returns only the subset of member ids
 * a caller who can view the directory already sees.
 */
export async function getCommunityPeopleLinkedMemberIds(
  communityId: string,
): Promise<Set<string>> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.rpc("community_people_linked_member_ids", {
    p_community_id: communityId,
  });
  return new Set(rows(data));
}

/**
 * An organisation-directory lookup that failed is not the same as one that
 * found nothing, and must not be rendered as if it were: a missing migration
 * or a revoked grant would otherwise look exactly like "nobody matched".
 * Throws outside production; in production it is logged and the caller
 * degrades to the empty answer.
 */
function reportOrganizationLookupFailure(
  name: string,
  communityId: string,
  error: { message: string; code?: string },
): void {
  const message = `${name}(${communityId}) failed: ${error.message} (${error.code})`;
  if (process.env.NODE_ENV !== "production") throw new Error(message);
  console.error(`[organisasjonen] ${message}`);
}

/**
 * The caller's own published organisation cards, as `community_people.id`
 * values. Reads through `own_organization_person_ids`, so the protected
 * `user_id` link never reaches the client; empty when the caller has no card.
 */
export async function getOwnOrganizationPersonIds(communityId: string): Promise<Set<string>> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("own_organization_person_ids", {
    p_community_id: communityId,
  });
  if (error) {
    reportOrganizationLookupFailure("own_organization_person_ids", communityId, error);
    return new Set();
  }
  return new Set(rows(data));
}

/**
 * Profile photos for organisation cards, keyed by `community_people.id`.
 *
 * A card has no photo of its own. When it is linked to an account, this is
 * that person's photo *in this community* — the same persona, the same URL
 * and the same access check as everywhere else they appear here. A card gets
 * an entry only when the caller may already see that profile and it has a
 * photo; every other card keeps its monogram.
 */
export async function getOrganizationPersonAvatarUrls(
  communityId: string,
): Promise<Map<string, string>> {
  const supabase = await createSupabaseServerClient();
  const [{ data, error }, personas] = await Promise.all([
    supabase.rpc("organization_person_profile_links", { p_community_id: communityId }),
    loadCommunityPersonas(communityId),
  ]);
  if (error) {
    reportOrganizationLookupFailure("organization_person_profile_links", communityId, error);
    return new Map();
  }

  const avatarUrls = new Map<string, string>();
  for (const link of rows(data)) {
    const avatarUrl = personas.get(link.user_id)?.avatarUrl;
    if (avatarUrl) avatarUrls.set(link.person_id, avatarUrl);
  }
  return avatarUrls;
}

export interface LinkedCrewMemberDetails {
  title?: string;
  bio?: string;
  location?: string;
}

/**
 * Bio/location/title for explicitly-linked, actively-membered Crew people,
 * keyed by the Crew person's own `community_people.id` — a value already
 * public through `getCommunityPeople`.
 *
 * Reads through `community_people_linked_member_details`, which never returns
 * `community_people.user_id`, a membership id, an email, or a role. Used to
 * enrich a linked person's Crew card; never for the MEDLEMMER de-duplication,
 * which stays on `getCommunityPeopleLinkedMemberIds`.
 */
export async function getCommunityPeopleLinkedMemberDetails(
  communityId: string,
): Promise<Map<string, LinkedCrewMemberDetails>> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.rpc("community_people_linked_member_details", {
    p_community_id: communityId,
  });
  return new Map(
    rows(data).map((row) => [
      row.person_id,
      { title: row.title ?? undefined, bio: row.bio ?? undefined, location: row.location ?? undefined },
    ]),
  );
}

export async function getMemberDmActions(
  communityId: string,
): Promise<Map<string, string | undefined>> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.rpc("direct_member_dm_actions", {
    p_community_id: communityId,
  });
  return new Map(rows(data).map((row) => [row.user_id, row.conversation_id ?? undefined]));
}

export async function markDirectConversationRead(conversationId: string): Promise<boolean> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("mark_direct_conversation_read", {
    p_conversation_id: conversationId,
  });
  return !error && data === true;
}

export async function getUnreadDirectConversationCount(communityId: string): Promise<number> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("direct_unread_count", {
    p_community_id: communityId,
  });
  return error ? 0 : data ?? 0;
}

export type DirectMessageWriteResult =
  | { ok: true; message: DirectMessage }
  | { ok: false; error: MessageKey };

export async function createDirectMessage(input: {
  conversationId: string;
  body: string;
}): Promise<DirectMessageWriteResult> {
  const body = input.body.trim();
  const invalid = messageBodyError(body);
  if (invalid) return { ok: false, error: invalid };

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("direct_messages")
    .insert({ conversation_id: input.conversationId, body })
    .select("*")
    .single();

  if (error) return { ok: false, error: directMessageWriteError(error.message) };
  return { ok: true, message: toDirectMessage(data) };
}

/**
 * Writes one direct message with files. As for channels: the database decides
 * — including, for member-to-member conversations, that both people have
 * written before either may send a file — and does it all in one transaction.
 */
export async function createDirectMessageWithAttachments(input: {
  conversationId: string;
  body: string;
  attachmentIds: string[];
}): Promise<DirectMessageWriteResult> {
  const body = input.body.trim();
  if (body.length > MESSAGE_BODY_MAX) return { ok: false, error: "err.messageTooLong" };

  const sent = await sendWithAttachments(
    { conversationId: input.conversationId },
    body,
    input.attachmentIds,
  );
  if (!sent.ok) {
    return { ok: false, error: attachmentSendError(sent.refusal, "err.conversationWriteDenied") };
  }

  const supabase = await createSupabaseServerClient();
  const [{ data: row }, { data: attachmentRows }] = await Promise.all([
    supabase.from("direct_messages").select("*").eq("id", sent.messageId).maybeSingle(),
    supabase
      .from("message_attachments")
      .select("*")
      .eq("direct_message_id", sent.messageId)
      .order("position", { ascending: true }),
  ]);
  if (!row) return { ok: false, error: "err.messageSendFailed" };
  return {
    ok: true,
    message: { ...toDirectMessage(row), attachments: rows(attachmentRows).map(toMessageAttachment) },
  };
}

/**
 * The database's own wording for a refused conversation is Norwegian and is not
 * for showing to anyone, so every failure reads the same in the caller's
 * language. The action redirects rather than displaying it in any case.
 */
function directConversationError(): MessageKey {
  return "err.conversationOpenFailed";
}

function directMessageWriteError(message: string): MessageKey {
  if (message.includes("row-level security") || message.includes("tilgang")) {
    return "err.conversationWriteDenied";
  }
  if (message.includes("direct_messages_body_present")) {
    return "err.messageLength";
  }
  return "err.messageSendFailed";
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
    .select(POST_SELECT)
    .eq("community_id", communityId)
    .order("pinned", { ascending: false })
    .order("created_at", { ascending: false });
  return rows(data).map(toPost);
}

export async function getAnnouncements(communityId: string): Promise<Post[]> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("posts")
    .select(POST_SELECT)
    .eq("community_id", communityId)
    .eq("kind", "announcement")
    .order("created_at", { ascending: false });
  return rows(data).map(toPost);
}

/** Recent posts for one selected local group. The ordinary post RLS still applies. */
export async function getRecentLocalGroupPosts(
  communityId: string,
  localGroupId: string,
  limit = 3,
): Promise<Post[]> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("posts")
    .select(POST_SELECT)
    .eq("community_id", communityId)
    .eq("local_group_id", localGroupId)
    .order("created_at", { ascending: false })
    .limit(limit);
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
    .select(POST_SELECT)
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

export type PostWriteResult = { ok: true; id: string } | { ok: false; error: MessageKey };

export async function createPost(input: {
  communityId: string;
  localGroupId?: string;
  subgroupId?: string;
  body: string;
  title?: string;
  announcement?: boolean;
}): Promise<PostWriteResult> {
  const body = input.body.trim();
  if (!body) return { ok: false, error: "err.postEmpty" };

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("posts")
    .insert({
      community_id: input.communityId,
      local_group_id: input.localGroupId || null,
      subgroup_id: input.subgroupId || null,
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
  if (!body) return { ok: false, error: "err.postEmpty" };

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
  if (!data) return { ok: false, error: "err.postEditOwn" };
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
  if (!data) return { ok: false, error: "err.postDeleteDenied" };
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
    return { ok: false, error: "err.pinDenied" };
  }
  return { ok: true, id: postId };
}

/** Turns a Postgres message into something worth showing a person. */
function postWriteError(message: string): MessageKey {
  // posts_insert: only active admins and moderators may publish.
  if (message.includes("row-level security")) {
    return "err.publishDenied";
  }
  // A group from another community (composite foreign key) or a retired one
  // (posts_local_group_active trigger).
  if (message.includes("posts_local_group_fkey") || message.includes("Lokallaget finnes ikke")) {
    return "err.localGroupSelectionRefused";
  }
  return "err.postSaveFailed";
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

export type CommentWriteResult = { ok: true; id: string } | { ok: false; error: MessageKey };

export async function createComment(input: {
  postId: string;
  body: string;
  parentId?: string;
}): Promise<CommentWriteResult> {
  const body = input.body.trim();
  if (!body) return { ok: false, error: "err.commentEmpty" };

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
  if (!trimmed) return { ok: false, error: "err.commentEmpty" };

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("comments")
    .update({ body: trimmed })
    .eq("id", commentId)
    .select("id")
    .maybeSingle();

  if (error) return { ok: false, error: commentWriteError(error.message) };
  if (!data) return { ok: false, error: "err.commentEditOwn" };
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
  if (!data) return { ok: false, error: "err.commentDeleteDenied" };
  return { ok: true, id: data.id };
}

function commentWriteError(message: string): MessageKey {
  if (message.includes("row-level security")) {
    return "err.commentDenied";
  }
  if (message.includes("svare på et svar")) {
    return "err.replyToReply";
  }
  return "err.commentSaveFailed";
}

// ── Reactions ───────────────────────────────────────────────────────────
//
// One row per person per emoji per post; the primary key is what makes a
// double reaction impossible. The count on a post is recomputed by a trigger,
// so nothing here ever writes an aggregate.

export type ReactionResult = { ok: true; reacted: boolean } | { ok: false; error: MessageKey };

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
    return { ok: false, error: "err.reactionInvalid" };
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

    if (deleteError) return { ok: false, error: "err.reactionRemoveFailed" };
    return { ok: true, reacted: !removed };
  }

  if (error.message.includes("row-level security")) {
    return { ok: false, error: "err.reactionDenied" };
  }
  // Raised by post_reactions_guard when the emoji belongs elsewhere.
  if (error.message.includes("annet fellesskap")) {
    return { ok: false, error: "err.reactionOtherCommunity" };
  }
  return { ok: false, error: "err.reactionSaveFailed" };
}

// ── Custom emojis ───────────────────────────────────────────────────────
//
// A custom emoji belongs to exactly one community, and both its metadata and
// its image are members-only. The bucket is private, so images are handed out
// as short-lived signed URLs created with the caller's own session — a
// non-member cannot obtain one, and a URL that leaks stops working.

const EMOJI_BUCKET = "community-emoji";

/**
 * The stable, authenticated address of an emoji's image. It never expires and
 * carries no credential: the route behind it checks membership on every
 * request, so a copied link is useless to anyone else.
 */
export function communityEmojiUrl(communityId: string, emojiId: string): string {
  return `/community/${encodeURIComponent(communityId)}/emoji/${encodeURIComponent(emojiId)}`;
}

function toEmoji(row: CommunityEmojiRow): CommunityEmoji {
  return {
    id: row.id,
    communityId: row.community_id,
    name: row.name,
    createdBy: row.created_by,
    createdAt: row.created_at,
    url: communityEmojiUrl(row.community_id, row.id),
  };
}

/**
 * Every custom emoji in one community.
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

  return (rows(data) as CommunityEmojiRow[]).map(toEmoji);
}

/**
 * One emoji's image, read with the caller's own session.
 *
 * Keyed by community *and* id, so an id from another community matches no row.
 * The row is visible only to members, and the object only to members too;
 * anyone else, and any emoji that no longer exists, gets `undefined`.
 */
export async function downloadCommunityEmoji(
  communityId: string,
  emojiId: string,
): Promise<{ blob: Blob; contentType: string } | undefined> {
  const supabase = await createSupabaseServerClient();
  const { data: row } = await supabase
    .from("community_emojis")
    .select("storage_path, content_type")
    .eq("community_id", communityId)
    .eq("id", emojiId)
    .maybeSingle();
  if (!row) return undefined;

  const { data: blob } = await supabase.storage.from(EMOJI_BUCKET).download(row.storage_path);
  return blob ? { blob, contentType: row.content_type } : undefined;
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

export type EmojiWriteResult = { ok: true; id: string } | { ok: false; error: MessageKey };

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
        ? "err.emojiAddDenied"
        : "err.imageUploadFailed",
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
      return { ok: false, error: "err.emojiExists" };
    }
    if (error.message.includes("row-level security")) {
      return { ok: false, error: "err.emojiAddDenied" };
    }
    return { ok: false, error: "err.emojiSaveFailed" };
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
    return { ok: false, error: "err.emojiDeleteDenied" };
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
        ? "err.emojiDeleteDenied"
        : "err.emojiImageRemoveFailed",
    };
  }

  const { data, error } = await supabase
    .from("community_emojis")
    .delete()
    .eq("id", emojiId)
    .select("id")
    .maybeSingle();

  if (error || !data) {
    return { ok: false, error: "err.emojiDeleteFailed" };
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

/**
 * Whether the signed-in caller has an access request waiting in this
 * community. Answers only for the caller's own identity — a request bound to
 * their session, or one filed for their own confirmed address — and takes no
 * address, so it cannot be used to ask about anybody else. False for anyone
 * who is not signed in.
 */
export async function hasPendingAccessRequest(slug: string): Promise<boolean> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("has_pending_access_request", { p_slug: slug });
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

export interface AccessRequestResolution {
  id: string;
  email: string;
  displayName?: string;
  status: "approved" | "rejected";
  createdAt: string;
  reviewedAt?: string;
  resolution: "activated" | "invitation_pending" | "invitation_accepted" | "invitation_expired" | "rejected";
}

/**
 * What became of a community's recently-decided requests, so the admin queue
 * can say more than "gone from the pending list" — an administrator who just
 * approved something should be able to see whether that put someone straight
 * in or left a claim link outstanding.
 */
export async function getAccessRequestHistory(communityId: string): Promise<AccessRequestResolution[]> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.rpc("access_request_history", { p_community_id: communityId });
  return (data as AccessRequestHistoryRow[] | null ?? []).map((row) => ({
    id: row.id,
    email: row.email,
    displayName: row.display_name ?? undefined,
    status: row.status as "approved" | "rejected",
    createdAt: row.created_at,
    reviewedAt: row.reviewed_at ?? undefined,
    resolution: row.resolution as AccessRequestResolution["resolution"],
  }));
}

export interface MintedInvitation {
  /**
   * 'activated' when the requester already had a usable TING account and
   * approval put them straight into the community — no invitation exists for
   * this outcome. 'invited' when a claim link is the next step, whether it
   * was minted just now (`token` set) or already existed (`token` null, a
   * repeat approval).
   */
  outcome: "activated" | "invited";
  token: string | null;
  email: string;
  communityId: string;
  expiresAt: string | null;
}

/**
 * Approves a request. What comes back depends on whether the address already
 * had a usable account: an immediate activation, or an invitation to send.
 *
 * `token` is null both when the request was already approved with a live
 * invitation out there (the caller should not send a second email) and when
 * the outcome is 'activated' (there is no invitation at all). That is what
 * makes a double-click harmless either way.
 */
export async function approveAccessRequest(requestId: string): Promise<MintedInvitation | null> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("approve_access_request", {
    p_request_id: requestId,
  });
  const row = (data as MintedInvitationRow[] | null)?.[0];
  if (error || !row) return null;
  return {
    outcome: row.outcome as "activated" | "invited",
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
    outcome: "invited",
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
  /**
   * True when this invitation traces back to a request the person already
   * made. The acceptance page uses it to skip asking for an explicit accept
   * once the visitor has proven they hold that mailbox — see
   * `AcceptInvitation`'s `auto` prop.
   */
  autoActivate: boolean;
  /** The language the community works in — decides which words the page uses. */
  communityLocale: Locale;
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
    autoActivate: row.auto_activate,
    communityLocale: parseLocale(row.community_default_locale),
  };
}

/**
 * The language of wherever a sign-in is heading, when that place is a
 * community's portal, invitation or private area — and nothing otherwise.
 *
 * The sign-in page is not itself part of any community, so it borrows the
 * language of the one the person is on their way to. `path` has already been
 * through `safeInternalPath`; this only reads it, and only through the public
 * one-community-at-a-time functions, so it cannot be used to discover
 * communities or to test tokens any more than the pages it mirrors can.
 */
export async function getLocaleForDestination(path: string): Promise<Locale | undefined> {
  const pathname = path.split(/[?#]/)[0];

  const invitation = /^\/invitasjon\/([^/]+)$/.exec(pathname);
  if (invitation) return (await getInvitationPreview(invitation[1]))?.communityLocale;

  const inCommunity = /^\/community\/([^/]+)/.exec(pathname);
  if (inCommunity) {
    const slug = await getPortalSlugForCommunity(inCommunity[1]);
    return slug ? (await getPortalCommunity(slug))?.defaultLocale : undefined;
  }

  const portal = /^\/([a-z0-9][a-z0-9-]{0,62})$/.exec(pathname);
  if (portal) return (await getPortalCommunity(portal[1]))?.defaultLocale;

  return undefined;
}

export type AcceptInvitationResult =
  | { ok: true; communityId: string; alreadyMember: boolean }
  | { ok: false; reason: string };

/**
 * The only path from an invitation to a membership. An account that has not
 * chosen a password yet is refused with `password-required` — by the database,
 * for every caller — and comes back here once it has one.
 */
export async function acceptInvitationToken(token: string): Promise<AcceptInvitationResult> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("accept_invitation_token", { p_token: token });
  const row = (data as AcceptInvitationRow[] | null)?.[0];
  if (error || !row) return { ok: false, reason: "invalid" };
  if (!row.ok || !row.community_id) return { ok: false, reason: row.reason };
  return { ok: true, communityId: row.community_id, alreadyMember: row.reason === "already-member" };
}

// ── One-email sign-in from an approval email ────────────────────────────
//
// The approval email's link carries a Supabase sign-in token (see
// lib/email-sign-in-link.ts) next to the TING invitation token. Redeeming
// happens only on an explicit POST from the page the link opens — never on the
// GET a mail scanner or link preview makes — and verifying and accepting run on
// one request-scoped client, so the acceptance is made by the session that was
// just proven, not by whatever cookies the request arrived with.

/** Supabase did not answer, as opposed to refusing the token. */
function authUnavailable(error: AuthError): boolean {
  return isAuthRetryableFetchError(error) || (error.status ?? 0) >= 500;
}

type VerifiedLink =
  | { ok: true; email: string; session: { access_token: string; refresh_token: string }; discard: () => Promise<void> }
  | { ok: false; unavailable: boolean };

/**
 * Verifies an email sign-in token *without* touching this request's session.
 *
 * The check runs on a throwaway client that keeps nothing, so a spent,
 * expired or foreign token changes nothing about who is signed in here.
 * Only the caller decides to adopt the verified session (see `adopt`) — after
 * it has confirmed the address is the one it expects.
 */
async function verifyEmailLink(tokenHash: string): Promise<VerifiedLink> {
  const scratch = await createSupabaseScratchClient();
  const { data, error } = await scratch.auth.verifyOtp({ type: "email", token_hash: tokenHash });
  if (error || !data.session || !data.user?.email) {
    return { ok: false, unavailable: error ? authUnavailable(error) : false };
  }
  return {
    ok: true,
    email: data.user.email.toLowerCase(),
    session: { access_token: data.session.access_token, refresh_token: data.session.refresh_token },
    // A verified session that will not be used is revoked, not left lying around.
    discard: async () => {
      await scratch.auth.signOut({ scope: "local" });
    },
  };
}

/** Ends this request's current session (if any) and makes the verified one current. */
async function adopt(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  verified: Extract<VerifiedLink, { ok: true }>,
) {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) await supabase.auth.signOut({ scope: "local" });
  const { error } = await supabase.auth.setSession(verified.session);
  return !error;
}

export type InvitationLinkOutcome =
  | { status: "joined"; communityId: string }
  /** Signed in as another account, and switching was not asked for. */
  | { status: "mismatch" }
  /** The sign-in token is spent, expired or replaced. The invitation may still be good. */
  | { status: "link-expired" }
  | { status: "unavailable" }
  /** The invitation itself refused: `accept_invitation_token`'s reason. */
  | { status: "refused"; reason: string };

export async function redeemInvitationWithEmailLink(input: {
  token: string;
  tokenHash?: string;
  switchAccount: boolean;
}): Promise<InvitationLinkOutcome> {
  const supabase = await createSupabaseServerClient();

  // The invitation decides which address may be signed in here. A spent,
  // revoked, expired or invented token names nobody, and nothing else runs.
  const { data: previewRows } = await supabase.rpc("invitation_preview", { p_token: input.token });
  const preview = (previewRows as InvitationPreviewRow[] | null)?.[0];
  if (!preview) return { status: "refused", reason: "invalid" };
  const invited = preview.email.toLowerCase();

  const {
    data: { user: current },
  } = await supabase.auth.getUser();
  const signedInAsInvited = current?.email?.toLowerCase() === invited;

  if (!signedInAsInvited) {
    // Never swap someone's identity underneath them. Only an explicit "sign
    // out and continue as …" from the page gets here with switchAccount.
    if (current && !input.switchAccount) return { status: "mismatch" };
    if (!input.tokenHash) return { status: "link-expired" };

    const verified = await verifyEmailLink(input.tokenHash);
    if (!verified.ok) return verified.unavailable ? { status: "unavailable" } : { status: "link-expired" };
    if (verified.email !== invited) {
      // A genuine sign-in token, but for another address than this
      // invitation's. It is not adopted; whoever was signed in stays so.
      await verified.discard();
      return { status: "refused", reason: "email-mismatch" };
    }
    if (!(await adopt(supabase, verified))) return { status: "unavailable" };
  }

  const { data: rows, error } = await supabase.rpc("accept_invitation_token", { p_token: input.token });
  const row = (rows as AcceptInvitationRow[] | null)?.[0];
  if (!error && row?.ok && row.community_id) return { status: "joined", communityId: row.community_id };
  return { status: "refused", reason: row?.reason ?? "invalid" };
}

export type CommunityLinkOutcome =
  | { status: "entered"; path: string }
  | { status: "link-expired" }
  | { status: "unavailable" };

/**
 * The existing-account variant: membership was activated at approval, so this
 * only signs in and finds the way to the community. It grants nothing. The
 * destination is built from the database — the community's id, and only if
 * the now-signed-in account is an active member — never from the URL.
 */
export async function enterCommunityWithEmailLink(input: {
  tokenHash: string;
  communitySlug: string;
}): Promise<CommunityLinkOutcome> {
  const supabase = await createSupabaseServerClient();
  const verified = await verifyEmailLink(input.tokenHash);
  if (!verified.ok) return verified.unavailable ? { status: "unavailable" } : { status: "link-expired" };
  // The page offers this only to someone who chose the email's link, so a
  // session already here is set aside — but only now that the link is good.
  if (!(await adopt(supabase, verified))) return { status: "unavailable" };

  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: portalRows } = await supabase.rpc("portal_by_slug", { p_slug: input.communitySlug });
  const communityId = (portalRows as PortalCommunityRow[] | null)?.[0]?.id;
  if (!communityId || !user) return { status: "entered", path: "/home" };
  const { data: membership } = await supabase
    .from("memberships")
    .select("status")
    .eq("user_id", user.id)
    .eq("community_id", communityId)
    .maybeSingle();
  return {
    status: "entered",
    path: membership?.status === "active" ? `/community/${communityId}` : "/home",
  };
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

/**
 * How many current RSVPs each event has, and whether one is the caller's.
 *
 * Counts only: `event_attendees_select` shows an ordinary member their own
 * row and nobody else's, so who is attending never reaches a page that
 * merely renders the event. `event_attendance` counts with the same
 * rsvp_is_current() rule as the capacity trigger, so "6 av 6" and "fullt"
 * always agree.
 */
async function withAttendees(eventRows: EventWithScopeRow[]): Promise<CommunityEvent[]> {
  if (eventRows.length === 0) return [];
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.rpc("event_attendance", {
    p_event_ids: eventRows.map((row) => row.id),
  });
  const byEvent = new Map(
    rows(data).map((row) => [
      row.event_id,
      { attendeeCount: row.attendee_count, attending: row.attending },
    ]),
  );
  return eventRows.map((row) =>
    toEvent(row, byEvent.get(row.id) ?? { attendeeCount: 0, attending: false }),
  );
}

export async function getCommunityEvents(communityId: string): Promise<CommunityEvent[]> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("events")
    .select(EVENT_SELECT)
    .eq("community_id", communityId)
    .order("starts_at", { ascending: true });
  return withAttendees(rows(data));
}

/**
 * Scheduled events that have not ended. Cancelled events are never "coming
 * up" — they are listed by `getCancelledCommunityEvents` instead.
 */
export async function getUpcomingCommunityEvents(communityId: string) {
  const events = await getCommunityEvents(communityId);
  return events.filter((event) => !event.cancelledAt && Date.parse(event.endsAt) >= now().getTime());
}

/** Cancelled events, most recently scheduled first — the event history's own list. */
export async function getCancelledCommunityEvents(communityId: string) {
  const events = await getCommunityEvents(communityId);
  return events.filter((event) => Boolean(event.cancelledAt)).reverse();
}

export async function getUpcomingLocalGroupEvents(
  communityId: string,
  localGroupId: string,
  limit = 3,
): Promise<CommunityEvent[]> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("events")
    .select(EVENT_SELECT)
    .eq("community_id", communityId)
    .eq("local_group_id", localGroupId)
    .is("cancelled_at", null)
    .gte("ends_at", now().toISOString())
    .order("starts_at", { ascending: true })
    .limit(limit);
  return withAttendees(rows(data));
}

/** Scheduled events that took place. Cancelled ones have their own list. */
export async function getPastCommunityEvents(communityId: string) {
  const events = await getCommunityEvents(communityId);
  return events.filter((event) => !event.cancelledAt && Date.parse(event.endsAt) < now().getTime()).reverse();
}

/**
 * Upcoming scheduled events across the caller's communities — Home, the
 * combined calendar, the profile count. Scoped by RLS, as above; cancelled
 * events are left out.
 */
export async function getEventsForUser(_userId: string): Promise<CommunityEvent[]> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("events")
    .select(EVENT_SELECT)
    .is("cancelled_at", null)
    .gte("ends_at", now().toISOString())
    .order("starts_at", { ascending: true });
  return withAttendees(rows(data));
}

export type EventWriteResult = { ok: true } | { ok: false; error: "full" | "refused" };

/**
 * Signs the caller up for an event.
 *
 * `user_id` is deliberately absent: the column defaults to auth.uid(), and
 * `event_attendees_insert` independently requires the row to be the caller's
 * own and the caller to be able to read the event. There is
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
 * auth.uid() — and `events_insert` requires `can_create_event()`: an admin of
 * the community in any scope, or a lokallagsleder for their own lokallag.
 * Field limits and the ends-after-starts rule are in the policy too, so a
 * caller that skips this function still meets them.
 */
export async function createEvent(input: {
  communityId: string;
  localGroupId?: string;
  subgroupId?: string;
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
      local_group_id: input.localGroupId || null,
      subgroup_id: input.subgroupId || null,
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
  const { data } = await supabase.from("events").select(EVENT_SELECT).eq("id", eventId).maybeSingle();
  return data ? (await withAttendees([data]))[0] : undefined;
}

// ── Managing an event ───────────────────────────────────────────────────
//
// Every write below is decided by the database from auth.uid():
//   edit            events_update — can_manage_event (admin of the community,
//                   or the lokallag's lokallagsleder), with the field rules
//                   and a capacity floor at the current RSVPs
//   cancel/restore  cancel_event() / restore_event() — can_manage_event
//   delete          events_delete — admins of the community only
// The page asks can_manage_event / can_delete_event only to decide what to
// show.

export type EventEditResult =
  | { ok: true }
  | { ok: false; error: "capacity" | "refused" };

/** The fields an edit may change. Community, host, scope and visibility are not among them. */
export type EventEditFields = {
  title: string;
  description: string;
  startsAt: string;
  endsAt: string;
  location: string;
  capacity: number | null;
};

/** Saves the edit form: title, description, time, place and capacity. */
export async function updateEvent(eventId: string, fields: EventEditFields): Promise<EventEditResult> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("events")
    .update({
      title: fields.title,
      description: fields.description,
      starts_at: fields.startsAt,
      ends_at: fields.endsAt,
      location: fields.location,
      capacity: fields.capacity,
    })
    .eq("id", eventId)
    .select("id");
  if (error) {
    return { ok: false, error: error.message.includes("capacity_below_attendees") ? "capacity" : "refused" };
  }
  // No row back: the policy did not let this caller see the row as theirs to edit.
  return (data ?? []).length === 1 ? { ok: true } : { ok: false, error: "refused" };
}

export type EventLifecycleResult =
  | "ok"
  | "refused"
  | "already_cancelled"
  | "not_cancelled"
  | "ended"
  | "over_capacity";

function lifecycleResult(data: unknown, error: unknown): EventLifecycleResult {
  if (error || typeof data !== "string") return "refused";
  const known: EventLifecycleResult[] = ["ok", "refused", "already_cancelled", "not_cancelled", "ended", "over_capacity"];
  return (known as string[]).includes(data) ? (data as EventLifecycleResult) : "refused";
}

/** Cancels an event: keeps it and every RSVP, freezes sign-ups, tells attendees. */
export async function cancelEvent(eventId: string): Promise<EventLifecycleResult> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("cancel_event", { p_event_id: eventId });
  return lifecycleResult(data, error);
}

/** Restores a cancelled event, only if its current RSVPs still fit. */
export async function restoreEvent(eventId: string): Promise<EventLifecycleResult> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("restore_event", { p_event_id: eventId });
  return lifecycleResult(data, error);
}

export type AttendeeRemovalResult = "ok" | "refused" | "cancelled" | "ended" | "not_attending";

/**
 * Removes one person's registration from a scheduled, upcoming event the
 * caller may manage, and notifies them (remove_event_attendee). Not a ban:
 * they may sign up again if there is room.
 */
export async function removeEventAttendee(eventId: string, userId: string): Promise<AttendeeRemovalResult> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("remove_event_attendee", {
    p_event_id: eventId,
    p_user_id: userId,
  });
  const known: AttendeeRemovalResult[] = ["ok", "refused", "cancelled", "ended", "not_attending"];
  if (error || typeof data !== "string" || !(known as string[]).includes(data)) return "refused";
  return data as AttendeeRemovalResult;
}

/** Permanently deletes an event and its RSVPs. Admins of its community only. */
export async function deleteEvent(eventId: string): Promise<boolean> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.from("events").delete().eq("id", eventId).select("id");
  return !error && (data ?? []).length === 1;
}

/** Whether the signed-in person may edit, cancel and restore this event. */
export async function canManageEvent(eventId: string): Promise<boolean> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.rpc("can_manage_event", { p_event_id: eventId });
  return data === true;
}

/** Whether the signed-in person may permanently delete this event. */
export async function canDeleteEvent(eventId: string): Promise<boolean> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.rpc("can_delete_event", { p_event_id: eventId });
  return data === true;
}

/**
 * Whether the signed-in person is an effective lokallagsleder of this
 * lokallag: granted, active, and still in it (`can_lead_local_group`). Decides
 * whether the lokallag page offers the event composer; `events_insert` decides
 * whether the event is created.
 */
export async function canLeadLocalGroup(localGroupId: string): Promise<boolean> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.rpc("can_lead_local_group", { p_local_group_id: localGroupId });
  return data === true;
}

/**
 * Who is attending one event, for the people allowed to know: whoever may
 * manage it right now — its community's admins and, for a lokallag event,
 * that lokallag's leaders (`can_view_event_roster`). Being its host grants
 * nothing by itself. `undefined` for everyone else, so a page can tell "not
 * yours to see" from "nobody yet" — the
 * database itself returns no rows in both cases and the second question is
 * asked of the same rule.
 *
 * Names and photos are the attendees' profiles in the event's community,
 * never the account.
 */
export async function getEventRoster(
  communityId: string,
  eventId: string,
): Promise<EventAttendee[] | undefined> {
  const supabase = await createSupabaseServerClient();
  const { data: allowed } = await supabase.rpc("can_view_event_roster", { p_event_id: eventId });
  if (allowed !== true) return undefined;
  const { data } = await supabase.rpc("event_attendee_roster", { p_event_id: eventId });
  return rows(data).map((row) => {
    const name = row.display_name ?? "Ukjent";
    return {
      id: row.user_id,
      name,
      initials: row.display_name ? initialsFor(name) : "?",
      avatarUrl: row.avatar_path
        ? memberAvatarUrl(communityId, row.user_id, row.avatar_path)
        : undefined,
    };
  });
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

// ── Community profile image ─────────────────────────────────────────────
//
// The image shown for a community inside the signed-in app. Only the active
// administrator may change it, and that is enforced in the database twice:
// the storage policies require is_admin() on the community in the object path,
// and set_community_avatar() requires it again before touching the reference.
// Nothing below trusts a role or a user id from the caller.

const AVATAR_BUCKET = "community-avatars";

export type CommunityAvatarResult = { ok: true } | { ok: false; error: MessageKey };

const AVATAR_REFUSED = "err.avatarAdminOnly" as const;

/**
 * Swaps the reference to `nextPath` (null clears it), then tidies up the file
 * it replaced. The order is the point: the old image is only removed once the
 * reference no longer names it, and a failed cleanup leaves an unreferenced
 * file, never a broken avatar.
 */
async function swapCommunityAvatar(
  communityId: string,
  nextPath: string | null,
): Promise<CommunityAvatarResult> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("set_community_avatar", {
    p_community_id: communityId,
    p_path: nextPath as string,
  });
  const result = data?.[0];

  if (error || !result?.applied) {
    return { ok: false, error: error ? "err.avatarSaveFailed" : AVATAR_REFUSED };
  }

  const previous = result.previous_path as string | null;
  if (previous && previous !== nextPath) {
    // Best effort, and deliberately unreported: the swap has already
    // succeeded, and nobody can act on a leftover file.
    await supabase.storage.from(AVATAR_BUCKET).remove([previous]);
  }
  return { ok: true };
}

export async function setCommunityAvatar(input: {
  communityId: string;
  bytes: Uint8Array;
  contentType: string;
  extension: string;
}): Promise<CommunityAvatarResult> {
  const supabase = await createSupabaseServerClient();
  const path = `${input.communityId}/${crypto.randomUUID()}.${input.extension}`;

  // Upload first. If this is refused — not the administrator, wrong shape,
  // over the bucket's limits — nothing has changed and the current image
  // stays as it was.
  const { error: uploadError } = await supabase.storage
    .from(AVATAR_BUCKET)
    .upload(path, input.bytes, { contentType: input.contentType, upsert: false });

  if (uploadError) {
    const message = uploadError.message.toLowerCase();
    return {
      ok: false,
      error:
        message.includes("row-level security") || message.includes("unauthorized")
          ? AVATAR_REFUSED
          : "err.imageUploadRetry",
    };
  }

  const swapped = await swapCommunityAvatar(input.communityId, path);
  if (!swapped.ok) {
    // The new file never became the avatar; do not leave it behind.
    await supabase.storage.from(AVATAR_BUCKET).remove([path]);
  }
  return swapped;
}

export async function clearCommunityAvatar(communityId: string): Promise<CommunityAvatarResult> {
  return swapCommunityAvatar(communityId, null);
}

/**
 * Serves a community's profile image to a member of that community.
 *
 * Runs as the caller: the row is only visible with a relationship to the
 * community, and the object only to an active member, so a non-member gets
 * nothing whether or not an image exists.
 */
export async function downloadCommunityAvatar(
  communityId: string,
): Promise<{ blob: Blob; path: string } | undefined> {
  const supabase = await createSupabaseServerClient();
  const { data: row } = await supabase
    .from("communities")
    .select("avatar_path")
    .eq("id", communityId)
    .maybeSingle();
  if (!row?.avatar_path) return undefined;

  const { data: blob } = await supabase.storage.from(AVATAR_BUCKET).download(row.avatar_path);
  return blob ? { blob, path: row.avatar_path } : undefined;
}

// ── Your profile in a community ─────────────────────────────────────────
//
// Display name, bio and photo for one community. Every write names only the
// community: whose profile changes is auth.uid() inside the database, so
// there is no user id here for anyone — an administrator included — to aim
// at somebody else. An inactive membership is refused there too.

const MEMBER_AVATAR_BUCKET = "member-avatars";

export type CommunityProfileResult = { ok: true } | { ok: false; error: MessageKey };

const PROFILE_REFUSED = "err.profileOwnOnly" as const;

export async function updateMyCommunityProfile(input: {
  communityId: string;
  displayName: string;
  bio: string;
}): Promise<CommunityProfileResult> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("update_my_community_profile", {
    p_community_id: input.communityId,
    p_display_name: input.displayName,
    p_bio: input.bio,
  });
  if (error) return { ok: false, error: "err.profileSaveFailed" };
  return data === true ? { ok: true } : { ok: false, error: PROFILE_REFUSED };
}

// ── Welcome card ────────────────────────────────────────────────────────
//
// Per membership, never per account. Both functions name only a community;
// whose row is read or written comes from auth.uid() inside the database, and
// the column itself is not selectable by clients at all.

/** Whether the caller's own active membership here still has its welcome card. */
export async function isOnboardingVisible(communityId: string): Promise<boolean> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("my_onboarding_visible", {
    p_community_id: communityId,
  });
  return !error && data === true;
}

/** Dismisses the caller's own welcome card in one community. Idempotent. */
export async function dismissMyOnboarding(communityId: string): Promise<boolean> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("dismiss_my_onboarding", {
    p_community_id: communityId,
  });
  return !error && data === true;
}

/** Same order as `swapCommunityAvatar`: swap the reference, then tidy up. */
async function swapMyCommunityAvatar(
  communityId: string,
  nextPath: string | null,
): Promise<CommunityProfileResult> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("set_my_community_avatar", {
    p_community_id: communityId,
    p_path: nextPath as string,
  });
  const result = data?.[0];

  if (error || !result?.applied) {
    return { ok: false, error: error ? "err.avatarSaveFailed" : PROFILE_REFUSED };
  }

  const previous = result.previous_path as string | null;
  if (previous && previous !== nextPath) {
    await supabase.storage.from(MEMBER_AVATAR_BUCKET).remove([previous]);
  }
  return { ok: true };
}

export async function setMyCommunityAvatar(input: {
  communityId: string;
  userId: string;
  bytes: Uint8Array;
  contentType: string;
  extension: string;
}): Promise<CommunityProfileResult> {
  const supabase = await createSupabaseServerClient();
  // The user id only builds the folder name. The storage policy requires it
  // to be the caller's own, and set_my_community_avatar() checks it again.
  const path = `${input.communityId}/${input.userId}/${crypto.randomUUID()}.${input.extension}`;

  const { error: uploadError } = await supabase.storage
    .from(MEMBER_AVATAR_BUCKET)
    .upload(path, input.bytes, { contentType: input.contentType, upsert: false });

  if (uploadError) {
    const message = uploadError.message.toLowerCase();
    return {
      ok: false,
      error:
        message.includes("row-level security") || message.includes("unauthorized")
          ? PROFILE_REFUSED
          : "err.imageUploadRetry",
    };
  }

  const swapped = await swapMyCommunityAvatar(input.communityId, path);
  if (!swapped.ok) {
    await supabase.storage.from(MEMBER_AVATAR_BUCKET).remove([path]);
  }
  return swapped;
}

export async function clearMyCommunityAvatar(communityId: string): Promise<CommunityProfileResult> {
  return swapMyCommunityAvatar(communityId, null);
}

/**
 * Serves one member's photo in one community, to someone allowed to see that
 * profile. Runs as the caller: the profile row is only readable through
 * `can_view_community_profile`, and the object only through the matching
 * storage policy, so anyone else gets nothing whether or not a photo exists.
 */
export async function downloadMemberAvatar(
  communityId: string,
  userId: string,
): Promise<{ blob: Blob; path: string } | undefined> {
  const supabase = await createSupabaseServerClient();
  const { data: row } = await supabase
    .from("community_profiles")
    .select("avatar_path")
    .eq("community_id", communityId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!row?.avatar_path) return undefined;

  const { data: blob } = await supabase.storage.from(MEMBER_AVATAR_BUCKET).download(row.avatar_path);
  return blob ? { blob, path: row.avatar_path } : undefined;
}
