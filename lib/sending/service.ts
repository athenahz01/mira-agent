import type { SupabaseClient } from "@supabase/supabase-js";

import type { Json, Tables } from "../db/types";
import {
  GmailSendError,
  sendEmailViaGmail,
  type GmailSendInput,
  type GmailSendResult,
} from "../gmail/send.ts";
import { type SendDecision, decideSendTime } from "./pacing.ts";

export type { SendDecision } from "./pacing.ts";

export type SendingContext = {
  supabase: SupabaseClient;
  userId: string;
};

export type ServiceRoleSendingContext = {
  supabase: SupabaseClient;
};

export type ApproveAndScheduleOptions = {
  editedSubject?: string;
  editedBody?: string;
  pickedSubjectVariant?: number;
};

export type ScheduledSendRow = {
  message: Tables<"messages">;
  campaign: Tables<"campaigns">;
  brand: Tables<"brands">;
  creator_profile: Tables<"creator_profiles">;
  contact: Tables<"brand_contacts"> | null;
};

type MessageWithCampaign = {
  message: Tables<"messages">;
  campaign: Tables<"campaigns">;
};

type SendQueueMessage = MessageWithCampaign & {
  brand: Tables<"brands">;
  contact: Tables<"brand_contacts"> | null;
  user: Tables<"users">;
  credential: Tables<"gmail_credentials"> | null;
  rules: Tables<"outreach_rules">;
};

export class SendingServiceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SendingServiceError";
  }
}

export async function approveAndSchedule(
  context: SendingContext,
  messageId: string,
  options: ApproveAndScheduleOptions,
): Promise<{ message: Tables<"messages">; decision: SendDecision }> {
  const { message, campaign } = await loadMessageWithCampaign(context, messageId);

  if (message.status !== "pending_approval") {
    throw new SendingServiceError("Only pending drafts can be approved.");
  }

  if (!campaign.target_contact_id) {
    throw new SendingServiceError(
      "Add a brand contact before approving this pitch for send.",
    );
  }

  const contact = await loadContact(context, campaign.target_contact_id);

  if (!contact || contact.marked_unreachable) {
    throw new SendingServiceError(
      "Choose a reachable brand contact before approving this pitch.",
    );
  }

  const rules = await loadRulesForProfile(context, campaign.creator_profile_id);
  const lastSentAt = await loadLastSentAt(
    context,
    campaign.creator_profile_id,
  );
  const sentTodayCount = await countSentToday(
    context,
    campaign.creator_profile_id,
  );
  const decision = decideSendTime({
    rules,
    lastSentAt,
    sentTodayCount,
    now: new Date(),
  });

  if (decision.kind === "reject") {
    throw new SendingServiceError(readRejectReason(decision.reason));
  }

  const subjectVariants = readSubjectVariants(message);
  const pickedSubject =
    typeof options.pickedSubjectVariant === "number" &&
    options.pickedSubjectVariant >= 0 &&
    options.pickedSubjectVariant < subjectVariants.length
      ? subjectVariants[options.pickedSubjectVariant]
      : null;
  const editedSubject = options.editedSubject?.trim();
  const finalSubject = editedSubject || pickedSubject || message.subject;
  const finalBody = options.editedBody ?? message.body_text;
  const subjectChanged = finalSubject !== message.subject;
  const bodyChanged = finalBody !== message.body_text;
  const now = new Date();
  const scheduledSendAt =
    decision.kind === "send_immediately"
      ? new Date(now.getTime() + 30_000)
      : decision.scheduled_send_at;
  const undoUntil = decision.kind === "send_immediately" ? scheduledSendAt : null;

  if (bodyChanged) {
    await insertEditedVoiceSample(
      context,
      campaign,
      message.body_text,
      finalBody,
    );
  }

  const { data, error } = await context.supabase
    .from("messages")
    .update({
      subject: finalSubject,
      body_text: finalBody,
      status: "approved",
      approved_at: now.toISOString(),
      approved_by: context.userId,
      was_edited_before_send: subjectChanged || bodyChanged,
      edit_diff: buildApprovalEditDiff(message, {
        originalSubject: message.subject,
        editedSubject: finalSubject,
        originalBody: message.body_text,
        editedBody: finalBody,
      }) as Json,
      scheduled_send_at: scheduledSendAt.toISOString(),
      undo_until: undoUntil?.toISOString() ?? null,
      send_error: null,
    })
    .eq("id", message.id)
    .eq("user_id", context.userId)
    .select("*")
    .single();

  if (error || !data) {
    throw new SendingServiceError(
      error?.message ?? "Could not schedule approved draft.",
    );
  }

  await updateCampaignStatus(context, campaign.id, "approved");
  await insertSendEvent(context.supabase, {
    userId: context.userId,
    messageId: message.id,
    eventType: "queued",
    details: {
      mode: rules.send_mode,
      decision_kind: decision.kind,
      scheduled_send_at: scheduledSendAt.toISOString(),
    },
  });

  return {
    message: data,
    decision,
  };
}

