import { z } from "zod";

import { waitForInstagramRateLimit } from "./rate-limit.ts";

const DEFAULT_RAPIDAPI_INSTAGRAM_HOST =
  "instagram-scraper-stable-api.p.rapidapi.com";
const USER_POSTS_PATH = "/get_ig_user_posts.php";
const REQUEST_TIMEOUT_MS = 30_000;

export type IgPost = {
  code: string;
  taken_at_unix: number;
  caption: string | null;
  accessibility_caption: string | null;
  is_paid_partnership: boolean;
  sponsor_tags: { username: string; full_name?: string | null }[];
  usertags: { username: string; full_name: string | null; pk: string }[];
  like_count: number | null;
  comment_count: number | null;
  media_type: number;
};

export type RapidApiInstagramClient = {
  fetchRecentPosts(input: {
    username: string;
    maxPosts?: number;
    maxAgeDays?: number;
  }): Promise<IgPost[]>;
};

type NormalizedInstagramUser = {
  pk?: string;
  username: string;
  full_name: string | null;
};

export class RapidApiInstagramError extends Error {
  readonly requestUrl: string;
  readonly status?: number;
  readonly isRateLimited: boolean;

  constructor(
    message: string,
    requestUrl: string,
    status?: number,
    isRateLimited = false,
  ) {
    super(message);
    this.name = "RapidApiInstagramError";
    this.requestUrl = requestUrl;
    this.status = status;
    this.isRateLimited = isRateLimited;
  }
}

const rawInstagramUserSchema = z
  .object({
    pk: z.union([z.string(), z.number()]).nullable().optional(),
    username: z.string().nullable().optional(),
    full_name: z.string().nullable().optional(),
  })
  .passthrough();

const rawInstagramPostSchema = z
  .object({
    code: z.string().nullable().optional(),
    taken_at: z.union([z.number(), z.string()]).nullable().optional(),
    caption: z
      .union([
        z.string(),
        z
          .object({
            text: z.string().nullable().optional(),
          })
          .passthrough(),
      ])
      .nullable()
      .optional(),
    accessibility_caption: z.string().nullable().optional(),
    is_paid_partnership: z.boolean().nullable().optional(),
    sponsor_tags: z.array(z.unknown()).nullable().optional(),
    usertags: z
      .object({
        in: z.array(z.unknown()).default([]),
      })
      .passthrough()
      .nullable()
      .optional(),
    like_count: z.number().nullable().optional(),
    comment_count: z.number().nullable().optional(),
    media_type: z.number().nullable().optional(),
  })
  .passthrough();

const userPostsResponseSchema = z
  .object({
    posts: z.array(z.unknown()).default([]),
    pagination_token: z.string().nullable().optional(),
  })
  .passthrough();

export function createRapidApiInstagramClient(): RapidApiInstagramClient {
  const apiKey = process.env.RAPIDAPI_KEY;
  const host =
    process.env.RAPIDAPI_INSTAGRAM_HOST ?? DEFAULT_RAPIDAPI_INSTAGRAM_HOST;

  if (!apiKey) {
    throw new RapidApiInstagramError(
      "Missing RAPIDAPI_KEY.",
      `https://${host}${USER_POSTS_PATH}`,
    );
  }

  return {
    async fetchRecentPosts({ username, maxPosts = 100, maxAgeDays = 90 }) {
      const posts: IgPost[] = [];
      let paginationToken: string | null = null;
      const cutoffUnix = Math.floor(Date.now() / 1000) - maxAgeDays * 86_400;

      do {
        const response = await rapidApiPost(
          host,
          apiKey,
          username,
          paginationToken,
        );
        const normalized = response.posts
          .map(normalizeResponsePost)
          .filter((post): post is IgPost => Boolean(post))
          .filter((post) => post.taken_at_unix >= cutoffUnix);

        posts.push(...normalized);
        paginationToken = response.pagination_token ?? null;
      } while (paginationToken && posts.length < maxPosts);

      return posts.slice(0, maxPosts);
    },
  };
}

