/**
 * Domain model for the platform.
 *
 * These types are deliberately storage-agnostic: they describe what the UI
 * needs, not how it is persisted. When Supabase (or any other backend) is
 * introduced, only `lib/data.ts` should have to change — every component reads
 * through the query functions there.
 */

export type RoleId = "member" | "moderator" | "admin";

export interface Role {
  id: RoleId;
  /** Norwegian label shown in the UI. */
  label: string;
  description: string;
}

export interface User {
  id: string;
  name: string;
  /** Short handle, unique across the platform. */
  handle: string;
  /** Two-letter monogram used when there is no photo. */
  initials: string;
  email: string;
  pronoun: string;
  location: string;
  bio: string;
  /** ISO date the account was created. */
  joinedAt: string;
}

export interface CommunityBranding {
  /** Hex colour that tints the community shell. */
  accent: string;
  /** Soft tint used for backgrounds inside the community. */
  accentSoft: string;
  /** Monogram shown in the community mark. */
  monogram: string;
  /** `serif` reads editorial, `mono` reads technical, `sans` reads neutral. */
  markStyle: "serif" | "sans" | "mono";
}

/**
 * What a community shows the world on its portal.
 *
 * This is a separate type from `Community` on purpose: anything a portal
 * renders must be reachable from here, so adding an internal field to
 * `Community` cannot accidentally leak onto the public page.
 */
export interface CommunityPublic {
  id: string;
  /** URL segment for the public portal, e.g. `/under-the-rug`. */
  slug: string;
  name: string;
  /** One line, shown in lists and on the portal. */
  tagline: string;
  /** Longer public description on the portal. */
  publicDescription: string;
  location: string;
  foundedYear: number;
  branding: CommunityBranding;
  /** How new members get in. Nothing here makes a community discoverable. */
  accessPolicy: "invite-only" | "request-to-join";
  memberCount: number;
  /** Public-facing links shown on the portal. */
  links: { label: string; href: string }[];
}

/** The full record, readable only by members. */
export interface Community extends CommunityPublic {
  /** Internal description, only visible to members. */
  about: string;
}

export type MembershipStatus = "active" | "invited" | "requested";

export interface Membership {
  userId: string;
  communityId: string;
  role: RoleId;
  status: MembershipStatus;
  joinedAt: string;
  /** Free-text role inside the organisation, e.g. "Frivilligkoordinator". */
  title?: string;
  /** Who invited this person, for pending invitations. */
  invitedBy?: string;
}

export interface ChannelGroup {
  id: string;
  /** Uppercase group heading, e.g. GENERELT. */
  label: string;
}

export interface Channel {
  id: string;
  communityId: string;
  groupId: string;
  /** Without the leading `#`. */
  name: string;
  purpose: string;
  /** Only moderators and admins may post. */
  readOnly?: boolean;
}

export interface Message {
  id: string;
  channelId: string;
  authorId: string;
  body: string;
  /** ISO timestamp. */
  createdAt: string;
  /** Emoji → user ids who reacted. */
  reactions?: { emoji: string; userIds: string[] }[];
  /** Set on the first message of a day, computed at read time. */
  attachment?: { kind: "file" | "link"; label: string; meta: string };
}

export interface Post {
  id: string;
  communityId: string;
  authorId: string;
  /** Optional headline; short updates have none. */
  title?: string;
  body: string;
  createdAt: string;
  /** Stamped by the database when the text is changed, never by the client. */
  editedAt?: string;
  /** Pinned announcements surface on the overview and announcements page. */
  kind: "post" | "announcement";
  pinned?: boolean;
  channelId?: string;
  /** Derived by the database from the comment rows. Never written directly. */
  commentCount: number;
  /** Derived by the database from `post_reactions`. Never written directly. */
  reactions: Reaction[];
}

export interface CommunityEvent {
  id: string;
  communityId: string;
  title: string;
  description: string;
  /** ISO timestamp for the start. */
  startsAt: string;
  endsAt: string;
  location: string;
  /** Shown on the public portal when true. */
  isPublic: boolean;
  hostId: string;
  attendeeIds: string[];
  capacity?: number;
}

export interface Comment {
  id: string;
  postId: string;
  /** Set on a reply. A reply always sits on the same post as its parent. */
  parentId?: string;
  authorId: string;
  body: string;
  createdAt: string;
  /** Stamped by the database when the text changes, never by the client. */
  editedAt?: string;
}

/**
 * One aggregated reaction on a post, derived by the database from the
 * individual reaction rows.
 *
 * Exactly one of `emoji` (a built-in Unicode character) and `emojiId` (a
 * custom emoji belonging to this post's community) is set.
 */
export interface Reaction {
  emoji: string | null;
  emojiId: string | null;
  /** The custom emoji's name, without colons. Null for built-ins. */
  name: string | null;
  userIds: string[];
}

/** A custom emoji. Belongs to exactly one community and is never shared. */
export interface CommunityEmoji {
  id: string;
  communityId: string;
  /** Normalised, without colons. Unique within its community only. */
  name: string;
  createdBy: string;
  createdAt: string;
  /** Short-lived signed URL. Absent when the file could not be signed. */
  url?: string;
}

export type NotificationKind =
  | "mention"
  | "announcement"
  | "event"
  | "invitation"
  | "membership";

export interface Notification {
  id: string;
  userId: string;
  kind: NotificationKind;
  communityId?: string;
  title: string;
  body: string;
  createdAt: string;
  read: boolean;
  href: string;
}
