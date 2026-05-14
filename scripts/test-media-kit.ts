import { randomUUID } from "node:crypto";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { defaultVoiceStyleGuide } from "../lib/db/style-guide.ts";
import type { MediaKitJson } from "../lib/db/media-kit";
import type { Database } from "../lib/db/types";
import {
  generateAndPersistMediaKit,
  persistMediaKit,
  type MediaKitContext,
} from "../lib/media-kit/service.ts";

const envSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
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
const password = `Mira-media-kit-${randomUUID()}-password`;
const email = `mira-media-kit-${randomUUID()}@example.com`;
let createdUserId: string | null = null;

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

async function createContext(): Promise<MediaKitContext> {
  const { data: created, error: createError } =
    await service.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        name: "Mira Media Kit Test",
      },
    });

  if (createError || !created.user) {
    throw new Error(createError?.message ?? "Missing created user.");
  }

  createdUserId = created.user.id;
  const client = createAnonClient();
  const { data: signedIn, error: signInError } =
    await client.auth.signInWithPassword({
      email,
      password,
    });

  if (signInError || !signedIn.user) {
    throw new Error(signInError?.message ?? "Missing signed-in user.");
  }

  return {
    supabase: client as SupabaseClient<Database>,
    userId: signedIn.user.id,
    email,
  };
}

function fixtureKit(label: string): MediaKitJson {
  return {
    version: 1,
    profile_summary: {
      handle: "athena_hz",
      display_name: "Athena Huo",
      tagline: `Creator media kit for ${label}.`,
      location: "NYC",
      languages: ["English", "Mandarin"],
    },
    audience: {
      platform: "instagram",
      follower_count: 5000,
      engagement_rate: 0.04,
      tier: "nano",
      demographics: {},
    },
    niche: {
      categories: ["fashion", "lifestyle", "ugc"],
      aesthetic_keywords: ["warm-toned", "polished"],
      content_pillars: ["fit checks", "UGC demos", "NYC lifestyle"],
    },
    deliverables: [
      {
        kind: "ig_reel",
        description: "Short-form editorial reel.",
        suggested_rate_usd: { min: 150, max: 500 },
        usage_rights_included: "Organic social usage for 30 days.",
        typical_turnaround_days: 7,
      },
      {
        kind: "ugc_video",
        description: "UGC video for paid social testing.",
        suggested_rate_usd: { min: 200, max: 650 },
        usage_rights_included: "Organic usage included; paid usage quoted separately.",
        typical_turnaround_days: 10,
      },
    ],
    past_brand_work: [],
    contact: {
      email,
      website: "https://athenahuo.com",
      instagram: "https://instagram.com/athena_hz",
    },
    rate_methodology_note:
      "Rates are estimated from creator tier, deliverable complexity, usage rights, and current industry benchmarks.",
  };
}

async function cleanup() {
  if (!createdUserId) {
    return;
  }

  const { error } = await service.auth.admin.deleteUser(createdUserId);

  if (error) {
    console.warn(`Cleanup failed for ${createdUserId}: ${error.message}`);
  }
}

async function main() {
  try {
    const context = await createContext();
    await context.supabase.from("users").insert({
      user_id: context.userId,
      email,
      name: "Mira Media Kit Test",
      timezone: "America/New_York",
      sender_display_name: "Athena Huo",
    });
    const { data: profile, error: profileError } = await context.supabase
      .from("creator_profiles")
      .insert({
        user_id: context.userId,
        handle: "athena_hz",
        display_name: "Athena Huo",
        audience_size_snapshot: 5000,
        engagement_rate_snapshot: 0.04,
        tier: "nano",
        niche_tags: ["fashion", "lifestyle", "ugc"],
        aesthetic_keywords: ["warm-toned", "polished"],
        recent_post_themes: ["fit checks", "UGC demos"],
      })
      .select("*")
      .single();

    if (profileError || !profile) {
      throw new Error(profileError?.message ?? "Missing profile.");
    }

    await context.supabase.from("voice_style_guides").insert({
      user_id: context.userId,
      creator_profile_id: profile.id,
      version: 1,
      is_active: true,
      style_doc_json: defaultVoiceStyleGuide,
      learned_from_message_ids: [],
    });

    const first = await generateAndPersistMediaKit(
      context,
      profile.id,
      [],
      async () => fixtureKit("v1"),
    );

    if (first.version !== 1 || !first.is_active) {
      throw new Error("Expected active v1 media kit.");
    }

    const second = await persistMediaKit(context, profile.id, fixtureKit("v2"));

    if (second.version !== 2 || !second.is_active) {
      throw new Error("Expected active v2 media kit.");
    }

    const { data: firstAfter, error: firstAfterError } = await context.supabase
      .from("media_kits")
      .select("is_active")
      .eq("id", first.id)
      .single();

    if (firstAfterError || firstAfter.is_active) {
      throw new Error("Expected v1 media kit to be deactivated.");
    }

    console.log("Media kit test passed.");
  } finally {
    await cleanup();
  }
}

main().catch((error: unknown) => {
  const message =
    error instanceof Error ? error.message : "Unknown media kit test failure";
  console.error(message);
  process.exitCode = 1;
});
