import { randomUUID } from "node:crypto";

import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

import {
  brandIdentityKey,
  normalizeDomain,
  normalizeHandle,
  normalizeName,
} from "../lib/brands/identity.ts";
import { findOrCreateBrand } from "../lib/brands/service.ts";
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

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(message);
  }
}

async function createTestUser() {
  const email = `mira-brand-identity-${randomUUID()}@example.com`;
  const { data, error } = await service.auth.admin.createUser({
    email,
    password: `Mira-${randomUUID()}-password`,
    email_confirm: true,
    user_metadata: {
      name: "Mira Brand Identity",
    },
  });

  if (error || !data.user) {
    throw new Error(error?.message ?? "Could not create test user.");
  }

  createdUserId = data.user.id;
  const { error: appUserError } = await service.from("users").insert({
    user_id: data.user.id,
    email,
    name: "Mira Brand Identity",
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

async function main() {
  assert(
    brandIdentityKey({ name: "Glossier" }) === "name:glossier",
    "Name identity did not normalize.",
  );
  assert(
    brandIdentityKey({ domain: " HTTPS://www.Glossier.com/shop " }) ===
      "domain:glossier.com",
    "Domain identity did not normalize.",
  );
  assert(
    brandIdentityKey({
      instagram_handle: "https://instagram.com/Glossier/",
    }) === "ig:glossier",
    "Instagram identity did not normalize.",
  );
  assert(
    brandIdentityKey({
      tiktok_handle: "https://www.tiktok.com/@Glossier/",
    }) === "tt:glossier",
    "TikTok identity did not normalize.",
  );
  assert(
    brandIdentityKey({ name: "Glossier" }) !==
      brandIdentityKey({ domain: "glossier.com" }) &&
      brandIdentityKey({ name: "Glossier" }) !==
        brandIdentityKey({ instagram_handle: "@glossier" }),
    "Different identity fields should produce different key prefixes.",
  );
  assert(
    normalizeDomain("https://www.glossier.com/") ===
      normalizeDomain("GLOSSIER.com/path"),
    "Equivalent domains should normalize to the same value.",
  );
  assert(
    normalizeHandle("@Glossier/", "instagram") ===
      normalizeHandle("https://instagram.com/glossier", "instagram"),
    "Equivalent Instagram handles should normalize to the same value.",
  );
  assert(
    normalizeName(" Glossier, Inc. ") === "glossier inc",
    "Name normalization should strip punctuation and collapse whitespace.",
  );

  const userId = await createTestUser();
  const context = {
    supabase: service,
    userId,
  };
  const first = await findOrCreateBrand(context, {
    name: "Glossier",
    category: ["beauty"],
    aesthetic_tags: ["dewy"],
    pays_creators: null,
    size_estimate: null,
    notes: "",
  });
  const second = await findOrCreateBrand(context, {
    name: " glossier ",
    category: ["skincare"],
    aesthetic_tags: ["minimal"],
    pays_creators: true,
    size_estimate: "established-dtc",
    notes: "same name key",
  });
  const promoted = await findOrCreateBrand(context, {
    name: "Glossier",
    domain: "https://glossier.com/",
    instagram_handle: "@glossier",
    category: ["beauty"],
    aesthetic_tags: ["everyday"],
    pays_creators: true,
    size_estimate: "established-dtc",
    notes: "domain promotion",
  });
  const handleOnly = await findOrCreateBrand(context, {
    name: "Glossier Social",
    instagram_handle: "https://instagram.com/glossier/",
    category: ["beauty"],
    aesthetic_tags: [],
    pays_creators: null,
    size_estimate: null,
    notes: "same stored handle",
  });

  assert(first.created, "First brand should be created.");
  assert(!second.created, "Second same-name brand should merge.");
  assert(first.brand.id === second.brand.id, "Same name key should reuse row.");
  assert(promoted.brand.id === first.brand.id, "Domain should promote row.");
  assert(promoted.promoted, "Domain import should mark promotion.");
  assert(
    promoted.brand.identity_key === "domain:glossier.com",
    "Promoted brand should store domain identity.",
  );
  assert(
    handleOnly.brand.id === first.brand.id,
    "Stored Instagram handle should merge back into the canonical row.",
  );

  console.log("Brand identity test passed.");
}

main()
  .catch((error: unknown) => {
    const message =
      error instanceof Error ? error.message : "Unknown brand identity error";
    console.error(message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await cleanup();
  });
