import {
  detectPageScrapeRole,
  extractEmailsWithContext,
} from "../workers/scrapers/page-scrape.ts";

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(message);
  }
}

const fixtureText = `
  Press and PR inquiries: press@brand.com.
  Partnerships and creator collabs: collabs@brand.com.
  Marketing team: growth@brand.com.
  Founder office: jane@brand.com.
  General questions: info@brand.com.
  Random mailbox: mystery@brand.com.
`;

const matches = extractEmailsWithContext(fixtureText);
const byEmail = new Map(matches.map((match) => [match.email, match]));

assert(matches.length === 6, `Expected 6 emails, got ${matches.length}.`);
assert(
  byEmail.get("press@brand.com")?.context.includes("Press and PR") === true,
  "Expected surrounding context for press email.",
);

const cases = [
  {
    email: "press@brand.com",
    context: byEmail.get("press@brand.com")?.context,
    role: "pr",
  },
  {
    email: "collabs@brand.com",
    context: byEmail.get("collabs@brand.com")?.context,
    role: "partnerships",
  },
  {
    email: "growth@brand.com",
    context: byEmail.get("growth@brand.com")?.context,
    role: "marketing",
  },
  {
    email: "jane@brand.com",
    context: byEmail.get("jane@brand.com")?.context,
    role: "founder",
  },
  {
    email: "info@brand.com",
    context: "General questions",
    role: "generic_info",
  },
  {
    email: "mystery@brand.com",
    context: "Plain footer",
    role: "unknown",
  },
] as const;

for (const testCase of cases) {
  const role = detectPageScrapeRole({
    email: testCase.email,
    context: testCase.context,
  });

  assert(
    role === testCase.role,
    `Expected ${testCase.email} to map to ${testCase.role}, got ${role}.`,
  );
}

console.log("Page scrape mapping test passed.");
