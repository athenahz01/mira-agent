import { randomUUID } from "node:crypto";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import type { Database } from "../lib/db/types";

const envSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
});

type AuthedTestClient = {
  client: SupabaseClient<Database>;
  userId: string;
  email: string;
};

const envResult = envSchema.safeParse(process.env);

if (!envResult.success) {
  const missing = envResult.error.issues
    .map((issue) => issue.path.join("."))
    .join(", ");
  console.error(`Missing required env vars: ${missing}`);
  process.exit(1);
}

const env = envResult.data;
const password = `Mira-test-${randomUUID()}-password`;
const createdUserIds: string[] = [];

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

function createAnonClient() {
  return createClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    },
  );
}

async function createSignedInUser(label: string): Promise<AuthedTestClient> {
  const email = `mira-rls-${label}-${randomUUID()}@example.com`;
  const { data: created, error: createError } =
    await service.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        name: `Mira RLS ${label}`,
      },
    });

  if (createError || !created.user) {
    throw new Error(
      `Failed to create ${label}: ${createError?.message ?? "missing user"}`,
    );
  }

  createdUserIds.push(created.user.id);

  const client = createAnonClient();
  const { data: signedIn, error: signInError } =
    await client.auth.signInWithPassword({
      email,
      password,
    });

  if (signInError || !signedIn.user) {
    throw new Error(
      `Failed to sign in ${label}: ${signInError?.message ?? "missing user"}`,
    );
  }

  const { error: appUserError } = await client.from("users").insert({
    user_id: signedIn.user.id,
    email,
    name: `Mira RLS ${label}`,
    timezone: "America/New_York",
  });

  if (appUserError) {
    throw new Error(`Failed to create app user ${label}: ${appUserError.message}`);
  }

  return {
    client,
    userId: signedIn.user.id,
    email,
  };
}

async function insertBrandForUser(
  testUser: AuthedTestClient,
  brandName: string,
) {
  const { data, error } = await testUser.client
    .from("brands")
    .insert({
      user_id: testUser.userId,
      name: brandName,
    })
    .select("id,name,user_id")
    .single();

  if (error || !data) {
    throw new Error(
      `Failed to insert brand for ${testUser.email}: ${
        error?.message ?? "missing brand"
      }`,
    );
  }

  return data;
}

async function assertCanOnlyReadOwnBrand(
  testUser: AuthedTestClient,
  ownBrandId: string,
  otherBrandId: string,
) {
  const { data: ownRows, error: ownReadError } = await testUser.client
    .from("brands")
    .select("id")
    .eq("id", ownBrandId);

  if (ownReadError || ownRows.length !== 1) {
    throw new Error(`User ${testUser.email} could not read their own brand.`);
  }

  const { data: otherRows, error: otherReadError } = await testUser.client
    .from("brands")
    .select("id")
    .eq("id", otherBrandId);

  if (otherReadError) {
    throw new Error(
      `Unexpected read error for ${testUser.email}: ${otherReadError.message}`,
    );
  }

  if (otherRows.length !== 0) {
    throw new Error(`User ${testUser.email} could read another user's brand.`);
  }
}

async function assertCannotModifyOtherBrand(
  testUser: AuthedTestClient,
  otherBrandId: string,
) {
  const { data: updatedRows, error: updateError } = await testUser.client
    .from("brands")
    .update({
      name: "Mutated by wrong user",
    })
    .eq("id", otherBrandId)
    .select("id");

  if (updateError) {
    throw new Error(
      `Unexpected update error for ${testUser.email}: ${updateError.message}`,
    );
  }

  if (updatedRows.length !== 0) {
    throw new Error(`User ${testUser.email} updated another user's brand.`);
  }

  const { data: deletedRows, error: deleteError } = await testUser.client
    .from("brands")
    .delete()
    .eq("id", otherBrandId)
    .select("id");

  if (deleteError) {
    throw new Error(
      `Unexpected delete error for ${testUser.email}: ${deleteError.message}`,
    );
  }

  if (deletedRows.length !== 0) {
    throw new Error(`User ${testUser.email} deleted another user's brand.`);
  }
}

async function assertBrandStillExists(brandId: string, expectedName: string) {
  const { data, error } = await service
    .from("brands")
    .select("name")
    .eq("id", brandId)
    .single();

  if (error || !data) {
    throw new Error(
      `Could not verify protected brand: ${error?.message ?? "missing row"}`,
    );
  }

  if (data.name !== expectedName) {
    throw new Error(`Protected brand was modified. Expected ${expectedName}.`);
  }
}

async function cleanup() {
  await Promise.all(
    createdUserIds.map(async (userId) => {
      const { error } = await service.auth.admin.deleteUser(userId);

      if (error) {
        console.warn(`Cleanup failed for ${userId}: ${error.message}`);
      }
    }),
  );
}

async function main() {
  try {
    const userA = await createSignedInUser("a");
    const userB = await createSignedInUser("b");

    const brandA = await insertBrandForUser(userA, "User A Brand");
    const brandB = await insertBrandForUser(userB, "User B Brand");

    await assertCanOnlyReadOwnBrand(userA, brandA.id, brandB.id);
    await assertCanOnlyReadOwnBrand(userB, brandB.id, brandA.id);

    await assertCannotModifyOtherBrand(userA, brandB.id);
    await assertBrandStillExists(brandB.id, "User B Brand");

    console.log("RLS test passed: users can only read or modify their own rows.");
  } finally {
    await cleanup();
  }
}

main().catch((error: unknown) => {
  const message =
    error instanceof Error ? error.message : "Unknown RLS test failure";
  console.error(message);
  process.exitCode = 1;
});
