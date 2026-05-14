import { randomUUID } from "node:crypto";

import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

import { findOrCreateBrand } from "../lib/brands/service.ts";
import type { Database } from "../lib/db/types";

const envSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
});

const envResult = envSchema.safeParse(process.env);

if (!envResult.success) {
  console.error(envResult.error.message);
  process.exit(1);
}

const service = createClient<Database>(
  envResult.data.NEXT_PUBLIC_SUPABASE_URL,
  envResult.data.SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  },
);
let createdUserId: string | null = null;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

async function createTestUser() {
  const email = `mira-fuzzy-${randomUUID()}@example.com`;
  const { data, error } = await service.auth.admin.createUser({
    email,
    password: `Test-${randomUUID()}!`,
    email_confirm: true,
  });

  if (error || !data.user) {
    throw new Error(error?.message ?? "Could not create test user.");
  }

  createdUserId = data.user.id;
  return data.user.id;
}

async function main() {
  const userId = await createTestUser();
  const context = {
    supabase: service,
    userId,
  };

  await findOrCreateBrand(
    context,
    brandInput("Glossier"),
    { skipFuzzy: true },
  );
  await findOrCreateBrand(
    context,
    brandInput("Glossier Beauty"),
    { skipFuzzy: true },
  );
  await findOrCreateBrand(
    context,
    brandInput("Different Brand"),
    { skipFuzzy: true },
  );

  const autoMerged = await findOrCreateBrand(
    context,
    brandInput("Glossier Inc"),
    { source: "manual_seed" },
  );

  assert(autoMerged.brand, "Auto-merged result should return a brand.");
  assert(!autoMerged.created, "Glossier Inc should auto-merge.");
  assert(autoMerged.auto_merged, "Glossier Inc should be marked auto-merged.");
  assert(
    autoMerged.brand.name === "Glossier",
    "Glossier Inc should merge into the canonical Glossier row.",
  );

  const queued = await findOrCreateBrand(
    context,
    brandInput("Glos"),
    { source: "manual_seed" },
  );

  assert(queued.queued_for_review, "Short similar name should queue review.");

  const { data: proposals, error: proposalsError } = await service
    .from("brand_match_proposals")
    .select("*")
    .eq("user_id", userId)
    .eq("status", "open");

  if (proposalsError) {
    throw new Error(proposalsError.message);
  }

  assert((proposals ?? []).length === 1, "One proposal should be open.");

  const unrelated = await findOrCreateBrand(
    context,
    brandInput("Totally Unrelated"),
    { source: "manual_seed" },
  );

  assert(unrelated.brand, "Unrelated result should return a brand.");
  assert(unrelated.created, "Unrelated brand should be created.");

  console.log("Fuzzy matching test passed.");
}

function brandInput(name: string) {
  return {
    name,
    domain: null,
    instagram_handle: null,
    tiktok_handle: null,
    category: [],
    aesthetic_tags: [],
    size_estimate: null,
    pays_creators: null,
    notes: "",
  };
}

async function cleanup() {
  if (createdUserId) {
    await service.auth.admin.deleteUser(createdUserId);
  }
}

main()
  .catch((error: unknown) => {
    const message =
      error instanceof Error ? error.message : "Unknown fuzzy matching error";
    console.error(message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await cleanup();
  });