export async function undoApproval(
  context: SendingContext,
  messageId: string,
): Promise<Tables<"messages">> {
  const { message, campaign } = await loadMessageWithCampaign(context, messageId);

  if (
    message.status !== "approved" ||
    !message.undo_until ||
    new Date(message.undo_until).getTime() <= Date.now()
  ) {
    throw new SendingServiceError("Undo window expired.");
  }

  const { data, error } = await context.supabase
    .from("messages")
    .update({
      status: "pending_approval",
      approved_at: null,
      approved_by: null,
      scheduled_send_at: null,
      undo_until: null,
    })
    .eq("id", message.id)
    .eq("user_id", context.userId)
    .select("*")
    .single();

  if (error || !data) {
    throw new SendingServiceError(error?.message ?? "Could not undo approval.");
  }

  await updateCampaignStatus(context, campaign.id, "drafted");
  await insertSendEvent(context.supabase, {
    userId: context.userId,
    messageId: message.id,
    eventType: "undone",
    details: null,
  });

  return data;
}

export async function processSendQueue(
  context: ServiceRoleSendingContext,
  sender: typeof sendEmailViaGmail = sendEmailViaGmail,
): Promise<{ processed: number; sent: number; failed: number }> {
  const dueMessages = await loadDueMessages(context.supabase);
  let processed = 0;
  let sent = 0;
  let failed = 0;

  for (const message of dueMessages) {
    processed += 1;
    const loaded = await loadQueueMessage(context.supabase, message);

    try {
      const spacing = await checkMinimumSpacing(context.supabase, loaded);

      if (spacing) {
        await pauseMessage(context.supabase, loaded.message, spacing, {
          reason: "minimum_spacing",
        });
        continue;
      }

      const sentTodayCount = await countSentToday(
        { supabase: context.supabase, userId: loaded.message.user_id },
        loaded.campaign.creator_profile_id,
      );
      const lastSentAt = await loadLastSentAt(
        { supabase: context.supabase, userId: loaded.message.user_id },
        loaded.campaign.creator_profile_id,
      );
      const decision = decideSendTime({
        rules: loaded.rules,
        lastSentAt,
        sentTodayCount,
        now: new Date(),
      });

      if (decision.kind === "reject") {
        await pauseMessage(
          context.supabase,
          loaded.message,
          nextRetryAfterReject(loaded.rules),
          {
            reason: decision.reason,
          },
        );
        continue;
      }

      if (decision.kind === "schedule_at") {
        const scheduledAt = decision.scheduled_send_at;

        if (scheduledAt.getTime() > Date.now() + 1_000) {
          await pauseMessage(context.supabase, loaded.message, scheduledAt, {
            reason: "outside_window",
          });
          continue;
        }
      }

      await insertSendEvent(context.supabase, {
        userId: loaded.message.user_id,
        messageId: loaded.message.id,
        eventType: "attempting",
        details: null,
      });

      const result = await sender(buildGmailSendInput(loaded));

      await markMessageSent(context.supabase, loaded, result);
      sent += 1;
    } catch (error) {
      failed += 1;
      await handleSendFailure(context.supabase, loaded, error);
    }
  }

  return {
    processed,
    sent,
    failed,
  };
}

