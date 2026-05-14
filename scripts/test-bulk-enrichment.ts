import { randomUUID } from "node:crypto";

import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

import { enrichUnenrichedBrandsForUser } from "../lib/enrichment/bulk.ts";
import type { EnrichmentContext } from "../lib/enrichment/contacts.ts";
import type { HunterClient } from "../lib/enrichment/hunter.ts";
import type { Database } from "../lib/db/types";

const envSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
});

const envResult = envSchema.safeParse(process.env);

if (!envResult.success) {
  const missing = envResult.error.issues
    .map((issue) => issue.path.join("."))
    .join(", ");
  console.error(`Missing required env vars: ${missing}`);
  process.exit(1);
}

const env = envResult.data;
const service = createClient<Database>(
  env.NEXT_PUBLIC_SUPABASE_URL,
  env.SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  },
);
let createdUserId: string | null = null;

const fakeHunter: HunterClient = {
  async domainSearch({ domain }) {
    return {
      data: {
        domain,
        emails: [
          {
            value: `press@${domain}`,
            type: "generic",
            confidence: 65,
            position: null,
            department: null,
            first_name: null,
            last_name: null,
          },
        ],
      },
    };
  },
  async emailVerifier({ email }) {
    return {
      data: {
        email,
        result: "deliverable",
        score: 90,
      },
    };
  },
};

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(message);
  }
}

async function createUser() {
  const email = `mira-bulk-${randomUUID()}@example.com`;
  const { data, error } = await service.auth.admin.createUser({
    email,
    password: `Mira-${randomUUID()}-password`,
    email_confirm: true,
  });

  if (error || !data.user) {
    throw new Error(error?.message ?? "Could not create user.");
  }

  createdUserId = data.user.id;
  const { error: appUserError } = await service.from("users").insert({
    user_id: data.user.id,
    email,
    name: "Bulk Test",
  });

  if (appUserError) {
    throw new Error(appUserError.message);
  }

  return data.user.id;
}

async function seedBrands(userId: string) {
  const rows = [
    { name: "No Domain One", domain: null },
    { name: "No Domain Two", domain: null },
    { name: "Brand One", domain: "one.example" },
    { name: "Brand Two", domain: "two.example" },
    { name: "Brand Three", domain: "three.example" },
  ].map((brand) => ({
    user_id: userId,
    name: brand.name,
    domain: brand.domain,
    identity_key: brand.domain
      ? `domain:${brand.domain}`
      : `name:${brand.name.toLowerCase().replaceAll(" ", "-")}`,
  }));
  const { error } = await service.from("brands").insert(rows);

  if (error) {
    throw new Error(error.message);
  }
}

async function cleanup() {
  if (!createdUserId) {
    return;
  }

  const { error } = await service.auth.admin.deleteUser(createdUserId);

  if (error) {
    console.warn(`Cleanup failed: ${error.message}`);
  }
}

async function main() {
  const userId = await createUser();
  await seedBrands(userId);
  const context: EnrichmentContext = {
    supabase: service,
    userId,
    hunterClient: fakeHunter,
  };
  const result = await enrichUnenrichedBrandsForUser(context, {
    limit: 3,
  });

  assert(result.processed === 3, `Expected 3 processed, got ${result.processed}.`);
  assert(result.succeeded === 3, `Expected 3 succeeded, got ${result.succeeded}.`);
  assert(result.skipped === 0, `Expected 0 skipped, got ${result.skipped}.`);

  const { data: contacts, error } = await service
    .from("brand_contacts")
    .select("*")
    .eq("user_id", userId);

  if (error) {
    throw new Error(error.message);
  }

  assert(contacts?.length === 3, "Expected one contact for each domain brand.");

  console.log("Bulk enrichment test passed.");
}

main()
  .catch((error: unknown) => {
    const message =
      error instanceof Error ? error.message : "Unknown bulk enrichment error";
    console.error(message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await cleanup();
  });
