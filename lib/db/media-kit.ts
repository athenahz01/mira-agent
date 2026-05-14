import { z } from "zod";

export const dealTypeSchema = z.enum([
  "paid",
  "gifting",
  "affiliate",
  "ugc",
  "ambassador",
]);

export const deliverableKindSchema = z.enum([
  "ig_reel",
  "ig_static",
  "ig_story",
  "tiktok",
  "ugc_video",
  "ugc_photo_set",
]);

export const pastBrandWorkInputSchema = z
  .object({
    brand_name: z.string().min(1),
    year: z.number().int().min(2000).max(2100),
    deal_type: dealTypeSchema,
    one_liner: z.string().min(1),
    link: z.string().url().optional(),
  })
  .strict();

export const mediaKitJsonSchema = z
  .object({
    version: z.literal(1),
    profile_summary: z
      .object({
        handle: z.string().min(1),
        display_name: z.string().min(1),
        tagline: z.string().min(1),
        location: z.string().min(1),
        languages: z.array(z.string().min(1)),
      })
      .strict(),
    audience: z
      .object({
        platform: z.enum(["instagram", "tiktok"]),
        follower_count: z.number().int().nonnegative(),
        engagement_rate: z.number().min(0).max(1),
        tier: z.enum(["nano", "micro", "mid", "macro"]),
        demographics: z
          .object({
            gender_split: z
              .object({
                female: z.number().min(0).max(1).optional(),
                male: z.number().min(0).max(1).optional(),
                nonbinary: z.number().min(0).max(1).optional(),
              })
              .strict()
              .optional(),
            age_brackets: z.record(z.number().min(0).max(1)).optional(),
            top_locations: z.array(z.string().min(1)).optional(),
            notes: z.string().optional(),
          })
          .strict(),
      })
      .strict(),
    niche: z
      .object({
        categories: z.array(z.string().min(1)),
        aesthetic_keywords: z.array(z.string().min(1)),
        content_pillars: z.array(z.string().min(1)).min(3).max(5),
      })
      .strict(),
    deliverables: z.array(
      z
        .object({
          kind: deliverableKindSchema,
          description: z.string().min(1),
          suggested_rate_usd: z
            .object({
              min: z.number().nonnegative(),
              max: z.number().nonnegative(),
            })
            .strict()
            .refine((value) => value.max >= value.min, {
              message: "max rate must be greater than or equal to min rate",
            }),
          gifting_minimum_value_usd: z.number().nonnegative().optional(),
          usage_rights_included: z.string().min(1),
          typical_turnaround_days: z.number().int().positive(),
          notes: z.string().optional(),
        })
        .strict(),
    ),
    past_brand_work: z.array(pastBrandWorkInputSchema),
    contact: z
      .object({
        email: z.string().email(),
        website: z.string().url().optional(),
        instagram: z.string().min(1),
        tiktok: z.string().min(1).optional(),
      })
      .strict(),
    rate_methodology_note: z.string().min(1),
  })
  .strict();

export type MediaKitJson = z.infer<typeof mediaKitJsonSchema>;
export type PastBrandWorkInput = z.infer<typeof pastBrandWorkInputSchema>;