export async function listScheduledSends(
  context: SendingContext,
  profileId?: string,
): Promise<ScheduledSendRow[]> {
  const { data: messages, error } = await context.supabase
    .from("messages")
    .select("*")
    .eq("user_id", context.userId)
    .eq("status", "approved")
    .is("sent_at", null)
    .order("scheduled_send_at", {
      ascending: true,
      nullsFirst: false,
    });

  if (error) {
    throw new SendingServiceError(error.message);
  }

  const rows: ScheduledSendRow[] = [];

  for (const message of messages ?? []) {
    const campaign = await loadCampaign(context, message.campaign_id);

    if (profileId && campaign.creator_profile_id !== profileId) {
      continue;
    }

    const [brand, profile, contact] = await Promise.all([
      loadBrand(context, campaign.brand_id),
      loadCreatorProfile(context, campaign.creator_profile_id),
      campaign.target_contact_id
        ? loadContact(context, campaign.target_contact_id)
        : Promise.resolve(null),
    ]);

    rows.push({
      message,
      campaign,
      brand,
      creator_profile: profile,
      contact,
    });
  }

  return rows;
}

export async function sendScheduledMessageNow(
  context: SendingContext,
  messageId: string,
): Promise<Tables<"messages">> {
  const { data, error } = await context.supabase
    .from("messages")
    .update({
      scheduled_send_at: new Date().toISOString(),
      undo_until: null,
    })
    .eq("id", messageId)
    .eq("user_id", context.userId)
    .eq("status", "approved")
    .is("sent_at", null)
    .select("*")
    .single();

  if (error || !data) {
    throw new SendingServiceError(error?.message ?? "Could not send now.");
  }

  await insertSendEvent(context.supabase, {
    userId: context.userId,
    messageId,
    eventType: "queued",
    details: {
      mode: "send_now",
    },
  });

  return data;
}

export async function cancelScheduledSend(
  context: SendingContext,
  messageId: string,
): Promise<Tables<"messages">> {
  const { message, campaign } = await loadMessageWithCampaign(context, messageId);

  if (message.status !== "approved" || message.sent_at) {
    throw new SendingServiceError("Only unsent approved messages can be cancelled.");
  }

  const { data, error } = await context.supabase
    .from("messages")
    .update({
      status: "pending_approval",
      approved_at: null,
      approved_by: null,
      scheduled_send_at: null,
      undo_until: null,
    })
    .eq("id", messageId)
    .eq("user_id", context.userId)
    .select("*")
    .single();

  if (error || !data) {
    throw new SendingServiceError(error?.message ?? "Could not cancel send.");
  }

  await updateCampaignStatus(context, campaign.id, "drafted");
  await insertSendEvent(context.supabase, {
    userId: context.userId,
    messageId,
    eventType: "undone",
    details: {
      mode: "cancel_scheduled",
    },
  });

  return data;
}

async function loadDueMessages(supabase: SupabaseClient) {
  const { data, error } = await supabase
    .from("messages")
    .select("*")
    .eq("status", "approved")
    .is("sent_at", null)
    .lte("scheduled_send_at", new Date().toISOString())
    .order("scheduled_send_at", {
      ascending: true,
      nullsFirst: false,
    })
    .limit(10);

  if (error) {
    throw new SendingServiceError(error.message);
  }

  return data ?? [];
}

