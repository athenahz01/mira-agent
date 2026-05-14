import { randomUUID } from "node:crypto";

import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

import type { Database, Tables } from "../lib/db/types";
import { computeBrandFitScores } from "../lib/scoring/service.ts";

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
  const email = `mira-scoring-${randomUUID()}@example.com`;
  const { data, error } = await service.auth.admin.createUser({
    email,
    password: `Test-${randomUUID()}!`,
    email_confirm: true,
  });

  if (error || !data.user) {
    throw new Error(error?.message ?? "Could not create test user.");
  }

  createdUserId = data.user.id;
  await service.from("users").insert({
    user_id: data.user.id,
    email,
    name: "Scoring Test",
  });

  return data.user.id;
}

async function main() {
  const userId = await createTestUser();
  const profile = await seedProfile(userId);
  const brands = await seedBrands(userId);

  await seedSignalsAndContacts(userId, brands);

  const context = {
    supabase: service,
    userId,
  };
  const first = await computeBrandFitScores(context, {
    creatorProfileIds: [profile.id],
    brandIds: brands.map((brand) => brand.id),
  });

  assert(first.pairs_processed === 3, "Expected 3 profile-brand pairs processed.");
  assert(first.scores_written === 15, "Expected 15 score rows written.");

  const rowsAfterFirst = await loadScores(userId);
  assert(rowsAfterFirst.length === 15, "Expected exactly 15 score rows.");

  const second = await computeBrandFitScores(context, {
    creatorProfileIds: [profile.id],
    brandIds: brands.map((brand) => brand.id),
  });

  assert(second.pairs_processed === 0, "Fresh scores should be cached.");
  assert(second.scores_cached === 15, "Expected 15 cached score rows.");
  assert((await loadScores(userId)).length === 15, "Cache run should not add rows.");

  const oldTimestamp = "2000-01-01T00:00:00.000Z";
  const { error: staleError } = await service
    .from("brand_fit_scores")
    .update({
      computed_at: oldTimestamp,
    })
    .eq("user_id", userId);

  if (staleError) {
    throw new Error(staleError.message);
  }

  const forced = await computeBrandFitScores(context, {
    creatorProfileIds: [profile.id],
    brandIds: brands.map((brand) => brand.id),
    forceRecompute: true,
  });
  const rowsAfterForce = await loadScores(userId);

  assert(forced.pairs_processed === 3, "Force recompute should process all pairs.");
  assert(forced.scores_written === 15, "Force recompute should write 15 rows.");
  assert(rowsAfterForce.length === 15, "Force recompute should upsert rows.");
  assert(
    rowsAfterForce.every((row) => row.computed_at > oldTimestamp),
    "Force recompute should update every computed_at.",
  );

  console.log("Scoring service test passed.");
}

async function seedProfile(userId: string) {
  const { data, error } = await service
    .from("creator_profiles")
    .insert({
      user_id: userId,
      handle: "athena_hz",
      display_name: "Athena Huo",
      niche_tags: ["fashion", "beauty", "ugc"],
      aesthetic_keywords: ["clean", "dewy", "inclusive"],
      recent_post_themes: ["fit checks"],
      tier: "micro",
    })
    .select("*")
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? "Could not seed profile.");
  }

  return data;
}

async function seedBrands(userId: string) {
  const { data, error } = await service
    .from("brands")
    .insert([
      brandInsert(userId, "Glossier", "domain:glossier.com", {
        domain: "glossier.com",
        category: ["beauty"],
        aesthetic_tags: ["clean", "dewy"],
        size_estimate: "established-dtc",
        pays_creators: true,
      }),
      brandInsert(userId, "Tiny Launch", "domain:tiny.test", {
        domain: "tiny.test",
        category: ["fashion"],
        aesthetic_tags: ["minimal"],
        size_estimate: "pre-launch",
      }),
      brandInsert(userId, "UGC Brand", "domain:ugc.test", {
        domain: "ugc.test",
        category: ["ugc"],
        aesthetic_tags: ["inclusive", "authentic"],
        size_estimate: "indie-medium",
      }),
    ])
    .select("*");

  if (error || !data) {
    throw new Error(error?.message ?? "Could not seed brands.");
  }

  return data;
}

async function seedSignalsAndContacts(
  userId: string,
  brands: Tables<"brands">[],
) {
  const [glossier, , ugcBrand] = brands;

  await service.from("brand_contacts").insert([
    {
      user_id: userId,
      brand_id: glossier.id,
      email: "press@glossier.com",
      role: "pr",
      source: "hunter",
      confidence: 90,
    },
    {
      user_id: userId,
      brand_id: ugcBrand.id,
      email: "marketing@ugc.test",
      role: "marketing",
      source: "manual",
      confidence: null,
    },
  ]);
  await service.from("source_signals").insert([
    {
      user_id: userId,
      brand_id: glossier.id,
      signal_type: "rapidapi_competitor_scrape",
      evidence_json: {
        paid_partnership_count: 2,
      },
      weight: 1,
    },
    {
      user_id: userId,
      brand_id: ugcBrand.id,
      signal_type: "manual_seed",
      evidence_json: {
        note: "affiliate program available",
      },
      weight: 1,
    },
  ]);
}

function brandInsert(
  userId: string,
  name: string,
  identityKey: string,
  overrides: Partial<Tables<"brands">>,
) {
  return {
    user_id: userId,
    name,
    identity_key: identityKey,
    aliases: [],
    category: [],
    aesthetic_tags: [],
    ...overrides,
  };
}

async function loadScores(userId: string) {
  const { data, error } = await service
    .from("brand_fit_scores")
    .select("*")
    .eq("user_id", userId);

  if (error) {
    throw new Error(error.message);
  }

  return data ?? [];
}

async function cleanup() {
  if (createdUserId) {
    await service.auth.admin.deleteUser(createdUserId);
  }
}

main()
  .catch((error: unknown) => {
    const message =
      error instanceof Error ? error.message : "Unknown scoring service error";
    console.error(message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await cleanup();
  });
