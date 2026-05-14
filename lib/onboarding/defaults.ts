import type { TablesInsert } from "../db/types";

export const defaultSenderDisplayName = "Athena Huo";
export const defaultTimezone = "America/New_York";

export type DefaultCreatorProfile = Omit<
  TablesInsert<"creator_profiles">,
  "user_id"
>;

export const defaultCreatorProfiles: DefaultCreatorProfile[] = [
  {
    handle: "athena_hz",
    display_name: "Athena Huo",
    platform: "instagram",
    niche_tags: ["fashion", "lifestyle", "ugc", "nyc", "asian-american"],
    aesthetic_keywords: ["warm-toned", "soft-girl", "preppy-elevated"],
    recent_post_themes: [],
    active: true,
    cross_pitch_cooldown_days: 90,
  },
  {
    handle: "athena_huo",
    display_name: "Athena Huo",
    platform: "instagram",
    niche_tags: [
      "college",
      "grad-school",
      "female-power",
      "ai-tools",
      "career",
    ],
    aesthetic_keywords: [
      "grounded",
      "tech-curious",
      "career-aware",
      "campus-polished",
    ],
    recent_post_themes: [],
    active: true,
    cross_pitch_cooldown_days: 90,
  },
];