async function loadQueueMessage(
  supabase: SupabaseClient,
  message: Tables<"messages">,
): Promise<SendQueueMessage> {
  const context = {
    supabase,
    userId: message.user_id,
  };
  const campaign = await loadCampaign(context, message.campaign_id);
  const [brand, user, credential, rules, contact] = await Promise.all([
    loadBrand(context, campaign.brand_id),
    loadUser(context),
    loadActiveCredential(context),
    loadRulesForProfile(context, campaign.creator_profile_id),
    campaign.target_contact_id
      ? loadContact(context, campaign.target_contact_id)
      : Promise.resolve(null),
  ]);

  return {
    message,
    campaign,
    brand,
    user,
    credential,
    rules,
    contact,
  };
}

async function loadMessageWithCampaign(
  context: SendingContext,
  messageId: string,
): Promise<MessageWithCampaign> {
  const { data: message, error: messageError } = await context.supabase
    .from("messages")
    .select("*")
    .eq("id", messageId)
    .eq("user_id", context.userId)
    .single();

  if (messageError || !message) {
    throw new SendingServiceError(messageError?.message ?? "Message not found.");
  }

  const campaign = await loadCampaign(context, message.campaign_id);

  return { message, campaign };
}

async function loadCampaign(context: SendingContext, campaignId: string) {
  const { data, error } = await context.supabase
    .from("campaigns")
    .select("*")
    .eq("id", campaignId)
    .eq("user_id", context.userId)
    .single();

  if (error || !data) {
    throw new SendingServiceError(error?.message ?? "Campaign not found.");
  }

  return data;
}

async function loadBrand(context: SendingContext, brandId: string) {
  const { data, error } = await context.supabase
    .from("brands")
    .select("*")
    .eq("id", brandId)
    .eq("user_id", context.userId)
    .single();

  if (error || !data) {
    throw new SendingServiceError(error?.message ?? "Brand not found.");
  }

  return data;
}

async function loadCreatorProfile(
  context: SendingContext,
  creatorProfileId: string,
) {
  const { data, error } = await context.supabase
    .from("creator_profiles")
    .select("*")
    .eq("id", creatorProfileId)
    .eq("user_id", context.userId)
    .single();

  if (error || !data) {
    throw new SendingServiceError(
      error?.message ?? "Creator profile not found.",
    );
  }

  return data;
}

async function loadContact(context: SendingContext, contactId: string) {
  const { data, error } = await context.supabase
    .from("brand_contacts")
    .select("*")
    .eq("id", contactId)
    .eq("user_id", context.userId)
    .maybeSingle();

  if (error) {
    throw new SendingServiceError(error.message);
  }

  return data;
}

async function loadUser(context: SendingContext) {
  const { data, error } = await context.supabase
    .from("users")
    .select("*")
    .eq("user_id", context.userId)
    .single();

  if (error || !data) {
    throw new SendingServiceError(error?.message ?? "User settings not found.");
  }

  return data;
}

async function loadActiveCredential(context: SendingContext) {
  const { data, error } = await context.supabase
    .from("gmail_credentials")
    .select("*")
    .eq("user_id", context.userId)
    .is("revoked_at", null)
    .order("created_at", {
      ascending: false,
    })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new SendingServiceError(error.message);
  }

  return data;
}

async function loadRulesForProfile(
  context: SendingContext,
  creatorProfileId: string,
) {
  const { data, error } = await context.supabase
    .from("outreach_rules")
    .select("*")
    .eq("user_id", context.userId)
    .or(`creator_profile_id.eq.${creatorProfileId},creator_profile_id.is.null`);

  if (error) {
    throw new SendingServiceError(error.message);
  }

  const rows = data ?? [];
  const profileRule = rows.find(
    (rule) => rule.creator_profile_id === creatorProfileId,
  );
  const globalRule = rows.find((rule) => rule.creator_profile_id === null);
  const rule = profileRule ?? globalRule;

  if (!rule) {
    throw new SendingServiceError("Outreach rules are missing.");
  }

  return rule;
}

