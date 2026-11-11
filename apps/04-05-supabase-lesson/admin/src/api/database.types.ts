export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.18"
  }
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
      booking_requests: {
        Row: {
          booking_at: string
          comment: string | null
          contact: string
          conversation_id: string | null
          created_at: string
          guest_name: string
          guest_notified_at: string | null
          guests_count: number
          id: string
          idempotency_key: string
          manager_notified_at: string | null
          replaces_id: string | null
          restaurant_id: string
          status: string
          updated_at: string
        }
        Insert: {
          booking_at: string
          comment?: string | null
          contact: string
          conversation_id?: string | null
          created_at?: string
          guest_name: string
          guest_notified_at?: string | null
          guests_count: number
          id?: string
          idempotency_key: string
          manager_notified_at?: string | null
          replaces_id?: string | null
          restaurant_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          booking_at?: string
          comment?: string | null
          contact?: string
          conversation_id?: string | null
          created_at?: string
          guest_name?: string
          guest_notified_at?: string | null
          guests_count?: number
          id?: string
          idempotency_key?: string
          manager_notified_at?: string | null
          replaces_id?: string | null
          restaurant_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "booking_requests_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_requests_replaces_id_fkey"
            columns: ["replaces_id"]
            isOneToOne: false
            referencedRelation: "booking_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_requests_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      conversations: {
        Row: {
          channel: string
          chat_id: number
          created_at: string
          display_name: string | null
          external_user_id: number
          flag_reason: string | null
          flagged_at: string | null
          handoff_until: string | null
          id: string
          last_message_at: string | null
          last_message_direction: string | null
          last_message_preview: string | null
          manager_last_read_at: string | null
          restaurant_id: string
          state: Json
        }
        Insert: {
          channel?: string
          chat_id: number
          created_at?: string
          display_name?: string | null
          external_user_id: number
          flag_reason?: string | null
          flagged_at?: string | null
          handoff_until?: string | null
          id?: string
          last_message_at?: string | null
          last_message_direction?: string | null
          last_message_preview?: string | null
          manager_last_read_at?: string | null
          restaurant_id: string
          state?: Json
        }
        Update: {
          channel?: string
          chat_id?: number
          created_at?: string
          display_name?: string | null
          external_user_id?: number
          flag_reason?: string | null
          flagged_at?: string | null
          handoff_until?: string | null
          id?: string
          last_message_at?: string | null
          last_message_direction?: string | null
          last_message_preview?: string | null
          manager_last_read_at?: string | null
          restaurant_id?: string
          state?: Json
        }
        Relationships: [
          {
            foreignKeyName: "conversations_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      faq_entries: {
        Row: {
          answer: string
          created_at: string
          id: string
          is_published: boolean
          question: string
          restaurant_id: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          answer: string
          created_at?: string
          id?: string
          is_published?: boolean
          question: string
          restaurant_id: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          answer?: string
          created_at?: string
          id?: string
          is_published?: boolean
          question?: string
          restaurant_id?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "faq_entries_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      guest_requests: {
        Row: {
          contact: string | null
          conversation_id: string | null
          created_at: string
          id: string
          idempotency_key: string
          kind: string
          manager_notified_at: string | null
          restaurant_id: string
          status: string
          text: string
          updated_at: string
        }
        Insert: {
          contact?: string | null
          conversation_id?: string | null
          created_at?: string
          id?: string
          idempotency_key: string
          kind: string
          manager_notified_at?: string | null
          restaurant_id: string
          status?: string
          text: string
          updated_at?: string
        }
        Update: {
          contact?: string | null
          conversation_id?: string | null
          created_at?: string
          id?: string
          idempotency_key?: string
          kind?: string
          manager_notified_at?: string | null
          restaurant_id?: string
          status?: string
          text?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "guest_requests_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "guest_requests_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      menu_categories: {
        Row: {
          created_at: string
          id: string
          name: string
          restaurant_id: string
          sort_order: number
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          restaurant_id: string
          sort_order?: number
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          restaurant_id?: string
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "menu_categories_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      menu_items: {
        Row: {
          allergens: string[] | null
          carbs_per_portion: number | null
          category_id: string | null
          created_at: string
          description: string | null
          external_id: string | null
          fat_per_portion: number | null
          id: string
          ingredients: string | null
          is_available: boolean
          is_published: boolean
          kcal_per_portion: number | null
          name: string
          photo_url: string | null
          portion_grams: number | null
          price: number
          protein_per_portion: number | null
          restaurant_id: string
          source: string
          source_updated_at: string | null
          updated_at: string
        }
        Insert: {
          allergens?: string[] | null
          carbs_per_portion?: number | null
          category_id?: string | null
          created_at?: string
          description?: string | null
          external_id?: string | null
          fat_per_portion?: number | null
          id?: string
          ingredients?: string | null
          is_available?: boolean
          is_published?: boolean
          kcal_per_portion?: number | null
          name: string
          photo_url?: string | null
          portion_grams?: number | null
          price: number
          protein_per_portion?: number | null
          restaurant_id: string
          source?: string
          source_updated_at?: string | null
          updated_at?: string
        }
        Update: {
          allergens?: string[] | null
          carbs_per_portion?: number | null
          category_id?: string | null
          created_at?: string
          description?: string | null
          external_id?: string | null
          fat_per_portion?: number | null
          id?: string
          ingredients?: string | null
          is_available?: boolean
          is_published?: boolean
          kcal_per_portion?: number | null
          name?: string
          photo_url?: string | null
          portion_grams?: number | null
          price?: number
          protein_per_portion?: number | null
          restaurant_id?: string
          source?: string
          source_updated_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "menu_items_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "menu_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "menu_items_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      messages: {
        Row: {
          conversation_id: string
          created_at: string
          direction: string
          id: string
          kind: string
          meta: Json | null
          text: string
        }
        Insert: {
          conversation_id: string
          created_at?: string
          direction: string
          id?: string
          kind?: string
          meta?: Json | null
          text: string
        }
        Update: {
          conversation_id?: string
          created_at?: string
          direction?: string
          id?: string
          kind?: string
          meta?: Json | null
          text?: string
        }
        Relationships: [
          {
            foreignKeyName: "messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      processed_updates: {
        Row: {
          created_at: string
          update_id: number
        }
        Insert: {
          created_at?: string
          update_id: number
        }
        Update: {
          created_at?: string
          update_id?: number
        }
        Relationships: []
      }
      restaurant_ai_settings: {
        Row: {
          ai_enabled: boolean
          daily_turn_limit: number
          history_window: number
          restaurant_id: string
        }
        Insert: {
          ai_enabled?: boolean
          daily_turn_limit?: number
          history_window?: number
          restaurant_id: string
        }
        Update: {
          ai_enabled?: boolean
          daily_turn_limit?: number
          history_window?: number
          restaurant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "restaurant_ai_settings_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: true
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      restaurant_managers: {
        Row: {
          created_at: string
          restaurant_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          restaurant_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          restaurant_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "restaurant_managers_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      restaurants: {
        Row: {
          address: string | null
          created_at: string
          currency: string
          description: string | null
          email: string | null
          id: string
          manager_chat_id: number | null
          name: string
          opening_hours: Json | null
          phone: string | null
          timezone: string
          updated_at: string
          working_hours: string | null
        }
        Insert: {
          address?: string | null
          created_at?: string
          currency?: string
          description?: string | null
          email?: string | null
          id?: string
          manager_chat_id?: number | null
          name: string
          opening_hours?: Json | null
          phone?: string | null
          timezone?: string
          updated_at?: string
          working_hours?: string | null
        }
        Update: {
          address?: string | null
          created_at?: string
          currency?: string
          description?: string | null
          email?: string | null
          id?: string
          manager_chat_id?: number | null
          name?: string
          opening_hours?: Json | null
          phone?: string | null
          timezone?: string
          updated_at?: string
          working_hours?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      ai_usage_daily: {
        Args: { p_from: string; p_to: string }
        Returns: {
          calls: number
          day: string
          fallback_error: number
          fallback_limit: number
          fallback_quota: number
          fallback_timeout: number
          input_tokens: number
          ms_total: number
          model: string
          output_tokens: number
          thought_tokens: number
          turns: number
        }[]
      }
      begin_manager_handoff: {
        Args: { p_conversation_id: string }
        Returns: {
          chat_id: number
          handoff_until: string
          was_active: boolean
        }[]
      }
      count_unread_conversations: { Args: never; Returns: number }
      eu_allergen_codes: { Args: never; Returns: string[] }
      get_messages_page: {
        Args: {
          p_before_created_at: string
          p_before_id: string
          p_conversation_id: string
          p_limit: number
        }
        Returns: {
          conversation_id: string
          created_at: string
          direction: string
          id: string
          kind: string
          meta: Json | null
          text: string
        }[]
        SetofOptions: {
          from: "*"
          to: "messages"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      is_manager_of: { Args: { p_restaurant_id: string }; Returns: boolean }
      end_manager_handoff: {
        Args: { p_conversation_id: string }
        Returns: {
          chat_id: number
          restaurant_id: string
          was_active: boolean
        }[]
      }
      extend_manager_handoff: {
        Args: { p_conversation_id: string }
        Returns: {
          chat_id: number
          handoff_until: string
        }[]
      }
      list_conversations_page: {
        Args: { p_before_at: string; p_before_id: string; p_limit: number }
        Returns: {
          channel: string
          created_at: string
          display_name: string
          flag_reason: string
          flagged_at: string
          handoff_until: string
          id: string
          last_message_at: string
          last_message_direction: string
          last_message_preview: string
          manager_last_read_at: string
          unread_count: number
        }[]
      }
      mark_conversation_read: {
        Args: { p_conversation_id: string; p_up_to: string }
        Returns: undefined
      }
      resolve_conversation_flag: {
        Args: { p_conversation_id: string }
        Returns: undefined
      }
      set_booking_status: {
        Args: { p_from: string; p_id: string; p_to: string }
        Returns: {
          booking_at: string
          comment: string | null
          contact: string
          conversation_id: string | null
          created_at: string
          guest_name: string
          guest_notified_at: string | null
          guests_count: number
          id: string
          idempotency_key: string
          manager_notified_at: string | null
          replaces_id: string | null
          restaurant_id: string
          status: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "booking_requests"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      set_guest_request_status: {
        Args: { p_from: string; p_id: string; p_to: string }
        Returns: {
          contact: string | null
          conversation_id: string | null
          created_at: string
          id: string
          idempotency_key: string
          kind: string
          manager_notified_at: string | null
          restaurant_id: string
          status: string
          text: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "guest_requests"
          isOneToOne: true
          isSetofReturn: false
        }
      }
    }
    Enums: {
      [_ in never]: never
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
    Enums: {},
  },
} as const
