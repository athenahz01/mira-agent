export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  public: {
    Tables: {
      brand_contacts: {
        Row: {
          id: string;
          created_at: string;
          updated_at: string;
          user_id: string;
          brand_id: string;
          email: string;
          name: string | null;
          role: string | null;
          source: string;
          confidence: number | null;
          verified_at: string | null;
          last_emailed_at: string | null;
          bounce_count: number;
          marked_unreachable: boolean;
          unsubscribe_received_at: string | null;
        };
        Insert: {
          id?: string;
          created_at?: string;
          updated_at?: string;
          user_id: string;
          brand_id: string;
          email: string;
          name?: string | null;
          role?: string | null;
          source: string;
          confidence?: number | null;
          verified_at?: string | null;
          last_emailed_at?: string | null;
          bounce_count?: number;
          marked_unreachable?: boolean;
          unsubscribe_received_at?: string | null;
        };
        Update: {
          id?: string;
          created_at?: string;
          updated_at?: string;
          user_id?: string;
          brand_id?: string;
          email?: string;
          name?: string | null;
          role?: string | null;
          source?: string;
          confidence?: number | null;
          verified_at?: string | null;
          last_emailed_at?: string | null;
          bounce_count?: number;
          marked_unreachable?: boolean;
          unsubscribe_received_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "brand_contacts_brand_id_fkey";
            columns: ["brand_id"];
            isOneToOne: false;
            referencedRelation: "brands";
            referencedColumns: ["id"];
          },
        ];
      };
      brands: {
        Row: {
          id: string;
          created_at: string;
          updated_at: string;
          user_id: string;
          name: string;
          aliases: string[];
          domain: string | null;
          instagram_handle: string | null;
          tiktok_handle: string | null;
          category: string[];
          aesthetic_tags: string[];
          size_estimate: string | null;
          creator_friendliness_score: number | null;
          pays_creators: boolean | null;
          last_pitched_at: string | null;
          pitch_count: number;
          source_signals_summary: string | null;
          excluded: boolean;
          exclusion_reason: string | null;
        };
        Insert: {
          id?: string;
          created_at?: string;
          updated_at?: string;
          user_id: string;
          name: string;
          aliases?: string[];
          domain?: string | null;
          instagram_handle?: string | null;
          tiktok_handle?: string | null;
          category?: string[];
          aesthetic_tags?: string[];
          size_estimate?: string | null;
          creator_friendliness_score?: number | null;
          pays_creators?: boolean | null;
          last_pitched_at?: string | null;
          pitch_count?: number;
          source_signals_summary?: string | null;
          excluded?: boolean;
          exclusion_reason?: string | null;
        };
        Update: {
          id?: string;
          created_at?: string;
          updated_at?: string;
          user_id?: string;
          name?: string;
          aliases?: string[];
          domain?: string | null;
          instagram_handle?: string | null;
          tiktok_handle?: string | null;
          category?: string[];
          aesthetic_tags?: string[];
          size_estimate?: string | null;
          creator_friendliness_score?: number | null;
          pays_creators?: boolean | null;
          last_pitched_at?: string | null;
          pitch_count?: number;
          source_signals_summary?: string | null;
          excluded?: boolean;
          exclusion_reason?: string | null;
        };
        Relationships: [];
      };
      campaigns: {
        Row: {
          id: string;
          created_at: string;
          updated_at: string;
          user_id: string;
          creator_profile_id: string;
          brand_id: string;
          deal_type: string;
          status: string;
          score: number | null;
          score_rationale_json: Json | null;
          hook_chosen: string | null;
          research_brief_json: Json | null;
          target_contact_id: string | null;
          scheduled_send_at: string | null;
          sent_at: string | null;
          replied_at: string | null;
          closed_at: string | null;
          outcome: string | null;
          deal_value_usd: number | null;
          notes: string | null;
        };
        Insert: {
          id?: string;
          created_at?: string;
          updated_at?: string;
          user_id: string;
          creator_profile_id: string;
          brand_id: string;
          deal_type: string;
          status?: string;
          score?: number | null;
          score_rationale_json?: Json | null;
          hook_chosen?: string | null;
          research_brief_json?: Json | null;
          target_contact_id?: string | null;
          scheduled_send_at?: string | null;
          sent_at?: string | null;
          replied_at?: string | null;
          closed_at?: string | null;
          outcome?: string | null;
          deal_value_usd?: number | null;
          notes?: string | null;
        };
        Update: {
          id?: string;
          created_at?: string;
          updated_at?: string;
          user_id?: string;
          creator_profile_id?: string;
          brand_id?: string;
          deal_type?: string;
          status?: string;
          score?: number | null;
          score_rationale_json?: Json | null;
          hook_chosen?: string | null;
          research_brief_json?: Json | null;
          target_contact_id?: string | null;
          scheduled_send_at?: string | null;
          sent_at?: string | null;
          replied_at?: string | null;
          closed_at?: string | null;
          outcome?: string | null;
          deal_value_usd?: number | null;
          notes?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "campaigns_brand_id_fkey";
            columns: ["brand_id"];
            isOneToOne: false;
            referencedRelation: "brands";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "campaigns_creator_profile_id_fkey";
            columns: ["creator_profile_id"];
            isOneToOne: false;
            referencedRelation: "creator_profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "campaigns_target_contact_id_fkey";
            columns: ["target_contact_id"];
            isOneToOne: false;
            referencedRelation: "brand_contacts";
            referencedColumns: ["id"];
          },
        ];
      };
      creator_profiles: {
        Row: {
          id: string;
          created_at: string;
          updated_at: string;
          user_id: string;
          handle: string;
          display_name: string;
          platform: string;
          niche_tags: string[];
          audience_size_snapshot: number | null;
          engagement_rate_snapshot: number | null;
          tier: string | null;
          aesthetic_keywords: string[];
          bio_extract: string | null;
          recent_post_themes: string[];
          voice_style_guide_id: string | null;
          active: boolean;
          cross_pitch_cooldown_days: number;
        };
        Insert: {
          id?: string;
          created_at?: string;
          updated_at?: string;
          user_id: string;
          handle: string;
          display_name: string;
          platform?: string;
          niche_tags?: string[];
          audience_size_snapshot?: number | null;
          engagement_rate_snapshot?: number | null;
          tier?: string | null;
          aesthetic_keywords?: string[];
          bio_extract?: string | null;
          recent_post_themes?: string[];
          voice_style_guide_id?: string | null;
          active?: boolean;
          cross_pitch_cooldown_days?: number;
        };
        Update: {
          id?: string;
          created_at?: string;
          updated_at?: string;
          user_id?: string;
          handle?: string;
          display_name?: string;
          platform?: string;
          niche_tags?: string[];
          audience_size_snapshot?: number | null;
          engagement_rate_snapshot?: number | null;
          tier?: string | null;
          aesthetic_keywords?: string[];
          bio_extract?: string | null;
          recent_post_themes?: string[];
          voice_style_guide_id?: string | null;
          active?: boolean;
          cross_pitch_cooldown_days?: number;
        };
        Relationships: [
          {
            foreignKeyName: "creator_profiles_voice_style_guide_fk";
            columns: ["voice_style_guide_id"];
            isOneToOne: false;
            referencedRelation: "voice_style_guides";
            referencedColumns: ["id"];
          },
        ];
      };
      deals: {
        Row: {
          id: string;
          created_at: string;
          updated_at: string;
          user_id: string;
          campaign_id: string;
          agreed_value_usd: number | null;
          currency: string;
          payment_terms: string | null;
          contract_url: string | null;
          contract_status: string;
          usage_rights_scope: string | null;
          exclusivity_clauses_json: Json | null;
        };
        Insert: {
          id?: string;
          created_at?: string;
          updated_at?: string;
          user_id: string;
          campaign_id: string;
          agreed_value_usd?: number | null;
          currency?: string;
          payment_terms?: string | null;
          contract_url?: string | null;
          contract_status?: string;
          usage_rights_scope?: string | null;
          exclusivity_clauses_json?: Json | null;
        };
        Update: {
          id?: string;
          created_at?: string;
          updated_at?: string;
          user_id?: string;
          campaign_id?: string;
          agreed_value_usd?: number | null;
          currency?: string;
          payment_terms?: string | null;
          contract_url?: string | null;
          contract_status?: string;
          usage_rights_scope?: string | null;
          exclusivity_clauses_json?: Json | null;
        };
        Relationships: [
          {
            foreignKeyName: "deals_campaign_id_fkey";
            columns: ["campaign_id"];
            isOneToOne: false;
            referencedRelation: "campaigns";
            referencedColumns: ["id"];
          },
        ];
      };
      deliverables: {
        Row: {
          id: string;
          created_at: string;
          updated_at: string;
          user_id: string;
          deal_id: string;
          kind: string;
          quantity: number;
          due_date: string | null;
          posted_url: string | null;
          status: string;
        };
        Insert: {
          id?: string;
          created_at?: string;
          updated_at?: string;
          user_id: string;
          deal_id: string;
          kind: string;
          quantity?: number;
          due_date?: string | null;
          posted_url?: string | null;
          status?: string;
        };
        Update: {
          id?: string;
          created_at?: string;
          updated_at?: string;
          user_id?: string;
          deal_id?: string;
          kind?: string;
          quantity?: number;
          due_date?: string | null;
          posted_url?: string | null;
          status?: string;
        };
        Relationships: [
          {
            foreignKeyName: "deliverables_deal_id_fkey";
            columns: ["deal_id"];
            isOneToOne: false;
            referencedRelation: "deals";
            referencedColumns: ["id"];
          },
        ];
      };
      email_threads: {
        Row: {
          id: string;
          created_at: string;
          updated_at: string;
          user_id: string;
          gmail_thread_id: string;
          campaign_id: string | null;
          last_message_at: string | null;
          participant_emails: string[];
        };
        Insert: {
          id?: string;
          created_at?: string;
          updated_at?: string;
          user_id: string;
          gmail_thread_id: string;
          campaign_id?: string | null;
          last_message_at?: string | null;
          participant_emails?: string[];
        };
        Update: {
          id?: string;
          created_at?: string;
          updated_at?: string;
          user_id?: string;
          gmail_thread_id?: string;
          campaign_id?: string | null;
          last_message_at?: string | null;
          participant_emails?: string[];
        };
        Relationships: [
          {
            foreignKeyName: "email_threads_campaign_id_fkey";
            columns: ["campaign_id"];
            isOneToOne: false;
            referencedRelation: "campaigns";
            referencedColumns: ["id"];
          },
        ];
      };
      feedback_marks: {
        Row: {
          id: string;
          created_at: string;
          updated_at: string;
          user_id: string;
          target_kind: string;
          target_id: string;
          direction: string;
          note: string | null;
        };
        Insert: {
          id?: string;
          created_at?: string;
          updated_at?: string;
          user_id: string;
          target_kind: string;
          target_id: string;
          direction: string;
          note?: string | null;
        };
        Update: {
          id?: string;
          created_at?: string;
          updated_at?: string;
          user_id?: string;
          target_kind?: string;
          target_id?: string;
          direction?: string;
          note?: string | null;
        };
        Relationships: [];
      };
      follow_up_sequences: {
        Row: {
          id: string;
          created_at: string;
          updated_at: string;
          user_id: string;
          campaign_id: string;
          steps_json: Json;
          cancelled: boolean;
          cancelled_reason: string | null;
        };
        Insert: {
          id?: string;
          created_at?: string;
          updated_at?: string;
          user_id: string;
          campaign_id: string;
          steps_json: Json;
          cancelled?: boolean;
          cancelled_reason?: string | null;
        };
        Update: {
          id?: string;
          created_at?: string;
          updated_at?: string;
          user_id?: string;
          campaign_id?: string;
          steps_json?: Json;
          cancelled?: boolean;
          cancelled_reason?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "follow_up_sequences_campaign_id_fkey";
            columns: ["campaign_id"];
            isOneToOne: false;
            referencedRelation: "campaigns";
            referencedColumns: ["id"];
          },
        ];
      };
      hook_library: {
        Row: {
          id: string;
          created_at: string;
          updated_at: string;
          user_id: string;
          hook_pattern: string;
          applies_to_deal_types: string[];
          creator_profile_id: string | null;
          usage_count: number;
          reply_count: number;
          positive_reply_count: number;
        };
        Insert: {
          id?: string;
          created_at?: string;
          updated_at?: string;
          user_id: string;
          hook_pattern: string;
          applies_to_deal_types?: string[];
          creator_profile_id?: string | null;
          usage_count?: number;
          reply_count?: number;
          positive_reply_count?: number;
        };
        Update: {
          id?: string;
          created_at?: string;
          updated_at?: string;
          user_id?: string;
          hook_pattern?: string;
          applies_to_deal_types?: string[];
          creator_profile_id?: string | null;
          usage_count?: number;
          reply_count?: number;
          positive_reply_count?: number;
        };
        Relationships: [
          {
            foreignKeyName: "hook_library_creator_profile_id_fkey";
            columns: ["creator_profile_id"];
            isOneToOne: false;
            referencedRelation: "creator_profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      media_kits: {
        Row: {
          id: string;
          created_at: string;
          updated_at: string;
          user_id: string;
          creator_profile_id: string;
          version: number;
          pdf_url: string | null;
          data_json: Json;
          is_active: boolean;
        };
        Insert: {
          id?: string;
          created_at?: string;
          updated_at?: string;
          user_id: string;
          creator_profile_id: string;
          version: number;
          pdf_url?: string | null;
          data_json: Json;
          is_active?: boolean;
        };
        Update: {
          id?: string;
          created_at?: string;
          updated_at?: string;
          user_id?: string;
          creator_profile_id?: string;
          version?: number;
          pdf_url?: string | null;
          data_json?: Json;
          is_active?: boolean;
        };
        Relationships: [
          {
            foreignKeyName: "media_kits_creator_profile_id_fkey";
            columns: ["creator_profile_id"];
            isOneToOne: false;
            referencedRelation: "creator_profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      messages: {
        Row: {
          id: string;
          created_at: string;
          updated_at: string;
          user_id: string;
          campaign_id: string;
          version: number;
          kind: string;
          subject: string;
          body_text: string;
          body_html: string | null;
          status: string;
          approved_at: string | null;
          approved_by: string | null;
          sent_at: string | null;
          gmail_message_id: string | null;
          gmail_thread_id: string | null;
          model_used: string | null;
          prompt_hash: string | null;
          was_edited_before_send: boolean;
          edit_diff: Json | null;
        };
        Insert: {
          id?: string;
          created_at?: string;
          updated_at?: string;
          user_id: string;
          campaign_id: string;
          version: number;
          kind: string;
          subject: string;
          body_text: string;
          body_html?: string | null;
          status?: string;
          approved_at?: string | null;
          approved_by?: string | null;
          sent_at?: string | null;
          gmail_message_id?: string | null;
          gmail_thread_id?: string | null;
          model_used?: string | null;
          prompt_hash?: string | null;
          was_edited_before_send?: boolean;
          edit_diff?: Json | null;
        };
        Update: {
          id?: string;
          created_at?: string;
          updated_at?: string;
          user_id?: string;
          campaign_id?: string;
          version?: number;
          kind?: string;
          subject?: string;
          body_text?: string;
          body_html?: string | null;
          status?: string;
          approved_at?: string | null;
          approved_by?: string | null;
          sent_at?: string | null;
          gmail_message_id?: string | null;
          gmail_thread_id?: string | null;
          model_used?: string | null;
          prompt_hash?: string | null;
          was_edited_before_send?: boolean;
          edit_diff?: Json | null;
        };
        Relationships: [
          {
            foreignKeyName: "messages_campaign_id_fkey";
            columns: ["campaign_id"];
            isOneToOne: false;
            referencedRelation: "campaigns";
            referencedColumns: ["id"];
          },
        ];
      };
      outreach_rules: {
        Row: {
          id: string;
          created_at: string;
          updated_at: string;
          user_id: string;
          creator_profile_id: string | null;
          max_sends_per_day: number;
          send_window_start_hour: number;
          send_window_end_hour: number;
          send_timezone: string;
          min_minutes_between_sends: number;
          max_minutes_between_sends: number;
          send_on_weekends: boolean;
          excluded_brand_ids: string[];
          excluded_categories: string[];
          auto_send_after_approval: boolean;
          require_per_email_approval: boolean;
          warmup_mode: boolean;
          warmup_max_per_day: number;
        };
        Insert: {
          id?: string;
          created_at?: string;
          updated_at?: string;
          user_id: string;
          creator_profile_id?: string | null;
          max_sends_per_day?: number;
          send_window_start_hour?: number;
          send_window_end_hour?: number;
          send_timezone?: string;
          min_minutes_between_sends?: number;
          max_minutes_between_sends?: number;
          send_on_weekends?: boolean;
          excluded_brand_ids?: string[];
          excluded_categories?: string[];
          auto_send_after_approval?: boolean;
          require_per_email_approval?: boolean;
          warmup_mode?: boolean;
          warmup_max_per_day?: number;
        };
        Update: {
          id?: string;
          created_at?: string;
          updated_at?: string;
          user_id?: string;
          creator_profile_id?: string | null;
          max_sends_per_day?: number;
          send_window_start_hour?: number;
          send_window_end_hour?: number;
          send_timezone?: string;
          min_minutes_between_sends?: number;
          max_minutes_between_sends?: number;
          send_on_weekends?: boolean;
          excluded_brand_ids?: string[];
          excluded_categories?: string[];
          auto_send_after_approval?: boolean;
          require_per_email_approval?: boolean;
          warmup_mode?: boolean;
          warmup_max_per_day?: number;
        };
        Relationships: [
          {
            foreignKeyName: "outreach_rules_creator_profile_id_fkey";
            columns: ["creator_profile_id"];
            isOneToOne: false;
            referencedRelation: "creator_profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      payments: {
        Row: {
          id: string;
          created_at: string;
          updated_at: string;
          user_id: string;
          deal_id: string;
          amount_usd: number;
          expected_at: string | null;
          received_at: string | null;
          status: string;
        };
        Insert: {
          id?: string;
          created_at?: string;
          updated_at?: string;
          user_id: string;
          deal_id: string;
          amount_usd: number;
          expected_at?: string | null;
          received_at?: string | null;
          status?: string;
        };
        Update: {
          id?: string;
          created_at?: string;
          updated_at?: string;
          user_id?: string;
          deal_id?: string;
          amount_usd?: number;
          expected_at?: string | null;
          received_at?: string | null;
          status?: string;
        };
        Relationships: [
          {
            foreignKeyName: "payments_deal_id_fkey";
            columns: ["deal_id"];
            isOneToOne: false;
            referencedRelation: "deals";
            referencedColumns: ["id"];
          },
        ];
      };
      reply_classifications: {
        Row: {
          id: string;
          created_at: string;
          updated_at: string;
          user_id: string;
          message_id: string;
          category: string;
          confidence: number | null;
          summary: string;
          suggested_action: string;
        };
        Insert: {
          id?: string;
          created_at?: string;
          updated_at?: string;
          user_id: string;
          message_id: string;
          category: string;
          confidence?: number | null;
          summary: string;
          suggested_action: string;
        };
        Update: {
          id?: string;
          created_at?: string;
          updated_at?: string;
          user_id?: string;
          message_id?: string;
          category?: string;
          confidence?: number | null;
          summary?: string;
          suggested_action?: string;
        };
        Relationships: [
          {
            foreignKeyName: "reply_classifications_message_id_fkey";
            columns: ["message_id"];
            isOneToOne: false;
            referencedRelation: "messages";
            referencedColumns: ["id"];
          },
        ];
      };
      source_signals: {
        Row: {
          id: string;
          created_at: string;
          updated_at: string;
          user_id: string;
          brand_id: string;
          signal_type: string;
          evidence_url: string | null;
          evidence_json: Json | null;
          weight: number;
        };
        Insert: {
          id?: string;
          created_at?: string;
          updated_at?: string;
          user_id: string;
          brand_id: string;
          signal_type: string;
          evidence_url?: string | null;
          evidence_json?: Json | null;
          weight?: number;
        };
        Update: {
          id?: string;
          created_at?: string;
          updated_at?: string;
          user_id?: string;
          brand_id?: string;
          signal_type?: string;
          evidence_url?: string | null;
          evidence_json?: Json | null;
          weight?: number;
        };
        Relationships: [
          {
            foreignKeyName: "source_signals_brand_id_fkey";
            columns: ["brand_id"];
            isOneToOne: false;
            referencedRelation: "brands";
            referencedColumns: ["id"];
          },
        ];
      };
      users: {
        Row: {
          user_id: string;
          created_at: string;
          updated_at: string;
          email: string;
          name: string | null;
          timezone: string;
          physical_address: string | null;
          gmail_oauth_token_ref: string | null;
        };
        Insert: {
          user_id: string;
          created_at?: string;
          updated_at?: string;
          email: string;
          name?: string | null;
          timezone?: string;
          physical_address?: string | null;
          gmail_oauth_token_ref?: string | null;
        };
        Update: {
          user_id?: string;
          created_at?: string;
          updated_at?: string;
          email?: string;
          name?: string | null;
          timezone?: string;
          physical_address?: string | null;
          gmail_oauth_token_ref?: string | null;
        };
        Relationships: [];
      };
      voice_samples: {
        Row: {
          id: string;
          created_at: string;
          updated_at: string;
          user_id: string;
          creator_profile_id: string;
          source: string;
          text: string;
          metadata_json: Json | null;
          tag: string | null;
        };
        Insert: {
          id?: string;
          created_at?: string;
          updated_at?: string;
          user_id: string;
          creator_profile_id: string;
          source: string;
          text: string;
          metadata_json?: Json | null;
          tag?: string | null;
        };
        Update: {
          id?: string;
          created_at?: string;
          updated_at?: string;
          user_id?: string;
          creator_profile_id?: string;
          source?: string;
          text?: string;
          metadata_json?: Json | null;
          tag?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "voice_samples_creator_profile_id_fkey";
            columns: ["creator_profile_id"];
            isOneToOne: false;
            referencedRelation: "creator_profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      voice_style_guides: {
        Row: {
          id: string;
          created_at: string;
          updated_at: string;
          user_id: string;
          creator_profile_id: string;
          version: number;
          is_active: boolean;
          style_doc_json: Json;
          learned_from_message_ids: string[];
        };
        Insert: {
          id?: string;
          created_at?: string;
          updated_at?: string;
          user_id: string;
          creator_profile_id: string;
          version: number;
          is_active?: boolean;
          style_doc_json: Json;
          learned_from_message_ids?: string[];
        };
        Update: {
          id?: string;
          created_at?: string;
          updated_at?: string;
          user_id?: string;
          creator_profile_id?: string;
          version?: number;
          is_active?: boolean;
          style_doc_json?: Json;
          learned_from_message_ids?: string[];
        };
        Relationships: [
          {
            foreignKeyName: "voice_style_guides_creator_profile_id_fkey";
            columns: ["creator_profile_id"];
            isOneToOne: false;
            referencedRelation: "creator_profiles";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      [_ in never]: never;
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type PublicSchema = Database["public"];

export type Tables<TableName extends keyof PublicSchema["Tables"]> =
  PublicSchema["Tables"][TableName]["Row"];

export type TablesInsert<TableName extends keyof PublicSchema["Tables"]> =
  PublicSchema["Tables"][TableName]["Insert"];

export type TablesUpdate<TableName extends keyof PublicSchema["Tables"]> =
  PublicSchema["Tables"][TableName]["Update"];