async function loadLastSentAt(
  context: SendingContext,
  creatorProfileId: string,
) {
  const campaignIds = await loadCampaignIdsForProfile(context, creatorProfileId);

  if (campaignIds.length === 0) {
    return null;
  }

  const { data, error } = await context.supabase
    .from("messages")
    .select("sent_at")
    .eq("user_id", context.userId)
    .eq("status", "sent")
    .not("sent_at", "is", null)
    .in("campaign_id", campaignIds)
    .order("sent_at", { ascending: false })
    .limit(1);

  if (error) {
    throw new SendingServiceError(error.message);
  }

  return data?.[0]?.sent_at ? new Date(data[0].sent_at) : null;
}

async function countSentToday(
  context: SendingContext,
  creatorProfileId: string,
) {
  const campaignIds = await loadCampaignIdsForProfile(context, creatorProfileId);

  if (campaignIds.length === 0) {
    return 0;
  }

  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const { count, error } = await context.supabase
    .from("messages")
    .select("id", { count: "exact", head: true })
    .eq("user_id", context.userId)
    .eq("status", "sent")
    .not("sent_at", "is", null)
    .gte("sent_at", startOfToday.toISOString())
    .in("campaign_id", campaignIds);

  if (error) {
    throw new SendingServiceError(error.message);
  }

  return count ?? 0;
}

async function loadCampaignIdsForProfile(
  context: SendingContext,
  creatorProfileId: string,
) {
  const { data, error } = await context.supabase
    .from("campaigns")
    .select("id")
    .eq("user_id", context.userId)
    .eq("creator_profile_id", creatorProfileId);

  if (error) {
    throw new SendingServiceError(error.message);
  }

  return (data ?? []).map((campaign) => campaign.id);
}

async function insertEditedVoiceSample(
  context: SendingContext,
  campaign: Tables<"campaigns">,
  originalBody: string,
  editedBody: string,
) {
  const { error } = await context.supabase.from("voice_samples").insert({
    user_id: context.userId,
    creator_profile_id: campaign.creator_profile_id,
    source: "email_edited",
    text: editedBody,
    tag: "pitch",
    metadata_json: {
      campaign_id: campaign.id,
      original_body: originalBody,
      edited_body: editedBody,
    } as Json,
  });

  if (error) {
    throw new SendingServiceError(error.message);
  }
}

async function updateCampaignStatus(
  context: SendingContext,
  campaignId: string,
  status: Tables<"campaigns">["status"],
) {
  const { error } = await context.supabase
    .from("campaigns")
    .update({ status })
    .eq("id", campaignId)
    .eq("user_id", context.userId);

  if (error) {
    throw new SendingServiceError(error.message);
  }
}

async function markMessageSent(
  supabase: SupabaseClient,
  loaded: SendQueueMessage,
  result: GmailSendResult,
) {
  const now = new Date().toISOString();
  const { error: messageError } = await supabase
    .from("messages")
    .update({
      status: "sent",
      sent_at: now,
      gmail_message_id: result.gmail_message_id,
      gmail_thread_id: result.gmail_thread_id,
      send_attempts: loaded.message.send_attempts + 1,
      send_error: null,
      undo_until: null,
    })
    .eq("id", loaded.message.id)
    .eq("user_id", loaded.message.user_id);

  if (messageError) {
    throw new SendingServiceError(messageError.message);
  }

  const { error: campaignError } = await supabase
    .from("campaigns")
    .update({
      status: "sent",
      sent_at: now,
    })
    .eq("id", loaded.campaign.id)
    .eq("user_id", loaded.message.user_id);

  if (campaignError) {
    throw new SendingServiceError(campaignError.message);
  }

  if (loaded.contact) {
    const { error: contactError } = await supabase
      .from("brand_contacts")
      .update({
        last_emailed_at: now,
      })
      .eq("id", loaded.contact.id)
      .eq("user_id", loaded.message.user_id);

    if (contactError) {
      throw new SendingServiceError(contactError.message);
    }
  }

  const { error: brandError } = await supabase
    .from("brands")
    .update({
      last_pitched_at: now,
      pitch_count: loaded.brand.pitch_count + 1,
    })
    .eq("id", loaded.brand.id)
    .eq("user_id", loaded.message.user_id);

  if (brandError) {
    throw new SendingServiceError(brandError.message);
  }

  const participantEmails = [
    loaded.credential?.google_email,
    loaded.contact?.email,
  ].filter((item): item is string => Boolean(item));
  const { error: threadError } = await supabase.from("email_threads").upsert(
    {
      user_id: loaded.message.user_id,
      gmail_thread_id: result.gmail_thread_id,
      campaign_id: loaded.campaign.id,
      last_message_at: now,
      participant_emails: participantEmails,
    },
    {
      onConflict: "gmail_thread_id",
    },
  );

  if (threadError) {
    throw new SendingServiceError(threadError.message);
  }

  await insertSendEvent(supabase, {
    userId: loaded.message.user_id,
    messageId: loaded.message.id,
    eventType: "sent",
    details: result as unknown as Json,
  });
}

