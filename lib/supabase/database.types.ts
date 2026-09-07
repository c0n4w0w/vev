/**
 * Database types.
 *
 * Hand-written to match `supabase/migrations`. Once a project exists, replace
 * this file with the generated version and delete the note:
 *
 *   npx supabase gen types typescript --linked > lib/supabase/database.types.ts
 *
 * Only the columns the application reads are described; that is enough for the
 * client to type every query in `lib/data.ts`.
 */
export type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

export type CommunityRole = "member" | "moderator" | "admin";
export type MembershipStatus = "active" | "invited" | "requested";
export type AccessPolicy = "invite-only" | "request-to-join";
export type PostKind = "post" | "announcement";
export type NotificationKind =
  | "mention"
  | "announcement"
  | "event"
  | "invitation"
  | "membership";

export type ProfileRow = {
  id: string;
  name: string;
  handle: string;
  initials: string;
  email: string;
  pronoun: string;
  location: string;
  bio: string;
  joined_at: string;
};

export type CommunityRow = {
  id: string;
  slug: string;
  name: string;
  tagline: string;
  public_description: string;
  about: string;
  location: string;
  founded_year: number;
  accent: string;
  accent_soft: string;
  monogram: string;
  mark_style: string;
  access_policy: AccessPolicy;
  member_count: number;
  links: Json;
};

/** What `portal_by_slug` returns — the internal `about` column is absent. */
export type PortalCommunityRow = Omit<CommunityRow, "about">;

export type MembershipRow = {
  id: string;
  user_id: string;
  community_id: string;
  role: CommunityRole;
  status: MembershipStatus;
  joined_at: string;
  title: string | null;
  invited_by: string | null;
};

export type ChannelGroupRow = {
  id: string;
  label: string;
  position: number;
};

export type ChannelRow = {
  id: string;
  community_id: string;
  group_id: string;
  name: string;
  purpose: string;
  read_only: boolean;
  position: number;
};

export type MessageRow = {
  id: string;
  channel_id: string;
  author_id: string;
  body: string;
  created_at: string;
  attachment: Json;
  reactions: Json;
};

export type PostRow = {
  id: string;
  community_id: string;
  author_id: string;
  title: string | null;
  body: string;
  created_at: string;
  kind: PostKind;
  pinned: boolean;
  comment_count: number;
  reactions: Json;
};

export type EventRow = {
  id: string;
  community_id: string;
  title: string;
  description: string;
  starts_at: string;
  ends_at: string;
  location: string;
  is_public: boolean;
  host_id: string | null;
  capacity: number | null;
};

/** `portal_events` deliberately omits `host_id` and `is_public`. */
export type PortalEventRow = Pick<
  EventRow,
  "id" | "title" | "description" | "starts_at" | "ends_at" | "location"
>;

export type EventAttendeeRow = {
  event_id: string;
  user_id: string;
};

export type NotificationRow = {
  id: string;
  user_id: string;
  kind: NotificationKind;
  community_id: string | null;
  title: string;
  body: string;
  created_at: string;
  read: boolean;
  href: string;
};

type Table<Row, Insert = Partial<Row>, Update = Partial<Row>> = {
  Row: Row;
  Insert: Insert;
  Update: Update;
  Relationships: [];
};

export type Database = {
  public: {
    Tables: {
      profiles: Table<ProfileRow>;
      communities: Table<CommunityRow>;
      memberships: Table<MembershipRow>;
      channel_groups: Table<ChannelGroupRow>;
      channels: Table<ChannelRow>;
      messages: Table<MessageRow>;
      posts: Table<PostRow>;
      events: Table<EventRow>;
      event_attendees: Table<EventAttendeeRow>;
      notifications: Table<NotificationRow>;
    };
    // No views yet; the empty map keeps the shape the client expects.
    Views: { [key: string]: { Row: Record<string, unknown>; Relationships: [] } };
    Functions: {
      portal_by_slug: { Args: { p_slug: string }; Returns: PortalCommunityRow[] };
      portal_events: { Args: { p_slug: string }; Returns: PortalEventRow[] };
      request_access: { Args: { p_community_id: string }; Returns: boolean };
      accept_invitation: { Args: { p_community_id: string }; Returns: boolean };
      decline_invitation: { Args: { p_community_id: string }; Returns: boolean };
      approve_membership: {
        Args: { p_community_id: string; p_user_id: string };
        Returns: boolean;
      };
      reject_membership: {
        Args: { p_community_id: string; p_user_id: string };
        Returns: boolean;
      };
      mark_notifications_read: { Args: Record<string, never>; Returns: undefined };
      resolve_invitation_notice: {
        Args: { p_user: string; p_community: string };
        Returns: undefined;
      };
    };
    Enums: {
      community_role: CommunityRole;
      membership_status: MembershipStatus;
      access_policy: AccessPolicy;
      post_kind: PostKind;
      notification_kind: NotificationKind;
    };
    CompositeTypes: { [key: string]: Record<string, unknown> };
  };
};
