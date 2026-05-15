import { randomUUID } from "node:crypto";

import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

import { defaultVoiceStyleGuide } from "../lib/db/style-guide.ts";
import type { MediaKitJson } from "../lib/db/media-kit.ts";
import type { Database, Json, TablesInsert } from "../lib/db/types";
import {
  createReplyClassificationFixture,
  createNewReplyFixture,
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
  if (!condition) {
    throw new Error(message);
  }
}

async function main() {
  const fixture = await seedFixture();
  const result = await processInboundReply(
    {
      supabase: service,
      userId: fixture.userId,
    },
    createNewReplyFixture({
      gmail_thread_id: fixture.gmailThreadId,
      gmail_message_id: "reply-process-test",
      from_email: fixture.contactEmail,
      body_text: "Could you send your rate sheet?",
      received_at: new Date(),
    }),
    {
      classify: async () => createReplyClassificationFixture(),
      draft: async () => ({
        body_text: "Thanks for asking. My paid reel range is $500-$900.\n\nBest,\nAthena",
        model_used: "test-model",
        prompt_hash: "test-hash",
      }),
    },
  );

  assert(result, "Reply should be processed.");
  assert(result.replyDraftMessageId, "Rate ask should create a reply draft.");

  const inbound = await loadMessage(result.messageId);
  assert(inbound.kind === "reply", "Inbound message should use reply kind.");
  assert(inbound.status === "replied", "Inbound message should be replied.");

  const classifications = await loadClassifications(fixture.userId);
  assert(classifications.length === 1, "Classification row should be inserted.");
  assert(
    classifications[0].category === "asks_rate",
    "Classification should be asks_rate.",
  );

  const campaign = await loadCampaign(fixture.campaignId);
  assert(
    campaign.status === "negotiating",
    "asks_rate should move campaign to negotiating.",
  );

  const draft = await loadMessage(result.replyDraftMessageId);
  assert(
    draft.status === "pending_approval" && draft.kind === "reply",
    "Reply draft should enter approval queue.",
  );

  console.log("Process inbound reply test passed.");
}

async function seedFixture() {
  const userId = await createTestUser();
  const profile = await seedProfile(userId);
  await seedVoiceAndMedia(userId, profile.id);
  const brand = await seedBrand(userId);
  const contact = await seedContact(userId, brand.id);
  const campaign = await seedCampaign(userId, profile.id, brand.id, contact.id);
  const initial = await seedSentMessage(userId, campaign.id);
  await service.from("email_threads").insert({
    user_id: userId,
    gmail_thread_id: initial.gmail_thread_id ?? "thread-process-test",
    campaign_id: campaign.id,
    last_message_at: initial.sent_at,
    participant_emails: ["zhengathenahuo@gmail.com", contact.email],
  });

  return {
    userId,
    campaignId: campaign.id,
    gmailThreadId: initial.gmail_thread_id ?? "thread-process-test",
    contactEmail: contact.email,
  };
}

async function createTestUser() {
  const email = `mira-reply-${randomUUID()}@example.com`;
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
    name: "Reply Test",
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
      niche_tags: ["fashion", "beauty"],
      aesthetic_keywords: ["clean"],
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

async function seedBrand(userId: string) {
  const { data, error } = await service
    .from("brands")
    .insert({
      user_id: userId,
      name: "Glossier",
      identity_key: `domain:${randomUUID()}.test`,
      aliases: [],
      domain: "glossier.com",
      category: ["beauty"],
      aesthetic_tags: ["clean"],
      size_estimate: "established-dtc",
    })
    .select("*")
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? "Could not seed brand.");
  }

  return data;
}

async function seedContact(userId: string, brandId: string) {
  const { data, error } = await service
    .from("brand_contacts")
    .insert({
      user_id: userId,
      brand_id: brandId,
      email: "press@brand.test",
      name: "Press Team",
      role: "pr",
      source: "manual",
    })
    .select("*")
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? "Could not seed contact.");
  }

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
      research_brief_json: createResearchBriefFixture() as unknown as Json,
      target_contact_id: contactId,
      sent_at: new Date().toISOString(),
      hook_chosen: "specific-product-hook",
    })
    .select("*")
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? "Could not seed campaign.");
  }

  return data;
}

async function seedSentMessage(userId: string, campaignId: string) {
  const { data, error } = await service
    .from("messages")
    .insert({
      user_id: userId,
      campaign_id: campaignId,
      version: 1,
      kind: "initial",
      subject: "Athena x Brand",
      body_text: "Hi team, I had an idea.",
      status: "sent",
      sent_at: new Date().toISOString(),
      gmail_message_id: "initial-message-id",
      gmail_thread_id: "thread-process-test",
    })
    .select("*")
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? "Could not seed message.");
  }

  return data;
}

async function loadMessage(messageId: string) {
  const { data, error } = await service
    .from("messages")
    .select("*")
    .eq("id", messageId)
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? "Could not load message.");
  }

  return data;
}

async function loadCampaign(campaignId: string) {
  const { data, error } = await service
    .from("campaigns")
    .select("*")
    .eq("id", campaignId)
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? "Could not load campaign.");
  }

  return data;
}

async function loadClassifications(userId: string) {
  const { data, error } = await service
    .from("reply_classifications")
    .select("*")
    .eq("user_id", userId);

  if (error) {
    throw new Error(error.message);
  }

  return data ?? [];
}

function fixtureMediaKit(): MediaKitJson {
  return {
    version: 1,
    profile_summary: {
      handle: "athena_hz",
      display_name: "Athena Huo",
      tagline: "NYC fashion and lifestyle creator.",
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
      content_pillars: ["fit checks", "UGC", "NYC lifestyle"],
    },
    deliverables: [
      {
        kind: "ig_reel",
        description: "Short-form reel.",
        suggested_rate_usd: { min: 500, max: 900 },
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
    console.error(error instanceof Error ? error.message : "Unknown reply test error");
    process.exitCode = 1;
  })
  .finally(async () => {
    await cleanup();
  });
