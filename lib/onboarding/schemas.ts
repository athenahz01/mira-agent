import { z } from "zod";

import { voiceStyleGuideJsonSchema } from "../db/style-guide.ts";

export const creatorTierSchema = z.enum(["nano", "micro", "mid", "macro"]);
export const creatorPlatformSchema = z.enum(["instagram"]);

const textArraySchema = z
  .array(z.string().trim().min(1))
  .transform((items) => [...new Set(items.map((item) => item.trim()))]);

export const userBasicsSchema = z.object({
  name: z.string().trim().min(1, "Add the name Mira should use in the app."),
  timezone: z.string().trim().min(1, "Choose a timezone."),
  physical_address: z
    .string()
    .trim()
    .min(8, "Add the mailing address required in outreach footers."),
  sender_display_name: z
    .string()
    .trim()
    .min(1, "Add the sender name brands should see."),
});

export const creatorProfileSchema = z.object({
  id: z.string().uuid().optional(),
  handle: z
    .string()
    .trim()
    .min(1)
    .transform((value) => value.replace(/^@/, "")),
  display_name: z.string().trim().min(1),
  platform: creatorPlatformSchema.default("instagram"),
  niche_tags: textArraySchema,
  audience_size_snapshot: z.number().int().nonnegative().nullable(),
  engagement_rate_snapshot: z.number().min(0).max(1).nullable(),
  tier: creatorTierSchema.nullable(),
  aesthetic_keywords: textArraySchema,
  bio_extract: z.string().trim().nullable(),
  recent_post_themes: textArraySchema,
  cross_pitch_cooldown_days: z.number().int().nonnegative(),
  active: z.boolean(),
});

export const voiceSampleSourceSchema = z.enum([
  "website",
  "ig_caption",
  "email_sent",
  "manual_paste",
]);

export const voiceSampleInputSchema = z.object({
  source: voiceSampleSourceSchema,
  text: z.string().trim().min(1),
  tag: z.string().trim().nullable(),
});

export const addVoiceSamplesSchema = z.object({
  profileId: z.string().uuid(),
  samples: z.array(voiceSampleInputSchema).min(1),
});

export const profileIdSchema = z.object({
  profileId: z.string().uuid(),
});

export const saveVoiceGuideEditsSchema = z.object({
  guideId: z.string().uuid(),
  edits: voiceStyleGuideJsonSchema,
});

export type UserBasicsInput = z.input<typeof userBasicsSchema>;
export type CreatorProfileInput = z.input<typeof creatorProfileSchema>;
export type VoiceSampleInput = z.infer<typeof voiceSampleInputSchema>;
export type AddVoiceSamplesInput = z.infer<typeof addVoiceSamplesSchema>;
