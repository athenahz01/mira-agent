import { randomUUID } from "node:crypto";

import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

import { defaultVoiceStyleGuide } from "../lib/db/style-guide.ts";
import type { MediaKitJson } from "../lib/db/media-kit.ts";
import type { Database, Json, TablesInsert } from "../lib/db/types";
import {
  approveDraft,
  createDraftFixture,
  createResearchBriefFixture,
  excludeBrandFromQueue,
  generateAndPersistPitch,
  skipDraft,
} from "../lib/drafting/service.ts";

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

async function main() {
  const userId = await createTestUser();
  const profile = await seedProfile(userId);
  await seedVoiceAndMedia(userId, profile.id);
  const brands = await seedBrands(userId);
  await seedScoresAndContact(userId, profile.id, brands);
  const context = {
    supabase: service,
    userId,
  };
  const generators = {
    brief: async () => createResearchBriefFixture(),
    draft: async () => createDraftFixture(),
  };
  const first = await generateAndPersistPitch(
    context,
    {
      creatorProfileId: profile.id,
      brandId: brands[0].id,
      dealType: "paid",
    },
    generators,
  );

  assert(first.campaign.status === "drafted", "Campaign should be drafted.");
  assert(
    first.message.status === "pending_approval",
    "Message should be pending approval.",
  );
  assert(first.campaign.research_brief_json, "Campaign should store the brief.");

  const hooks = await loadHookRows(userId);
  assert(hooks.length === 1, "Hook library row should be inserted.");

  const approved = await approveDraft(context, first.message.id, {
    editedBody: `${first.message.body_text}\n\nTiny edit.`,
  });

  assert(approved.status === "approved", "Message should be approved.");
  assert(
    approved.was_edited_before_send,
    "Edited approval should mark was_edited_before_send.",
  );

  const voiceSamples = await loadVoiceSamples(userId);
  assert(
    voiceSamples.some((sample) => sample.source === "email_edited"),
    "Edited body should be captured as a voice sample.",
  );

  const second = await generateAndPersistPitch(
    context,
    {
      creatorProfileId: profile.id,
      brandId: brands[1].id,
      dealType: "gifting",
    },
    generators,
  );
  await skipDraft(context, second.message.id);

  const suppressions = await loadDraftSuppressions(userId);
  assert(
    suppressions.some(
      (suppression) =>
        suppression.brand_id === brands[1].id &&
        suppression.deal_type === "gifting",
    ),
    "Skipping should create a draft suppression.",
  );

  const third = await generateAndPersistPitch(
    context,
    {
      creatorProfileId: profile.id,
      brandId: brands[2].id,
      dealType: "ugc",
    },
    generators,
  );
  await excludeBrandFromQueue(context, brands[2].id, "not a fit");

  const { data: excludedBrand, error: excludedError } = await service
    .from("brands")
    .select("*")
    .eq("id", brands[2].id)
    .single();

  if (excludedError || !excludedBrand) {
    throw new Error(excludedError?.message ?? "Could not load excluded brand.");
  }

  assert(excludedBrand.excluded, "Exclude action should mark brand excluded.");

  const { data: skippedMessage, error: skippedError } = await service
    .from("messages")
    .select("*")
    .eq("id", third.message.id)
    .single();

  if (skippedError || !skippedMessage) {
    throw new Error(skippedError?.message ?? "Could not load skipped message.");
  }

  assert(
    skippedMessage.status === "skipped",
    "Exclude action should skip pending messages.",
  );

  console.log("Drafting service test passed.");
}

async function createTestUser() {
  const email = `mira-drafting-${randomUUID()}@example.com`;
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
    name: "Drafting Test",
    sender_display_name: "Athena Huo",
    physical_address: "Configured",
  });

  return data.user.id;
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

async function seedVoiceAndMedia(userId: string, profileId: string) {
  await service.from("voice_style_guides").insert({
    user_id: userId,
    creator_profile_id: profileId,
    version: 1,
    is_active: true,
    style_doc_json: defaultVoiceStyleGuide as unknown as Json,
  });
  await service.from("media_kits").insert({
    user_id: userId,
    creator_profile_id: profileId,
    version: 1,
    is_active: true,
    data_json: fixtureMediaKit() as unknown as Json,
  });
}

