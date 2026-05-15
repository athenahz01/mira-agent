import { randomUUID } from "node:crypto";

import type { Tables } from "../lib/db/types";
import { decideSendTime } from "../lib/sending/pacing.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

const mondayMorningUtc = new Date("2026-05-18T14:00:00.000Z");
const saturdayMorningUtc = new Date("2026-05-16T14:00:00.000Z");

const immediate = decideSendTime({
  rules: rules(),
  lastSentAt: null,
  sentTodayCount: 0,
  now: mondayMorningUtc,
});
assert(
  immediate.kind === "send_immediately",
  "Within the send window should send immediately in immediate mode.",
);

const capped = decideSendTime({
  rules: rules({ warmup_mode: true, warmup_max_per_day: 1 }),
  lastSentAt: null,
  sentTodayCount: 1,
  now: mondayMorningUtc,
});
assert(capped.kind === "reject", "Warmup cap should reject extra sends.");
assert(
  capped.kind === "reject" && capped.reason === "daily_cap",
  "Warmup cap should return daily_cap.",
);

const beforeWindow = decideSendTime({
  rules: rules(),
  lastSentAt: null,
  sentTodayCount: 0,
  now: new Date("2026-05-18T11:00:00.000Z"),
});
assert(
  beforeWindow.kind === "schedule_at",
  "Before window should schedule for the next opening.",
);
assert(
  beforeWindow.kind === "schedule_at" &&
    beforeWindow.scheduled_send_at.toISOString() === "2026-05-18T13:00:00.000Z",
  "Before-window schedule should land at 9am New York.",
);

const weekend = decideSendTime({
  rules: rules({ send_on_weekends: false }),
  lastSentAt: null,
  sentTodayCount: 0,
  now: saturdayMorningUtc,
});
assert(weekend.kind === "schedule_at", "Weekend should schedule forward.");
assert(
  weekend.kind === "schedule_at" &&
    weekend.scheduled_send_at.toISOString() === "2026-05-18T13:00:00.000Z",
  "Weekend without weekend sends should schedule Monday at 9am New York.",
);

const queued = decideSendTime({
  rules: rules({
    send_mode: "queued",
    min_minutes_between_sends: 4,
    max_minutes_between_sends: 4,
  }),
  lastSentAt: new Date("2026-05-18T13:58:00.000Z"),
  sentTodayCount: 0,
  now: mondayMorningUtc,
});
assert(queued.kind === "schedule_at", "Queued mode should schedule.");
assert(
  queued.kind === "schedule_at" &&
    queued.scheduled_send_at.toISOString() === "2026-05-18T14:02:00.000Z",
  "Queued mode should respect the minimum spacing after the last send.",
);

console.log("Pacing logic test passed.");

function rules(overrides: Partial<Tables<"outreach_rules">> = {}) {
  const now = new Date().toISOString();
  const row: Tables<"outreach_rules"> = {
    id: randomUUID(),
    created_at: now,
    updated_at: now,
    user_id: randomUUID(),
    creator_profile_id: null,
    max_sends_per_day: 15,
    max_drafts_per_day: 10,
    follow_up_enabled: true,
    follow_up_1_days_after: 7,
    follow_up_2_days_after_initial: 14,
    follow_up_max_count: 2,
    send_mode: "immediate",
    send_window_start_hour: 9,
    send_window_end_hour: 16,
    send_timezone: "America/New_York",
    min_minutes_between_sends: 4,
    max_minutes_between_sends: 11,
    send_on_weekends: false,
    excluded_brand_ids: [],
    excluded_categories: [],
    auto_send_after_approval: false,
    require_per_email_approval: true,
    warmup_mode: false,
    warmup_max_per_day: 5,
  };

  return {
    ...row,
    ...overrides,
  };
}
