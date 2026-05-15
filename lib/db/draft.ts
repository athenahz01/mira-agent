import { z } from "zod";

export const draftJsonSchema = z
  .object({
    subject_variants: z.array(z.string().min(1).max(80)).min(3).max(3),
    body_text: z.string().min(1),
    body_html: z.string().nullable(),
    hook_pattern_name: z.string().min(1),
    model_used: z.string().min(1),
    prompt_hash: z.string().min(1),
  })
  .strict();

export type DraftJson = z.infer<typeof draftJsonSchema>;
