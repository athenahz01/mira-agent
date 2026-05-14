import { z } from "zod";

import { waitForHunterRateLimit } from "./rate-limit.ts";

const HUNTER_API_BASE_URL = "https://api.hunter.io/v2";

export class HunterApiError extends Error {
  readonly requestUrl: string;
  readonly status?: number;

  constructor(
    message: string,
    requestUrl: string,
    status?: number,
  ) {
    super(message);
    this.name = "HunterApiError";
    this.requestUrl = requestUrl;
    this.status = status;
  }
}

const hunterDomainEmailSchema = z
  .object({
    value: z.string().email(),
    type: z.string().nullable().optional(),
    confidence: z.number().min(0).max(100).nullable().optional(),
    first_name: z.string().nullable().optional(),
    last_name: z.string().nullable().optional(),
    position: z.string().nullable().optional(),
    department: z.string().nullable().optional(),
    seniority: z.string().nullable().optional(),
  })
  .passthrough();

const hunterDomainSearchResponseSchema = z
  .object({
    data: z
      .object({
        domain: z.string().nullable().optional(),
        organization: z.string().nullable().optional(),
        pattern: z.string().nullable().optional(),
        emails: z.array(hunterDomainEmailSchema).default([]),
      })
      .passthrough(),
    meta: z.unknown().optional(),
  })
  .passthrough();

const hunterEmailVerifierResponseSchema = z
  .object({
    data: z
      .object({
        email: z.string().email(),
        result: z.string().nullable().optional(),
        status: z.string().nullable().optional(),
        score: z.number().min(0).max(100).nullable().optional(),
        smtp_check: z.boolean().nullable().optional(),
        mx_records: z.boolean().nullable().optional(),
      })
      .passthrough(),
    meta: z.unknown().optional(),
  })
  .passthrough();

export type HunterDomainEmail = z.infer<typeof hunterDomainEmailSchema>;
export type HunterDomainSearchResponse = z.infer<
  typeof hunterDomainSearchResponseSchema
>;
export type HunterEmailVerifierResponse = z.infer<
  typeof hunterEmailVerifierResponseSchema
>;

export type HunterClient = {
  domainSearch(input: {
    domain: string;
    limit?: number;
  }): Promise<HunterDomainSearchResponse>;
  emailVerifier(input: { email: string }): Promise<HunterEmailVerifierResponse>;
};

export function createHunterClient(): HunterClient {
  const apiKey = process.env.HUNTER_API_KEY;

  if (!apiKey) {
    throw new HunterApiError(
      "Missing HUNTER_API_KEY.",
      `${HUNTER_API_BASE_URL}/domain-search`,
    );
  }

  return {
    async domainSearch({ domain, limit = 10 }) {
      return hunterGet(
        "/domain-search",
        {
          domain,
          limit: String(limit),
        },
        hunterDomainSearchResponseSchema,
        apiKey,
      );
    },
    async emailVerifier({ email }) {
      return hunterGet(
        "/email-verifier",
        {
          email,
        },
        hunterEmailVerifierResponseSchema,
        apiKey,
      );
    },
  };
}

// `@hunter/api` is not published in npm, so Mira uses this typed fetch client
// around Hunter's public v2 API instead of adding an unmaintained wrapper.
async function hunterGet<T extends z.ZodTypeAny>(
  path: string,
  params: Record<string, string>,
  schema: T,
  apiKey: string,
): Promise<z.output<T>> {
  const url = new URL(`${HUNTER_API_BASE_URL}${path}`);

  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }

  url.searchParams.set("api_key", apiKey);
  await waitForHunterRateLimit();

  let response: Response;

  try {
    response = await fetch(url);
  } catch (error) {
    throw new HunterApiError(
      error instanceof Error ? error.message : "Hunter request failed.",
      sanitizeUrl(url),
    );
  }

  if (!response.ok) {
    throw new HunterApiError(
      `Hunter request failed with status ${response.status}.`,
      sanitizeUrl(url),
      response.status,
    );
  }

  const body = await response.json();
  const parsed = schema.safeParse(body);

  if (!parsed.success) {
    throw new HunterApiError(
      parsed.error.message,
      sanitizeUrl(url),
      response.status,
    );
  }

  return parsed.data;
}

function sanitizeUrl(url: URL) {
  const copy = new URL(url.toString());
  copy.searchParams.set("api_key", "redacted");
  return copy.toString();
}
