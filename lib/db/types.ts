export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

type FlexibleFields = {
  [key: string]: Json | undefined;
};

type BaseRow = {
  id: string;
  created_at: string;
  updated_at: string;
  user_id: string;
};

type BaseInsert = {
  id?: string;
  created_at?: string;
  updated_at?: string;
  user_id: string;
};

type BaseUpdate = {
  id?: string;
  created_at?: string;
  updated_at?: string;
  user_id?: string;
};

type Table<Row, Insert, Update> = {
  Row: Row;
  Insert: Insert;
  Update: Update;
  Relationships: [];
};

type GenericRow = BaseRow & FlexibleFields;
type GenericInsert = BaseInsert & FlexibleFields;
type GenericUpdate = BaseUpdate & FlexibleFields;
type GenericTable = Table<GenericRow, GenericInsert, GenericUpdate>;

type UsersRow = {
  user_id: string;
  created_at: string;
  updated_at: string;
  email: string;
  name: string | null;
  timezone: string;
  physical_address: string | null;
  gmail_oauth_token_ref: string | null;
};

type UsersInsert = {
  user_id: string;
  created_at?: string;
  updated_at?: string;
  email: string;
  name?: string | null;
  timezone?: string;
  physical_address?: string | null;
  gmail_oauth_token_ref?: string | null;
};

type UsersUpdate = Partial<UsersInsert>;

type CreatorProfileTier = "nano" | "micro" | "mid" | "macro";

type CreatorProfilesRow = BaseRow & {
  handle: string;
  display_name: string;
  platform: string;
  niche_tags: string[];
  audience_size_snapshot: number | null;
  engagement_rate_snapshot: number | null;
  tier: CreatorProfileTier | null;
  aesthetic_keywords: string[];
  bio_extract: string | null;
  recent_post_themes: string[];
  voice_style_guide_id: string | null;
  active: boolean;
  cross_pitch_cooldown_days: number;
};

type CreatorProfilesInsert = BaseInsert & {
  handle: string;
  display_name: string;
  platform?: string;
  niche_tags?: string[];
  audience_size_snapshot?: number | null;
  engagement_rate_snapshot?: number | null;
  tier?: CreatorProfileTier | null;
  aesthetic_keywords?: string[];
  bio_extract?: string | null;
  recent_post_themes?: string[];
  voice_style_guide_id?: string | null;
  active?: boolean;
  cross_pitch_cooldown_days?: number;
};

type CreatorProfilesUpdate = Partial<CreatorProfilesInsert>;

type BrandSizeEstimate =
  | "pre-launch"
  | "indie-small"
  | "indie-medium"
  | "established-dtc"
  | "legacy-large";

type BrandsRow = BaseRow & {
  name: string;
  aliases: string[];
  domain: string | null;
  instagram_handle: string | null;
  tiktok_handle: string | null;
  category: string[];
  aesthetic_tags: string[];
  size_estimate: BrandSizeEstimate | null;
  creator_friendliness_score: number | null;
  pays_creators: boolean | null;
  last_pitched_at: string | null;
  pitch_count: number;
  source_signals_summary: string | null;
  excluded: boolean;
  exclusion_reason: string | null;
};

type BrandsInsert = BaseInsert & {
  name: string;
  aliases?: string[];
  domain?: string | null;
  instagram_handle?: string | null;
  tiktok_handle?: string | null;
  category?: string[];
  aesthetic_tags?: string[];
  size_estimate?: BrandSizeEstimate | null;
  creator_friendliness_score?: number | null;
  pays_creators?: boolean | null;
  last_pitched_at?: string | null;
  pitch_count?: number;
  source_signals_summary?: string | null;
  excluded?: boolean;
  exclusion_reason?: string | null;
};

type BrandsUpdate = Partial<BrandsInsert>;

type OutreachRulesRow = BaseRow & {
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

type OutreachRulesInsert = BaseInsert & {
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

type OutreachRulesUpdate = Partial<OutreachRulesInsert>;

export type Database = {
  public: {
    Tables: {
      users: Table<UsersRow, UsersInsert, UsersUpdate>;
      creator_profiles: Table<
        CreatorProfilesRow,
        CreatorProfilesInsert,
        CreatorProfilesUpdate
      >;
      voice_style_guides: GenericTable;
      media_kits: GenericTable;
      brands: Table<BrandsRow, BrandsInsert, BrandsUpdate>;
      brand_contacts: GenericTable;
      source_signals: GenericTable;
      campaigns: GenericTable;
      messages: GenericTable;
      email_threads: GenericTable;
      reply_classifications: GenericTable;
      follow_up_sequences: GenericTable;
      deals: GenericTable;
      deliverables: GenericTable;
      payments: GenericTable;
      voice_samples: GenericTable;
      feedback_marks: GenericTable;
      hook_library: GenericTable;
      outreach_rules: Table<
        OutreachRulesRow,
        OutreachRulesInsert,
        OutreachRulesUpdate
      >;
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
