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
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      brand_contacts: {
        Row: {
          bounce_count: number
          brand_id: string
          confidence: number | null
          created_at: string
          email: string
          id: string
          last_emailed_at: string | null
          marked_unreachable: boolean
          name: string | null
          role: string | null
          source: string
          unsubscribe_received_at: string | null
          updated_at: string
          user_id: string
          verified_at: string | null
        }
        Insert: {
          bounce_count?: number
          brand_id: string
          confidence?: number | null
          created_at?: string
          email: string
          id?: string
          last_emailed_at?: string | null
          marked_unreachable?: boolean
          name?: string | null
          role?: string | null
          source: string
          unsubscribe_received_at?: string | null
          updated_at?: string
          user_id: string
          verified_at?: string | null
        }
        Update: {
          bounce_count?: number
          brand_id?: string
          confidence?: number | null
          created_at?: string
          email?: string
          id?: string
          last_emailed_at?: string | null
          marked_unreachable?: boolean
          name?: string | null
          role?: string | null
          source?: string
          unsubscribe_received_at?: string | null
          updated_at?: string
          user_id?: string
          verified_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "brand_contacts_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
        ]
      }
      brand_match_proposals: {
        Row: {
          candidate_brand_ids: string[]
          candidate_scores: number[]
          created_at: string
          id: string
          incoming_payload_json: Json
          resolved_at: string | null
          resolved_brand_id: string | null
          resolved_by: string | null
          source: string
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          candidate_brand_ids: string[]
          candidate_scores: number[]
          created_at?: string
          id?: string
          incoming_payload_json: Json
          resolved_at?: string | null
          resolved_brand_id?: string | null
          resolved_by?: string | null
          source: string
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          candidate_brand_ids?: string[]
          candidate_scores?: number[]
          created_at?: string
          id?: string
          incoming_payload_json?: Json
          resolved_at?: string | null
          resolved_brand_id?: string | null
          resolved_by?: string | null
          source?: string
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "brand_match_proposals_resolved_brand_id_fkey"
            columns: ["resolved_brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
        ]
      }
      brands: {
        Row: {
          aesthetic_tags: string[]
          aliases: string[]
          category: string[]
          created_at: string
          creator_friendliness_score: number | null
          domain: string | null
          excluded: boolean
          exclusion_reason: string | null
          id: string
          identity_key: string
          instagram_handle: string | null
          last_pitched_at: string | null
          name: string
          pays_creators: boolean | null
          pitch_count: number
          size_estimate: string | null
          source_signals_summary: string | null
          tiktok_handle: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          aesthetic_tags?: string[]
          aliases?: string[]
          category?: string[]
          created_at?: string
          creator_friendliness_score?: number | null
          domain?: string | null
          excluded?: boolean
          exclusion_reason?: string | null
          id?: string
          identity_key?: string
          instagram_handle?: string | null
          last_pitched_at?: string | null
          name: string
          pays_creators?: boolean | null
          pitch_count?: number
          size_estimate?: string | null
          source_signals_summary?: string | null
          tiktok_handle?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          aesthetic_tags?: string[]
          aliases?: string[]
          category?: string[]
          created_at?: string
          creator_friendliness_score?: number | null
          domain?: string | null
          excluded?: boolean
          exclusion_reason?: string | null
          id?: string
          identity_key?: string
          instagram_handle?: string | null
          last_pitched_at?: string | null
          name?: string
          pays_creators?: boolean | null
          pitch_count?: number
          size_estimate?: string | null
          source_signals_summary?: string | null
          tiktok_handle?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      campaigns: {
        Row: {
          brand_id: string
          closed_at: string | null
          created_at: string
          creator_profile_id: string
          deal_type: string
          deal_value_usd: number | null
          hook_chosen: string | null
          id: string
          notes: string | null
          outcome: string | null
          replied_at: string | null
          research_brief_json: Json | null
          scheduled_send_at: string | null
          score: number | null
          score_rationale_json: Json | null
          sent_at: string | null
          status: string
          target_contact_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          brand_id: string
          closed_at?: string | null
          created_at?: string
          creator_profile_id: string
          deal_type: string
          deal_value_usd?: number | null
          hook_chosen?: string | null
          id?: string
          notes?: string | null
          outcome?: string | null
          replied_at?: string | null
          research_brief_json?: Json | null
          scheduled_send_at?: string | null
          score?: number | null
          score_rationale_json?: Json | null
          sent_at?: string | null
          status?: string
          target_contact_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          brand_id?: string
          closed_at?: string | null
          created_at?: string
          creator_profile_id?: string
          deal_type?: string
          deal_value_usd?: number | null
          hook_chosen?: string | null
          id?: string
          notes?: string | null
          outcome?: string | null
          replied_at?: string | null
          research_brief_json?: Json | null
          scheduled_send_at?: string | null
          score?: number | null
          score_rationale_json?: Json | null
          sent_at?: string | null
          status?: string
          target_contact_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "campaigns_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaigns_creator_profile_id_fkey"
            columns: ["creator_profile_id"]
            isOneToOne: false
            referencedRelation: "creator_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaigns_target_contact_id_fkey"
            columns: ["target_contact_id"]
            isOneToOne: false
            referencedRelation: "brand_contacts"
            referencedColumns: ["id"]
          },
        ]
      }
      competitor_handles: {
        Row: {
          created_at: string
          creator_profile_id: string
          handle: string
          id: string
          last_scraped_at: string | null
          notes: string | null
          platform: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          creator_profile_id: string
          handle: string
          id?: string
          last_scraped_at?: string | null
          notes?: string | null
          platform?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          creator_profile_id?: string
          handle?: string
          id?: string
          last_scraped_at?: string | null
          notes?: string | null
          platform?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "competitor_handles_creator_profile_id_fkey"
            columns: ["creator_profile_id"]
            isOneToOne: false
            referencedRelation: "creator_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      creator_profiles: {
        Row: {
          active: boolean
          aesthetic_keywords: string[]
          audience_size_snapshot: number | null
          bio_extract: string | null
          created_at: string
          cross_pitch_cooldown_days: number
          display_name: string
          engagement_rate_snapshot: number | null
          handle: string
          id: string
          niche_tags: string[]
          platform: string
          recent_post_themes: string[]
          tier: string | null
          updated_at: string
          user_id: string
          voice_style_guide_id: string | null
        }
        Insert: {
          active?: boolean
          aesthetic_keywords?: string[]
          audience_size_snapshot?: number | null
          bio_extract?: string | null
          created_at?: string
          cross_pitch_cooldown_days?: number
          display_name: string
          engagement_rate_snapshot?: number | null
          handle: string
          id?: string
          niche_tags?: string[]
          platform?: string
          recent_post_themes?: string[]
          tier?: string | null
          updated_at?: string
          user_id: string
          voice_style_guide_id?: string | null
        }
        Update: {
          active?: boolean
          aesthetic_keywords?: string[]
          audience_size_snapshot?: number | null
          bio_extract?: string | null
          created_at?: string
          cross_pitch_cooldown_days?: number
          display_name?: string
          engagement_rate_snapshot?: number | null
          handle?: string
          id?: string
          niche_tags?: string[]
          platform?: string
          recent_post_themes?: string[]
          tier?: string | null
          updated_at?: string
          user_id?: string
          voice_style_guide_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "creator_profiles_voice_style_guide_fk"
            columns: ["voice_style_guide_id"]
            isOneToOne: false
            referencedRelation: "voice_style_guides"
            referencedColumns: ["id"]
          },
        ]
      }
      deals: {
        Row: {
          agreed_value_usd: number | null
          campaign_id: string
          contract_status: string
          contract_url: string | null
          created_at: string
          currency: string
          exclusivity_clauses_json: Json | null
          id: string
          payment_terms: string | null
          updated_at: string
          usage_rights_scope: string | null
          user_id: string
        }
        Insert: {
          agreed_value_usd?: number | null
          campaign_id: string
          contract_status?: string
          contract_url?: string | null
          created_at?: string
          currency?: string
          exclusivity_clauses_json?: Json | null
          id?: string
          payment_terms?: string | null
          updated_at?: string
          usage_rights_scope?: string | null
          user_id: string
        }
        Update: {
          agreed_value_usd?: number | null
          campaign_id?: string
          contract_status?: string
          contract_url?: string | null
          created_at?: string
          currency?: string
          exclusivity_clauses_json?: Json | null
          id?: string
          payment_terms?: string | null
          updated_at?: string
          usage_rights_scope?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "deals_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: true
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
        ]
      }
      deliverables: {
        Row: {
          created_at: string
          deal_id: string
          due_date: string | null
          id: string
          kind: string
          posted_url: string | null
          quantity: number
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          deal_id: string
          due_date?: string | null
          id?: string
          kind: string
          posted_url?: string | null
          quantity?: number
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          deal_id?: string
          due_date?: string | null
          id?: string
          kind?: string
          posted_url?: string | null
          quantity?: number
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "deliverables_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["id"]
          },
        ]
      }
      email_threads: {
        Row: {
          campaign_id: string | null
          created_at: string
          gmail_thread_id: string
          id: string
          last_message_at: string | null
          participant_emails: string[]
          updated_at: string
          user_id: string
        }
        Insert: {
          campaign_id?: string | null
          created_at?: string
          gmail_thread_id: string
          id?: string
          last_message_at?: string | null
          participant_emails?: string[]
          updated_at?: string
          user_id: string
        }
        Update: {
          campaign_id?: string | null
          created_at?: string
          gmail_thread_id?: string
          id?: string
          last_message_at?: string | null
          participant_emails?: string[]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_threads_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
        ]
      }
      feedback_marks: {
        Row: {
          created_at: string
          direction: string
          id: string
          note: string | null
          target_id: string
          target_kind: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          direction: string
          id?: string
          note?: string | null
          target_id: string
          target_kind: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          direction?: string
          id?: string
          note?: string | null
          target_id?: string
          target_kind?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      follow_up_sequences: {
        Row: {
          campaign_id: string
          cancelled: boolean
          cancelled_reason: string | null
          created_at: string
          id: string
          steps_json: Json
          updated_at: string
          user_id: string
        }
        Insert: {
          campaign_id: string
          cancelled?: boolean
          cancelled_reason?: string | null
          created_at?: string
          id?: string
          steps_json: Json
          updated_at?: string
          user_id: string
        }
        Update: {
          campaign_id?: string
          cancelled?: boolean
          cancelled_reason?: string | null
          created_at?: string
          id?: string
          steps_json?: Json
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "follow_up_sequences_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: true
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
        ]
      }
      gmail_credentials: {
        Row: {
          created_at: string
          google_email: string
          id: string
          last_refreshed_at: string | null
          refresh_token_encrypted: string
          revoked_at: string | null
          scopes: string[]
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          google_email: string
          id?: string
          last_refreshed_at?: string | null
          refresh_token_encrypted: string
          revoked_at?: string | null
          scopes: string[]
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          google_email?: string
          id?: string
          last_refreshed_at?: string | null
          refresh_token_encrypted?: string
          revoked_at?: string | null
          scopes?: string[]
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      hook_library: {
        Row: {
          applies_to_deal_types: string[]
          created_at: string
          creator_profile_id: string | null
          hook_pattern: string
          id: string
          positive_reply_count: number
          reply_count: number
          updated_at: string
          usage_count: number
          user_id: string
        }
        Insert: {
          applies_to_deal_types?: string[]
          created_at?: string
          creator_profile_id?: string | null
          hook_pattern: string
          id?: string
          positive_reply_count?: number
          reply_count?: number
          updated_at?: string
          usage_count?: number
          user_id: string
        }
        Update: {
          applies_to_deal_types?: string[]
          created_at?: string
          creator_profile_id?: string | null
          hook_pattern?: string
          id?: string
          positive_reply_count?: number
          reply_count?: number
          updated_at?: string
          usage_count?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "hook_library_creator_profile_id_fkey"
            columns: ["creator_profile_id"]
            isOneToOne: false
            referencedRelation: "creator_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      jobs: {
        Row: {
          attempts: number
          created_at: string
          error_message: string | null
          finished_at: string | null
          id: string
          kind: string
          locked_by: string | null
          locked_until: string | null
          max_attempts: number
          next_attempt_at: string
          payload_json: Json
          result_json: Json | null
          started_at: string | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          attempts?: number
          created_at?: string
          error_message?: string | null
          finished_at?: string | null
          id?: string
          kind: string
          locked_by?: string | null
          locked_until?: string | null
          max_attempts?: number
          next_attempt_at?: string
          payload_json: Json
          result_json?: Json | null
          started_at?: string | null
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          attempts?: number
          created_at?: string
          error_message?: string | null
          finished_at?: string | null
          id?: string
          kind?: string
          locked_by?: string | null
          locked_until?: string | null
          max_attempts?: number
          next_attempt_at?: string
          payload_json?: Json
          result_json?: Json | null
          started_at?: string | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      media_kits: {
        Row: {
          created_at: string
          creator_profile_id: string
          data_json: Json
          id: string
          is_active: boolean
          pdf_url: string | null
          updated_at: string
          user_id: string
          version: number
        }
        Insert: {
          created_at?: string
          creator_profile_id: string
          data_json: Json
          id?: string
          is_active?: boolean
          pdf_url?: string | null
          updated_at?: string
          user_id: string
          version: number
        }
        Update: {
          created_at?: string
          creator_profile_id?: string
          data_json?: Json
          id?: string
          is_active?: boolean
          pdf_url?: string | null
          updated_at?: string
          user_id?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "media_kits_creator_profile_id_fkey"
            columns: ["creator_profile_id"]
            isOneToOne: false
            referencedRelation: "creator_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      messages: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          body_html: string | null
          body_text: string
          campaign_id: string
          created_at: string
          edit_diff: Json | null
          gmail_message_id: string | null
          gmail_thread_id: string | null
          id: string
          kind: string
          model_used: string | null
          prompt_hash: string | null
          sent_at: string | null
          status: string
          subject: string
          updated_at: string
          user_id: string
          version: number
          was_edited_before_send: boolean
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          body_html?: string | null
          body_text: string
          campaign_id: string
          created_at?: string
          edit_diff?: Json | null
          gmail_message_id?: string | null
          gmail_thread_id?: string | null
          id?: string
          kind: string
          model_used?: string | null
          prompt_hash?: string | null
          sent_at?: string | null
          status?: string
          subject: string
          updated_at?: string
          user_id: string
          version: number
          was_edited_before_send?: boolean
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          body_html?: string | null
          body_text?: string
          campaign_id?: string
          created_at?: string
          edit_diff?: Json | null
          gmail_message_id?: string | null
          gmail_thread_id?: string | null
          id?: string
          kind?: string
          model_used?: string | null
          prompt_hash?: string | null
          sent_at?: string | null
          status?: string
          subject?: string
          updated_at?: string
          user_id?: string
          version?: number
          was_edited_before_send?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "messages_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
        ]
      }
      oauth_states: {
        Row: {
          consumed_at: string | null
          created_at: string
          expires_at: string
          id: string
          redirect_to: string | null
          state_hash: string
          updated_at: string
          user_id: string
        }
        Insert: {
          consumed_at?: string | null
          created_at?: string
          expires_at: string
          id?: string
          redirect_to?: string | null
          state_hash: string
          updated_at?: string
          user_id: string
        }
        Update: {
          consumed_at?: string | null
          created_at?: string
          expires_at?: string
          id?: string
          redirect_to?: string | null
          state_hash?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      outreach_rules: {
        Row: {
          auto_send_after_approval: boolean
          created_at: string
          creator_profile_id: string | null
          excluded_brand_ids: string[]
          excluded_categories: string[]
          id: string
          max_minutes_between_sends: number
          max_sends_per_day: number
          min_minutes_between_sends: number
          require_per_email_approval: boolean
          send_on_weekends: boolean
          send_timezone: string
          send_window_end_hour: number
          send_window_start_hour: number
          updated_at: string
          user_id: string
          warmup_max_per_day: number
          warmup_mode: boolean
        }
        Insert: {
          auto_send_after_approval?: boolean
          created_at?: string
          creator_profile_id?: string | null
          excluded_brand_ids?: string[]
          excluded_categories?: string[]
          id?: string
          max_minutes_between_sends?: number
          max_sends_per_day?: number
          min_minutes_between_sends?: number
          require_per_email_approval?: boolean
          send_on_weekends?: boolean
          send_timezone?: string
          send_window_end_hour?: number
          send_window_start_hour?: number
          updated_at?: string
          user_id: string
          warmup_max_per_day?: number
          warmup_mode?: boolean
        }
        Update: {
          auto_send_after_approval?: boolean
          created_at?: string
          creator_profile_id?: string | null
          excluded_brand_ids?: string[]
          excluded_categories?: string[]
          id?: string
          max_minutes_between_sends?: number
          max_sends_per_day?: number
          min_minutes_between_sends?: number
          require_per_email_approval?: boolean
          send_on_weekends?: boolean
          send_timezone?: string
          send_window_end_hour?: number
          send_window_start_hour?: number
          updated_at?: string
          user_id?: string
          warmup_max_per_day?: number
          warmup_mode?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "outreach_rules_creator_profile_id_fkey"
            columns: ["creator_profile_id"]
            isOneToOne: false
            referencedRelation: "creator_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      past_brand_work: {
        Row: {
          brand_name: string
          created_at: string
          creator_profile_id: string
          deal_type: string
          id: string
          link: string | null
          one_liner: string
          sort_order: number
          updated_at: string
          user_id: string
          year: number
        }
        Insert: {
          brand_name: string
          created_at?: string
          creator_profile_id: string
          deal_type: string
          id?: string
          link?: string | null
          one_liner: string
          sort_order?: number
          updated_at?: string
          user_id: string
          year: number
        }
        Update: {
          brand_name?: string
          created_at?: string
          creator_profile_id?: string
          deal_type?: string
          id?: string
          link?: string | null
          one_liner?: string
          sort_order?: number
          updated_at?: string
          user_id?: string
          year?: number
        }
        Relationships: [
          {
            foreignKeyName: "past_brand_work_creator_profile_id_fkey"
            columns: ["creator_profile_id"]
            isOneToOne: false
            referencedRelation: "creator_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      payments: {
        Row: {
          amount_usd: number
          created_at: string
          deal_id: string
          expected_at: string | null
          id: string
          received_at: string | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          amount_usd: number
          created_at?: string
          deal_id: string
          expected_at?: string | null
          id?: string
          received_at?: string | null
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          amount_usd?: number
          created_at?: string
          deal_id?: string
          expected_at?: string | null
          id?: string
          received_at?: string | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "payments_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["id"]
          },
        ]
      }
      reply_classifications: {
        Row: {
          category: string
          confidence: number | null
          created_at: string
          id: string
          message_id: string
          suggested_action: string
          summary: string
          updated_at: string
          user_id: string
        }
        Insert: {
          category: string
          confidence?: number | null
          created_at?: string
          id?: string
          message_id: string
          suggested_action: string
          summary: string
          updated_at?: string
          user_id: string
        }
        Update: {
          category?: string
          confidence?: number | null
          created_at?: string
          id?: string
          message_id?: string
          suggested_action?: string
          summary?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "reply_classifications_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
        ]
      }
      source_signals: {
        Row: {
          brand_id: string
          created_at: string
          evidence_json: Json | null
          evidence_url: string | null
          id: string
          signal_type: string
          updated_at: string
          user_id: string
          weight: number
        }
        Insert: {
          brand_id: string
          created_at?: string
          evidence_json?: Json | null
          evidence_url?: string | null
          id?: string
          signal_type: string
          updated_at?: string
          user_id: string
          weight?: number
        }
        Update: {
          brand_id?: string
          created_at?: string
          evidence_json?: Json | null
          evidence_url?: string | null
          id?: string
          signal_type?: string
          updated_at?: string
          user_id?: string
          weight?: number
        }
        Relationships: [
          {
            foreignKeyName: "source_signals_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
        ]
      }
      users: {
        Row: {
          created_at: string
          email: string
          name: string | null
          onboarding_completed_at: string | null
          physical_address: string | null
          sender_display_name: string | null
          timezone: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          email: string
          name?: string | null
          onboarding_completed_at?: string | null
          physical_address?: string | null
          sender_display_name?: string | null
          timezone?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          email?: string
          name?: string | null
          onboarding_completed_at?: string | null
          physical_address?: string | null
          sender_display_name?: string | null
          timezone?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      voice_samples: {
        Row: {
          created_at: string
          creator_profile_id: string
          id: string
          metadata_json: Json | null
          source: string
          tag: string | null
          text: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          creator_profile_id: string
          id?: string
          metadata_json?: Json | null
          source: string
          tag?: string | null
          text: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          creator_profile_id?: string
          id?: string
          metadata_json?: Json | null
          source?: string
          tag?: string | null
          text?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "voice_samples_creator_profile_id_fkey"
            columns: ["creator_profile_id"]
            isOneToOne: false
            referencedRelation: "creator_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      voice_style_guides: {
        Row: {
          created_at: string
          creator_profile_id: string
          id: string
          is_active: boolean
          learned_from_message_ids: string[]
          style_doc_json: Json
          updated_at: string
          user_id: string
          version: number
        }
        Insert: {
          created_at?: string
          creator_profile_id: string
          id?: string
          is_active?: boolean
          learned_from_message_ids?: string[]
          style_doc_json: Json
          updated_at?: string
          user_id: string
          version: number
        }
        Update: {
          created_at?: string
          creator_profile_id?: string
          id?: string
          is_active?: boolean
          learned_from_message_ids?: string[]
          style_doc_json?: Json
          updated_at?: string
          user_id?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "voice_style_guides_creator_profile_id_fkey"
            columns: ["creator_profile_id"]
            isOneToOne: false
            referencedRelation: "creator_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      claim_next_job: {
        Args: { p_kind: string; p_lease_seconds: number; p_worker_id: string }
        Returns: {
          attempts: number
          created_at: string
          error_message: string | null
          finished_at: string | null
          id: string
          kind: string
          locked_by: string | null
          locked_until: string | null
          max_attempts: number
          next_attempt_at: string
          payload_json: Json
          result_json: Json | null
          started_at: string | null
          status: string
          updated_at: string
          user_id: string
        }[]
        SetofOptions: {
          from: "*"
          to: "jobs"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      fuzzy_match_brands: {
        Args: {
          p_domain: string
          p_min_score: number
          p_name: string
          p_user_id: string
        }
        Returns: {
          brand_id: string
          matched_field: string
          score: number
        }[]
      }
      resolve_child_user_id: {
        Args: {
          expected_user_id: string
          provided_user_id: string
          relation_name: string
        }
        Returns: string
      }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
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
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
