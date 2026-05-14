import { randomUUID } from "node:crypto";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { defaultVoiceStyleGuide } from "../lib/db/style-guide.ts";
import type { VoiceStyleGuideJson } from "../lib/db/style-guide";
import type { Database } from "../lib/db/types";
import {
  addVoiceSamples,
  completeOnboarding,
  ensureDefaultCreatorProfiles,
  generateAndPersistVoiceGuide,
  upsertCreatorProfile,
  upsertUserBasics,
  type OnboardingContext,
} from "../lib/onboarding/service.ts";

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
const password = `Mira-onboarding-${randomUUID()}-password`;
const email = `mira-onboarding-${randomUUID()}@example.com`;
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

async function createContext(): Promise<OnboardingContext> {
  const { data: created, error: createError } =
    await service.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        name: "Mira Onboarding Test",
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

function fakeGuide(label: string): VoiceStyleGuideJson {
  return {
    ...defaultVoiceStyleGuide,
    avoid_phrases: [`generic opener ${label}`, "huge fan"],
    favored_phrases: [`specific fit ${label}`],
    hook_patterns: [
      `Reference a brand detail for ${label}.`,
      `Lead with a content concept for ${label}.`,
      `Tie Athena's audience to ${label}.`,
    ],
    notes: `Synthetic guide ${label}.`,
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
    const user = await upsertUserBasics(context, {
      name: "Mira Onboarding Test",
      timezone: "America/New_York",
      physical_address: "123 Test Street, New York, NY 10001",
      sender_display_name: "Athena Huo",
    });

    if (user.onboarding_completed_at !== null) {
      throw new Error("New user should not be completed yet.");
    }

    const profiles = await ensureDefaultCreatorProfiles(context);

    if (profiles.length !== 2) {
      throw new Error("Expected two default creator profiles.");
    }

    const savedProfiles = await Promise.all(
      profiles.map((profile) =>
        upsertCreatorProfile(context, {
          id: profile.id,
          handle: profile.handle,
          display_name: profile.display_name,
          platform: "instagram",
          tier: "nano",
          audience_size_snapshot: 1234,
          engagement_rate_snapshot: 0.045,
          niche_tags: profile.niche_tags,
          aesthetic_keywords: profile.aesthetic_keywords,
          bio_extract: `Bio for ${profile.handle}.`,
          recent_post_themes: ["fit checks", "campus routines"],
          cross_pitch_cooldown_days: 90,
          active: true,
        }),
      ),
    );

    for (const profile of savedProfiles) {
      const samples = await addVoiceSamples(context, {
        profileId: profile.id,
        samples: [
          {
            source: "website",
            text: `Website copy for ${profile.handle}.`,
            tag: "website",
          },
          {
            source: "ig_caption",
            text: `Caption for ${profile.handle}.`,
            tag: "caption",
          },
          {
            source: "email_sent",
            text: `Pitch email for ${profile.handle}.`,
            tag: "paid",
          },
        ],
      });

      if (samples.length !== 3) {
        throw new Error(`Expected 3 samples for ${profile.handle}.`);
      }
    }

    const firstGuides = await Promise.all(
      savedProfiles.map((profile) =>
        generateAndPersistVoiceGuide(
          context,
          {
            profileId: profile.id,
          },
          async () => fakeGuide(profile.handle),
        ),
      ),
    );

    if (firstGuides.some((guide) => guide.version !== 1 || !guide.is_active)) {
      throw new Error("Expected active v1 guides for both profiles.");
    }

    const secondGuide = await generateAndPersistVoiceGuide(
      context,
      {
        profileId: savedProfiles[0].id,
      },
      async () => fakeGuide(`${savedProfiles[0].handle}-v2`),
    );

    if (secondGuide.version !== 2 || !secondGuide.is_active) {
      throw new Error("Expected second guide generation to create active v2.");
    }

    const { data: inactiveV1, error: inactiveError } = await context.supabase
      .from("voice_style_guides")
      .select("is_active")
      .eq("id", firstGuides[0].id)
      .single();

    if (inactiveError || inactiveV1.is_active) {
      throw new Error("Expected v1 to be deactivated after v2 generation.");
    }

    const completed = await completeOnboarding(context);

    if (!completed.onboarding_completed_at) {
      throw new Error("Expected onboarding_completed_at to be set.");
    }

    console.log(
      "Onboarding test passed: basics, profiles, samples, guides, v2 activation, and completion work.",
    );
  } finally {
    await cleanup();
  }
}

main().catch((error: unknown) => {
  const message =
    error instanceof Error ? error.message : "Unknown onboarding test failure";
  console.error(message);
  process.exitCode = 1;
});
