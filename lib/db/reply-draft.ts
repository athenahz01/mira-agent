import { z } from "zod";

export const replyDraftJsonSchema = z
  .object({
    body_text: z.string().min(1),
    model_used: z.string().min(1),
    prompt_hash: z.string().min(1),
  })
  .strict();

export type ReplyDraftJson = z.infer<typeof replyDraftJsonSchema>;