async function seedBrands(userId: string) {
  const { data, error } = await service
    .from("brands")
    .insert([
      brandInsert(userId, "Glossier", "domain:glossier.com"),
      brandInsert(userId, "Tower 28", "domain:tower28beauty.com"),
      brandInsert(userId, "Topicals", "domain:topicals.com"),
    ])
    .select("*");

  if (error || !data) {
    throw new Error(error?.message ?? "Could not seed brands.");
  }

  return data;
}

async function seedScoresAndContact(
  userId: string,
  profileId: string,
  brands: { id: string }[],
) {
  const rows: TablesInsert<"brand_fit_scores">[] = [
    scoreInsert(userId, profileId, brands[0].id, "paid", 88),
    scoreInsert(userId, profileId, brands[1].id, "gifting", 76),
    scoreInsert(userId, profileId, brands[2].id, "ugc", 70),
  ];

  await service.from("brand_fit_scores").insert(rows);
  await service.from("brand_contacts").insert({
    user_id: userId,
    brand_id: brands[0].id,
    email: "press@glossier.com",
    role: "pr",
    source: "manual",
    confidence: 90,
  });
}

function scoreInsert(
  userId: string,
  profileId: string,
  brandId: string,
  dealType: "paid" | "gifting" | "ugc",
  score: number,
): TablesInsert<"brand_fit_scores"> {
  return {
    user_id: userId,
    creator_profile_id: profileId,
    brand_id: brandId,
    deal_type: dealType,
    base_fit_score: score - 5,
    deal_type_score: score,
    score_rationale_json: {
      base_fit_score: score - 5,
      base_rationale: ["fixture base"],
      deal_type: dealType,
      deal_type_score: score,
      deal_type_rationale: ["fixture deal"],
      computed_at: new Date().toISOString(),
    } as Json,
  };
}

function brandInsert(
  userId: string,
  name: string,
  identityKey: string,
): TablesInsert<"brands"> {
  return {
    user_id: userId,
    name,
    identity_key: identityKey,
    aliases: [],
    domain: identityKey.replace("domain:", ""),
    instagram_handle: name.toLowerCase().replace(/\s+/g, ""),
    category: ["beauty"],
    aesthetic_tags: ["clean"],
    size_estimate: "established-dtc",
  };
}

function fixtureMediaKit(): MediaKitJson {
  return {
    version: 1,
    profile_summary: {
      handle: "athena_hz",
      display_name: "Athena Huo",
      tagline: "NYC fashion and lifestyle creator.",
      location: "NYC",
      languages: ["English", "Mandarin"],
    },
    audience: {
      platform: "instagram",
      follower_count: 8000,
      engagement_rate: 0.04,
      tier: "micro",
      demographics: {},
    },
    niche: {
      categories: ["fashion", "lifestyle", "ugc"],
      aesthetic_keywords: ["clean", "dewy", "inclusive"],
      content_pillars: ["fit checks", "UGC demos", "NYC lifestyle"],
    },
    deliverables: [
      {
        kind: "ig_reel",
        description: "Short-form editorial reel.",
        suggested_rate_usd: { min: 300, max: 800 },
        usage_rights_included: "Organic usage for 30 days.",
        typical_turnaround_days: 7,
      },
    ],
    past_brand_work: [],
    contact: {
      email: "zhengathenahuo@gmail.com",
      website: "https://athenahuo.com",
      instagram: "https://instagram.com/athena_hz",
    },
    rate_methodology_note:
      "Rates are estimated from creator tier, deliverable complexity, usage rights, and industry data.",
  };
}

async function loadHookRows(userId: string) {
  const { data, error } = await service
    .from("hook_library")
    .select("*")
    .eq("user_id", userId);

  if (error) {
    throw new Error(error.message);
  }

  return data ?? [];
}

async function loadVoiceSamples(userId: string) {
  const { data, error } = await service
    .from("voice_samples")
    .select("*")
    .eq("user_id", userId);

  if (error) {
    throw new Error(error.message);
  }

  return data ?? [];
}

async function loadDraftSuppressions(userId: string) {
  const { data, error } = await service
    .from("draft_suppressions")
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
      error instanceof Error ? error.message : "Unknown drafting service error";
    console.error(message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await cleanup();
  });
