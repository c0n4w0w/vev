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
      account_security: {
        Row: {
          email_change_armed_until: string | null
          email_change_authorized_at: string | null
          email_change_requested_at: string | null
          email_change_to: string | null
          password_change_authorized_at: string | null
          password_set_at: string | null
          password_setup_required_at: string | null
          user_id: string
        }
        Insert: {
          email_change_armed_until?: string | null
          email_change_authorized_at?: string | null
          email_change_requested_at?: string | null
          email_change_to?: string | null
          password_change_authorized_at?: string | null
          password_set_at?: string | null
          password_setup_required_at?: string | null
          user_id: string
        }
        Update: {
          email_change_armed_until?: string | null
          email_change_authorized_at?: string | null
          email_change_requested_at?: string | null
          email_change_to?: string | null
          password_change_authorized_at?: string | null
          password_set_at?: string | null
          password_setup_required_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      auth_throttle: {
        Row: {
          attempts: number
          blocked_until: string | null
          key: string
          last_attempt_at: string
        }
        Insert: {
          attempts?: number
          blocked_until?: string | null
          key: string
          last_attempt_at?: string
        }
        Update: {
          attempts?: number
          blocked_until?: string | null
          key?: string
          last_attempt_at?: string
        }
        Relationships: []
      }
      channel_attachment_placements: {
        Row: {
          attachment_id: string
          channel_id: string
          folder_id: string
          placed_at: string
          placed_by: string | null
        }
        Insert: {
          attachment_id: string
          channel_id: string
          folder_id: string
          placed_at?: string
          placed_by?: string | null
        }
        Update: {
          attachment_id?: string
          channel_id?: string
          folder_id?: string
          placed_at?: string
          placed_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "channel_attachment_placements_attachment_fkey"
            columns: ["attachment_id", "channel_id"]
            isOneToOne: false
            referencedRelation: "message_attachments"
            referencedColumns: ["id", "channel_id"]
          },
          {
            foreignKeyName: "channel_attachment_placements_folder_fkey"
            columns: ["folder_id", "channel_id"]
            isOneToOne: false
            referencedRelation: "channel_resource_folders"
            referencedColumns: ["id", "channel_id"]
          },
          {
            foreignKeyName: "channel_attachment_placements_placed_by_fkey"
            columns: ["placed_by"]
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
      channel_links: {
        Row: {
          channel_id: string
          created_at: string
          created_by: string | null
          description: string
          folder_id: string | null
          id: string
          title: string
          updated_at: string
          url: string
        }
        Insert: {
          channel_id: string
          created_at?: string
          created_by?: string | null
          description?: string
          folder_id?: string | null
          id?: string
          title: string
          updated_at?: string
          url: string
        }
        Update: {
          channel_id?: string
          created_at?: string
          created_by?: string | null
          description?: string
          folder_id?: string | null
          id?: string
          title?: string
          updated_at?: string
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "channel_links_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "channels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "channel_links_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "channel_links_folder_fkey"
            columns: ["folder_id", "channel_id"]
            isOneToOne: false
            referencedRelation: "channel_resource_folders"
            referencedColumns: ["id", "channel_id"]
          },
        ]
      }
      channel_participants: {
        Row: {
          added_by: string | null
          channel_id: string
          community_id: string
          created_at: string
          is_manager: boolean
          local_group_id: string
          user_id: string
        }
        Insert: {
          added_by?: string | null
          channel_id: string
          community_id: string
          created_at?: string
          is_manager?: boolean
          local_group_id: string
          user_id: string
        }
        Update: {
          added_by?: string | null
          channel_id?: string
          community_id?: string
          created_at?: string
          is_manager?: boolean
          local_group_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "channel_participants_added_by_fkey"
            columns: ["added_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "channel_participants_channel_id_community_id_local_group_i_fkey"
            columns: ["channel_id", "community_id", "local_group_id"]
            isOneToOne: false
            referencedRelation: "channels"
            referencedColumns: ["id", "community_id", "local_group_id"]
          },
          {
            foreignKeyName: "channel_participants_user_id_community_id_fkey"
            columns: ["user_id", "community_id"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["user_id", "community_id"]
          },
        ]
      }
      channel_pinned_messages: {
        Row: {
          channel_id: string
          message_id: string
          pinned_at: string
          pinned_by: string | null
        }
        Insert: {
          channel_id: string
          message_id: string
          pinned_at?: string
          pinned_by?: string | null
        }
        Update: {
          channel_id?: string
          message_id?: string
          pinned_at?: string
          pinned_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "channel_pinned_messages_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: true
            referencedRelation: "channels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "channel_pinned_messages_message_fkey"
            columns: ["message_id", "channel_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id", "channel_id"]
          },
          {
            foreignKeyName: "channel_pinned_messages_pinned_by_fkey"
            columns: ["pinned_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      channel_resource_folders: {
        Row: {
          channel_id: string
          created_at: string
          created_by: string | null
          depth: number
          id: string
          name: string
          parent_id: string | null
          updated_at: string
        }
        Insert: {
          channel_id: string
          created_at?: string
          created_by?: string | null
          depth: number
          id?: string
          name: string
          parent_id?: string | null
          updated_at?: string
        }
        Update: {
          channel_id?: string
          created_at?: string
          created_by?: string | null
          depth?: number
          id?: string
          name?: string
          parent_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "channel_resource_folders_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "channels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "channel_resource_folders_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "channel_resource_folders_parent_fkey"
            columns: ["parent_id", "channel_id"]
            isOneToOne: false
            referencedRelation: "channel_resource_folders"
            referencedColumns: ["id", "channel_id"]
          },
        ]
      }
      channel_resource_pins: {
        Row: {
          attachment_id: string | null
          channel_id: string
          id: string
          link_id: string | null
          pinned_at: string
          pinned_by: string | null
        }
        Insert: {
          attachment_id?: string | null
          channel_id: string
          id?: string
          link_id?: string | null
          pinned_at?: string
          pinned_by?: string | null
        }
        Update: {
          attachment_id?: string | null
          channel_id?: string
          id?: string
          link_id?: string | null
          pinned_at?: string
          pinned_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "channel_resource_pins_attachment_fkey"
            columns: ["attachment_id", "channel_id"]
            isOneToOne: false
            referencedRelation: "message_attachments"
            referencedColumns: ["id", "channel_id"]
          },
          {
            foreignKeyName: "channel_resource_pins_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "channels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "channel_resource_pins_link_fkey"
            columns: ["link_id", "channel_id"]
            isOneToOne: false
            referencedRelation: "channel_links"
            referencedColumns: ["id", "channel_id"]
          },
          {
            foreignKeyName: "channel_resource_pins_pinned_by_fkey"
            columns: ["pinned_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      channel_retired_ids: {
        Row: {
          community_id: string
          id: string
          retired_at: string
        }
        Insert: {
          community_id: string
          id: string
          retired_at?: string
        }
        Update: {
          community_id?: string
          id?: string
          retired_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "channel_retired_ids_community_id_fkey"
            columns: ["community_id"]
            isOneToOne: false
            referencedRelation: "communities"
            referencedColumns: ["id"]
          },
        ]
      }
      channel_sections: {
        Row: {
          community_id: string
          created_at: string
          created_by: string | null
          creation_key: string | null
          id: string
          name: string
          position: number
        }
        Insert: {
          community_id: string
          created_at?: string
          created_by?: string | null
          creation_key?: string | null
          id?: string
          name: string
          position?: number
        }
        Update: {
          community_id?: string
          created_at?: string
          created_by?: string | null
          creation_key?: string | null
          id?: string
          name?: string
          position?: number
        }
        Relationships: [
          {
            foreignKeyName: "channel_sections_community_id_fkey"
            columns: ["community_id"]
            isOneToOne: false
            referencedRelation: "communities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "channel_sections_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      channels: {
        Row: {
          archived_at: string | null
          community_id: string
          created_by: string | null
          creation_key: string | null
          file_sharing_enabled: boolean
          group_id: string | null
          id: string
          is_private: boolean
          local_group_id: string | null
          name: string
          position: number
          purpose: string
          read_only: boolean
          section_id: string | null
          subgroup_id: string | null
        }
        Insert: {
          archived_at?: string | null
          community_id: string
          created_by?: string | null
          creation_key?: string | null
          file_sharing_enabled?: boolean
          group_id?: string | null
          id: string
          is_private?: boolean
          local_group_id?: string | null
          name: string
          position?: number
          purpose: string
          read_only?: boolean
          section_id?: string | null
          subgroup_id?: string | null
        }
        Update: {
          archived_at?: string | null
          community_id?: string
          created_by?: string | null
          creation_key?: string | null
          file_sharing_enabled?: boolean
          group_id?: string | null
          id?: string
          is_private?: boolean
          local_group_id?: string | null
          name?: string
          position?: number
          purpose?: string
          read_only?: boolean
          section_id?: string | null
          subgroup_id?: string | null
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
            foreignKeyName: "channels_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "channels_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "channel_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "channels_local_group_fkey"
            columns: ["local_group_id", "community_id"]
            isOneToOne: false
            referencedRelation: "community_local_groups"
            referencedColumns: ["id", "community_id"]
          },
          {
            foreignKeyName: "channels_section_fkey"
            columns: ["section_id", "community_id"]
            isOneToOne: false
            referencedRelation: "channel_sections"
            referencedColumns: ["id", "community_id"]
          },
          {
            foreignKeyName: "channels_subgroup_fkey"
            columns: ["subgroup_id", "community_id"]
            isOneToOne: false
            referencedRelation: "community_subgroups"
            referencedColumns: ["id", "community_id"]
          },
        ]
      }
      collaboration_audit_log: {
        Row: {
          action: string
          actor_user_id: string | null
          collaboration_id: string
          community_id: string | null
          created_at: string
          id: number
          local_group_id: string | null
          participant_id: string | null
          sponsorship_id: string | null
          subject_user_id: string | null
        }
        Insert: {
          action: string
          actor_user_id?: string | null
          collaboration_id: string
          community_id?: string | null
          created_at?: string
          id?: never
          local_group_id?: string | null
          participant_id?: string | null
          sponsorship_id?: string | null
          subject_user_id?: string | null
        }
        Update: {
          action?: string
          actor_user_id?: string | null
          collaboration_id?: string
          community_id?: string | null
          created_at?: string
          id?: never
          local_group_id?: string | null
          participant_id?: string | null
          sponsorship_id?: string | null
          subject_user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "collaboration_audit_log_actor_user_id_fkey"
            columns: ["actor_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "collaboration_audit_log_collaboration_id_fkey"
            columns: ["collaboration_id"]
            isOneToOne: false
            referencedRelation: "collaborations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "collaboration_audit_log_participant_id_fkey"
            columns: ["participant_id"]
            isOneToOne: false
            referencedRelation: "collaboration_participants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "collaboration_audit_log_sponsorship_id_fkey"
            columns: ["sponsorship_id"]
            isOneToOne: false
            referencedRelation: "collaboration_member_sponsorships"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "collaboration_audit_log_subject_user_id_fkey"
            columns: ["subject_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      collaboration_channels: {
        Row: {
          archived_at: string | null
          collaboration_id: string
          created_at: string
          created_by_user_id: string | null
          description: string | null
          id: string
          is_default: boolean
          name: string
          position: number
          status: Database["public"]["Enums"]["collaboration_channel_status"]
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          collaboration_id: string
          created_at?: string
          created_by_user_id?: string | null
          description?: string | null
          id?: string
          is_default?: boolean
          name: string
          position?: number
          status?: Database["public"]["Enums"]["collaboration_channel_status"]
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          collaboration_id?: string
          created_at?: string
          created_by_user_id?: string | null
          description?: string | null
          id?: string
          is_default?: boolean
          name?: string
          position?: number
          status?: Database["public"]["Enums"]["collaboration_channel_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "collaboration_channels_collaboration_id_fkey"
            columns: ["collaboration_id"]
            isOneToOne: false
            referencedRelation: "collaborations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "collaboration_channels_created_by_user_id_fkey"
            columns: ["created_by_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      collaboration_document_versions: {
        Row: {
          collaboration_id: string
          content: string
          created_at: string
          created_by_user_id: string | null
          document_id: string
          id: string
          revision: number
          title: string
        }
        Insert: {
          collaboration_id: string
          content: string
          created_at?: string
          created_by_user_id?: string | null
          document_id: string
          id?: string
          revision: number
          title: string
        }
        Update: {
          collaboration_id?: string
          content?: string
          created_at?: string
          created_by_user_id?: string | null
          document_id?: string
          id?: string
          revision?: number
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "collaboration_document_versions_created_by_user_id_fkey"
            columns: ["created_by_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "collaboration_document_versions_document_fkey"
            columns: ["document_id", "collaboration_id"]
            isOneToOne: false
            referencedRelation: "collaboration_documents"
            referencedColumns: ["id", "collaboration_id"]
          },
        ]
      }
      collaboration_documents: {
        Row: {
          archived_at: string | null
          collaboration_id: string
          content: string
          created_at: string
          created_by_user_id: string | null
          id: string
          revision: number
          status: Database["public"]["Enums"]["collaboration_document_status"]
          title: string
          updated_at: string
          updated_by_user_id: string | null
        }
        Insert: {
          archived_at?: string | null
          collaboration_id: string
          content?: string
          created_at?: string
          created_by_user_id?: string | null
          id?: string
          revision?: number
          status?: Database["public"]["Enums"]["collaboration_document_status"]
          title: string
          updated_at?: string
          updated_by_user_id?: string | null
        }
        Update: {
          archived_at?: string | null
          collaboration_id?: string
          content?: string
          created_at?: string
          created_by_user_id?: string | null
          id?: string
          revision?: number
          status?: Database["public"]["Enums"]["collaboration_document_status"]
          title?: string
          updated_at?: string
          updated_by_user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "collaboration_documents_collaboration_id_fkey"
            columns: ["collaboration_id"]
            isOneToOne: false
            referencedRelation: "collaborations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "collaboration_documents_created_by_user_id_fkey"
            columns: ["created_by_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "collaboration_documents_updated_by_user_id_fkey"
            columns: ["updated_by_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      collaboration_event_organizer_consents: {
        Row: {
          collaboration_id: string
          event_id: string
          granted_at: string
          participant_id: string
        }
        Insert: {
          collaboration_id: string
          event_id: string
          granted_at?: string
          participant_id: string
        }
        Update: {
          collaboration_id?: string
          event_id?: string
          granted_at?: string
          participant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "collaboration_event_organizer_consents_event_fkey"
            columns: ["event_id", "collaboration_id"]
            isOneToOne: false
            referencedRelation: "collaboration_events"
            referencedColumns: ["id", "collaboration_id"]
          },
          {
            foreignKeyName: "collaboration_event_organizer_consents_participant_fkey"
            columns: ["participant_id", "collaboration_id"]
            isOneToOne: false
            referencedRelation: "collaboration_participants"
            referencedColumns: ["id", "collaboration_id"]
          },
        ]
      }
      collaboration_event_public_organizers: {
        Row: {
          collaboration_id: string
          created_at: string
          event_id: string
          participant_id: string
          position: number
        }
        Insert: {
          collaboration_id: string
          created_at?: string
          event_id: string
          participant_id: string
          position?: number
        }
        Update: {
          collaboration_id?: string
          created_at?: string
          event_id?: string
          participant_id?: string
          position?: number
        }
        Relationships: [
          {
            foreignKeyName: "collaboration_event_public_organizers_event_fkey"
            columns: ["event_id", "collaboration_id"]
            isOneToOne: false
            referencedRelation: "collaboration_events"
            referencedColumns: ["id", "collaboration_id"]
          },
          {
            foreignKeyName: "collaboration_event_public_organizers_participant_fkey"
            columns: ["participant_id", "collaboration_id"]
            isOneToOne: false
            referencedRelation: "collaboration_participants"
            referencedColumns: ["id", "collaboration_id"]
          },
        ]
      }
      collaboration_events: {
        Row: {
          audience: Database["public"]["Enums"]["collaboration_event_audience"]
          collaboration_id: string
          created_at: string
          created_by_user_id: string | null
          description: string | null
          ends_at: string | null
          id: string
          internal_notes: string | null
          location: string | null
          public_asset_key: string
          public_image_file_id: string | null
          registration_url: string | null
          starts_at: string | null
          status: Database["public"]["Enums"]["collaboration_event_status"]
          title: string
          updated_at: string
          updated_by_user_id: string | null
        }
        Insert: {
          audience?: Database["public"]["Enums"]["collaboration_event_audience"]
          collaboration_id: string
          created_at?: string
          created_by_user_id?: string | null
          description?: string | null
          ends_at?: string | null
          id?: string
          internal_notes?: string | null
          location?: string | null
          public_asset_key?: string
          public_image_file_id?: string | null
          registration_url?: string | null
          starts_at?: string | null
          status?: Database["public"]["Enums"]["collaboration_event_status"]
          title: string
          updated_at?: string
          updated_by_user_id?: string | null
        }
        Update: {
          audience?: Database["public"]["Enums"]["collaboration_event_audience"]
          collaboration_id?: string
          created_at?: string
          created_by_user_id?: string | null
          description?: string | null
          ends_at?: string | null
          id?: string
          internal_notes?: string | null
          location?: string | null
          public_asset_key?: string
          public_image_file_id?: string | null
          registration_url?: string | null
          starts_at?: string | null
          status?: Database["public"]["Enums"]["collaboration_event_status"]
          title?: string
          updated_at?: string
          updated_by_user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "collaboration_events_collaboration_id_fkey"
            columns: ["collaboration_id"]
            isOneToOne: false
            referencedRelation: "collaborations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "collaboration_events_created_by_user_id_fkey"
            columns: ["created_by_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "collaboration_events_public_image_fkey"
            columns: ["public_image_file_id", "collaboration_id"]
            isOneToOne: false
            referencedRelation: "collaboration_files"
            referencedColumns: ["id", "collaboration_id"]
          },
          {
            foreignKeyName: "collaboration_events_updated_by_user_id_fkey"
            columns: ["updated_by_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      collaboration_files: {
        Row: {
          archived_at: string | null
          archived_by_user_id: string | null
          collaboration_id: string
          created_at: string
          display_name: string
          id: string
          mime_type: string
          size_bytes: number
          storage_path: string
          uploaded_by_user_id: string | null
        }
        Insert: {
          archived_at?: string | null
          archived_by_user_id?: string | null
          collaboration_id: string
          created_at?: string
          display_name: string
          id: string
          mime_type: string
          size_bytes: number
          storage_path: string
          uploaded_by_user_id?: string | null
        }
        Update: {
          archived_at?: string | null
          archived_by_user_id?: string | null
          collaboration_id?: string
          created_at?: string
          display_name?: string
          id?: string
          mime_type?: string
          size_bytes?: number
          storage_path?: string
          uploaded_by_user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "collaboration_files_archived_by_user_id_fkey"
            columns: ["archived_by_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "collaboration_files_collaboration_id_fkey"
            columns: ["collaboration_id"]
            isOneToOne: false
            referencedRelation: "collaborations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "collaboration_files_uploaded_by_user_id_fkey"
            columns: ["uploaded_by_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      collaboration_manager_participants: {
        Row: {
          collaboration_id: string
          created_at: string
          granted_by_user_id: string | null
          participant_id: string
        }
        Insert: {
          collaboration_id: string
          created_at?: string
          granted_by_user_id?: string | null
          participant_id: string
        }
        Update: {
          collaboration_id?: string
          created_at?: string
          granted_by_user_id?: string | null
          participant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "collaboration_manager_participants_collaboration_id_fkey"
            columns: ["collaboration_id"]
            isOneToOne: false
            referencedRelation: "collaborations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "collaboration_manager_participants_granted_by_user_id_fkey"
            columns: ["granted_by_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "collaboration_manager_participants_participant_fkey"
            columns: ["participant_id", "collaboration_id"]
            isOneToOne: false
            referencedRelation: "collaboration_participants"
            referencedColumns: ["id", "collaboration_id"]
          },
        ]
      }
      collaboration_member_sponsorships: {
        Row: {
          collaboration_id: string
          created_at: string
          id: string
          invited_at: string
          invited_by_user_id: string | null
          participant_id: string
          responded_at: string | null
          revoked_at: string | null
          revoked_by_user_id: string | null
          status: Database["public"]["Enums"]["collaboration_sponsorship_status"]
          updated_at: string
          user_id: string
        }
        Insert: {
          collaboration_id: string
          created_at?: string
          id?: string
          invited_at?: string
          invited_by_user_id?: string | null
          participant_id: string
          responded_at?: string | null
          revoked_at?: string | null
          revoked_by_user_id?: string | null
          status?: Database["public"]["Enums"]["collaboration_sponsorship_status"]
          updated_at?: string
          user_id: string
        }
        Update: {
          collaboration_id?: string
          created_at?: string
          id?: string
          invited_at?: string
          invited_by_user_id?: string | null
          participant_id?: string
          responded_at?: string | null
          revoked_at?: string | null
          revoked_by_user_id?: string | null
          status?: Database["public"]["Enums"]["collaboration_sponsorship_status"]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "collaboration_member_sponsorships_invited_by_user_id_fkey"
            columns: ["invited_by_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "collaboration_member_sponsorships_participant_fkey"
            columns: ["participant_id", "collaboration_id"]
            isOneToOne: false
            referencedRelation: "collaboration_participants"
            referencedColumns: ["id", "collaboration_id"]
          },
          {
            foreignKeyName: "collaboration_member_sponsorships_revoked_by_user_id_fkey"
            columns: ["revoked_by_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "collaboration_member_sponsorships_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      collaboration_members: {
        Row: {
          collaboration_id: string
          joined_at: string
          left_at: string | null
          status: Database["public"]["Enums"]["collaboration_member_status"]
          user_id: string
        }
        Insert: {
          collaboration_id: string
          joined_at?: string
          left_at?: string | null
          status?: Database["public"]["Enums"]["collaboration_member_status"]
          user_id: string
        }
        Update: {
          collaboration_id?: string
          joined_at?: string
          left_at?: string | null
          status?: Database["public"]["Enums"]["collaboration_member_status"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "collaboration_members_collaboration_id_fkey"
            columns: ["collaboration_id"]
            isOneToOne: false
            referencedRelation: "collaborations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "collaboration_members_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      collaboration_messages: {
        Row: {
          author_id: string | null
          body: string
          channel_id: string
          collaboration_id: string
          created_at: string
          deleted_at: string | null
          deleted_by_user_id: string | null
          edited_at: string | null
          id: string
          parent_message_id: string | null
        }
        Insert: {
          author_id?: string | null
          body: string
          channel_id: string
          collaboration_id: string
          created_at?: string
          deleted_at?: string | null
          deleted_by_user_id?: string | null
          edited_at?: string | null
          id?: string
          parent_message_id?: string | null
        }
        Update: {
          author_id?: string | null
          body?: string
          channel_id?: string
          collaboration_id?: string
          created_at?: string
          deleted_at?: string | null
          deleted_by_user_id?: string | null
          edited_at?: string | null
          id?: string
          parent_message_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "collaboration_messages_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "collaboration_messages_channel_fkey"
            columns: ["channel_id", "collaboration_id"]
            isOneToOne: false
            referencedRelation: "collaboration_channels"
            referencedColumns: ["id", "collaboration_id"]
          },
          {
            foreignKeyName: "collaboration_messages_collaboration_id_fkey"
            columns: ["collaboration_id"]
            isOneToOne: false
            referencedRelation: "collaborations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "collaboration_messages_deleted_by_user_id_fkey"
            columns: ["deleted_by_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "collaboration_messages_parent_fkey"
            columns: ["parent_message_id", "channel_id", "collaboration_id"]
            isOneToOne: false
            referencedRelation: "collaboration_messages"
            referencedColumns: ["id", "channel_id", "collaboration_id"]
          },
        ]
      }
      collaboration_participants: {
        Row: {
          collaboration_id: string
          community_id: string
          id: string
          invited_at: string
          invited_by_user_id: string | null
          joined_at: string | null
          left_at: string | null
          left_by_user_id: string | null
          local_group_id: string | null
          responded_at: string | null
          responded_by_user_id: string | null
          status: Database["public"]["Enums"]["collaboration_participant_status"]
        }
        Insert: {
          collaboration_id: string
          community_id: string
          id?: string
          invited_at?: string
          invited_by_user_id?: string | null
          joined_at?: string | null
          left_at?: string | null
          left_by_user_id?: string | null
          local_group_id?: string | null
          responded_at?: string | null
          responded_by_user_id?: string | null
          status?: Database["public"]["Enums"]["collaboration_participant_status"]
        }
        Update: {
          collaboration_id?: string
          community_id?: string
          id?: string
          invited_at?: string
          invited_by_user_id?: string | null
          joined_at?: string | null
          left_at?: string | null
          left_by_user_id?: string | null
          local_group_id?: string | null
          responded_at?: string | null
          responded_by_user_id?: string | null
          status?: Database["public"]["Enums"]["collaboration_participant_status"]
        }
        Relationships: [
          {
            foreignKeyName: "collaboration_participants_collaboration_id_fkey"
            columns: ["collaboration_id"]
            isOneToOne: false
            referencedRelation: "collaborations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "collaboration_participants_community_id_fkey"
            columns: ["community_id"]
            isOneToOne: false
            referencedRelation: "communities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "collaboration_participants_invited_by_user_id_fkey"
            columns: ["invited_by_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "collaboration_participants_left_by_user_id_fkey"
            columns: ["left_by_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "collaboration_participants_local_group_fkey"
            columns: ["local_group_id", "community_id"]
            isOneToOne: false
            referencedRelation: "community_local_groups"
            referencedColumns: ["id", "community_id"]
          },
          {
            foreignKeyName: "collaboration_participants_responded_by_user_id_fkey"
            columns: ["responded_by_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      collaboration_profiles: {
        Row: {
          avatar_path: string | null
          bio: string | null
          collaboration_id: string
          created_at: string
          display_name: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          avatar_path?: string | null
          bio?: string | null
          collaboration_id: string
          created_at?: string
          display_name?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          avatar_path?: string | null
          bio?: string | null
          collaboration_id?: string
          created_at?: string
          display_name?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "collaboration_profiles_member_fkey"
            columns: ["collaboration_id", "user_id"]
            isOneToOne: true
            referencedRelation: "collaboration_members"
            referencedColumns: ["collaboration_id", "user_id"]
          },
        ]
      }
      collaboration_task_assignees: {
        Row: {
          assigned_by_user_id: string | null
          collaboration_id: string
          created_at: string
          task_id: string
          user_id: string
        }
        Insert: {
          assigned_by_user_id?: string | null
          collaboration_id: string
          created_at?: string
          task_id: string
          user_id: string
        }
        Update: {
          assigned_by_user_id?: string | null
          collaboration_id?: string
          created_at?: string
          task_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "collaboration_task_assignees_assigned_by_user_id_fkey"
            columns: ["assigned_by_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "collaboration_task_assignees_member_fkey"
            columns: ["collaboration_id", "user_id"]
            isOneToOne: false
            referencedRelation: "collaboration_members"
            referencedColumns: ["collaboration_id", "user_id"]
          },
          {
            foreignKeyName: "collaboration_task_assignees_task_fkey"
            columns: ["task_id", "collaboration_id"]
            isOneToOne: false
            referencedRelation: "collaboration_tasks"
            referencedColumns: ["id", "collaboration_id"]
          },
        ]
      }
      collaboration_tasks: {
        Row: {
          collaboration_id: string
          completed_at: string | null
          created_at: string
          created_by_user_id: string | null
          description: string | null
          due_on: string | null
          id: string
          related_channel_id: string | null
          related_document_id: string | null
          related_event_id: string | null
          status: Database["public"]["Enums"]["collaboration_task_status"]
          title: string
          updated_at: string
          updated_by_user_id: string | null
        }
        Insert: {
          collaboration_id: string
          completed_at?: string | null
          created_at?: string
          created_by_user_id?: string | null
          description?: string | null
          due_on?: string | null
          id?: string
          related_channel_id?: string | null
          related_document_id?: string | null
          related_event_id?: string | null
          status?: Database["public"]["Enums"]["collaboration_task_status"]
          title: string
          updated_at?: string
          updated_by_user_id?: string | null
        }
        Update: {
          collaboration_id?: string
          completed_at?: string | null
          created_at?: string
          created_by_user_id?: string | null
          description?: string | null
          due_on?: string | null
          id?: string
          related_channel_id?: string | null
          related_document_id?: string | null
          related_event_id?: string | null
          status?: Database["public"]["Enums"]["collaboration_task_status"]
          title?: string
          updated_at?: string
          updated_by_user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "collaboration_tasks_channel_fkey"
            columns: ["related_channel_id", "collaboration_id"]
            isOneToOne: false
            referencedRelation: "collaboration_channels"
            referencedColumns: ["id", "collaboration_id"]
          },
          {
            foreignKeyName: "collaboration_tasks_collaboration_id_fkey"
            columns: ["collaboration_id"]
            isOneToOne: false
            referencedRelation: "collaborations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "collaboration_tasks_created_by_user_id_fkey"
            columns: ["created_by_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "collaboration_tasks_document_fkey"
            columns: ["related_document_id", "collaboration_id"]
            isOneToOne: false
            referencedRelation: "collaboration_documents"
            referencedColumns: ["id", "collaboration_id"]
          },
          {
            foreignKeyName: "collaboration_tasks_event_fkey"
            columns: ["related_event_id", "collaboration_id"]
            isOneToOne: false
            referencedRelation: "collaboration_events"
            referencedColumns: ["id", "collaboration_id"]
          },
          {
            foreignKeyName: "collaboration_tasks_updated_by_user_id_fkey"
            columns: ["updated_by_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      collaborations: {
        Row: {
          archived_at: string | null
          created_at: string
          created_by_user_id: string | null
          default_locale: string
          description: string | null
          id: string
          name: string
          slug: string
          status: Database["public"]["Enums"]["collaboration_status"]
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          created_at?: string
          created_by_user_id?: string | null
          default_locale?: string
          description?: string | null
          id?: string
          name: string
          slug: string
          status?: Database["public"]["Enums"]["collaboration_status"]
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          created_at?: string
          created_by_user_id?: string | null
          default_locale?: string
          description?: string | null
          id?: string
          name?: string
          slug?: string
          status?: Database["public"]["Enums"]["collaboration_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "collaborations_created_by_user_id_fkey"
            columns: ["created_by_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
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
          default_locale: string
          dm_policy: Database["public"]["Enums"]["dm_policy"]
          founded_year: number
          id: string
          links: Json
          location: string
          mark_style: string
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
          default_locale?: string
          dm_policy?: Database["public"]["Enums"]["dm_policy"]
          founded_year: number
          id: string
          links?: Json
          location: string
          mark_style?: string
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
          default_locale?: string
          dm_policy?: Database["public"]["Enums"]["dm_policy"]
          founded_year?: number
          id?: string
          links?: Json
          location?: string
          mark_style?: string
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
      community_local_group_managers: {
        Row: {
          community_id: string
          created_at: string
          granted_by: string | null
          local_group_id: string
          user_id: string
        }
        Insert: {
          community_id: string
          created_at?: string
          granted_by?: string | null
          local_group_id: string
          user_id: string
        }
        Update: {
          community_id?: string
          created_at?: string
          granted_by?: string | null
          local_group_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "community_local_group_managers_granted_by_fkey"
            columns: ["granted_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "community_local_group_managers_local_group_id_community_id_fkey"
            columns: ["local_group_id", "community_id"]
            isOneToOne: false
            referencedRelation: "community_local_groups"
            referencedColumns: ["id", "community_id"]
          },
          {
            foreignKeyName: "community_local_group_managers_user_id_community_id_fkey"
            columns: ["user_id", "community_id"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["user_id", "community_id"]
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
      community_subgroup_managers: {
        Row: {
          community_id: string
          created_at: string
          subgroup_id: string
          user_id: string
        }
        Insert: {
          community_id: string
          created_at?: string
          subgroup_id: string
          user_id: string
        }
        Update: {
          community_id?: string
          created_at?: string
          subgroup_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "community_subgroup_managers_subgroup_id_community_id_fkey"
            columns: ["subgroup_id", "community_id"]
            isOneToOne: false
            referencedRelation: "community_subgroups"
            referencedColumns: ["id", "community_id"]
          },
          {
            foreignKeyName: "community_subgroup_managers_user_id_community_id_fkey"
            columns: ["user_id", "community_id"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["user_id", "community_id"]
          },
        ]
      }
      community_subgroup_members: {
        Row: {
          added_by: string | null
          community_id: string
          created_at: string
          subgroup_id: string
          user_id: string
        }
        Insert: {
          added_by?: string | null
          community_id: string
          created_at?: string
          subgroup_id: string
          user_id: string
        }
        Update: {
          added_by?: string | null
          community_id?: string
          created_at?: string
          subgroup_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "community_subgroup_members_added_by_fkey"
            columns: ["added_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "community_subgroup_members_subgroup_id_community_id_fkey"
            columns: ["subgroup_id", "community_id"]
            isOneToOne: false
            referencedRelation: "community_subgroups"
            referencedColumns: ["id", "community_id"]
          },
          {
            foreignKeyName: "community_subgroup_members_user_id_community_id_fkey"
            columns: ["user_id", "community_id"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["user_id", "community_id"]
          },
        ]
      }
      community_subgroups: {
        Row: {
          active: boolean
          community_id: string
          created_at: string
          created_by: string | null
          description: string
          id: string
          moderators_read: boolean
          name: string
          slug: string
        }
        Insert: {
          active?: boolean
          community_id: string
          created_at?: string
          created_by?: string | null
          description?: string
          id?: string
          moderators_read?: boolean
          name: string
          slug: string
        }
        Update: {
          active?: boolean
          community_id?: string
          created_at?: string
          created_by?: string | null
          description?: string
          id?: string
          moderators_read?: boolean
          name?: string
          slug?: string
        }
        Relationships: [
          {
            foreignKeyName: "community_subgroups_community_id_fkey"
            columns: ["community_id"]
            isOneToOne: false
            referencedRelation: "communities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "community_subgroups_created_by_fkey"
            columns: ["created_by"]
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
          participant_one_wrote: boolean
          participant_two_id: string
          participant_two_wrote: boolean
        }
        Insert: {
          community_id: string
          created_at?: string
          created_by?: string
          id?: string
          last_message_at?: string
          participant_one_id: string
          participant_one_wrote?: boolean
          participant_two_id: string
          participant_two_wrote?: boolean
        }
        Update: {
          community_id?: string
          created_at?: string
          created_by?: string
          id?: string
          last_message_at?: string
          participant_one_id?: string
          participant_one_wrote?: boolean
          participant_two_id?: string
          participant_two_wrote?: boolean
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
          deleted_at: string | null
          edited_at: string | null
          has_attachments: boolean
          id: string
        }
        Insert: {
          author_id?: string
          body: string
          conversation_id: string
          created_at?: string
          deleted_at?: string | null
          edited_at?: string | null
          has_attachments?: boolean
          id?: string
        }
        Update: {
          author_id?: string
          body?: string
          conversation_id?: string
          created_at?: string
          deleted_at?: string | null
          edited_at?: string | null
          has_attachments?: boolean
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
          cancelled_at: string | null
          cancelled_by: string | null
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
          subgroup_id: string | null
          title: string
        }
        Insert: {
          cancelled_at?: string | null
          cancelled_by?: string | null
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
          subgroup_id?: string | null
          title: string
        }
        Update: {
          cancelled_at?: string | null
          cancelled_by?: string | null
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
          subgroup_id?: string | null
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "events_cancelled_by_fkey"
            columns: ["cancelled_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
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
          {
            foreignKeyName: "events_subgroup_fkey"
            columns: ["subgroup_id", "community_id"]
            isOneToOne: false
            referencedRelation: "community_subgroups"
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
          onboarding_dismissed_at: string | null
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
          onboarding_dismissed_at?: string | null
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
          onboarding_dismissed_at?: string | null
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
      message_attachment_purges: {
        Row: {
          queued_at: string
          storage_path: string
        }
        Insert: {
          queued_at?: string
          storage_path: string
        }
        Update: {
          queued_at?: string
          storage_path?: string
        }
        Relationships: []
      }
      message_attachments: {
        Row: {
          attached_at: string | null
          channel_id: string | null
          community_id: string
          conversation_id: string | null
          created_at: string
          direct_message_id: string | null
          display_name: string
          height: number | null
          id: string
          message_id: string | null
          mime_type: string
          position: number
          size_bytes: number
          status: string
          storage_path: string
          thumb_path: string | null
          uploader_id: string
          width: number | null
        }
        Insert: {
          attached_at?: string | null
          channel_id?: string | null
          community_id: string
          conversation_id?: string | null
          created_at?: string
          direct_message_id?: string | null
          display_name: string
          height?: number | null
          id?: string
          message_id?: string | null
          mime_type: string
          position?: number
          size_bytes: number
          status?: string
          storage_path: string
          thumb_path?: string | null
          uploader_id: string
          width?: number | null
        }
        Update: {
          attached_at?: string | null
          channel_id?: string | null
          community_id?: string
          conversation_id?: string | null
          created_at?: string
          direct_message_id?: string | null
          display_name?: string
          height?: number | null
          id?: string
          message_id?: string | null
          mime_type?: string
          position?: number
          size_bytes?: number
          status?: string
          storage_path?: string
          thumb_path?: string | null
          uploader_id?: string
          width?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "message_attachments_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "channels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "message_attachments_community_id_fkey"
            columns: ["community_id"]
            isOneToOne: false
            referencedRelation: "communities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "message_attachments_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "direct_conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "message_attachments_direct_message_id_fkey"
            columns: ["direct_message_id"]
            isOneToOne: false
            referencedRelation: "direct_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "message_attachments_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "message_attachments_uploader_id_fkey"
            columns: ["uploader_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      message_mentions: {
        Row: {
          channel_id: string
          created_at: string
          message_id: string
          user_id: string
        }
        Insert: {
          channel_id: string
          created_at?: string
          message_id: string
          user_id: string
        }
        Update: {
          channel_id?: string
          created_at?: string
          message_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "message_mentions_message_fkey"
            columns: ["message_id", "channel_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id", "channel_id"]
          },
          {
            foreignKeyName: "message_mentions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      message_moderation_log: {
        Row: {
          action: string
          actor_id: string | null
          channel_id: string
          community_id: string
          created_at: string
          id: string
          message_id: string
        }
        Insert: {
          action: string
          actor_id?: string | null
          channel_id: string
          community_id: string
          created_at?: string
          id?: string
          message_id: string
        }
        Update: {
          action?: string
          actor_id?: string | null
          channel_id?: string
          community_id?: string
          created_at?: string
          id?: string
          message_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "message_moderation_log_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "message_moderation_log_community_id_fkey"
            columns: ["community_id"]
            isOneToOne: false
            referencedRelation: "communities"
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
          deleted_at: string | null
          edited_at: string | null
          id: string
          reactions: Json
          removed_by_moderator: boolean
        }
        Insert: {
          attachment?: Json | null
          author_id?: string
          body: string
          channel_id: string
          created_at?: string
          deleted_at?: string | null
          edited_at?: string | null
          id?: string
          reactions?: Json
          removed_by_moderator?: boolean
        }
        Update: {
          attachment?: Json | null
          author_id?: string
          body?: string
          channel_id?: string
          created_at?: string
          deleted_at?: string | null
          edited_at?: string | null
          id?: string
          reactions?: Json
          removed_by_moderator?: boolean
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
          event_id: string | null
          href: string
          id: string
          kind: Database["public"]["Enums"]["notification_kind"]
          message_id: string | null
          post_id: string | null
          read: boolean
          title: string
          user_id: string
        }
        Insert: {
          body: string
          community_id?: string | null
          created_at?: string
          event_id?: string | null
          href: string
          id?: string
          kind: Database["public"]["Enums"]["notification_kind"]
          message_id?: string | null
          post_id?: string | null
          read?: boolean
          title: string
          user_id: string
        }
        Update: {
          body?: string
          community_id?: string | null
          created_at?: string
          event_id?: string | null
          href?: string
          id?: string
          kind?: Database["public"]["Enums"]["notification_kind"]
          message_id?: string | null
          post_id?: string | null
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
            foreignKeyName: "notifications_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "posts"
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
          subgroup_id: string | null
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
          subgroup_id?: string | null
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
          subgroup_id?: string | null
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
          {
            foreignKeyName: "posts_subgroup_fkey"
            columns: ["subgroup_id", "community_id"]
            isOneToOne: false
            referencedRelation: "community_subgroups"
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
      published_collaboration_events: {
        Row: {
          audience: Database["public"]["Enums"]["collaboration_event_audience"]
          collaboration_id: string
          description: string | null
          ends_at: string | null
          first_published_at: string
          id: string
          is_cancelled: boolean
          locale: string
          location: string | null
          organizers: Json
          public_image_path: string | null
          public_image_source_file_id: string | null
          public_slug: string
          published_at: string
          published_by_user_id: string | null
          registration_url: string | null
          source_event_id: string
          starts_at: string
          status: Database["public"]["Enums"]["collaboration_publication_status"]
          title: string
          unpublished_at: string | null
          unpublished_by_user_id: string | null
          updated_at: string
        }
        Insert: {
          audience: Database["public"]["Enums"]["collaboration_event_audience"]
          collaboration_id: string
          description?: string | null
          ends_at?: string | null
          first_published_at?: string
          id?: string
          is_cancelled?: boolean
          locale: string
          location?: string | null
          organizers?: Json
          public_image_path?: string | null
          public_image_source_file_id?: string | null
          public_slug: string
          published_at?: string
          published_by_user_id?: string | null
          registration_url?: string | null
          source_event_id: string
          starts_at: string
          status?: Database["public"]["Enums"]["collaboration_publication_status"]
          title: string
          unpublished_at?: string | null
          unpublished_by_user_id?: string | null
          updated_at?: string
        }
        Update: {
          audience?: Database["public"]["Enums"]["collaboration_event_audience"]
          collaboration_id?: string
          description?: string | null
          ends_at?: string | null
          first_published_at?: string
          id?: string
          is_cancelled?: boolean
          locale?: string
          location?: string | null
          organizers?: Json
          public_image_path?: string | null
          public_image_source_file_id?: string | null
          public_slug?: string
          published_at?: string
          published_by_user_id?: string | null
          registration_url?: string | null
          source_event_id?: string
          starts_at?: string
          status?: Database["public"]["Enums"]["collaboration_publication_status"]
          title?: string
          unpublished_at?: string | null
          unpublished_by_user_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "published_collaboration_events_published_by_user_id_fkey"
            columns: ["published_by_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "published_collaboration_events_source_fkey"
            columns: ["source_event_id", "collaboration_id"]
            isOneToOne: false
            referencedRelation: "collaboration_events"
            referencedColumns: ["id", "collaboration_id"]
          },
          {
            foreignKeyName: "published_collaboration_events_unpublished_by_user_id_fkey"
            columns: ["unpublished_by_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      accept_collaboration_participant_invite: {
        Args: { p_local_group_id: string; p_participant_id: string }
        Returns: boolean
      }
      accept_collaboration_sponsorship_and_join: {
        Args: { p_sponsorship_id: string }
        Returns: boolean
      }
      accept_invitation_token: {
        Args: { p_token: string }
        Returns: {
          community_id: string
          ok: boolean
          reason: string
        }[]
      }
      accept_invitation_token_for_account: {
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
      account_has_password: { Args: { p_user_id: string }; Returns: boolean }
      add_channel_link: {
        Args: {
          p_channel_id: string
          p_description: string
          p_folder_id: string
          p_title: string
          p_url: string
        }
        Returns: string
      }
      add_local_group_manager: {
        Args: { p_local_group_id: string; p_user_id: string }
        Returns: boolean
      }
      add_private_channel_participant: {
        Args: { p_channel_id: string; p_user_id: string }
        Returns: boolean
      }
      add_subgroup_member: {
        Args: { p_subgroup_id: string; p_user_id: string }
        Returns: boolean
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
      arm_email_change: { Args: never; Returns: boolean }
      authorize_email_change: { Args: { p_new_email: string }; Returns: string }
      authorize_password_change: { Args: never; Returns: boolean }
      begin_message_attachment: {
        Args: {
          p_channel_id: string
          p_conversation_id: string
          p_display_name: string
          p_height?: number
          p_mime_type: string
          p_size_bytes: number
          p_width?: number
        }
        Returns: {
          attachment_id: string
          storage_path: string
        }[]
      }
      begin_password_attempt: {
        Args: { p_email: string; p_ip: string }
        Returns: number
      }
      can_access_channel_row: {
        Args: {
          p_channel_id: string
          p_community_id: string
          p_is_private: boolean
          p_local_group_id: string
          p_subgroup_id: string
        }
        Returns: boolean
      }
      can_access_post: { Args: { pid: string }; Returns: boolean }
      can_access_subgroup: { Args: { p_subgroup_id: string }; Returns: boolean }
      can_create_event: {
        Args: {
          p_community_id: string
          p_local_group_id: string
          p_subgroup_id: string
        }
        Returns: boolean
      }
      can_create_private_channel: {
        Args: { p_local_group_id: string }
        Returns: boolean
      }
      can_create_subgroup: {
        Args: { p_community_id: string }
        Returns: boolean
      }
      can_delete_event: { Args: { p_event_id: string }; Returns: boolean }
      can_discard_collaboration_file_object: {
        Args: { p_name: string }
        Returns: boolean
      }
      can_lead_local_group: {
        Args: { p_local_group_id: string }
        Returns: boolean
      }
      can_manage_event: { Args: { p_event_id: string }; Returns: boolean }
      can_manage_private_channel: {
        Args: { p_channel_id: string }
        Returns: boolean
      }
      can_manage_subgroup: { Args: { p_subgroup_id: string }; Returns: boolean }
      can_moderate: { Args: { cid: string }; Returns: boolean }
      can_moderate_channel_messages: {
        Args: { p_channel_id: string }
        Returns: boolean
      }
      can_moderate_post: { Args: { pid: string }; Returns: boolean }
      can_read_channel: { Args: { chid: string }; Returns: boolean }
      can_read_collaboration_file_object: {
        Args: { p_name: string }
        Returns: boolean
      }
      can_read_content_scope: {
        Args: {
          p_community_id: string
          p_local_group_id: string
          p_subgroup_id: string
        }
        Returns: boolean
      }
      can_read_event: { Args: { p_event_id: string }; Returns: boolean }
      can_read_member_avatar_object: {
        Args: { p_name: string }
        Returns: boolean
      }
      can_read_message_attachment: {
        Args: {
          p_channel_id: string
          p_conversation_id: string
          p_status: string
          p_uploader_id: string
        }
        Returns: boolean
      }
      can_read_message_attachment_object: {
        Args: { p_name: string }
        Returns: boolean
      }
      can_read_notified_message: {
        Args: { p_message_id: string }
        Returns: boolean
      }
      can_reply_direct_conversation: {
        Args: { p_conversation_id: string }
        Returns: boolean
      }
      can_represent_collaboration_unit: {
        Args: {
          p_community_id: string
          p_local_group_id: string
          p_user_id: string
        }
        Returns: boolean
      }
      can_see_rsvp: {
        Args: { p_attendee_id: string; p_event_id: string }
        Returns: boolean
      }
      can_send_dm: {
        Args: { cid: string; recipient: string }
        Returns: boolean
      }
      can_upload_collaboration_file_object: {
        Args: { p_name: string }
        Returns: boolean
      }
      can_upload_published_event_image: {
        Args: { p_name: string }
        Returns: boolean
      }
      can_view_collaboration: {
        Args: { p_collaboration_id: string }
        Returns: boolean
      }
      can_view_collaboration_author: {
        Args: { p_collaboration_id: string; p_user_id: string }
        Returns: boolean
      }
      can_view_collaboration_member: {
        Args: { p_collaboration_id: string; p_user_id: string }
        Returns: boolean
      }
      can_view_collaboration_participant: {
        Args: { p_participant_id: string }
        Returns: boolean
      }
      can_view_community_identity: {
        Args: { p_community_id: string; p_user_id: string }
        Returns: boolean
      }
      can_view_community_profile: {
        Args: { p_community_id: string; p_user_id: string }
        Returns: boolean
      }
      can_view_event_roster: { Args: { p_event_id: string }; Returns: boolean }
      can_view_member_directory: { Args: { cid: string }; Returns: boolean }
      cancel_email_change: { Args: never; Returns: boolean }
      cancel_event: { Args: { p_event_id: string }; Returns: string }
      channel_accepts_messages: { Args: { chid: string }; Returns: boolean }
      channel_access_admits: {
        Args: {
          p_channel_id: string
          p_community_id: string
          p_is_private: boolean
          p_local_group_id: string
          p_subgroup_id: string
          p_user_id: string
        }
        Returns: boolean
      }
      channel_link_url_valid: { Args: { p_url: string }; Returns: boolean }
      channel_message_moderate_admits: {
        Args: { p_channel_id: string; p_user_id: string }
        Returns: boolean
      }
      channel_person_card: {
        Args: { p_channel_id: string; p_user_id: string }
        Returns: {
          avatar_version: string
          bio: string
          display_name: string
          user_id: string
        }[]
      }
      channel_resource_contributors: {
        Args: { p_channel_id: string }
        Returns: {
          contributor_id: string
          resource_count: number
        }[]
      }
      channel_resource_folders: {
        Args: { p_channel_id: string }
        Returns: {
          created_at: string
          created_by: string
          depth: number
          id: string
          name: string
          parent_id: string
          resource_count: number
        }[]
      }
      channel_resource_permissions: {
        Args: { p_channel_id: string }
        Returns: {
          can_configure_uploads: boolean
          can_contribute: boolean
          can_manage: boolean
          can_read: boolean
        }[]
      }
      channel_resource_rights: {
        Args: { p_channel_id: string; p_user_id: string }
        Returns: {
          archived: boolean
          can_contribute: boolean
          can_manage: boolean
          can_read: boolean
        }[]
      }
      channel_resource_summary: {
        Args: { p_channel_id: string }
        Returns: {
          file_count: number
          folder_count: number
          link_count: number
          pin_count: number
        }[]
      }
      channel_resources: {
        Args: {
          p_after_id?: string
          p_after_key?: string
          p_channel_id: string
          p_contributor?: string
          p_folder?: string
          p_kind?: string
          p_limit?: number
          p_pinned?: boolean
          p_search?: string
          p_sort?: string
        }
        Returns: {
          community_id: string
          contributor_id: string
          created_at: string
          description: string
          folder_id: string
          has_thumbnail: boolean
          height: number
          id: string
          message_id: string
          mime_type: string
          name: string
          pinned_at: string
          resource_type: string
          size_bytes: number
          sort_key: string
          url: string
          width: number
        }[]
      }
      claim_message_attachments: {
        Args: {
          p_attachment_ids: string[]
          p_channel_id: string
          p_conversation_id: string
          p_max_bytes: number
          p_max_files: number
          p_user_id: string
        }
        Returns: string[]
      }
      collaboration_assignees_valid: {
        Args: {
          p_assignee_ids: string[]
          p_collaboration_id: string
          p_keep: string[]
        }
        Returns: boolean
      }
      collaboration_can_contribute: {
        Args: { p_collaboration_id: string }
        Returns: boolean
      }
      collaboration_enrol_representative: {
        Args: { p_collaboration_id: string; p_participant_id: string }
        Returns: undefined
      }
      collaboration_event_fields_valid: {
        Args: {
          p_description: string
          p_ends_at: string
          p_internal_notes: string
          p_location: string
          p_registration_url: string
          p_starts_at: string
          p_title: string
        }
        Returns: boolean
      }
      collaboration_file_object_collaboration: {
        Args: { p_name: string }
        Returns: string
      }
      collaboration_has_valid_sponsorship: {
        Args: { p_collaboration_id: string; p_user_id: string }
        Returns: boolean
      }
      collaboration_log: {
        Args: {
          p_action: string
          p_collaboration_id: string
          p_participant_id?: string
          p_sponsorship_id?: string
          p_subject_user_id?: string
        }
        Returns: undefined
      }
      collaboration_organizer_request: {
        Args: { p_event_id: string; p_participant_id: string }
        Returns: Record<string, unknown>
      }
      collaboration_participant_in_force: {
        Args: { p_participant_id: string }
        Returns: boolean
      }
      collaboration_sponsored_team_state: {
        Args: { p_sponsorship_id: string }
        Returns: string
      }
      collaboration_task_links_valid: {
        Args: {
          p_channel_id: string
          p_collaboration_id: string
          p_document_id: string
          p_event_id: string
        }
        Returns: boolean
      }
      collaboration_unit_includes: {
        Args: {
          p_community_id: string
          p_local_group_id: string
          p_user_id: string
        }
        Returns: boolean
      }
      collaboration_unit_is_valid: {
        Args: { p_community_id: string; p_local_group_id: string }
        Returns: boolean
      }
      collaboration_units: {
        Args: { p_collaboration_id: string }
        Returns: {
          accent: string
          community_id: string
          community_name: string
          local_group_id: string
          local_group_name: string
          mark_style: string
          monogram: string
          participant_id: string
          represented: boolean
          status: Database["public"]["Enums"]["collaboration_participant_status"]
        }[]
      }
      collaboration_user_contributed: {
        Args: { p_collaboration_id: string; p_user_id: string }
        Returns: boolean
      }
      collaboration_user_has_access: {
        Args: { p_collaboration_id: string; p_user_id: string }
        Returns: boolean
      }
      community_channel_content_counts: {
        Args: { p_channel_id: string }
        Returns: {
          attachment_count: number
          folder_count: number
          link_count: number
          message_count: number
        }[]
      }
      community_channel_id: {
        Args: { p_community_id: string; p_name: string }
        Returns: string
      }
      community_identities: {
        Args: { p_community_id: string; p_user_ids: string[] }
        Returns: {
          avatar_version: string
          display_name: string
          user_id: string
        }[]
      }
      community_identity_admits: {
        Args: { p_community_id: string; p_user_id: string; p_viewer: string }
        Returns: boolean
      }
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
      complete_message_attachment: {
        Args: { p_attachment_id: string }
        Returns: boolean
      }
      content_scope_admits: {
        Args: {
          p_community_id: string
          p_local_group_id: string
          p_subgroup_id: string
          p_user_id: string
        }
        Returns: boolean
      }
      create_channel_resource_folder: {
        Args: { p_channel_id: string; p_name: string; p_parent_id: string }
        Returns: string
      }
      create_channel_section: {
        Args: { p_community_id: string; p_creation_key: string; p_name: string }
        Returns: string
      }
      create_collaboration: {
        Args: {
          p_description: string
          p_name: string
          p_slug: string
          p_source_community_id: string
          p_source_local_group_id: string
        }
        Returns: string
      }
      create_collaboration_channel: {
        Args: {
          p_collaboration_id: string
          p_description: string
          p_name: string
        }
        Returns: string
      }
      create_collaboration_document: {
        Args: { p_collaboration_id: string; p_content: string; p_title: string }
        Returns: string
      }
      create_collaboration_event: {
        Args: {
          p_audience: Database["public"]["Enums"]["collaboration_event_audience"]
          p_collaboration_id: string
          p_description: string
          p_ends_at: string
          p_internal_notes: string
          p_location: string
          p_registration_url: string
          p_starts_at: string
          p_status: Database["public"]["Enums"]["collaboration_event_status"]
          p_title: string
        }
        Returns: string
      }
      create_collaboration_task: {
        Args: {
          p_assignee_ids: string[]
          p_collaboration_id: string
          p_description: string
          p_due_on: string
          p_related_channel_id: string
          p_related_document_id: string
          p_related_event_id: string
          p_title: string
        }
        Returns: string
      }
      create_community_channel: {
        Args: {
          p_community_id: string
          p_creation_key: string
          p_file_sharing: boolean
          p_name: string
          p_purpose: string
          p_read_only: boolean
          p_section_id: string
        }
        Returns: string
      }
      create_local_group: {
        Args: { p_community_id: string; p_name: string }
        Returns: string
      }
      create_private_channel: {
        Args: {
          p_local_group_id: string
          p_name: string
          p_participant_ids: string[]
          p_purpose: string
        }
        Returns: string
      }
      create_subgroup: {
        Args: {
          p_community_id: string
          p_description: string
          p_member_ids: string[]
          p_name: string
        }
        Returns: string
      }
      decline_collaboration_participant_invite: {
        Args: { p_participant_id: string }
        Returns: boolean
      }
      delete_channel_link: { Args: { p_link_id: string }; Returns: boolean }
      delete_channel_message: {
        Args: { p_message_id: string }
        Returns: string
      }
      delete_channel_resource_folder: {
        Args: { p_folder_id: string }
        Returns: number
      }
      delete_channel_section: {
        Args: { p_channels_to: string; p_section_id: string }
        Returns: boolean
      }
      delete_collaboration_message: {
        Args: { p_message_id: string }
        Returns: boolean
      }
      delete_community_channel: {
        Args: { p_channel_id: string; p_confirm_name: string }
        Returns: boolean
      }
      delete_direct_message: { Args: { p_message_id: string }; Returns: string }
      delete_private_channel: {
        Args: { p_channel_id: string }
        Returns: boolean
      }
      delete_subgroup: { Args: { p_subgroup_id: string }; Returns: boolean }
      direct_member_dm_actions: {
        Args: { p_community_id: string }
        Returns: {
          conversation_id: string
          user_id: string
        }[]
      }
      direct_message_requote_notification: {
        Args: {
          p_message: Database["public"]["Tables"]["direct_messages"]["Row"]
          p_new_quote: string
          p_old_body: string
        }
        Returns: undefined
      }
      direct_unread_count: { Args: { p_community_id: string }; Returns: number }
      discard_message_attachment: {
        Args: { p_attachment_id: string }
        Returns: boolean
      }
      dismiss_my_onboarding: {
        Args: { p_community_id: string }
        Returns: boolean
      }
      edit_channel_message: {
        Args: { p_body: string; p_message_id: string }
        Returns: {
          attachment: Json | null
          author_id: string
          body: string
          channel_id: string
          created_at: string
          deleted_at: string | null
          edited_at: string | null
          id: string
          reactions: Json
          removed_by_moderator: boolean
        }
        SetofOptions: {
          from: "*"
          to: "messages"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      edit_collaboration_message: {
        Args: { p_body: string; p_message_id: string }
        Returns: boolean
      }
      edit_direct_message: {
        Args: { p_body: string; p_message_id: string }
        Returns: {
          author_id: string
          body: string
          conversation_id: string
          created_at: string
          deleted_at: string | null
          edited_at: string | null
          has_attachments: boolean
          id: string
        }
        SetofOptions: {
          from: "*"
          to: "direct_messages"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      email_change_cooldown: { Args: never; Returns: string }
      emoji_matches_post: {
        Args: { eid: string; pid: string }
        Returns: boolean
      }
      ensure_community_profile: {
        Args: { p_community_id: string; p_user_id: string }
        Returns: undefined
      }
      ensure_local_group_channel: {
        Args: { p_local_group_id: string }
        Returns: string
      }
      ensure_subgroup_channel: {
        Args: { p_subgroup_id: string }
        Returns: string
      }
      event_attendance: {
        Args: { p_event_ids: string[] }
        Returns: {
          attendee_count: number
          attending: boolean
          event_id: string
        }[]
      }
      event_attendee_roster: {
        Args: { p_event_id: string }
        Returns: {
          avatar_path: string
          display_name: string
          user_id: string
        }[]
      }
      event_open_for_rsvp: { Args: { p_event_id: string }; Returns: boolean }
      finish_password_attempt: {
        Args: { p_email: string; p_ip: string; p_valid: boolean }
        Returns: undefined
      }
      has_collaboration_access: {
        Args: { p_collaboration_id: string }
        Returns: boolean
      }
      has_membership_row: { Args: { cid: string }; Returns: boolean }
      has_pending_access_request: { Args: { p_slug: string }; Returns: boolean }
      hash_invitation_token: { Args: { p_token: string }; Returns: string }
      inbox_proven_recently: { Args: never; Returns: boolean }
      invitation_lifetime: { Args: never; Returns: string }
      invitation_preview: {
        Args: { p_token: string }
        Returns: {
          auto_activate: boolean
          community_default_locale: string
          community_id: string
          community_name: string
          community_slug: string
          email: string
          expires_at: string
        }[]
      }
      invite_collaboration_member: {
        Args: {
          p_collaboration_id: string
          p_participant_id: string
          p_target_user_id: string
        }
        Returns: string
      }
      invite_collaboration_participant: {
        Args: { p_collaboration_id: string; p_community_id: string }
        Returns: string
      }
      invite_collaboration_participant_by_slug: {
        Args: { p_collaboration_id: string; p_slug: string }
        Returns: Record<string, unknown>
      }
      is_admin: { Args: { cid: string }; Returns: boolean }
      is_collaboration_manager: {
        Args: { p_collaboration_id: string }
        Returns: boolean
      }
      is_direct_conversation_participant: {
        Args: { p_conversation_id: string; p_user_id?: string }
        Returns: boolean
      }
      is_member: { Args: { cid: string }; Returns: boolean }
      join_collaboration: {
        Args: { p_collaboration_id: string }
        Returns: boolean
      }
      leave_collaboration: {
        Args: { p_collaboration_id: string }
        Returns: boolean
      }
      leave_collaboration_as_participant: {
        Args: { p_participant_id: string }
        Returns: boolean
      }
      local_group_channel_name: { Args: { p_name: string }; Returns: string }
      local_group_manage_admits: {
        Args: { p_local_group_id: string; p_user_id: string }
        Returns: boolean
      }
      local_group_member_counts: {
        Args: { p_community_id: string }
        Returns: {
          local_group_id: string
          member_count: number
        }[]
      }
      local_group_slug: { Args: { p_name: string }; Returns: string }
      lock_channel_layout: {
        Args: { p_community_id: string }
        Returns: undefined
      }
      looks_like_email: { Args: { p_email: string }; Returns: boolean }
      manages_collaboration_workspace: {
        Args: { p_collaboration_id: string }
        Returns: boolean
      }
      mark_direct_conversation_read: {
        Args: { p_conversation_id: string }
        Returns: boolean
      }
      mark_notifications_read: { Args: never; Returns: undefined }
      mention_target_admits: {
        Args: { p_channel_id: string; p_user_id: string }
        Returns: boolean
      }
      message_attachment_extension: {
        Args: { p_mime_type: string }
        Returns: string
      }
      message_attachment_library_kind: {
        Args: { p_mime_type: string }
        Returns: string
      }
      message_attachment_policy: {
        Args: { p_channel_id?: string; p_conversation_id?: string }
        Returns: {
          allowed: boolean
          community_id: string
          max_bytes: number
          max_files: number
          reason: string
        }[]
      }
      message_attachment_policy_for: {
        Args: {
          p_channel_id: string
          p_conversation_id: string
          p_user_id: string
        }
        Returns: {
          allowed: boolean
          community_id: string
          max_bytes: number
          max_files: number
          reason: string
        }[]
      }
      message_attachment_storage_read_allowed: { Args: never; Returns: boolean }
      message_mention_ids: { Args: { p_body: string }; Returns: string[] }
      move_channel_resource: {
        Args: { p_folder_id: string; p_id: string; p_type: string }
        Returns: boolean
      }
      move_channel_section: {
        Args: { p_position: number; p_section_id: string }
        Returns: boolean
      }
      move_community_channel: {
        Args: { p_channel_id: string; p_position: number; p_section_id: string }
        Returns: boolean
      }
      my_accepts_member_dms: {
        Args: { p_community_id: string }
        Returns: boolean
      }
      my_onboarding_visible: {
        Args: { p_community_id: string }
        Returns: boolean
      }
      normalize_channel_name: { Args: { p_name: string }; Returns: string }
      normalize_display_name: { Args: { p_value: string }; Returns: string }
      normalize_email: { Args: { p_email: string }; Returns: string }
      notify_event_attendees: {
        Args: { p_cancelled: boolean; p_event_id: string }
        Returns: undefined
      }
      organization_person_dm_actions: {
        Args: { p_community_id: string }
        Returns: {
          conversation_id: string
          person_id: string
        }[]
      }
      organization_person_profile_links: {
        Args: { p_community_id: string }
        Returns: {
          person_id: string
          user_id: string
        }[]
      }
      own_organization_person_ids: {
        Args: { p_community_id: string }
        Returns: string[]
      }
      password_proven_recently: { Args: never; Returns: boolean }
      password_throttle_key: { Args: { p_email: string }; Returns: string }
      portal_by_slug: {
        Args: { p_slug: string }
        Returns: {
          accent: string
          accent_soft: string
          access_policy: Database["public"]["Enums"]["access_policy"]
          default_locale: string
          founded_year: number
          id: string
          links: Json
          location: string
          mark_style: string
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
      post_collaboration_message: {
        Args: {
          p_body: string
          p_channel_id: string
          p_parent_message_id: string
        }
        Returns: string
      }
      private_channel_access_admits: {
        Args: {
          p_channel_id: string
          p_community_id: string
          p_local_group_id: string
          p_user_id: string
        }
        Returns: boolean
      }
      private_channel_create_admits: {
        Args: { p_local_group_id: string; p_user_id: string }
        Returns: boolean
      }
      private_channel_manage_admits: {
        Args: { p_channel_id: string; p_user_id: string }
        Returns: boolean
      }
      private_channel_roster: {
        Args: { p_channel_id: string }
        Returns: {
          added_at: string
          display_name: string
          is_leader: boolean
          is_manager: boolean
          user_id: string
        }[]
      }
      publish_collaboration_event: {
        Args: { p_event_id: string; p_image_path: string }
        Returns: string
      }
      published_event_by_slug: {
        Args: { p_slug: string }
        Returns: Record<string, unknown>
      }
      published_event_image_is_public: {
        Args: { p_name: string }
        Returns: boolean
      }
      register_collaboration_file: {
        Args: {
          p_collaboration_id: string
          p_display_name: string
          p_file_id: string
          p_mime_type: string
        }
        Returns: string
      }
      reject_access_request: {
        Args: { p_request_id: string }
        Returns: boolean
      }
      remove_collaboration_file: {
        Args: { p_file_id: string }
        Returns: boolean
      }
      remove_event_attendee: {
        Args: { p_event_id: string; p_user_id: string }
        Returns: string
      }
      remove_local_group_manager: {
        Args: { p_local_group_id: string; p_user_id: string }
        Returns: boolean
      }
      remove_private_channel_participant: {
        Args: { p_channel_id: string; p_user_id: string }
        Returns: boolean
      }
      remove_subgroup_member: {
        Args: { p_subgroup_id: string; p_user_id: string }
        Returns: boolean
      }
      rename_channel_resource_folder: {
        Args: { p_folder_id: string; p_name: string }
        Returns: boolean
      }
      rename_channel_section: {
        Args: { p_name: string; p_section_id: string }
        Returns: boolean
      }
      rename_local_group: {
        Args: { p_local_group_id: string; p_name: string }
        Returns: boolean
      }
      renumber_channel_sections: {
        Args: { p_community_id: string }
        Returns: undefined
      }
      renumber_community_channels: {
        Args: { p_community_id: string; p_section_id: string }
        Returns: undefined
      }
      represents_collaboration_participant: {
        Args: { p_participant_id: string }
        Returns: boolean
      }
      request_community_access: {
        Args: { p_display_name?: string; p_email: string; p_slug: string }
        Returns: boolean
      }
      require_channel_resource_rights: {
        Args: { p_channel_id: string; p_manage: boolean; p_owner: string }
        Returns: undefined
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
      respond_to_collaboration_sponsorship: {
        Args: { p_accept: boolean; p_sponsorship_id: string }
        Returns: boolean
      }
      restore_event: { Args: { p_event_id: string }; Returns: string }
      revoke_collaboration_sponsorship: {
        Args: { p_sponsorship_id: string }
        Returns: boolean
      }
      rsvp_is_current: {
        Args: { p_event_id: string; p_user_id: string }
        Returns: boolean
      }
      save_collaboration_document: {
        Args: {
          p_content: string
          p_document_id: string
          p_expected_revision: number
          p_title: string
        }
        Returns: Record<string, unknown>
      }
      search_channel_mention_candidates: {
        Args: { p_channel_id: string; p_query: string }
        Returns: {
          avatar_version: string
          display_name: string
          user_id: string
        }[]
      }
      search_new_subgroup_candidates: {
        Args: { p_community_id: string; p_query: string }
        Returns: {
          display_name: string
          user_id: string
        }[]
      }
      search_private_channel_candidates: {
        Args: {
          p_channel_id: string
          p_local_group_id: string
          p_query: string
        }
        Returns: {
          display_name: string
          user_id: string
        }[]
      }
      search_subgroup_candidates: {
        Args: { p_query: string; p_subgroup_id: string }
        Returns: {
          display_name: string
          user_id: string
        }[]
      }
      send_channel_message_with_attachments: {
        Args: {
          p_attachment_ids: string[]
          p_body: string
          p_channel_id: string
        }
        Returns: string
      }
      send_direct_message_with_attachments: {
        Args: {
          p_attachment_ids: string[]
          p_body: string
          p_conversation_id: string
        }
        Returns: string
      }
      session_proved_within: {
        Args: { p_methods: string[]; p_window: string }
        Returns: boolean
      }
      set_accepts_member_dms: {
        Args: { p_community_id: string; p_value: boolean }
        Returns: boolean
      }
      set_channel_details: {
        Args: {
          p_channel_id: string
          p_community_id: string
          p_name: string
          p_purpose: string
        }
        Returns: {
          name: string
          purpose: string
        }[]
      }
      set_channel_file_sharing: {
        Args: { p_channel_id: string; p_enabled: boolean }
        Returns: boolean
      }
      set_channel_message_pinned: {
        Args: { p_message_id: string; p_pinned: boolean }
        Returns: boolean
      }
      set_channel_resource_pinned: {
        Args: { p_id: string; p_pinned: boolean; p_type: string }
        Returns: boolean
      }
      set_collaboration_channel_status: {
        Args: {
          p_channel_id: string
          p_status: Database["public"]["Enums"]["collaboration_channel_status"]
        }
        Returns: boolean
      }
      set_collaboration_document_status: {
        Args: {
          p_document_id: string
          p_status: Database["public"]["Enums"]["collaboration_document_status"]
        }
        Returns: boolean
      }
      set_collaboration_event_image: {
        Args: { p_event_id: string; p_file_id: string }
        Returns: boolean
      }
      set_collaboration_event_organizer_consent: {
        Args: {
          p_consent: boolean
          p_event_id: string
          p_participant_id: string
        }
        Returns: boolean
      }
      set_collaboration_event_organizers: {
        Args: { p_event_id: string; p_participant_ids: string[] }
        Returns: boolean
      }
      set_collaboration_task_assignees: {
        Args: { p_assignee_ids: string[]; p_task_id: string }
        Returns: boolean
      }
      set_collaboration_task_status: {
        Args: {
          p_status: Database["public"]["Enums"]["collaboration_task_status"]
          p_task_id: string
        }
        Returns: boolean
      }
      set_community_about: {
        Args: { p_about: string; p_community_id: string }
        Returns: string
      }
      set_community_avatar: {
        Args: { p_community_id: string; p_path: string }
        Returns: {
          applied: boolean
          previous_path: string
        }[]
      }
      set_community_channel_archived: {
        Args: { p_archived: boolean; p_channel_id: string }
        Returns: boolean
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
      set_private_channel_archived: {
        Args: { p_archived: boolean; p_channel_id: string }
        Returns: boolean
      }
      set_private_channel_manager: {
        Args: { p_channel_id: string; p_is_manager: boolean; p_user_id: string }
        Returns: boolean
      }
      set_subgroup_archived: {
        Args: { p_archived: boolean; p_subgroup_id: string }
        Returns: boolean
      }
      set_subgroup_details: {
        Args: { p_description: string; p_name: string; p_subgroup_id: string }
        Returns: boolean
      }
      set_subgroup_manager: {
        Args: {
          p_is_manager: boolean
          p_subgroup_id: string
          p_user_id: string
        }
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
      subgroup_access_admits: {
        Args: { p_subgroup_id: string; p_user_id: string }
        Returns: boolean
      }
      subgroup_channel_purpose: {
        Args: { p_description: string; p_moderators_read: boolean }
        Returns: string
      }
      subgroup_content_counts: {
        Args: { p_subgroup_id: string }
        Returns: {
          event_count: number
          post_count: number
        }[]
      }
      subgroup_create_admits: {
        Args: { p_community_id: string; p_user_id: string }
        Returns: boolean
      }
      subgroup_manage_admits: {
        Args: { p_subgroup_id: string; p_user_id: string }
        Returns: boolean
      }
      subgroup_roster: {
        Args: { p_subgroup_id: string }
        Returns: {
          added_at: string
          display_name: string
          is_manager: boolean
          role: Database["public"]["Enums"]["community_role"]
          user_id: string
        }[]
      }
      sweep_abandoned_message_attachments: {
        Args: { p_older_than?: string }
        Returns: number
      }
      unpublish_collaboration_event: {
        Args: { p_event_id: string }
        Returns: boolean
      }
      update_channel_link: {
        Args: {
          p_description: string
          p_link_id: string
          p_title: string
          p_url: string
        }
        Returns: boolean
      }
      update_collaboration_channel: {
        Args: { p_channel_id: string; p_description: string; p_name: string }
        Returns: boolean
      }
      update_collaboration_event: {
        Args: {
          p_audience: Database["public"]["Enums"]["collaboration_event_audience"]
          p_description: string
          p_ends_at: string
          p_event_id: string
          p_internal_notes: string
          p_location: string
          p_registration_url: string
          p_starts_at: string
          p_status: Database["public"]["Enums"]["collaboration_event_status"]
          p_title: string
        }
        Returns: boolean
      }
      update_collaboration_task: {
        Args: {
          p_description: string
          p_due_on: string
          p_related_channel_id: string
          p_related_document_id: string
          p_related_event_id: string
          p_task_id: string
          p_title: string
        }
        Returns: boolean
      }
      update_community_channel: {
        Args: {
          p_channel_id: string
          p_file_sharing: boolean
          p_name: string
          p_purpose: string
          p_read_only: boolean
        }
        Returns: boolean
      }
      update_my_community_profile: {
        Args: { p_bio: string; p_community_id: string; p_display_name: string }
        Returns: boolean
      }
      upsert_my_collaboration_profile: {
        Args: {
          p_bio: string
          p_collaboration_id: string
          p_display_name: string
        }
        Returns: boolean
      }
    }
    Enums: {
      access_policy: "invite-only" | "request-to-join"
      access_request_status: "pending" | "approved" | "rejected" | "cancelled"
      collaboration_channel_status: "active" | "archived"
      collaboration_document_status: "active" | "archived"
      collaboration_event_audience:
        | "public"
        | "participating_organizations"
        | "invite_only"
      collaboration_event_status: "draft" | "confirmed" | "cancelled"
      collaboration_member_status: "active" | "left"
      collaboration_participant_status:
        | "invited"
        | "active"
        | "declined"
        | "left"
      collaboration_publication_status: "published" | "unpublished"
      collaboration_sponsorship_status:
        | "invited"
        | "accepted"
        | "declined"
        | "revoked"
      collaboration_status: "active" | "archived"
      collaboration_task_status: "todo" | "in_progress" | "done" | "cancelled"
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
      collaboration_channel_status: ["active", "archived"],
      collaboration_document_status: ["active", "archived"],
      collaboration_event_audience: [
        "public",
        "participating_organizations",
        "invite_only",
      ],
      collaboration_event_status: ["draft", "confirmed", "cancelled"],
      collaboration_member_status: ["active", "left"],
      collaboration_participant_status: [
        "invited",
        "active",
        "declined",
        "left",
      ],
      collaboration_publication_status: ["published", "unpublished"],
      collaboration_sponsorship_status: [
        "invited",
        "accepted",
        "declined",
        "revoked",
      ],
      collaboration_status: ["active", "archived"],
      collaboration_task_status: ["todo", "in_progress", "done", "cancelled"],
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
export type SubgroupRow = Tables<"community_subgroups">
export type MessageAttachmentRow = Tables<"message_attachments">
export type ChannelSectionRow = Tables<"channel_sections">
