import { randomUUID } from "node:crypto";

import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

import { addBrandsFromCsvForUser } from "../lib/brands/service.ts";
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

async function createTestUser() {
  const email = `mira-csv-${randomUUID()}@example.com`;
  const { data, error } = await service.auth.admin.createUser({
    email,
    password: `Mira-${randomUUID()}-password`,
    email_confirm: true,
    user_metadata: {
      name: "Mira CSV Import",
    },
  });

  if (error || !data.user) {
    throw new Error(error?.message ?? "Could not create test user.");
  }

  createdUserId = data.user.id;
  const { error: appUserError } = await service.from("users").insert({
    user_id: data.user.id,
    email,
    name: "Mira CSV Import",
  });

  if (appUserError) {
    throw new Error(appUserError.message);
  }

  return data.user.id;
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

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(message);
  }
}

const csvFixture = `name,domain,instagram_handle,tiktok_handle,category,aesthetic_tags,size_estimate,pays_creators,notes
Glossier,glossier.com,@glossier,,beauty;skincare,minimal;dewy,established-dtc,yes,good fit
Tower 28,tower28beauty.com,@tower28beauty,,beauty;skincare,beachy;inclusive,indie-medium,yes,
Topicals,mytopicals.com,@topicals,,skincare;beauty,bold;gen-z,indie-medium,yes,
Rare Beauty,rarebeauty.com,@rarebeauty,,beauty,soft;polished,legacy-large,yes,
Sunday Riley,sundayriley.com,@sundayriley,,skincare;beauty,clinical;elevated,established-dtc,yes,
,missing-name.com,@missingname,,beauty,minimal,indie-small,yes,missing name
Bad Size,badsize.example,@badsize,,beauty,minimal,giant,maybe,bad enum`;

async function main() {
  const userId = await createTestUser();
  const result = await addBrandsFromCsvForUser(
    {
      supabase: service,
      userId,
    },
    csvFixture,
  );

  assert(result.created === 5, `Expected 5 created, got ${result.created}.`);
  assert(result.merged === 0, `Expected 0 merged, got ${result.merged}.`);
  assert(result.skipped.length === 2, "Expected 2 skipped rows.");

  const [{ data: brands, error: brandsError }, signalsResult] =
    await Promise.all([
      service
        .from("brands")
        .select("id,identity_key")
        .eq("user_id", userId),
      service
        .from("source_signals")
        .select("brand_id,signal_type")
        .eq("user_id", userId),
    ]);

  if (brandsError) {
    throw new Error(brandsError.message);
  }

  if (signalsResult.error) {
    throw new Error(signalsResult.error.message);
  }

  assert(brands?.length === 5, "Expected 5 brand rows in database.");
  assert(
    signalsResult.data?.length === 5 &&
      signalsResult.data.every((signal) => signal.signal_type === "csv_import"),
    "Expected one csv_import source signal per created brand.",
  );

  const identityKeys = new Set((brands ?? []).map((brand) => brand.identity_key));
  assert(
    identityKeys.size === brands?.length,
    "Identity keys should be unique per user.",
  );

  console.log("CSV import test passed.");
}

main()
  .catch((error: unknown) => {
    const message =
      error instanceof Error ? error.message : "Unknown CSV import error";
    console.error(message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await cleanup();
  });