// RapidAPI docs: Instagram Scraper Stable API playground, "User Posts"
// endpoint, POST /get_ig_user_posts.php with username_or_url.
// https://rapidapi.com/thetechguy32744/api/instagram-scraper-stable-api/playground
async function rapidApiPost(
  host: string,
  apiKey: string,
  username: string,
  paginationToken: string | null,
) {
  const url = new URL(`https://${host}${USER_POSTS_PATH}`);
  const body = new URLSearchParams({
    username_or_url: username,
  });

  if (paginationToken) {
    body.set("pagination_token", paginationToken);
  }

  await waitForInstagramRateLimit();

  const controller = new AbortController();
  const timeout = windowlessSetTimeout(
    () => controller.abort(),
    REQUEST_TIMEOUT_MS,
  );

  let response: Response;

  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "x-rapidapi-host": host,
        "x-rapidapi-key": apiKey,
      },
      body,
      signal: controller.signal,
    });
  } catch (error) {
    throw new RapidApiInstagramError(
      error instanceof Error ? error.message : "RapidAPI request failed.",
      url.toString(),
    );
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    throw new RapidApiInstagramError(
      `RapidAPI Instagram request failed with status ${response.status}.`,
      url.toString(),
      response.status,
      response.status === 429,
    );
  }

  const json = await response.json();
  const parsed = userPostsResponseSchema.safeParse(json);

  if (!parsed.success) {
    throw new RapidApiInstagramError(
      parsed.error.message,
      url.toString(),
      response.status,
    );
  }

  return parsed.data;
}

function normalizeResponsePost(value: unknown): IgPost | null {
  const raw = readNode(value);
  const parsed = rawInstagramPostSchema.safeParse(raw);

  if (!parsed.success) {
    return null;
  }

  const post = parsed.data;
  const code = post.code?.trim();
  const takenAt = readNumber(post.taken_at);

  if (!code || !takenAt) {
    return null;
  }

  return {
    code,
    taken_at_unix: takenAt,
    caption: readCaption(post.caption),
    accessibility_caption: post.accessibility_caption ?? null,
    is_paid_partnership: post.is_paid_partnership ?? false,
    sponsor_tags: readSponsorTags(post.sponsor_tags ?? []),
    usertags: readUsertags(post.usertags?.in ?? []),
    like_count: post.like_count ?? null,
    comment_count: post.comment_count ?? null,
    media_type: post.media_type ?? 0,
  };
}

function readNode(value: unknown) {
  if (isRecord(value) && isRecord(value.node)) {
    return value.node;
  }

  return value;
}

function readNumber(value: string | number | null | undefined) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function readCaption(value: z.infer<typeof rawInstagramPostSchema>["caption"]) {
  if (typeof value === "string") {
    return value;
  }

  if (value && typeof value.text === "string") {
    return value.text;
  }

  return null;
}

function readSponsorTags(values: unknown[]) {
  return values
    .map(readInstagramUser)
    .filter((user): user is NormalizedInstagramUser => Boolean(user));
}

function readUsertags(values: unknown[]) {
  return values
    .map((value) => (isRecord(value) ? value.user : null))
    .map(readInstagramUser)
    .filter((user): user is NormalizedInstagramUser => Boolean(user))
    .map((user) => ({
      username: user.username,
      full_name: user.full_name ?? null,
      pk: user.pk ?? "",
    }));
}

function readInstagramUser(value: unknown): NormalizedInstagramUser | null {
  const raw =
    isRecord(value) && isRecord(value.user)
      ? value.user
      : isRecord(value) && isRecord(value.sponsor)
        ? value.sponsor
        : value;
  const parsed = rawInstagramUserSchema.safeParse(raw);

  if (!parsed.success || !parsed.data.username) {
    return null;
  }

  return {
    pk: parsed.data.pk ? String(parsed.data.pk) : undefined,
    username: normalizeHandle(parsed.data.username),
    full_name: parsed.data.full_name ?? null,
  };
}

function normalizeHandle(value: string) {
  return value.trim().toLowerCase().replace(/^@/, "");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function windowlessSetTimeout(
  handler: () => void,
  timeoutMs: number,
): ReturnType<typeof setTimeout> {
  return setTimeout(handler, timeoutMs);
}
