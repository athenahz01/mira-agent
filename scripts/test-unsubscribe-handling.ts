import { randomUUID } from "node:crypto";

import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

import { defaultVoiceStyleGuide } from "../lib/db/style-guide.ts";
import type { MediaKitJson } from "../lib/db/media-kit.ts";
import type { Database, Json } from "../lib/db/types";
import {
  createNewReplyFixture,
  createReplyClassificationFixture,
  processInboundReply,
} from "../lib/replies/service.ts";
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
  if (!condition) throw new Error(message);
}

async function main() {
  const fixture = await seedFixture();
  const result = await processInboundReply(
    { supabase: service, userId: fixture.userId },
    createNewReplyFixture({
      gmail_thread_id: fixture.gmailThreadId,
      gmail_message_id: "unsubscribe-message-id",
      from_email: fixture.contactEmail,
      body_text: "Please remove me from your list.",
    }),
    {
      classify: async () =>
        createReplyClassificationFixture({
          category: "unsubscribe",
          suggested_action: "pause_campaign",
          summary: "They asked to be removed from outreach.",
          detected_signals: ["remove me"],
        }),
    },
  );

  assert(result, "Unsubscribe reply should be processed.");
  const brand = await loadBrand(fixture.brandId);
  assert(brand.excluded, "Unsubscribe should exclude the brand.");
  const contact = await loadContact(fixture.contactId);
  assert(contact.marked_unreachable, "Contact should be unreachable.");
  assert(contact.unsubscribe_received_at, "Unsubscribe timestamp should be set.");
  const suppressions = await loadSuppressions(fixture.userId, fixture.brandId);
  assert(suppressions.length === 5, "All deal types should be suppressed.");

  console.log("Unsubscribe handling test passed.");
}

async function seedFixture() {
  const userId = await createTestUser();
  const profile = await seedProfile(userId);
  await seedVoiceAndMedia(userId, profile.id);
  const brand = await seedBrand(userId);
  const contact = await seedContact(userId, brand.id);
  const campaign = await seedCampaign(userId, profile.id, brand.id, contact.id);
  const gmailThreadId = "thread-unsubscribe-test";
  await seedSentMessage(userId, campaign.id, gmailThreadId);
  await service.from("email_threads").insert({
    user_id: userId,
    gmail_thread_id: gmailThreadId,
    campaign_id: campaign.id,
    participant_emails: ["zhengathenahuo@gmail.com", contact.email],
  });
  return {
    userId,
    brandId: brand.id,
    contactId: contact.id,
    contactEmail: contact.email,
    gmailThreadId,
  };
}

async function createTestUser() {
  const email = `mira-unsubscribe-${randomUUID()}@example.com`;
  const { data, error } = await service.auth.admin.createUser({
    email,
    password: `Test-${randomUUID()}!`,
    email_confirm: true,
  });
  if (error || !data.user) throw new Error(error?.message ?? "Could not create user.");
  createdUserId = data.user.id;
  await service.from("users").insert({
    user_id: data.user.id,
    email,
    name: "Unsubscribe Test",
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
      niche_tags: ["beauty"],
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
      name: "Unsub Brand",
      identity_key: `domain:${randomUUID()}.test`,
      aliases: [],
      domain: "brand.test",
      category: ["beauty"],
      aesthetic_tags: ["clean"],
    })
    .select("*")
    .single();
  if (error || !data) throw new Error(error?.message ?? "Could not seed brand.");
  return data;
}

async function seedContact(userId: string, brandId: string) {
  const { data, error } = await service
    .from("brand_contacts")
    .insert({
      user_id: userId,
      brand_id: brandId,
      email: "press@brand.test",
      role: "pr",
      source: "manual",
    })
    .select("*")
    .single();
  if (error || !data) throw new Error(error?.message ?? "Could not seed contact.");
  return data;
}

async function seedCampaign(
  userId: string,
  profileId: string,
  brandId: string,
  contactId: string,
) {
  const { data, error } = await service
    .from("campaigns")
    .insert({
      user_id: userId,
      creator_profile_id: profileId,
      brand_id: brandId,
      deal_type: "paid",
      status: "sent",
      sent_at: new Date().toISOString(),
      research_brief_json: createResearchBriefFixture() as unknown as Json,
      target_contact_id: contactId,
    })
    .select("*")
    .single();
  if (error || !data) throw new Error(error?.message ?? "Could not seed campaign.");
  return data;
}

async function seedSentMessage(
  userId: string,
  campaignId: string,
  gmailThreadId: string,
) {
  const { error } = await service.from("messages").insert({
    user_id: userId,
    campaign_id: campaignId,
    version: 1,
    kind: "initial",
    subject: "Athena x Brand",
    body_text: "Hi team, I had an idea.",
    status: "sent",
    sent_at: new Date().toISOString(),
    gmail_thread_id: gmailThreadId,
    gmail_message_id: "initial-unsubscribe",
  });
  if (error) throw new Error(error.message);
}

async function loadBrand(brandId: string) {
  const { data, error } = await service.from("brands").select("*").eq("id", brandId).single();
  if (error || !data) throw new Error(error?.message ?? "Could not load brand.");
  return data;
}

async function loadContact(contactId: string) {
  const { data, error } = await service.from("brand_contacts").select("*").eq("id", contactId).single();
  if (error || !data) throw new Error(error?.message ?? "Could not load contact.");
  return data;
}

async function loadSuppressions(userId: string, brandId: string) {
  const { data, error } = await service
    .from("draft_suppressions")
    .select("*")
    .eq("user_id", userId)
    .eq("brand_id", brandId);
  if (error) throw new Error(error.message);
  return data ?? [];
}

function fixtureMediaKit(): MediaKitJson {
  return {
    version: 1,
    profile_summary: {
      handle: "athena_hz",
      display_name: "Athena Huo",
      tagline: "NYC creator.",
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
      categories: ["beauty"],
      aesthetic_keywords: ["clean"],
      content_pillars: ["UGC", "beauty routines", "NYC lifestyle"],
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
  if (createdUserId) await service.auth.admin.deleteUser(createdUserId);
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Unknown unsubscribe error");
    process.exitCode = 1;
  })
  .finally(async () => {
    await cleanup();
  });
