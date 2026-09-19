export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      access_requests: {
        Row: {
          community_id: string
          created_at: string
          display_name: string | null
          email: string
          id: string
          reviewed_at: string | null
          reviewed_by: string | null
          status: Database["public"]["Enums"]["access_request_status"]
        }
        Insert: {
          community_id: string
          created_at?: string
          display_name?: string | null
          email: string
          id?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: Database["public"]["Enums"]["access_request_status"]
        }
        Update: {
          community_id?: string
          created_at?: string
          display_name?: string | null
          email?: string
          id?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: Database["public"]["Enums"]["access_request_status"]
        }
        Relationships: [
          {
            foreignKeyName: "access_requests_community_id_fkey"
            columns: ["community_id"]
            isOneToOne: false
            referencedRelation: "communities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "access_requests_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      channel_groups: {
        Row: {
          id: string
          label: string
          position: number
        }
        Insert: {
          id: string
          label: string
          position?: number
        }
        Update: {
          id?: string
          label?: string
          position?: number
        }
        Relationships: []
      }
      channels: {
        Row: {
          community_id: string
          group_id: string
          id: string
          name: string
          position: number
          purpose: string
          read_only: boolean
        }
        Insert: {
          community_id: string
          group_id: string
          id: string
          name: string
          position?: number
          purpose: string
          read_only?: boolean
        }
        Update: {
          community_id?: string
          group_id?: string
          id?: string
          name?: string
          position?: number
          purpose?: string
          read_only?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "channels_community_id_fkey"
            columns: ["community_id"]
            isOneToOne: false
            referencedRelation: "communities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "channels_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "channel_groups"
            referencedColumns: ["id"]
          },
        ]
      }
      comments: {
        Row: {
          author_id: string
          body: string
          created_at: string
          edited_at: string | null
          id: string
          parent_id: string | null
          post_id: string
        }
        Insert: {
          author_id?: string
          body: string
          created_at?: string
          edited_at?: string | null
          id?: string
          parent_id?: string | null
          post_id: string
        }
        Update: {
          author_id?: string
          body?: string
          created_at?: string
          edited_at?: string | null
          id?: string
          parent_id?: string | null
          post_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "comments_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "comments_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "comments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "comments_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "posts"
            referencedColumns: ["id"]
          },
        ]
      }
      communities: {
        Row: {
          about: string
          accent: string
          accent_soft: string
          access_policy: Database["public"]["Enums"]["access_policy"]
          dm_policy: Database["public"]["Enums"]["dm_policy"]
          founded_year: number
          id: string
          links: Json
          location: string
          mark_style: string
          member_count: number
          member_directory_visibility: Database["public"]["Enums"]["member_directory_visibility"]
          monogram: string
          name: string
          public_description: string
          slug: string
          tagline: string
        }
        Insert: {
          about: string
          accent: string
          accent_soft: string
          access_policy?: Database["public"]["Enums"]["access_policy"]
          dm_policy?: Database["public"]["Enums"]["dm_policy"]
          founded_year: number
          id: string
          links?: Json
          location: string
          mark_style?: string
          member_count?: number
          member_directory_visibility?: Database["public"]["Enums"]["member_directory_visibility"]
          monogram: string
          name: string
          public_description: string
          slug: string
          tagline: string
        }
        Update: {
          about?: string
          accent?: string
          accent_soft?: string
          access_policy?: Database["public"]["Enums"]["access_policy"]
          dm_policy?: Database["public"]["Enums"]["dm_policy"]
          founded_year?: number
          id?: string
          links?: Json
          location?: string
          mark_style?: string
          member_count?: number
          member_directory_visibility?: Database["public"]["Enums"]["member_directory_visibility"]
          monogram?: string
          name?: string
          public_description?: string
          slug?: string
          tagline?: string
        }
        Relationships: []
      }
      community_emojis: {
        Row: {
          byte_size: number
          community_id: string
          content_type: string
          created_at: string
          created_by: string
          id: string
          name: string
          storage_path: string
        }
        Insert: {
          byte_size: number
          community_id: string
          content_type: string
          created_at?: string
          created_by?: string
          id?: string
          name: string
          storage_path: string
        }
        Update: {
          byte_size?: number
          community_id?: string
          content_type?: string
          created_at?: string
          created_by?: string
          id?: string
          name?: string
          storage_path?: string
        }
        Relationships: [
          {
            foreignKeyName: "community_emojis_community_id_fkey"
            columns: ["community_id"]
            isOneToOne: false
            referencedRelation: "communities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "community_emojis_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      community_local_groups: {
        Row: {
          active: boolean
          community_id: string
          created_at: string
          id: string
          name: string
          slug: string
          sort_order: number
        }
        Insert: {
          active?: boolean
          community_id: string
          created_at?: string
          id?: string
          name: string
          slug: string
          sort_order?: number
        }
        Update: {
          active?: boolean
          community_id?: string
          created_at?: string
          id?: string
          name?: string
          slug?: string
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "community_local_groups_community_id_fkey"
            columns: ["community_id"]
            isOneToOne: false
            referencedRelation: "communities"
            referencedColumns: ["id"]
          },
        ]
      }
      event_attendees: {
        Row: {
          event_id: string
          user_id: string
        }
        Insert: {
          event_id: string
          user_id?: string
        }
        Update: {
          event_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_attendees_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_attendees_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      events: {
        Row: {
          capacity: number | null
          community_id: string
          description: string
          ends_at: string
          host_id: string | null
          id: string
          is_public: boolean
          local_group_id: string | null
          location: string
          starts_at: string
          title: string
        }
        Insert: {
          capacity?: number | null
          community_id: string
          description: string
          ends_at: string
          host_id?: string | null
          id?: string
          is_public?: boolean
          local_group_id?: string | null
          location: string
          starts_at: string
          title: string
        }
        Update: {
          capacity?: number | null
          community_id?: string
          description?: string
          ends_at?: string
          host_id?: string | null
          id?: string
          is_public?: boolean
          local_group_id?: string | null
          location?: string
          starts_at?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "events_community_id_fkey"
            columns: ["community_id"]
            isOneToOne: false
            referencedRelation: "communities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "events_host_id_fkey"
            columns: ["host_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "events_local_group_fkey"
            columns: ["local_group_id", "community_id"]
            isOneToOne: false
            referencedRelation: "community_local_groups"
            referencedColumns: ["id", "community_id"]
          },
        ]
      }
      invitations: {
        Row: {
          accepted_at: string | null
          accepted_by: string | null
          community_id: string
          created_at: string
          email: string
          expires_at: string
          id: string
          invited_by: string | null
          request_id: string | null
          revoked_at: string | null
          token_hash: string
        }
        Insert: {
          accepted_at?: string | null
          accepted_by?: string | null
          community_id: string
          created_at?: string
          email: string
          expires_at: string
          id?: string
          invited_by?: string | null
          request_id?: string | null
          revoked_at?: string | null
          token_hash: string
        }
        Update: {
          accepted_at?: string | null
          accepted_by?: string | null
          community_id?: string
          created_at?: string
          email?: string
          expires_at?: string
          id?: string
          invited_by?: string | null
          request_id?: string | null
          revoked_at?: string | null
          token_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: "invitations_accepted_by_fkey"
            columns: ["accepted_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invitations_community_id_fkey"
            columns: ["community_id"]
            isOneToOne: false
            referencedRelation: "communities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invitations_invited_by_fkey"
            columns: ["invited_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invitations_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "access_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      memberships: {
        Row: {
          accepts_member_dms: boolean
          community_id: string
          id: string
          invited_by: string | null
          joined_at: string
          local_group_id: string | null
          role: Database["public"]["Enums"]["community_role"]
          status: Database["public"]["Enums"]["membership_status"]
          title: string | null
          user_id: string
        }
        Insert: {
          accepts_member_dms?: boolean
          community_id: string
          id?: string
          invited_by?: string | null
          joined_at?: string
          local_group_id?: string | null
          role?: Database["public"]["Enums"]["community_role"]
          status?: Database["public"]["Enums"]["membership_status"]
          title?: string | null
          user_id: string
        }
        Update: {
          accepts_member_dms?: boolean
          community_id?: string
          id?: string
          invited_by?: string | null
          joined_at?: string
          local_group_id?: string | null
          role?: Database["public"]["Enums"]["community_role"]
          status?: Database["public"]["Enums"]["membership_status"]
          title?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "memberships_community_id_fkey"
            columns: ["community_id"]
            isOneToOne: false
            referencedRelation: "communities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "memberships_invited_by_fkey"
            columns: ["invited_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "memberships_local_group_fkey"
            columns: ["local_group_id", "community_id"]
            isOneToOne: false
            referencedRelation: "community_local_groups"
            referencedColumns: ["id", "community_id"]
          },
          {
            foreignKeyName: "memberships_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      messages: {
        Row: {
          attachment: Json | null
          author_id: string
          body: string
          channel_id: string
          created_at: string
          id: string
          reactions: Json
        }
        Insert: {
          attachment?: Json | null
          author_id?: string
          body: string
          channel_id: string
          created_at?: string
          id?: string
          reactions?: Json
        }
        Update: {
          attachment?: Json | null
          author_id?: string
          body?: string
          channel_id?: string
          created_at?: string
          id?: string
          reactions?: Json
        }
        Relationships: [
          {
            foreignKeyName: "messages_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "channels"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          body: string
          community_id: string | null
          created_at: string
          href: string
          id: string
          kind: Database["public"]["Enums"]["notification_kind"]
          read: boolean
          title: string
          user_id: string
        }
        Insert: {
          body: string
          community_id?: string | null
          created_at?: string
          href: string
          id?: string
          kind: Database["public"]["Enums"]["notification_kind"]
          read?: boolean
          title: string
          user_id: string
        }
        Update: {
          body?: string
          community_id?: string | null
          created_at?: string
          href?: string
          id?: string
          kind?: Database["public"]["Enums"]["notification_kind"]
          read?: boolean
          title?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_community_id_fkey"
            columns: ["community_id"]
            isOneToOne: false
            referencedRelation: "communities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      post_reactions: {
        Row: {
          created_at: string
          emoji: string | null
          emoji_id: string | null
          id: string
          post_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          emoji?: string | null
          emoji_id?: string | null
          id?: string
          post_id: string
          user_id?: string
        }
        Update: {
          created_at?: string
          emoji?: string | null
          emoji_id?: string | null
          id?: string
          post_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "post_reactions_emoji_id_fkey"
            columns: ["emoji_id"]
            isOneToOne: false
            referencedRelation: "community_emojis"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "post_reactions_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "posts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "post_reactions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      posts: {
        Row: {
          author_id: string
          body: string
          comment_count: number
          community_id: string
          created_at: string
          edited_at: string | null
          id: string
          kind: Database["public"]["Enums"]["post_kind"]
          local_group_id: string | null
          pinned: boolean
          reactions: Json
          title: string | null
        }
        Insert: {
          author_id?: string
          body: string
          comment_count?: number
          community_id: string
          created_at?: string
          edited_at?: string | null
          id?: string
          kind?: Database["public"]["Enums"]["post_kind"]
          local_group_id?: string | null
          pinned?: boolean
          reactions?: Json
          title?: string | null
        }
        Update: {
          author_id?: string
          body?: string
          comment_count?: number
          community_id?: string
          created_at?: string
          edited_at?: string | null
          id?: string
          kind?: Database["public"]["Enums"]["post_kind"]
          local_group_id?: string | null
          pinned?: boolean
          reactions?: Json
          title?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "posts_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "posts_community_id_fkey"
            columns: ["community_id"]
            isOneToOne: false
            referencedRelation: "communities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "posts_local_group_fkey"
            columns: ["local_group_id", "community_id"]
            isOneToOne: false
            referencedRelation: "community_local_groups"
            referencedColumns: ["id", "community_id"]
          },
        ]
      }
      profiles: {
        Row: {
          bio: string
          email: string
          handle: string
          id: string
          initials: string
          joined_at: string
          location: string
          name: string
          pronoun: string
        }
        Insert: {
          bio?: string
          email: string
          handle: string
          id: string
          initials: string
          joined_at?: string
          location?: string
          name: string
          pronoun?: string
        }
        Update: {
          bio?: string
          email?: string
          handle?: string
          id?: string
          initials?: string
          joined_at?: string
          location?: string
          name?: string
          pronoun?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      accept_invitation_token: {
        Args: { p_token: string }
        Returns: {
          community_id: string
          ok: boolean
          reason: string
        }[]
      }
      administers_pending_membership: {
        Args: { other: string }
        Returns: boolean
      }
      approve_access_request: {
        Args: { p_request_id: string }
        Returns: {
          community_id: string
          email: string
          expires_at: string
          token: string
        }[]
      }
      can_access_post: { Args: { pid: string }; Returns: boolean }
      can_moderate: { Args: { cid: string }; Returns: boolean }
      can_moderate_post: { Args: { pid: string }; Returns: boolean }
      can_read_channel: { Args: { chid: string }; Returns: boolean }
      can_send_dm: {
        Args: { cid: string; recipient: string }
        Returns: boolean
      }
      can_view_member_directory: { Args: { cid: string }; Returns: boolean }
      create_local_group: {
        Args: { p_community_id: string; p_name: string }
        Returns: string
      }
      emoji_matches_post: {
        Args: { eid: string; pid: string }
        Returns: boolean
      }
      has_membership_row: { Args: { cid: string }; Returns: boolean }
      hash_invitation_token: { Args: { p_token: string }; Returns: string }
      invitation_lifetime: { Args: never; Returns: string }
      invitation_preview: {
        Args: { p_token: string }
        Returns: {
          community_id: string
          community_name: string
          community_slug: string
          email: string
          expires_at: string
        }[]
      }
      is_admin: { Args: { cid: string }; Returns: boolean }
      is_member: { Args: { cid: string }; Returns: boolean }
      local_group_member_counts: {
        Args: { p_community_id: string }
        Returns: {
          local_group_id: string
          member_count: number
        }[]
      }
      local_group_slug: { Args: { p_name: string }; Returns: string }
      looks_like_email: { Args: { p_email: string }; Returns: boolean }
      mark_notifications_read: { Args: never; Returns: undefined }
      my_accepts_member_dms: {
        Args: { p_community_id: string }
        Returns: boolean
      }
      normalize_email: { Args: { p_email: string }; Returns: string }
      portal_by_slug: {
        Args: { p_slug: string }
        Returns: {
          accent: string
          accent_soft: string
          access_policy: Database["public"]["Enums"]["access_policy"]
          founded_year: number
          id: string
          links: Json
          location: string
          mark_style: string
          member_count: number
          monogram: string
          name: string
          public_description: string
          slug: string
          tagline: string
        }[]
      }
      portal_events: {
        Args: { p_slug: string }
        Returns: {
          description: string
          ends_at: string
          id: string
          location: string
          starts_at: string
          title: string
        }[]
      }
      portal_slug_by_id: { Args: { p_community_id: string }; Returns: string }
      reject_access_request: {
        Args: { p_request_id: string }
        Returns: boolean
      }
      rename_local_group: {
        Args: { p_local_group_id: string; p_name: string }
        Returns: boolean
      }
      request_community_access: {
        Args: { p_display_name?: string; p_email: string; p_slug: string }
        Returns: boolean
      }
      resend_invitation: {
        Args: { p_invitation_id: string }
        Returns: {
          community_id: string
          email: string
          expires_at: string
          token: string
        }[]
      }
      set_accepts_member_dms: {
        Args: { p_community_id: string; p_value: boolean }
        Returns: boolean
      }
      set_local_group_active: {
        Args: { p_active: boolean; p_local_group_id: string }
        Returns: boolean
      }
      set_my_local_group: {
        Args: { p_community_id: string; p_local_group_id: string }
        Returns: boolean
      }
      set_post_pinned: {
        Args: { p_pinned: boolean; p_post_id: string }
        Returns: boolean
      }
      shares_community: { Args: { other: string }; Returns: boolean }
      shares_visible_authorship: { Args: { other: string }; Returns: boolean }
      shares_visible_directory: { Args: { other: string }; Returns: boolean }
    }
    Enums: {
      access_policy: "invite-only" | "request-to-join"
      access_request_status: "pending" | "approved" | "rejected" | "cancelled"
      community_role: "member" | "moderator" | "admin"
      dm_policy: "staff_only" | "members"
      member_directory_visibility: "admin_only" | "members"
      membership_status: "active" | "invited" | "requested"
      notification_kind:
        | "mention"
        | "announcement"
        | "event"
        | "invitation"
        | "membership"
      post_kind: "post" | "announcement"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      access_policy: ["invite-only", "request-to-join"],
      access_request_status: ["pending", "approved", "rejected", "cancelled"],
      community_role: ["member", "moderator", "admin"],
      dm_policy: ["staff_only", "members"],
      member_directory_visibility: ["admin_only", "members"],
      membership_status: ["active", "invited", "requested"],
      notification_kind: [
        "mention",
        "announcement",
        "event",
        "invitation",
        "membership",
      ],
      post_kind: ["post", "announcement"],
    },
  },
} as const

/**
 * Row aliases used across `lib/data.ts`.
 *
 * These are derived from the generated `Database` type rather than restated,
 * so a column added or removed in a migration reaches the application code as
 * a type error the moment the types are regenerated.
 */
type PublicSchema = Database["public"];
type TableRow<T extends keyof PublicSchema["Tables"]> = PublicSchema["Tables"][T]["Row"];
type FunctionReturns<F extends keyof PublicSchema["Functions"]> =
  PublicSchema["Functions"][F]["Returns"];

export type ProfileRow = TableRow<"profiles">;
export type CommunityRow = TableRow<"communities">;
export type MembershipRow = TableRow<"memberships">;
export type LocalGroupRow = TableRow<"community_local_groups">;
export type ChannelGroupRow = TableRow<"channel_groups">;
export type ChannelRow = TableRow<"channels">;
export type MessageRow = TableRow<"messages">;
export type PostRow = TableRow<"posts">;
export type EventRow = TableRow<"events">;
export type EventAttendeeRow = TableRow<"event_attendees">;
export type NotificationRow = TableRow<"notifications">;
export type CommentRow = TableRow<"comments">;
export type PostReactionRow = TableRow<"post_reactions">;
export type CommunityEmojiRow = TableRow<"community_emojis">;
export type AccessRequestRow = TableRow<"access_requests">;
export type InvitationRow = TableRow<"invitations">;

/** What an anonymous portal visitor receives — strictly less than a full row. */
export type PortalCommunityRow = FunctionReturns<"portal_by_slug">[number];
export type PortalEventRow = FunctionReturns<"portal_events">[number];

/** Row shapes returned by the access-request and invitation RPCs. */
export type MintedInvitationRow = FunctionReturns<"approve_access_request">[number];
export type InvitationPreviewRow = FunctionReturns<"invitation_preview">[number];
export type AcceptInvitationRow = FunctionReturns<"accept_invitation_token">[number];
