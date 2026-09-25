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
          user_id: string | null
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
          user_id?: string | null
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
          user_id?: string | null
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
          {
            foreignKeyName: "access_requests_user_id_fkey"
            columns: ["user_id"]
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
          avatar_path: string | null
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
          avatar_path?: string | null
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
          avatar_path?: string | null
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
      community_people: {
        Row: {
          active: boolean
          community_id: string
          created_at: string
          description: string | null
          email: string | null
          id: string
          local_group_id: string | null
          name: string
          role: string | null
          section: Database["public"]["Enums"]["community_person_section"]
          sort_order: number
          user_id: string | null
        }
        Insert: {
          active?: boolean
          community_id: string
          created_at?: string
          description?: string | null
          email?: string | null
          id?: string
          local_group_id?: string | null
          name: string
          role?: string | null
          section: Database["public"]["Enums"]["community_person_section"]
          sort_order?: number
          user_id?: string | null
        }
        Update: {
          active?: boolean
          community_id?: string
          created_at?: string
          description?: string | null
          email?: string | null
          id?: string
          local_group_id?: string | null
          name?: string
          role?: string | null
          section?: Database["public"]["Enums"]["community_person_section"]
          sort_order?: number
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "community_people_community_id_fkey"
            columns: ["community_id"]
            isOneToOne: false
            referencedRelation: "communities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "community_people_local_group_fkey"
            columns: ["local_group_id", "community_id"]
            isOneToOne: false
            referencedRelation: "community_local_groups"
            referencedColumns: ["id", "community_id"]
          },
          {
            foreignKeyName: "community_people_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      community_profiles: {
        Row: {
          avatar_path: string | null
          bio: string
          community_id: string
          created_at: string
          display_name: string
          updated_at: string
          user_id: string
        }
        Insert: {
          avatar_path?: string | null
          bio?: string
          community_id: string
          created_at?: string
          display_name: string
          updated_at?: string
          user_id: string
        }
        Update: {
          avatar_path?: string | null
          bio?: string
          community_id?: string
          created_at?: string
          display_name?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "community_profiles_community_id_fkey"
            columns: ["community_id"]
            isOneToOne: false
            referencedRelation: "communities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "community_profiles_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      direct_conversation_reads: {
        Row: {
          conversation_id: string
          last_read_at: string
          user_id: string
        }
        Insert: {
          conversation_id: string
          last_read_at?: string
          user_id: string
        }
        Update: {
          conversation_id?: string
          last_read_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "direct_conversation_reads_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "direct_conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "direct_conversation_reads_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      direct_conversations: {
        Row: {
          community_id: string
          created_at: string
          created_by: string
          id: string
          last_message_at: string
          participant_one_id: string
          participant_two_id: string
        }
        Insert: {
          community_id: string
          created_at?: string
          created_by?: string
          id?: string
          last_message_at?: string
          participant_one_id: string
          participant_two_id: string
        }
        Update: {
          community_id?: string
          created_at?: string
          created_by?: string
          id?: string
          last_message_at?: string
          participant_one_id?: string
          participant_two_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "direct_conversations_community_id_fkey"
            columns: ["community_id"]
            isOneToOne: false
            referencedRelation: "communities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "direct_conversations_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "direct_conversations_participant_one_id_fkey"
            columns: ["participant_one_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "direct_conversations_participant_two_id_fkey"
            columns: ["participant_two_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      direct_messages: {
        Row: {
          author_id: string
          body: string
          conversation_id: string
          created_at: string
          id: string
        }
        Insert: {
          author_id?: string
          body: string
          conversation_id: string
          created_at?: string
          id?: string
        }
        Update: {
          author_id?: string
          body?: string
          conversation_id?: string
          created_at?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "direct_messages_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "direct_messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "direct_conversations"
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
      access_request_history: {
        Args: { p_community_id: string; p_limit?: number }
        Returns: {
          created_at: string
          display_name: string
          email: string
          id: string
          resolution: string
          reviewed_at: string
          status: Database["public"]["Enums"]["access_request_status"]
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
          outcome: string
          token: string
        }[]
      }
      can_access_post: { Args: { pid: string }; Returns: boolean }
      can_moderate: { Args: { cid: string }; Returns: boolean }
      can_moderate_post: { Args: { pid: string }; Returns: boolean }
      can_read_channel: { Args: { chid: string }; Returns: boolean }
      can_read_member_avatar_object: {
        Args: { p_name: string }
        Returns: boolean
      }
      can_reply_direct_conversation: {
        Args: { p_conversation_id: string }
        Returns: boolean
      }
      can_send_dm: {
        Args: { cid: string; recipient: string }
        Returns: boolean
      }
      can_view_community_profile: {
        Args: { p_community_id: string; p_user_id: string }
        Returns: boolean
      }
      can_view_member_directory: { Args: { cid: string }; Returns: boolean }
      community_member_accounts: {
        Args: { p_community_id: string }
        Returns: {
          email: string
          handle: string
          user_id: string
        }[]
      }
      community_people_linked_member_details: {
        Args: { p_community_id: string }
        Returns: {
          bio: string
          location: string
          person_id: string
          title: string
        }[]
      }
      community_people_linked_member_ids: {
        Args: { p_community_id: string }
        Returns: string[]
      }
      community_person_account_links: {
        Args: { p_community_id: string }
        Returns: {
          member_email: string
          member_handle: string
          member_name: string
          membership_role: Database["public"]["Enums"]["community_role"]
          membership_status: Database["public"]["Enums"]["membership_status"]
          membership_title: string
          person_id: string
          user_id: string
        }[]
      }
      create_local_group: {
        Args: { p_community_id: string; p_name: string }
        Returns: string
      }
      direct_member_dm_actions: {
        Args: { p_community_id: string }
        Returns: {
          conversation_id: string
          user_id: string
        }[]
      }
      direct_unread_count: { Args: { p_community_id: string }; Returns: number }
      emoji_matches_post: {
        Args: { eid: string; pid: string }
        Returns: boolean
      }
      ensure_community_profile: {
        Args: { p_community_id: string; p_user_id: string }
        Returns: undefined
      }
      has_membership_row: { Args: { cid: string }; Returns: boolean }
      has_pending_access_request: { Args: { p_slug: string }; Returns: boolean }
      hash_invitation_token: { Args: { p_token: string }; Returns: string }
      invitation_lifetime: { Args: never; Returns: string }
      invitation_preview: {
        Args: { p_token: string }
        Returns: {
          auto_activate: boolean
          community_id: string
          community_name: string
          community_slug: string
          email: string
          expires_at: string
        }[]
      }
      is_admin: { Args: { cid: string }; Returns: boolean }
      is_direct_conversation_participant: {
        Args: { p_conversation_id: string; p_user_id?: string }
        Returns: boolean
      }
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
      mark_direct_conversation_read: {
        Args: { p_conversation_id: string }
        Returns: boolean
      }
      mark_notifications_read: { Args: never; Returns: undefined }
      my_accepts_member_dms: {
        Args: { p_community_id: string }
        Returns: boolean
      }
      normalize_display_name: { Args: { p_value: string }; Returns: string }
      normalize_email: { Args: { p_email: string }; Returns: string }
      organization_person_dm_actions: {
        Args: { p_community_id: string }
        Returns: {
          conversation_id: string
          person_id: string
        }[]
      }
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
      set_community_avatar: {
        Args: { p_community_id: string; p_path: string }
        Returns: {
          applied: boolean
          previous_path: string
        }[]
      }
      set_community_person_user: {
        Args: { p_person_id: string; p_user_id: string }
        Returns: boolean
      }
      set_local_group_active: {
        Args: { p_active: boolean; p_local_group_id: string }
        Returns: boolean
      }
      set_membership_role: {
        Args: {
          p_membership_id: string
          p_role: Database["public"]["Enums"]["community_role"]
        }
        Returns: boolean
      }
      set_my_community_avatar: {
        Args: { p_community_id: string; p_path: string }
        Returns: {
          applied: boolean
          previous_path: string
        }[]
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
      shares_direct_conversation: { Args: { other: string }; Returns: boolean }
      shares_visible_authorship: { Args: { other: string }; Returns: boolean }
      shares_visible_directory: { Args: { other: string }; Returns: boolean }
      start_direct_conversation: {
        Args: { p_community_id: string; p_recipient_id: string }
        Returns: string
      }
      start_direct_conversation_with_organization_person: {
        Args: { p_person_id: string }
        Returns: {
          community_id: string
          conversation_id: string
        }[]
      }
      update_my_community_profile: {
        Args: { p_bio: string; p_community_id: string; p_display_name: string }
        Returns: boolean
      }
    }
    Enums: {
      access_policy: "invite-only" | "request-to-join"
      access_request_status: "pending" | "approved" | "rejected" | "cancelled"
      community_person_section:
        | "staff"
        | "board"
        | "local_group_leader"
        | "crew"
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
        | "direct_message"
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
      community_person_section: [
        "staff",
        "board",
        "local_group_leader",
        "crew",
      ],
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
        "direct_message",
      ],
      post_kind: ["post", "announcement"],
    },
  },
} as const

export type ProfileRow = Tables<"profiles">
export type CommunityRow = Tables<"communities">
export type MembershipRow = Tables<"memberships">
export type ChannelRow = Tables<"channels">
export type MessageRow = Tables<"messages">
export type PostRow = Tables<"posts">
export type EventRow = Tables<"events">
export type NotificationRow = Tables<"notifications">
export type CommentRow = Tables<"comments">
export type CommunityEmojiRow = Tables<"community_emojis">
export type AccessRequestRow = Tables<"access_requests">
export type InvitationRow = Tables<"invitations">
export type LocalGroupRow = Tables<"community_local_groups">
export type CommunityPersonRow = Tables<"community_people">
export type DirectConversationRow = Tables<"direct_conversations">
export type DirectConversationReadRow = Tables<"direct_conversation_reads">
export type DirectMessageRow = Tables<"direct_messages">
export type CommunityProfileRow = Tables<"community_profiles">

export type PortalCommunityRow =
  Database["public"]["Functions"]["portal_by_slug"]["Returns"][number]
export type PortalEventRow =
  Database["public"]["Functions"]["portal_events"]["Returns"][number]
export type AcceptInvitationRow =
  Database["public"]["Functions"]["accept_invitation_token"]["Returns"][number]
export type InvitationPreviewRow =
  Database["public"]["Functions"]["invitation_preview"]["Returns"][number]
export type MintedInvitationRow =
  Database["public"]["Functions"]["approve_access_request"]["Returns"][number]
export type AccessRequestHistoryRow =
  Database["public"]["Functions"]["access_request_history"]["Returns"][number]