async function handleSendFailure(
  supabase: SupabaseClient,
  loaded: SendQueueMessage,
  error: unknown,
) {
  const message = error instanceof Error ? error.message : "Unknown send error";

  if (error instanceof GmailSendError && error.quotaExceeded) {
    const { error: pauseError } = await supabase
      .from("messages")
      .update({
        scheduled_send_at: null,
        send_error: "Gmail quota hit, retry tomorrow.",
      })
      .eq("user_id", loaded.message.user_id)
      .eq("status", "approved")
      .is("sent_at", null);

    if (pauseError) {
      throw new SendingServiceError(pauseError.message);
    }

    await insertSendEvent(supabase, {
      userId: loaded.message.user_id,
      messageId: loaded.message.id,
      eventType: "paused",
      details: {
        reason: "quota_exceeded",
        error_message: message,
      },
    });
    return;
  }

  if (error instanceof GmailSendError && error.permanentFailure) {
    await markMessageBounced(supabase, loaded, message);
    return;
  }

  const nextAttempt = new Date(
    Date.now() + backoffSeconds(loaded.message.send_attempts + 1) * 1000,
  );
  const { error: updateError } = await supabase
    .from("messages")
    .update({
      send_attempts: loaded.message.send_attempts + 1,
      send_error: message,
      scheduled_send_at: nextAttempt.toISOString(),
    })
    .eq("id", loaded.message.id)
    .eq("user_id", loaded.message.user_id);

  if (updateError) {
    throw new SendingServiceError(updateError.message);
  }

  await insertSendEvent(supabase, {
    userId: loaded.message.user_id,
    messageId: loaded.message.id,
    eventType: "failed",
    details: {
      retry_at: nextAttempt.toISOString(),
      error_message: message,
    },
  });
}

async function markMessageBounced(
  supabase: SupabaseClient,
  loaded: SendQueueMessage,
  message: string,
) {
  const { error: updateError } = await supabase
    .from("messages")
    .update({
      status: "bounced",
      send_attempts: loaded.message.send_attempts + 1,
      send_error: message,
      scheduled_send_at: null,
      undo_until: null,
    })
    .eq("id", loaded.message.id)
    .eq("user_id", loaded.message.user_id);

  if (updateError) {
    throw new SendingServiceError(updateError.message);
  }

  if (loaded.contact) {
    const nextBounceCount = loaded.contact.bounce_count + 1;
    const { error: contactError } = await supabase
      .from("brand_contacts")
      .update({
        bounce_count: nextBounceCount,
        marked_unreachable: nextBounceCount >= 3,
      })
      .eq("id", loaded.contact.id)
      .eq("user_id", loaded.message.user_id);

    if (contactError) {
      throw new SendingServiceError(contactError.message);
    }
  }

  await insertSendEvent(supabase, {
    userId: loaded.message.user_id,
    messageId: loaded.message.id,
    eventType: "failed",
    details: {
      permanent: true,
      error_message: message,
    },
  });
}

