/**
 * Domain model for the platform.
 *
 * These types are deliberately storage-agnostic: they describe what the UI
 * needs, not how it is persisted. When Supabase (or any other backend) is
 * introduced, only `lib/data.ts` should have to change — every component reads
 * through the query functions there.
 */

import type { Locale } from "@/lib/i18n/locales";

export type RoleId = "member" | "moderator" | "admin";

export interface Role {
  id: RoleId;
  /** Label in the platform language. Screens inside a community use `roleLabel()` instead. */
  label: string;
  description: string;
}

/**
 * The account: one per person, across all of TING.
 *
 * Only ever the signed-in person's own. Other people are never seen through
 * this type — inside a community they are a `CommunityPersona`, which carries
 * nothing from the account.
 */
export interface User {
  id: string;
  /** The account name. The default a new community profile may start from. */
  name: string;
  /** Short handle, unique across the platform. Account identity, shown only to its owner. */
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

/**
 * How one person appears inside one community.
 *
 * The same account can be "Kari Moen" in one community and a pseudonym in
 * another, and neither community learns the other's. Everything that shows a
 * person inside a community — authors, DM participants, member cards, the
 * viewer's own avatar in a composer — uses this, resolved for *that*
 * community. There is deliberately no handle, email, location or account name
 * here: those belong to the account, not to the persona.
 */
export interface CommunityPersona {
  /** The account id. Used for keys and "is this me", never displayed. */
  id: string;
  communityId: string;
  /** The display name chosen for this community. */
  name: string;
  initials: string;
  bio: string;
  /** Same-origin URL of the profile photo in this community, when there is one. */
  avatarUrl?: string;
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
  /**
   * The language of the interface inside this community and on its portal.
   * Presentation only — nothing about access or visibility reads it.
   */
  defaultLocale: Locale;
  memberCount: number;
  /** Public-facing links shown on the portal. */
  links: { label: string; href: string }[];
}

/** The full record, readable only by members. */
export interface Community extends CommunityPublic {
  /** Internal description, only visible to members. */
  about: string;
  /**
   * The community's profile image inside TING, when its administrator has set
   * one. Deliberately here and not on `CommunityPublic`: it is part of the
   * signed-in app, never the public portal, so no portal can pick it up by
   * accident. Absent means the monogram in `branding` is used.
   */
  avatarUrl?: string;
}

export type MembershipStatus = "active" | "invited" | "requested";

export interface Membership {
  /** Database row id. Fixture memberships omit this until they are seeded. */
  id?: string;
  userId: string;
  communityId: string;
  role: RoleId;
  status: MembershipStatus;
  joinedAt: string;
  /** Free-text role inside the organisation, e.g. "Frivilligkoordinator". */
  title?: string;
  /** Who invited this person, for pending invitations. */
  invitedBy?: string;
  /**
   * The local group this membership belongs to, if the member has chosen one.
   * Absent is an ordinary, permanent state — not an unfinished profile.
   * Community-scoped: the same person may have a different answer, or none, in
   * another community.
   */
  localGroupId?: string;
}

/**
 * A local group within one community.
 *
 * `active` false means retired: it keeps its existing members and its name
 * stays readable, but nobody new can choose it.
 */
export interface LocalGroup {
  id: string;
  communityId: string;
  name: string;
  slug: string;
  sortOrder: number;
  active: boolean;
}

export type CommunityPersonSection = "staff" | "board" | "local_group_leader" | "crew";

/**
 * A person the organisation publishes as staff, board, local-group contact or
 * public crew.
 *
 * This is not a TING account and not a membership row. There is deliberately no
 * user id here, so rendering this type cannot reveal roles, DM settings,
 * private profiles or membership status.
 */
export interface CommunityPerson {
  id: string;
  communityId: string;
  section: CommunityPersonSection;
  localGroupId?: string;
  localGroupName?: string;
  name: string;
  role?: string;
  email?: string;
  description?: string;
  sortOrder: number;
}

export interface DirectMessage {
  id: string;
  conversationId: string;
  authorId: string;
  body: string;
  createdAt: string;
}

export interface DirectConversationSummary {
  id: string;
  communityId: string;
  participantIds: [string, string];
  /** As they appear in this conversation's community. */
  otherParticipant: CommunityPersona;
  latestMessage?: DirectMessage;
  lastMessageAt: string;
  unread: boolean;
}

export interface DirectConversation {
  id: string;
  communityId: string;
  participantIds: [string, string];
  /** As they appear in this conversation's community. */
  otherParticipant: CommunityPersona;
  messages: DirectMessage[];
  unread: boolean;
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
  /** Optional local group scope. Absent means community-wide. */
  localGroupId?: string;
  /**
   * The scoped local group's id and name, loaded with the post in the same
   * query. Absent exactly when `localGroupId` is. The name is the
   * organisation's own label for the unit ("FTR Oslo", "TU UiO") and is shown
   * verbatim as the post's scope badge.
   */
  localGroup?: { id: string; name: string };
  authorId: string;
  /** Optional headline; short updates have none. */
  title?: string;
  body: string;
  createdAt: string;
  /** Stamped by the database when the text is changed, never by the client. */
  editedAt?: string;
  /** A pinned announcement is also surfaced on the community overview. */
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
  /** Optional local group scope. Absent means community-wide. */
  localGroupId?: string;
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
  | "membership"
  | "direct_message";

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

// ── Collaborations ──────────────────────────────────────────────────────
//
// A collaboration is not a community. Several organisations take part, each
// through a unit (the whole community, or one of its local groups), and a
// person is on the organiser team only because their own organisation chose
// them and they said yes. None of these types carries a membership, a role in
// a community, or a community persona.

export interface Collaboration {
  id: string;
  slug: string;
  /** Written by people; never translated. */
  name: string;
  description?: string;
  /** The collaboration's own language, fixed from its source community. */
  defaultLocale: Locale;
}

export type CollaborationUnitStatus = "invited" | "active" | "declined" | "left";

/**
 * One organisation's participation, as the viewer may see it: a display name
 * and nothing about who belongs to it. `localGroupId` is present only on units
 * the viewer represents — their own organisation's.
 *
 * `participantId` and `communityId` are null on label-only rows: the units a
 * pending invitee may see so they know who they would be joining, which carry
 * nothing to act on or look anything up with. `key` is stable for rendering
 * either way.
 */
export interface CollaborationUnit {
  key: string;
  participantId: string | null;
  status: CollaborationUnitStatus;
  communityId: string | null;
  communityName: string;
  localGroupId?: string;
  localGroupName?: string;
  branding: Pick<CommunityBranding, "accent" | "monogram" | "markStyle">;
  /** The viewer can currently act for this unit. */
  represented: boolean;
}

/** A unit the viewer can act for: always a real participant row of their own organisation. */
export type RepresentedCollaborationUnit = CollaborationUnit & {
  participantId: string;
  communityId: string;
  represented: true;
};

export type CollaborationSponsorshipStatus = "invited" | "accepted" | "declined" | "revoked";

/**
 * What a representative sees for one of their OWN unit's people. "joined" and
 * "left" come from `collaboration_sponsored_team_state()`; "accepted" is the
 * rare accepted-but-never-joined case.
 */
export type OrganizerState =
  | "none"
  | "invited"
  | "joined"
  | "left"
  | "accepted"
  | "declined"
  | "revoked";

/** The viewer's own sponsorship. Never anyone else's. */
export interface MyCollaborationSponsorship {
  id: string;
  collaborationId: string;
  participantId: string;
  status: CollaborationSponsorshipStatus;
}

/**
 * How someone appears inside one collaboration. Only ever built from
 * `collaboration_profiles` — never from the account or a community persona.
 */
export interface CollaborationPersona {
  /** The account id. Used for keys and "is this me", never displayed. */
  id: string;
  collaborationId: string;
  name: string;
  initials: string;
  bio: string;
}
