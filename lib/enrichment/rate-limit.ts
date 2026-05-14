const DEFAULT_HUNTER_RATE_LIMIT_PER_MINUTE = 10;

let requestTimestamps: number[] = [];
let lastRequestAt = 0;

export async function waitForHunterRateLimit() {
  const limit = getHunterRateLimitPerMinute();
  const now = Date.now();
  const windowMs = 60_000;
  const minDelayMs = Math.ceil(windowMs / limit);

  requestTimestamps = requestTimestamps.filter(
    (timestamp) => now - timestamp < windowMs,
  );

  if (requestTimestamps.length >= limit) {
    const oldest = requestTimestamps[0];
    await sleep(Math.max(0, windowMs - (now - oldest)));
  }

  const nextAllowedAt = lastRequestAt + minDelayMs;
  const delay = Math.max(0, nextAllowedAt - Date.now());

  if (delay > 0) {
    await sleep(delay);
  }

  const timestamp = Date.now();
  lastRequestAt = timestamp;
  requestTimestamps.push(timestamp);
}

function getHunterRateLimitPerMinute() {
  const rawValue = process.env.HUNTER_RATE_LIMIT_PER_MINUTE;
  const parsed = rawValue ? Number(rawValue) : DEFAULT_HUNTER_RATE_LIMIT_PER_MINUTE;

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_HUNTER_RATE_LIMIT_PER_MINUTE;
  }

  return Math.floor(parsed);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
