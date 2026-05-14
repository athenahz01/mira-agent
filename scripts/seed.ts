import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

import type { Database } from "../lib/db/types";

const envSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
});

const argsSchema = z.object({
  userId: z.string().uuid(),
});

type CreatorProfileInsert =
  Database["public"]["Tables"]["creator_profiles"]["Insert"];

const envResult = envSchema.safeParse(process.env);
if (!envResult.success) {
  const missing = envResult.error.issues
    .map((issue) => issue.path.join("."))
    .join(", ");
  console.error(`Missing required env vars: ${missing}`);
  process.exit(1);
}

const userIdArg = process.argv.find((arg) => arg.startsWith("--user-id="));
const argsResult = argsSchema.safeParse({
  userId: userIdArg?.replace("--user-id=", ""),
});

if (!argsResult.success) {
  console.error("Usage: pnpm seed --user-id=<uuid>");
  process.exit(1);
}

const env = envResult.data;
const args = argsResult.data;

const supabase = createClient<Database>(
  env.NEXT_PUBLIC_SUPABASE_URL,
  env.SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  },
);

const creatorProfiles: CreatorProfileInsert[] = [
  {
    user_id: args.userId,
    handle: "athena_hz",
    display_name: "Athena Huo",
    platform: "instagram",
    niche_tags: ["fashion", "lifestyle", "ugc", "nyc", "asian-american"],
    aesthetic_keywords: ["warm-toned", "soft-girl", "preppy-elevated"],
    active: true,
    cross_pitch_cooldown_days: 90,
  },
  {
    user_id: args.userId,
    handle: "athena_huo",
    display_name: "Athena Huo",
    platform: "instagram",
    niche_tags: [
      "college",
      "grad-school",
      "female-power",
      "ai-tools",
      "career",
    ],
    aesthetic_keywords: [
      "grounded",
      "tech-curious",
      "career-aware",
      "campus-polished",
    ],
    active: true,
    cross_pitch_cooldown_days: 90,
  },
];

async function seedUser() {
  const { error } = await supabase.from("users").upsert(
    {
      user_id: args.userId,
      email: "zhengathenahuo@gmail.com",
      name: "Athena Huo",
      timezone: "America/New_York",
      sender_display_name: "Athena Huo",
    },
    {
      onConflict: "user_id",
    },
  );

  if (error) {
    throw new Error(`Failed to seed user: ${error.message}`);
  }
}

async function seedCreatorProfiles() {
  const { data, error } = await supabase
    .from("creator_profiles")
    .upsert(creatorProfiles, {
      onConflict: "user_id,handle",
    })
    .select("id,handle");

  if (error) {
    throw new Error(`Failed to seed creator profiles: ${error.message}`);
  }

  if (!data || data.length !== creatorProfiles.length) {
    throw new Error("Creator profile seed did not return both profiles.");
  }

  return data;
}

async function ensureOutreachRule(creatorProfileId: string | null) {
  const query = supabase
    .from("outreach_rules")
    .select("id")
    .eq("user_id", args.userId)
    .limit(1);

  const scopedQuery =
    creatorProfileId === null
      ? query.is("creator_profile_id", null)
      : query.eq("creator_profile_id", creatorProfileId);

  const { data: existing, error: selectError } = await scopedQuery;

  if (selectError) {
    throw new Error(`Failed to inspect outreach rules: ${selectError.message}`);
  }

  if (existing.length > 0) {
    return;
  }

  const { error: insertError } = await supabase.from("outreach_rules").insert({
    user_id: args.userId,
    creator_profile_id: creatorProfileId,
  });

  if (insertError) {
    throw new Error(`Failed to seed outreach rule: ${insertError.message}`);
  }
}

async function main() {
  await seedUser();
  const profiles = await seedCreatorProfiles();

  await ensureOutreachRule(null);
  await Promise.all(
    profiles.map((profile) => ensureOutreachRule(profile.id)),
  );

  console.log(`Seeded Mira foundation for ${args.userId}.`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown seed error";
  console.error(message);
  process.exitCode = 1;
});
