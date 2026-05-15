import { randomUUID } from "node:crypto";

import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

import { defaultVoiceStyleGuide } from "../lib/db/style-guide.ts";
import type { MediaKitJson } from "../lib/db/media-kit.ts";
import type { Database, Json, TablesInsert } from "../lib/db/types";
import { runAutoDraftBatch } from "../lib/drafting/batch.ts";
import {
  createDraftFixture,
  createResearchBriefFixture,
} from "../lib/drafting/service.ts";
import type { DealType } from "../lib/scoring/rules.ts";

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
  await service.from("outreach_rules").insert({
    user_id: userId,
    creator_profile_id: profile.id,
    max_drafts_per_day: 2,
    send_timezone: "America/New_York",
  });
  const brands = await seedBrands(userId);
  await seedScores(userId, profile.id, brands);
  await service.from("draft_suppressions").insert({
    user_id: userId,
    creator_profile_id: profile.id,
    brand_id: brands[4].id,
    deal_type: "paid",
    suppressed_until: new Date(Date.now() + 86_400_000).toISOString(),
    reason: "manual",
  });

  const context = {
    supabase: service,
    userId,
  };
  const generators = {
    brief: async () => createResearchBriefFixture(),
    draft: async () => createDraftFixture(),
  };
  const first = await runAutoDraftBatch(
    context,
    {
      creatorProfileIds: [profile.id],
    },
    generators,
  );

  assert(first.profilesProcessed === 1, "Expected one profile processed.");
  assert(first.draftsCreated === 2, "Expected exactly 2 drafts from limit.");

  const campaigns = await loadCampaigns(userId);
  assert(campaigns.length === 2, "Expected two campaigns.");
  assert(
    campaigns.some(
      (campaign) =>
        campaign.brand_id === brands[0].id && campaign.deal_type === "paid",
    ),
    "Highest score for duplicate brand should be paid.",
  );
  assert(
    campaigns.some(
      (campaign) =>
        campaign.brand_id === brands[1].id && campaign.deal_type === "ugc",
    ),
    "Second-highest eligible brand should be drafted.",
  );

  const second = await runAutoDraftBatch(
    context,
    {
      creatorProfileIds: [profile.id],
    },
    generators,
  );

  assert(second.draftsCreated === 0, "Re-run should not duplicate live drafts.");
  assert((await loadCampaigns(userId)).length === 2, "No new campaigns expected.");

  console.log("Auto-draft batch test passed.");
}

async function createTestUser() {
  const email = `mira-auto-draft-${randomUUID()}@example.com`;
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
    name: "Auto Draft Test",
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
      brandInsert(userId, "Glossier", "domain:glossier.com", false),
      brandInsert(userId, "UGC Brand", "domain:ugc.test", false),
      brandInsert(userId, "Too Low", "domain:low.test", false),
      brandInsert(userId, "Excluded", "domain:excluded.test", true),
      brandInsert(userId, "Suppressed", "domain:suppressed.test", false),
    ])
    .select("*");

  if (error || !data) {
    throw new Error(error?.message ?? "Could not seed brands.");
  }

  return data;
}

async function seedScores(
  userId: string,
  profileId: string,
  brands: { id: string }[],
) {
  const rows: TablesInsert<"brand_fit_scores">[] = [
    scoreInsert(userId, profileId, brands[0].id, "paid", 90),
    scoreInsert(userId, profileId, brands[1].id, "ugc", 80),
    scoreInsert(userId, profileId, brands[2].id, "paid", 39),
    scoreInsert(userId, profileId, brands[3].id, "paid", 95),
    scoreInsert(userId, profileId, brands[4].id, "paid", 85),
  ];
  const { error } = await service.from("brand_fit_scores").insert(rows);

  if (error) {
    throw new Error(error.message);
  }
}

function scoreInsert(
  userId: string,
  profileId: string,
  brandId: string,
  dealType: DealType,
  score: number,
): TablesInsert<"brand_fit_scores"> {
  return {
    user_id: userId,
    creator_profile_id: profileId,
    brand_id: brandId,
    deal_type: dealType,
    base_fit_score: score,
    deal_type_score: score,
    score_rationale_json: {
      base_fit_score: score,
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
  excluded: boolean,
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
    excluded,
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

async function loadCampaigns(userId: string) {
  const { data, error } = await service
    .from("campaigns")
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
      error instanceof Error ? error.message : "Unknown auto-draft batch error";
    console.error(message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await cleanup();
  });
