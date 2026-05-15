import { randomUUID } from "node:crypto";

import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

import type { Database, Tables, TablesInsert } from "../lib/db/types";
import { GmailSendError, type GmailSendInput } from "../lib/gmail/send.ts";
import {
  approveAndSchedule,
  processSendQueue,
  undoApproval,
} from "../lib/sending/service.ts";

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
  const brand = await seedBrand(userId);
  const contact = await seedContact(userId, brand.id);
  await seedRules(userId, profile.id);
  await seedGmailCredential(userId);
  const context = {
    supabase: service,
    userId,
  };

  const pending = await seedPendingPitch(userId, profile.id, brand.id, contact.id);
  const approved = await approveAndSchedule(context, pending.message.id, {
    editedSubject: "Picked subject",
    editedBody: `${pending.message.body_text}\nSmall edit.`,
  });
  const scheduledAt = new Date(
    approved.message.scheduled_send_at ?? "",
  ).getTime();

  assert(approved.message.status === "approved", "Approval should set status.");
  assert(
    scheduledAt > Date.now() && scheduledAt <= Date.now() + 45_000,
    "Immediate mode should schedule inside the 30 second undo window.",
  );
  assert(
    approved.message.was_edited_before_send,
    "Edited approval should mark the message edited.",
  );

  const undone = await undoApproval(context, approved.message.id);
  assert(
    undone.status === "pending_approval",
    "Undo should revert to pending approval.",
  );

  const expired = await seedApprovedPitch(
    userId,
    profile.id,
    brand.id,
    contact.id,
    new Date(Date.now() + 60_000).toISOString(),
    new Date(Date.now() - 1_000).toISOString(),
  );

  try {
    await undoApproval(context, expired.message.id);
    throw new Error("Expired undo should fail.");
  } catch (error) {
    if (error instanceof Error && error.message === "Expired undo should fail.") {
      throw error;
    }
  }

  const due = await seedApprovedPitch(
    userId,
    profile.id,
    brand.id,
    contact.id,
    new Date(Date.now() - 1_000).toISOString(),
    null,
  );
  const sentInputs: GmailSendInput[] = [];
  const sent = await processSendQueue(
    {
      supabase: service,
    },
    async (input) => {
      sentInputs.push(input);

      return {
        gmail_message_id: "gmail-message-id",
        gmail_thread_id: "gmail-thread-id",
      };
    },
  );

  assert(sent.processed >= 1, "Send queue should process due messages.");
  assert(sent.sent === 1, "Send queue should send one message.");
  assert(sentInputs[0]?.fromEmail === "zhengathenahuo@gmail.com", "Gmail address should be sender.");
  const sentMessage = await loadMessage(due.message.id);
  assert(sentMessage.status === "sent", "Message should be marked sent.");
  assert(sentMessage.gmail_message_id === "gmail-message-id", "Gmail id should persist.");
  const refreshedBrand = await loadBrand(brand.id);
  assert(refreshedBrand.pitch_count === 1, "Brand pitch count should increment.");
  const refreshedContact = await loadContact(contact.id);
  assert(refreshedContact.last_emailed_at, "Contact should store last emailed time.");

  await service
    .from("brand_contacts")
    .update({ bounce_count: 2 })
    .eq("id", contact.id);
  const bounce = await seedApprovedPitch(
    userId,
    profile.id,
    brand.id,
    contact.id,
    new Date(Date.now() - 1_000).toISOString(),
    null,
  );
  const bounced = await processSendQueue(
    {
      supabase: service,
    },
    async () => {
      throw new GmailSendError("Invalid recipient", {
        status: 400,
        permanentFailure: true,
      });
    },
  );

  assert(bounced.failed === 1, "Permanent Gmail error should count as failed.");
  const bouncedMessage = await loadMessage(bounce.message.id);
  assert(bouncedMessage.status === "bounced", "Permanent failure should bounce.");
  const bouncedContact = await loadContact(contact.id);
  assert(
    bouncedContact.marked_unreachable,
    "Third bounce should mark contact unreachable.",
  );

  console.log("Send service test passed.");
}

async function createTestUser() {
  const email = `mira-send-${randomUUID()}@example.com`;
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
    name: "Send Test",
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

  if (error || !data) {
    throw new Error(error?.message ?? "Could not seed profile.");
  }

  return data;
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
      confidence: 90,
    })
    .select("*")
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? "Could not seed contact.");
  }

  return data;
}

async function seedRules(userId: string, profileId: string) {
  const { error } = await service.from("outreach_rules").insert({
    user_id: userId,
    creator_profile_id: profileId,
    max_sends_per_day: 15,
    send_mode: "immediate",
    send_window_start_hour: 0,
    send_window_end_hour: 23,
    send_timezone: "America/New_York",
    min_minutes_between_sends: 0,
    max_minutes_between_sends: 0,
    send_on_weekends: true,
    warmup_mode: false,
  });

  if (error) {
    throw new Error(error.message);
  }
}

async function seedGmailCredential(userId: string) {
  const { error } = await service.from("gmail_credentials").insert({
    user_id: userId,
    google_email: "zhengathenahuo@gmail.com",
    refresh_token_encrypted: "mock-refresh-token",
    scopes: ["https://www.googleapis.com/auth/gmail.send"],
  });

  if (error) {
    throw new Error(error.message);
  }
}

async function seedPendingPitch(
  userId: string,
  profileId: string,
  brandId: string,
  contactId: string,
) {
  const campaign = await seedCampaign(userId, profileId, brandId, contactId);
  const message = await seedMessage(userId, campaign.id, {
    status: "pending_approval",
  });

  return {
    campaign,
    message,
  };
}

async function seedApprovedPitch(
  userId: string,
  profileId: string,
  brandId: string,
  contactId: string,
  scheduledSendAt: string,
  undoUntil: string | null,
) {
  const campaign = await seedCampaign(userId, profileId, brandId, contactId);
  const message = await seedMessage(userId, campaign.id, {
    status: "approved",
    approved_at: new Date().toISOString(),
    approved_by: userId,
    scheduled_send_at: scheduledSendAt,
    undo_until: undoUntil,
  });

  return {
    campaign,
    message,
  };
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
      status: "drafted",
      target_contact_id: contactId,
    })
    .select("*")
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? "Could not seed campaign.");
  }

  return data;
}

async function seedMessage(
  userId: string,
  campaignId: string,
  overrides: Partial<TablesInsert<"messages">>,
) {
  const { data, error } = await service
    .from("messages")
    .insert({
      user_id: userId,
      campaign_id: campaignId,
      version: 1,
      kind: "initial",
      subject: "Original subject",
      subject_variants: ["Original subject", "Second subject", "Third subject"],
      body_text: "Hi team,\n\nA quick idea.\n\nBest,\nAthena",
      body_html: null,
      status: "pending_approval",
      ...overrides,
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

async function loadBrand(brandId: string) {
  const { data, error } = await service
    .from("brands")
    .select("*")
    .eq("id", brandId)
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? "Could not load brand.");
  }

  return data;
}

async function loadContact(contactId: string) {
  const { data, error } = await service
    .from("brand_contacts")
    .select("*")
    .eq("id", contactId)
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? "Could not load contact.");
  }

  return data;
}

async function cleanup() {
  if (createdUserId) {
    await service.auth.admin.deleteUser(createdUserId);
  }
}

main()
  .catch((error: unknown) => {
    const message =
      error instanceof Error ? error.message : "Unknown send service error";
    console.error(message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await cleanup();
  });