async function pauseMessage(
  supabase: SupabaseClient,
  message: Tables<"messages">,
  scheduledAt: Date,
  details: Json,
) {
  const { error } = await supabase
    .from("messages")
    .update({
      scheduled_send_at: scheduledAt.toISOString(),
      send_error: null,
    })
    .eq("id", message.id)
    .eq("user_id", message.user_id);

  if (error) {
    throw new SendingServiceError(error.message);
  }

  await insertSendEvent(supabase, {
    userId: message.user_id,
    messageId: message.id,
    eventType: "paused",
    details: {
      ...readJsonRecord(details),
      scheduled_send_at: scheduledAt.toISOString(),
    },
  });
}

async function checkMinimumSpacing(
  supabase: SupabaseClient,
  loaded: SendQueueMessage,
) {
  const lastSentAt = await loadLastSentAt(
    {
      supabase,
      userId: loaded.message.user_id,
    },
    loaded.campaign.creator_profile_id,
  );

  if (!lastSentAt) {
    return null;
  }

  const earliest = new Date(
    lastSentAt.getTime() + loaded.rules.min_minutes_between_sends * 60_000,
  );

  return earliest.getTime() > Date.now() ? earliest : null;
}

function buildGmailSendInput(loaded: SendQueueMessage): GmailSendInput {
  if (!loaded.credential) {
    throw new GmailSendError("No active Gmail credential.", {
      permanentFailure: true,
    });
  }

  if (!loaded.contact) {
    throw new GmailSendError("No target contact on campaign.", {
      permanentFailure: true,
    });
  }

  return {
    userId: loaded.message.user_id,
    to: loaded.contact.email,
    toName: loaded.contact.name,
    fromEmail: loaded.credential.google_email,
    fromDisplayName:
      loaded.user.sender_display_name ?? loaded.user.name ?? "Athena Huo",
    replyToEmail: null,
    subject: loaded.message.subject,
    bodyText: loaded.message.body_text,
    bodyHtml: loaded.message.body_html,
  };
}

async function insertSendEvent(
  supabase: SupabaseClient,
  input: {
    userId: string;
    messageId: string;
    eventType: Tables<"send_events">["event_type"];
    details: Json | null;
  },
) {
  const { error } = await supabase.from("send_events").insert({
    user_id: input.userId,
    message_id: input.messageId,
    event_type: input.eventType,
    details_json: input.details,
  });

  if (error) {
    throw new SendingServiceError(error.message);
  }
}

function buildApprovalEditDiff(
  message: Tables<"messages">,
  input: {
    originalSubject: string;
    editedSubject: string;
    originalBody: string;
    editedBody: string;
  },
) {
  const subjectChanged = input.originalSubject !== input.editedSubject;
  const bodyChanged = input.originalBody !== input.editedBody;

  return {
    ...readJsonRecord(message.edit_diff),
    approval_edit:
      subjectChanged || bodyChanged
        ? {
            original_subject: input.originalSubject,
            edited_subject: input.editedSubject,
            original_body: input.originalBody,
            edited_body: input.editedBody,
          }
        : null,
  };
}

function readSubjectVariants(message: Tables<"messages">) {
  if (message.subject_variants.length > 0) {
    return message.subject_variants;
  }

  const record = readJsonRecord(message.edit_diff);
  const variants = Array.isArray(record.subject_variants)
    ? record.subject_variants.filter(
        (variant): variant is string => typeof variant === "string",
      )
    : [];

  return variants.length > 0 ? variants : [message.subject];
}

function readJsonRecord(value: Json | null) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
}

function readRejectReason(
  reason: Extract<SendDecision, { kind: "reject" }>["reason"],
) {
  if (reason === "daily_cap") {
    return "Daily send cap reached.";
  }

  if (reason === "outside_window") {
    return "Current time is outside the send window.";
  }

  return "Sending is paused.";
}

function nextRetryAfterReject(rules: Tables<"outreach_rules">) {
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
  tomorrow.setHours(rules.send_window_start_hour, 0, 0, 0);
  return tomorrow;
}

function backoffSeconds(attempts: number) {
  return Math.min(60 * 30, 60 * Math.pow(2, attempts));
}
