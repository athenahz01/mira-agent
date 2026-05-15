import { z } from "zod";

export const replyCategorySchema = z.enum([
  "interested",
  "asks_rate",
  "asks_more_info",
  "decline_polite",
  "decline_firm",
  "out_of_office",
  "wrong_person",
  "unsubscribe",
  "spam",
  "other",
]);

export const suggestedReplyActionSchema = z.enum([
  "draft_reply",
  "pause_campaign",
  "move_to_negotiating",
  "mark_lost",
  "no_action",
]);

export const replyClassificationJsonSchema = z
  .object({
    category: replyCategorySchema,
    confidence: z.number().int().min(0).max(100),
    summary: z.string().min(1),
    suggested_action: suggestedReplyActionSchema,
    detected_signals: z.array(z.string()).max(3),
  })
  .strict();

export type ReplyCategory = z.infer<typeof replyCategorySchema>;
export type SuggestedReplyAction = z.infer<typeof suggestedReplyActionSchema>;
export type ReplyClassificationJson = z.infer<
  typeof replyClassificationJsonSchema
>;
