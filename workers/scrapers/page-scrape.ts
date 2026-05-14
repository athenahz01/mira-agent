import type { SupabaseClient } from "@supabase/supabase-js";
import { chromium } from "playwright";
import robotsParser from "robots-parser";
import { z } from "zod";

import type { Database, Json, Tables } from "../../lib/db/types.ts";

const USER_AGENT =
  "Mozilla/5.0 (compatible; Mira Outreach Bot; +mailto:zhengathenahuo@gmail.com)";
const CANDIDATE_PATHS = [
  "/contact",
  "/contact-us",
  "/press",
  "/press-kit",
  "/influencers",
  "/collabs",
  "/partnerships",
  "/about",
];
const EMAIL_REGEX = /[a-zA-Z0-9._+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const PAGE_TIMEOUT_MS = 15_000;
const BRAND_TIMEOUT_MS = 90_000;

const pageScrapePayloadSchema = z.object({
  brand_id: z.string().uuid(),
  domain: z.string().min(1),
});

type ContactRole =
  | "pr"
  | "marketing"
  | "partnerships"
  | "founder"
  | "generic_info"
  | "unknown";

type EmailMatch = {
  email: string;
  context: string;
};

export type PageScrapeResult = {
  brand_id: string;
  pages_scraped: {
    url: string;
    status: number;
    found_emails: number;
  }[];
  contacts: {
    email: string;
    role: ContactRole;
    context: string;
    source_path: string;
  }[];
};

export async function processPageScrapeJob(
  supabase: SupabaseClient<Database>,
  job: Tables<"jobs">,
): Promise<PageScrapeResult> {
  const payload = pageScrapePayloadSchema.parse(job.payload_json);
  const result = await scrapePageForBrand({
    brandId: payload.brand_id,
    domain: payload.domain,
  });

  await persistPageScrapeResult(supabase, job.user_id, result);
  return result;
}

export async function scrapePageForBrand(input: {
  brandId: string;
  domain: string;
}): Promise<PageScrapeResult> {
  const baseUrl = buildBaseUrl(input.domain);
  const robots = await loadRobots(baseUrl);
  const browser = await chromium.launch({
    headless: true,
  });
  const pagesScraped: PageScrapeResult["pages_scraped"] = [];
  const contactsByEmail = new Map<string, PageScrapeResult["contacts"][number]>();
  const deadline = Date.now() + BRAND_TIMEOUT_MS;

  try {
    const context = await browser.newContext({
      userAgent: USER_AGENT,
    });
    const page = await context.newPage();
    page.setDefaultNavigationTimeout(PAGE_TIMEOUT_MS);
    page.setDefaultTimeout(PAGE_TIMEOUT_MS);

    for (const path of CANDIDATE_PATHS) {
      if (Date.now() >= deadline) {
        break;
      }

      const url = new URL(path, baseUrl).toString();

      if (!robots.canFetch(url)) {
        pagesScraped.push({
          url,
          status: 0,
          found_emails: 0,
        });
        continue;
      }

      const response = await page.goto(url, {
        waitUntil: "domcontentloaded",
        timeout: Math.min(PAGE_TIMEOUT_MS, Math.max(1, deadline - Date.now())),
      });
      const status = response?.status() ?? 0;

      if (status >= 400 || status === 0) {
        pagesScraped.push({
          url,
          status,
          found_emails: 0,
        });
        continue;
      }

      const text = await page.evaluate(() => document.body?.innerText ?? "");
      const matches = extractEmailsWithContext(text);
      pagesScraped.push({
        url,
        status,
        found_emails: matches.length,
      });

      for (const match of matches) {
        const existing = contactsByEmail.get(match.email);

        if (!existing) {
          contactsByEmail.set(match.email, {
            email: match.email,
            role: detectPageScrapeRole(match),
            context: match.context,
            source_path: path,
          });
        }
      }
    }
  } finally {
    await browser.close();
  }

  return {
    brand_id: input.brandId,
    pages_scraped: pagesScraped,
    contacts: [...contactsByEmail.values()],
  };
}

export function extractEmailsWithContext(text: string): EmailMatch[] {
  const matches: EmailMatch[] = [];

  for (const match of text.matchAll(EMAIL_REGEX)) {
    const email = match[0].toLowerCase();
    const index = match.index ?? 0;
    const start = Math.max(0, index - 50);
    const end = Math.min(text.length, index + email.length + 50);
    const context = text
      .slice(start, end)
      .replace(/\s+/g, " ")
      .trim();

    matches.push({
      email,
      context,
    });
  }

  return matches;
}

export function detectPageScrapeRole(input: {
  email: string;
  context?: string | null;
}): ContactRole {
  const localPart = input.email.split("@")[0]?.toLowerCase() ?? "";
  const context = input.context?.toLowerCase() ?? "";
  const searchable = `${localPart} ${context}`;

  if (/\b(founder|ceo|cmo)\b/.test(localPart)) {
    return "founder";
  }

  if (/\b(pr|press|comms|communications)\b/.test(localPart)) {
    return "pr";
  }

  if (/\b(partnerships?|collabs?|collaborations?|influencers?|creators?)\b/.test(localPart)) {
    return "partnerships";
  }

  if (/\b(marketing|social|growth)\b/.test(localPart)) {
    return "marketing";
  }

  if (["info", "hello", "contact", "support", "team"].includes(localPart)) {
    return "generic_info";
  }

  if (/\b(founder|ceo|cmo)\b/.test(searchable)) {
    return "founder";
  }

  if (/\b(pr|press|public relations|comms|communications)\b/.test(searchable)) {
    return "pr";
  }

  if (/\b(partnerships?|collabs?|collaborations?|influencers?|creators?)\b/.test(searchable)) {
    return "partnerships";
  }

  if (/\b(marketing|social)\b/.test(searchable)) {
    return "marketing";
  }

  return "unknown";
}

async function persistPageScrapeResult(
  supabase: SupabaseClient<Database>,
  userId: string,
  result: PageScrapeResult,
) {
  const contacts = result.contacts;

  if (contacts.length > 0) {
    const { data: existingContacts, error: existingError } = await supabase
      .from("brand_contacts")
      .select("email,source")
      .eq("user_id", userId)
      .eq("brand_id", result.brand_id)
      .in(
        "email",
        contacts.map((contact) => contact.email),
      );

    if (existingError) {
      throw new Error(existingError.message);
    }

    const existingByEmail = new Map(
      (existingContacts ?? []).map((contact) => [contact.email, contact]),
    );
    const newRows = contacts
      .filter((contact) => !existingByEmail.has(contact.email))
      .map((contact) => ({
        user_id: userId,
        brand_id: result.brand_id,
        email: contact.email,
        role: contact.role,
        source: "page_scrape",
        confidence: null,
        verified_at: null,
      }));
    const pageScrapeUpdates = contacts.filter(
      (contact) => existingByEmail.get(contact.email)?.source === "page_scrape",
    );

    if (newRows.length > 0) {
      const { error } = await supabase.from("brand_contacts").insert(newRows);

      if (error) {
        throw new Error(error.message);
      }
    }

    for (const contact of pageScrapeUpdates) {
      const { error } = await supabase
        .from("brand_contacts")
        .update({
          role: contact.role,
          marked_unreachable: false,
        })
        .eq("user_id", userId)
        .eq("brand_id", result.brand_id)
        .eq("email", contact.email)
        .eq("source", "page_scrape");

      if (error) {
        throw new Error(error.message);
      }
    }
  }

  const { error: signalError } = await supabase.from("source_signals").insert({
    user_id: userId,
    brand_id: result.brand_id,
    signal_type: "page_scrape",
    evidence_json: {
      pages_scraped: result.pages_scraped,
      contacts_found: result.contacts.length,
    } satisfies Json,
    weight: 1,
  });

  if (signalError) {
    throw new Error(signalError.message);
  }
}

async function loadRobots(baseUrl: string) {
  const robotsUrl = new URL("/robots.txt", baseUrl).toString();

  try {
    const response = await fetch(robotsUrl, {
      headers: {
        "User-Agent": USER_AGENT,
      },
      signal: AbortSignal.timeout(5_000),
    });

    if (!response.ok) {
      return {
        canFetch: () => true,
      };
    }

    const parser = robotsParser(robotsUrl, await response.text());

    return {
      canFetch: (url: string) => parser.isAllowed(url, USER_AGENT) !== false,
    };
  } catch {
    return {
      canFetch: () => true,
    };
  }
}

function buildBaseUrl(domain: string) {
  const trimmed = domain.trim().replace(/^https?:\/\//i, "").split(/[/?#]/)[0];

  return `https://${trimmed}`;
}
