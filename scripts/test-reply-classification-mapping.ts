import { randomUUID } from "node:crypto";

import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

import type { Database } from "../lib/db/types";
import {
  applyReplySideEffects,
  createNewReplyFixture,
  createReplyClassificationFixture,
} from "../lib/replies/service.ts";

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
  const userId = await createTestUser();
  const profile = await seedProfile(userId);
  const brand = await seedBrand(userId);
  const contact = await seedContact(userId, brand.id);
  const negotiatingCampaign = await seedCampaign(userId, profile.id, brand.id);
  await applyReplySideEffects(
    { supabase: service, userId },
    {
      campaign: negotiatingCampaign,
      brand,
      contacts: [contact],
      reply: createNewReplyFixture(),
      classification: createReplyClassificationFixture({
        category: "interested",
        suggested_action: "move_to_negotiating",
      }),
    },
  );
  const updatedNegotiating = await loadCampaign(negotiatingCampaign.id);
  assert(
    updatedNegotiating.status === "negotiating",
    "move_to_negotiating should set negotiating status.",
  );

  const lostCampaign = await seedCampaign(userId, profile.id, brand.id);
  await applyReplySideEffects(
    { supabase: service, userId },
    {
      campaign: lostCampaign,
      brand,
      contacts: [contact],
      reply: createNewReplyFixture(),
      classification: createReplyClassificationFixture({
        category: "decline_firm",
        suggested_action: "mark_lost",
      }),
    },
  );
  const updatedLost = await loadCampaign(lostCampaign.id);
  assert(updatedLost.status === "lost", "mark_lost should set lost.");
  assert(updatedLost.outcome === "lost", "mark_lost should set lost outcome.");

  const ghostedCampaign = await seedCampaign(userId, profile.id, brand.id);
  await applyReplySideEffects(
    { supabase: service, userId },
    {
      campaign: ghostedCampaign,
      brand,
      contacts: [contact],
      reply: createNewReplyFixture(),
      classification: createReplyClassificationFixture({
        category: "out_of_office",
        suggested_action: "pause_campaign",
      }),
    },
  );
  const updatedGhosted = await loadCampaign(ghostedCampaign.id);
  assert(
    updatedGhosted.status === "ghosted",
    "OOO pause should mark campaign ghosted.",
  );

  console.log("Reply classification mapping test passed.");
}

async function createTestUser() {
  const email = `mira-reply-map-${randomUUID()}@example.com`;
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
    name: "Reply Map Test",
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
    })
    .select("*")
    .single();
  if (error || !data) throw new Error(error?.message ?? "Could not seed profile.");
  return data;
}

async function seedBrand(userId: string) {
  const { data, error } = await service
    .from("brands")
    .insert({
      user_id: userId,
      name: "Mapping Brand",
      identity_key: `domain:${randomUUID()}.test`,
      aliases: [],
      domain: "brand.test",
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
      source: "manual",
    })
    .select("*")
    .single();
  if (error || !data) throw new Error(error?.message ?? "Could not seed contact.");
  return data;
}

async function seedCampaign(userId: string, profileId: string, brandId: string) {
  const { data, error } = await service
    .from("campaigns")
    .insert({
      user_id: userId,
      creator_profile_id: profileId,
      brand_id: brandId,
      deal_type: "paid",
      status: "sent",
      sent_at: new Date().toISOString(),
    })
    .select("*")
    .single();
  if (error || !data) throw new Error(error?.message ?? "Could not seed campaign.");
  return data;
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

async function cleanup() {
  if (createdUserId) await service.auth.admin.deleteUser(createdUserId);
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Unknown mapping error");
    process.exitCode = 1;
  })
  .finally(async () => {
    await cleanup();
  });
