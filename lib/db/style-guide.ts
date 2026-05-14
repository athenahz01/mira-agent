import { z } from "zod";

export const voiceGuideRegisterSchema = z
  .object({
    default: z.enum([
      "warm-grounded",
      "warm-enthusiastic",
      "professional-grounded",
      "playful-grounded",
    ]),
    paid_pitch_adjustment: z.string().min(1),
    gifting_pitch_adjustment: z.string().min(1),
    ugc_pitch_adjustment: z.string().min(1),
    ambassador_pitch_adjustment: z.string().min(1),
    affiliate_pitch_adjustment: z.string().min(1),
  })
  .strict();

export const voiceStyleGuideJsonSchema = z
  .object({
    version: z.literal(1),
    register: voiceGuideRegisterSchema,
    sentence_length_target: z
      .object({
        min_words: z.number().int().nonnegative(),
        max_words: z.number().int().positive(),
        mean_words: z.number().positive(),
      })
      .strict()
      .refine((value) => value.max_words >= value.min_words, {
        message: "max_words must be greater than or equal to min_words",
      }),
    emoji_policy: z.enum(["none", "rare-only", "occasional", "frequent"]),
    signature: z
      .object({
        sign_off: z.string().min(1),
        include_links: z.array(
          z.enum(["website", "instagram_main", "instagram_growth", "tiktok"]),
        ),
        title_line: z.string().min(1).optional(),
      })
      .strict(),
    avoid_phrases: z.array(z.string().min(1)),
    avoid_patterns: z.array(z.string().min(1)),
    favored_phrases: z.array(z.string().min(1)),
    personal_anchors: z
      .object({
        schools: z.array(z.string().min(1)),
        cities: z.array(z.string().min(1)),
        formats: z.array(z.string().min(1)),
        languages: z.array(z.string().min(1)),
        sizing: z.array(z.string().min(1)),
        other: z.array(z.string().min(1)),
      })
      .strict(),
    hook_patterns: z.array(z.string().min(1)).min(3).max(5),
    notes: z.string(),
  })
  .strict();

export type VoiceStyleGuideJson = z.infer<typeof voiceStyleGuideJsonSchema>;

export const defaultVoiceStyleGuide: VoiceStyleGuideJson = {
  version: 1,
  register: {
    default: "warm-grounded",
    paid_pitch_adjustment:
      "Drop the warmest fillers; keep one specific reason for the brand fit.",
    gifting_pitch_adjustment:
      "Warm and enthusiastic is fine; one personal-fit detail is enough.",
    ugc_pitch_adjustment:
      "Lead with what content you'd produce; tone neutral-professional.",
    ambassador_pitch_adjustment:
      "Frame as a longer-term relationship, mention past brand work.",
    affiliate_pitch_adjustment: "Brief and direct; mention audience trust.",
  },
  sentence_length_target: {
    min_words: 8,
    max_words: 22,
    mean_words: 14,
  },
  emoji_policy: "rare-only",
  signature: {
    sign_off: "Best, Athena",
    include_links: ["website", "instagram_main"],
    title_line: "fashion, lifestyle, UGC, and career creator",
  },
  avoid_phrases: [
    "huge fan",
    "loyal customer",
    "amazing products",
    "I'd love to chat",
  ],
  avoid_patterns: [
    "double exclamation marks",
    "generic compliments without a specific product or campaign reason",
  ],
  favored_phrases: ["thoughtful", "specific", "aligned", "excited to explore"],
  personal_anchors: {
    schools: ["UC Berkeley", "Cornell"],
    cities: ["Bay Area", "NYC"],
    formats: ["fit checks", "campus vlogs", "UGC videos"],
    languages: ["English", "Mandarin"],
    sizing: ["size 0-4"],
    other: ["fashion and lifestyle creator", "AI and career content"],
  },
  hook_patterns: [
    "Connect a specific brand product to a recent creator profile theme.",
    "Open with a concrete content concept Mira could produce for the brand.",
    "Reference a shared audience context before pitching the collaboration.",
  ],
  notes:
    "Use this default only as a fallback when generation is unavailable; prefer profile-specific samples.",
};
