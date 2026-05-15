import { z } from "zod";

export const outreachRulesSchema = z.object({
  id: z.string().uuid().optional(),
  creator_profile_id: z.string().uuid().nullable(),
  max_sends_per_day: z.number().int().nonnegative(),
  max_drafts_per_day: z.number().int().min(0).max(50),
  follow_up_enabled: z.boolean(),
  follow_up_1_days_after: z.number().int().min(1).max(30),
  follow_up_2_days_after_initial: z.number().int().min(1).max(60),
  follow_up_max_count: z.number().int().min(0).max(3),
  send_mode: z.enum(["immediate", "queued"]),
  send_window_start_hour: z.number().int().min(0).max(23),
  send_window_end_hour: z.number().int().min(0).max(23),
  send_timezone: z.string().min(1),
  min_minutes_between_sends: z.number().int().nonnegative(),
  max_minutes_between_sends: z.number().int().nonnegative(),
  send_on_weekends: z.boolean(),
  excluded_categories: z.array(z.string().min(1)),
  auto_send_after_approval: z.boolean(),
  require_per_email_approval: z.boolean(),
  warmup_mode: z.boolean(),
  warmup_max_per_day: z.number().int().nonnegative(),
});

export type OutreachRulesInput = z.infer<typeof outreachRulesSchema>;
