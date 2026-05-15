import { z } from "zod";

export const researchBriefJsonSchema = z
  .object({
    why_this_brand: z.string().min(1),
    why_this_deal_type: z.string().min(1),
    recommended_hook: z
      .object({
        pattern_name: z.string().min(1),
        one_liner: z.string().min(1),
        why_this_hook: z.string().min(1),
      })
      .strict(),
    suggested_subject_themes: z.array(z.string().min(1)).min(3).max(3),
    risk_flags: z.array(z.string().min(1)).max(3),
    confidence: z.number().int().min(0).max(100),
  })
  .strict();

export type ResearchBriefJson = z.infer<typeof researchBriefJsonSchema>;
