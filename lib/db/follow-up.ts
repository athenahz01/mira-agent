import { z } from "zod";

export const followUpDraftJsonSchema = z
  .object({
    body_text: z.string().min(1),
    angle_used: z.string().min(1),
    model_used: z.string().min(1),
    prompt_hash: z.string().min(1),
  })
  .strict();

export type FollowUpDraftJson = z.infer<typeof followUpDraftJsonSchema>;
