import type { Tables } from "../db/types";

export type SendPacingInputs = {
  rules: Tables<"outreach_rules">;
  lastSentAt: Date | null;
  sentTodayCount: number;
  now: Date;
};

export type SendDecision =
  | { kind: "send_immediately" }
  | { kind: "schedule_at"; scheduled_send_at: Date }
  | { kind: "reject"; reason: "daily_cap" | "outside_window" | "send_paused" };

export function decideSendTime(input: SendPacingInputs): SendDecision {
  const cap = input.rules.warmup_mode
    ? input.rules.warmup_max_per_day
    : input.rules.max_sends_per_day;

  if (input.sentTodayCount >= cap) {
    return {
      kind: "reject",
      reason: "daily_cap",
    };
  }

  const windowDecision = decideWindow(input.rules, input.now);

  if (windowDecision.kind === "schedule_at") {
    return windowDecision;
  }

  if (input.rules.send_mode === "immediate") {
    return {
      kind: "send_immediately",
    };
  }

  const delayMinutes = randomIntInclusive(
    input.rules.min_minutes_between_sends,
    input.rules.max_minutes_between_sends,
  );
  const delayedAfterLast = input.lastSentAt
    ? new Date(input.lastSentAt.getTime() + delayMinutes * 60_000)
    : input.now;
  const earliest = new Date(Math.max(input.now.getTime(), delayedAfterLast.getTime()));

  return constrainToSendWindow(input.rules, earliest);
}

function decideWindow(
  rules: Tables<"outreach_rules">,
  now: Date,
): SendDecision | { kind: "inside_window" } {
  const parts = getZonedParts(now, rules.send_timezone);

  if (isWeekend(parts.weekday) && !rules.send_on_weekends) {
    return {
      kind: "schedule_at",
      scheduled_send_at: nextWindowStart(rules, now, 1),
    };
  }

  if (parts.hour < rules.send_window_start_hour) {
    return {
      kind: "schedule_at",
      scheduled_send_at: zonedWallTimeToUtc(
        parts.year,
        parts.month,
        parts.day,
        rules.send_window_start_hour,
        0,
        rules.send_timezone,
      ),
    };
  }

  if (parts.hour >= rules.send_window_end_hour) {
    return {
      kind: "schedule_at",
      scheduled_send_at: nextWindowStart(rules, now, 1),
    };
  }

  return {
    kind: "inside_window",
  };
}

function constrainToSendWindow(
  rules: Tables<"outreach_rules">,
  candidate: Date,
): SendDecision {
  const windowDecision = decideWindow(rules, candidate);

  if (windowDecision.kind === "inside_window") {
    return {
      kind: "schedule_at",
      scheduled_send_at: candidate,
    };
  }

  return windowDecision;
}

function nextWindowStart(
  rules: Tables<"outreach_rules">,
  from: Date,
  dayOffset: number,
) {
  const parts = getZonedParts(from, rules.send_timezone);
  let candidate = addDaysInZone(parts, dayOffset);

  while (isWeekend(candidate.weekday) && !rules.send_on_weekends) {
    candidate = addDaysInZone(candidate, 1);
  }

  return zonedWallTimeToUtc(
    candidate.year,
    candidate.month,
    candidate.day,
    rules.send_window_start_hour,
    0,
    rules.send_timezone,
  );
}

function addDaysInZone(parts: ZonedParts, days: number): ZonedParts {
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days));
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
    hour: 0,
    minute: 0,
    weekday: getWeekday(date),
  };
}

type ZonedParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  weekday: string;
};

function getZonedParts(date: Date, timeZone: string): ZonedParts {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const parts = Object.fromEntries(
    formatter.formatToParts(date).map((part) => [part.type, part.value]),
  );

  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    weekday: parts.weekday ?? getWeekday(date),
  };
}

function zonedWallTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string,
) {
  const utcGuess = new Date(Date.UTC(year, month - 1, day, hour, minute));
  const offset = getTimeZoneOffsetMs(timeZone, utcGuess);
  const firstPass = new Date(utcGuess.getTime() - offset);
  const correctedOffset = getTimeZoneOffsetMs(timeZone, firstPass);

  return new Date(utcGuess.getTime() - correctedOffset);
}

function getTimeZoneOffsetMs(timeZone: string, date: Date) {
  const parts = getZonedParts(date, timeZone);
  const asUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
  );

  return asUtc - date.getTime();
}

function getWeekday(date: Date) {
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][date.getUTCDay()];
}

function isWeekend(weekday: string) {
  return weekday === "Sat" || weekday === "Sun";
}

function randomIntInclusive(min: number, max: number) {
  const safeMin = Math.min(min, max);
  const safeMax = Math.max(min, max);

  return Math.floor(Math.random() * (safeMax - safeMin + 1)) + safeMin;
}
