import { mapHunterContactRole } from "../lib/enrichment/contacts.ts";

const cases = [
  {
    input: {
      email: "jane@brand.com",
      department: "communication",
    },
    expected: "pr",
  },
  {
    input: {
      email: "jane@brand.com",
      department: "marketing",
    },
    expected: "marketing",
  },
  {
    input: {
      email: "jane@brand.com",
      position: "Head of PR",
    },
    expected: "pr",
  },
  {
    input: {
      email: "founder@brand.com",
      position: "CEO and Founder",
    },
    expected: "founder",
  },
  {
    input: {
      email: "info@brand.com",
    },
    expected: "generic_info",
  },
  {
    input: {
      email: "person@brand.com",
      position: "Operations",
    },
    expected: "unknown",
  },
] as const;

for (const testCase of cases) {
  const actual = mapHunterContactRole(testCase.input);

  if (actual !== testCase.expected) {
    throw new Error(
      `Expected ${testCase.expected} for ${JSON.stringify(testCase.input)}, got ${actual}.`,
    );
  }
}

console.log("Hunter mapping test passed.");
