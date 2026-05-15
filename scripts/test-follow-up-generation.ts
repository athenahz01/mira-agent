import { randomUUID } from "node:crypto";

import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

import { defaultVoiceStyleGuide } from "../lib/db/style-guide.ts";
import type { MediaKitJson } from "../lib/db/media-kit.ts";
import type { Database, Json } from "../lib/db/types";
import {
  createFollowUpDraftFixture,
  runFollowUpScan,
} from "../lib/follow-ups/service.ts";
import { createResearchBriefFixture } from "../lib/drafting/service.ts";

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
  const fixture = await seedFixture();
  const context = { supabase: service, userId: fixture.userId };
  const generator = async () => createFollowUpDraftFixture();
  const first = await runFollowUpScan(context, generator);

  assert(first.followUpsCreated === 1, "Expected follow_up_1 to be created.");
  let messages = await loadMessages(fixture.campaignId);
  const followUp1 = messages.find((message) => message.kind === "follow_up_1");
  assert(followUp1, "follow_up_1 message should exist.");
  assert(
    followUp1.status === "pending_approval",
    "follow_up_1 should require approval.",
  );
  assert(
    followUp1.gmail_thread_id === fixture.gmailThreadId,
    "follow_up_1 should stay on the Gmail thread.",
  );

  await service
    .from("messages")
    .update({
      status: "sent",
      sent_at: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
    })
    .eq("id", followUp1.id);

  const second = await runFollowUpScan(context, generator);
  assert(second.followUpsCreated === 1, "Expected follow_up_2 to be created.");
  messages = await loadMessages(fixture.campaignId);
  const followUp2 = messages.find((message) => message.kind === "follow_up_2");
  assert(followUp2, "follow_up_2 message should exist.");

  await service
    .from("messages")
    .update({
      status: "sent",
      sent_at: new Date().toISOString(),
    })
    .eq("id", followUp2.id);

  const third = await runFollowUpScan(context, generator);
  assert(third.campaignsGhosted === 1, "After follow_up_2, campaign should ghost.");
  const campaign = await loadCampaign(fixture.campaignId);
  assert(campaign.status === "ghosted", "Campaign status should be ghosted.");

  console.log("Follow-up generation test passed.");
}

async function seedFixture() {
  const userId = await createTestUser();
  const profile = await seedProfile(userId);
  await seedVoiceAndMedia(userId, profile.id);
  await service.from("outreach_rules").insert({
    user_id: userId,
    creator_profile_id: profile.id,
    send_timezone: "America/New_York",
    follow_up_enabled: true,
    follow_up_1_days_after: 7,
    follow_up_2_days_after_initial: 14,
    follow_up_max_count: 2,
  });
  const brand = await seedBrand(userId);
  const campaign = await seedCampaign(userId, profile.id, brand.id);
  const gmailThreadId = "thread-follow-up-test";
  await seedInitialMessage(userId, campaign.id, gmailThreadId);

  return { userId, campaignId: campaign.id, gmailThreadId };
}

async function createTestUser() {
  const email = `mira-follow-up-${randomUUID()}@example.com`;
  const { data, error } = await service.auth.admin.createUser({
    email,
    password: `Test-${randomUUID()}!`,
    email_confirm: true,
  });

  if (error || !data.user) {
    throw new Error(error?.message ?? "Could not create user.");
  }

  createdUserId = data.user.id;
  await service.from("users").insert({
    user_id: data.user.id,
    email,
    name: "Follow Up Test",
    sender_display_name: "Athena Huo",
    physical_address: "123 Test Street, New York, NY 10001",
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
      niche_tags: ["fashion"],
      aesthetic_keywords: ["clean"],
      tier: "micro",
    })
    .select("*")
    .single();

  if (error || !data) throw new Error(error?.message ?? "Could not seed profile.");
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

async function seedBrand(userId: string) {
  const { data, error } = await service
    .from("brands")
    .insert({
      user_id: userId,
      name: "Follow Brand",
      identity_key: `domain:${randomUUID()}.test`,
      aliases: [],
      domain: "brand.test",
      category: ["fashion"],
      aesthetic_tags: ["clean"],
    })
    .select("*")
    .single();

  if (error || !data) throw new Error(error?.message ?? "Could not seed brand.");
  return data;
}

async function seedCampaign(userId: string, profileId: string, brandId: string) {
  const sentAt = new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await service
    .from("campaigns")
    .insert({
      user_id: userId,
      creator_profile_id: profileId,
      brand_id: brandId,
      deal_type: "paid",
      status: "sent",
      sent_at: sentAt,
      research_brief_json: createResearchBriefFixture() as unknown as Json,
    })
    .select("*")
    .single();

  if (error || !data) throw new Error(error?.message ?? "Could not seed campaign.");
  return data;
}

async function seedInitialMessage(
  userId: string,
  campaignId: string,
  gmailThreadId: string,
) {
  const sentAt = new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString();
  const { error } = await service.from("messages").insert({
    user_id: userId,
    campaign_id: campaignId,
    version: 1,
    kind: "initial",
    subject: "Athena x Brand",
    body_text: "Hi team, I had an idea.",
    status: "sent",
    sent_at: sentAt,
    gmail_thread_id: gmailThreadId,
    gmail_message_id: "initial-follow-up",
  });

  if (error) throw new Error(error.message);
}

async function loadMessages(campaignId: string) {
  const { data, error } = await service
    .from("messages")
    .select("*")
    .eq("campaign_id", campaignId)
    .order("version");

  if (error) throw new Error(error.message);
  return data ?? [];
}

async function loadCampaign(campaignId: string) {
  const { data, error } = await service
    .from("campaigns")
    .select("*")
    .eq("id", campaignId)
    .single();

  if (error || !data) throw new Error(error?.message ?? "Could not load campaign.");
  return data;
}

function fixtureMediaKit(): MediaKitJson {
  return {
    version: 1,
    profile_summary: {
      handle: "athena_hz",
      display_name: "Athena Huo",
      tagline: "NYC fashion creator.",
      location: "NYC",
      languages: ["English"],
    },
    audience: {
      platform: "instagram",
      follower_count: 8000,
      engagement_rate: 0.04,
      tier: "micro",
      demographics: {},
    },
    niche: {
      categories: ["fashion"],
      aesthetic_keywords: ["clean"],
      content_pillars: ["fit checks", "UGC", "NYC lifestyle"],
    },
    deliverables: [],
    past_brand_work: [],
    contact: {
      email: "zhengathenahuo@gmail.com",
      website: "https://athenahuo.com",
      instagram: "https://instagram.com/athena_hz",
    },
    rate_methodology_note: "Fixture rates.",
  };
}

async function cleanup() {
  if (createdUserId) {
    await service.auth.admin.deleteUser(createdUserId);
  }
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Unknown follow-up error");
    process.exitCode = 1;
  })
  .finally(async () => {
    await cleanup();
  });
