import type { SupabaseClient } from "@supabase/supabase-js";

import { mediaKitJsonSchema, type MediaKitJson } from "../db/media-kit.ts";
import {
  replyClassificationJsonSchema,
  type ReplyCategory,
  type ReplyClassificationJson,
} from "../db/reply-classification.ts";
import type { ResearchBriefJson } from "../db/research-brief";
import {
  voiceStyleGuideJsonSchema,
  type VoiceStyleGuideJson,
} from "../db/style-guide.ts";
import type { Database, Json, Tables } from "../db/types";
import type { NewReply } from "../gmail/inbox.ts";
import { generateReplyDraft, type ReplyDraftInput } from "../llm/reply-draft.ts";
import {
  classifyReply,
  type ReplyClassificationInput,
  type ThreadMessage,
} from "../llm/reply-classify.ts";
import type { CreatorProfileSummary } from "../llm/voice-guide";
import {
  DEAL_TYPES,
  type DealType,
  type ScoringBrand,
} from "../scoring/rules.ts";

export type RepliesContext = {
  supabase: SupabaseClient<Database>;
  userId: string;
};

export type ReplyGenerators = {
  classify?: typeof classifyReply;
  draft?: typeof generateReplyDraft;
};

export type ProcessReplyResult = {
  messageId: string;
  classificationId: string;
  sideEffects: string[];
  replyDraftMessageId?: string;
};

export type RecentReplyRow = {
  message: Tables<"messages">;
  classification: Tables<"reply_classifications"> | null;
  campaign: Tables<"campaigns">;
  brand: Tables<"brands">;
};

export type RecentReplyFilters = {
  categories?: ReplyCategory[];
  hideHandled?: boolean;
  since?: string | null;
  until?: string | null;
};

export class RepliesServiceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RepliesServiceError";
  }
}

export async function processInboundReply(
  context: RepliesContext,
  reply: NewReply,
  generators: ReplyGenerators = {},
): Promise<ProcessReplyResult | null> {
  const existingInbound = await loadMessageByGmailId(
    context,
    reply.gmail_message_id,
  );

  if (existingInbound) {
    return null;
  }

  const thread = await loadEmailThread(context, reply.gmail_thread_id);

  if (!thread?.campaign_id) {
    return null;
  }

  const campaign = await loadCampaign(context, thread.campaign_id);
  const [profile, brand, contacts, signals, user, latestOutbound] =
    await Promise.all([
      loadCreatorProfile(context, campaign.creator_profile_id),
      loadBrand(context, campaign.brand_id),
      loadContacts(context, campaign.brand_id),
      loadSignals(context, campaign.brand_id),
      loadUser(context),
      loadLatestOutboundMessage(context, campaign.id),
    ]);

  if (!latestOutbound) {
    return null;
  }

  const inboundMessage = await insertInboundReplyMessage(context, {
    campaignId: campaign.id,
    reply,
  });
  await updateEmailThread(context, thread, reply);

  const [voiceStyleGuide, mediaKitRow, threadHistory] = await Promise.all([
    loadActiveVoiceGuide(context, campaign.creator_profile_id),
    loadActiveMediaKit(context, campaign.creator_profile_id),
    loadThreadHistory(context, campaign.id),
  ]);
  const mediaKit = mediaKitJsonSchema.parse(mediaKitRow.data_json);
  const scoringBrand = toScoringBrand(brand, contacts, signals);
  const classificationInput: ReplyClassificationInput = {
    creatorProfile: toCreatorSummary(profile),
    voiceStyleGuide,
    campaign,
    brand: scoringBrand,
    miraOriginalMessage: {
      subject: latestOutbound.subject,
      body_text: latestOutbound.body_text,
    },
    reply,
    threadHistory,
  };
  const classification = await (generators.classify ?? classifyReply)(
    classificationInput,
  );
  const classificationRow = await insertReplyClassification(context, {
    messageId: inboundMessage.id,
    classification,
  });
  const sideEffects = await applyReplySideEffects(context, {
    campaign,
    brand,
    contacts,
    reply,
    classification,
  });
  let replyDraftMessageId: string | undefined;

  if (
    classification.category === "asks_rate" &&
    classification.suggested_action === "draft_reply"
  ) {
    const draftInput: ReplyDraftInput = {
      creatorProfile: toCreatorSummary(profile),
      voiceStyleGuide,
      mediaKit,
      campaign,
      brand: scoringBrand,
      threadHistory,
      inboundReply: reply,
      classification,
      senderDisplayName: user.sender_display_name ?? user.name ?? "Athena Huo",
      senderEmail: user.email,
      physicalAddress: user.physical_address ?? "",
    };
    const draft = await (generators.draft ?? generateReplyDraft)(draftInput);
    const draftMessage = await insertReplyDraftMessage(context, {
      campaign,
      reply,
      originalSubject: latestOutbound.subject,
      draft,
    });
    replyDraftMessageId = draftMessage.id;
  }

  await updateHookReplyCounts(context, campaign, classification.category);

  return {
    messageId: inboundMessage.id,
    classificationId: classificationRow.id,
    sideEffects,
    replyDraftMessageId,
  };
}

export async function listRecentReplies(
  context: RepliesContext,
  filters: RecentReplyFilters = {},
): Promise<RecentReplyRow[]> {
  let query = context.supabase
    .from("messages")
    .select("*")
    .eq("user_id", context.userId)
    .eq("kind", "reply")
    .eq("status", "replied")
    .order("sent_at", { ascending: false })
    .limit(100);

  if (filters.since) {
    query = query.gte("sent_at", filters.since);
  }

  if (filters.until) {
    query = query.lte("sent_at", filters.until);
  }

  const { data: messages, error } = await query;

  if (error) {
    throw new RepliesServiceError(error.message);
  }

  const rows: RecentReplyRow[] = [];

  for (const message of messages ?? []) {
    if (filters.hideHandled && isReplyHandled(message)) {
      continue;
    }

    const [classification, campaign] = await Promise.all([
      loadClassificationForMessage(context, message.id),
      loadCampaign(context, message.campaign_id),
    ]);

    if (
      filters.categories?.length &&
      (!classification ||
        !filters.categories.includes(classification.category as ReplyCategory))
    ) {
      continue;
    }

    const brand = await loadBrand(context, campaign.brand_id);

    rows.push({
      message,
      classification,
      campaign,
      brand,
    });
  }

  return rows;
}

export async function markReplyHandled(
  context: RepliesContext,
  messageId: string,
): Promise<Tables<"messages">> {
  const { data: message, error: loadError } = await context.supabase
    .from("messages")
    .select("*")
    .eq("id", messageId)
    .eq("user_id", context.userId)
    .eq("kind", "reply")
    .single();

  if (loadError || !message) {
    throw new RepliesServiceError(loadError?.message ?? "Reply not found.");
  }

  const { data, error } = await context.supabase
    .from("messages")
    .update({
      edit_diff: {
        ...readJsonRecord(message.edit_diff),
        handled_at: new Date().toISOString(),
      } as Json,
    })
    .eq("id", message.id)
    .eq("user_id", context.userId)
    .select("*")
    .single();

  if (error || !data) {
    throw new RepliesServiceError(error?.message ?? "Could not mark handled.");
  }

  return data;
}

export async function pauseInboxPolling(
  context: RepliesContext,
  paused: boolean,
): Promise<Tables<"users">> {
  const { data, error } = await context.supabase
    .from("users")
    .update({ inbox_poll_paused: paused })
    .eq("user_id", context.userId)
    .select("*")
    .single();

  if (error || !data) {
    throw new RepliesServiceError(
      error?.message ?? "Could not update inbox polling.",
    );
  }

  return data;
}

export async function setInboxLastPolledAt(
  context: RepliesContext,
  value: Date,
): Promise<void> {
  const { error } = await context.supabase
    .from("users")
    .update({ inbox_last_polled_at: value.toISOString() })
    .eq("user_id", context.userId);

  if (error) {
    throw new RepliesServiceError(error.message);
  }
}

export async function applyReplySideEffects(
  context: RepliesContext,
  input: {
    campaign: Tables<"campaigns">;
    brand: Tables<"brands">;
    contacts: Tables<"brand_contacts">[];
    reply: NewReply;
    classification: ReplyClassificationJson;
  },
): Promise<string[]> {
  const sideEffects: string[] = [];
  const { campaign, classification } = input;

  await context.supabase
    .from("campaigns")
    .update({
      replied_at: input.reply.received_at.toISOString(),
    })
    .eq("id", campaign.id)
    .eq("user_id", context.userId);

  if (classification.category === "unsubscribe") {
    await handleUnsubscribe(context, input);
    sideEffects.push("unsubscribe_suppressed_brand");
    return sideEffects;
  }

  switch (classification.suggested_action) {
    case "move_to_negotiating":
    case "draft_reply":
      await updateCampaign(context, campaign.id, {
        status: "negotiating",
        replied_at: input.reply.received_at.toISOString(),
      });
      await cancelFollowUps(context, campaign.id, "reply_received");
      sideEffects.push("campaign_negotiating");
      break;
    case "mark_lost":
      await updateCampaign(context, campaign.id, {
        status: "lost",
        outcome: "lost",
        closed_at: input.reply.received_at.toISOString(),
      });
      await cancelFollowUps(context, campaign.id, "lost");
      sideEffects.push("campaign_lost");
      break;
    case "pause_campaign": {
      const status =
        classification.category === "decline_polite" ||
        classification.category === "decline_firm"
          ? "lost"
          : "ghosted";
      await updateCampaign(context, campaign.id, {
        status,
        outcome: status === "lost" ? "lost" : "ghost",
        closed_at: status === "lost" ? input.reply.received_at.toISOString() : null,
      });
      await cancelFollowUps(context, campaign.id, classification.category);
      sideEffects.push(`campaign_${status}`);
      break;
    }
    case "no_action":
      sideEffects.push("no_action");
      break;
  }

  return sideEffects;
}

async function handleUnsubscribe(
  context: RepliesContext,
  input: {
    campaign: Tables<"campaigns">;
    brand: Tables<"brands">;
    contacts: Tables<"brand_contacts">[];
    reply: NewReply;
  },
) {
  const now = input.reply.received_at.toISOString();
  const contact = input.contacts.find(
    (item) => item.email.toLowerCase() === input.reply.from_email.toLowerCase(),
  );

  if (contact) {
    const { error } = await context.supabase
      .from("brand_contacts")
      .update({
        unsubscribe_received_at: now,
        marked_unreachable: true,
      })
      .eq("id", contact.id)
      .eq("user_id", context.userId);

    if (error) {
      throw new RepliesServiceError(error.message);
    }
  }

  await updateCampaign(context, input.campaign.id, {
    status: "lost",
    outcome: "lost",
    closed_at: now,
  });
  const { error: brandError } = await context.supabase
    .from("brands")
    .update({
      excluded: true,
      exclusion_reason: "Unsubscribe request received.",
    })
    .eq("id", input.brand.id)
    .eq("user_id", context.userId);

  if (brandError) {
    throw new RepliesServiceError(brandError.message);
  }

  await cancelFollowUps(context, input.campaign.id, "unsubscribe");
  await upsertBrandSuppressions(context, {
    creatorProfileId: input.campaign.creator_profile_id,
    brandId: input.brand.id,
    reason: "manual",
    days: 365 * 5,
  });
}

async function insertInboundReplyMessage(
  context: RepliesContext,
  input: { campaignId: string; reply: NewReply },
) {
  const version = await nextMessageVersion(context, input.campaignId);
  const { data, error } = await context.supabase
    .from("messages")
    .insert({
      user_id: context.userId,
      campaign_id: input.campaignId,
      version,
      kind: "reply",
      subject: input.reply.subject || "(no subject)",
      body_text: input.reply.body_text,
      body_html: input.reply.body_html,
      status: "replied",
      sent_at: input.reply.received_at.toISOString(),
      gmail_message_id: input.reply.gmail_message_id,
      gmail_thread_id: input.reply.gmail_thread_id,
    })
    .select("*")
    .single();

  if (error || !data) {
    throw new RepliesServiceError(error?.message ?? "Could not insert reply.");
  }

  return data;
}

async function insertReplyDraftMessage(
  context: RepliesContext,
  input: {
    campaign: Tables<"campaigns">;
    reply: NewReply;
    originalSubject: string;
    draft: { body_text: string; model_used: string; prompt_hash: string };
  },
) {
  const version = await nextMessageVersion(context, input.campaign.id);
  const subject = toReplySubject(input.originalSubject || input.reply.subject);
  const { data, error } = await context.supabase
    .from("messages")
    .insert({
      user_id: context.userId,
      campaign_id: input.campaign.id,
      version,
      kind: "reply",
      subject,
      body_text: input.draft.body_text,
      body_html: null,
      status: "pending_approval",
      gmail_thread_id: input.reply.gmail_thread_id,
      model_used: input.draft.model_used,
      prompt_hash: input.draft.prompt_hash,
    })
    .select("*")
    .single();

  if (error || !data) {
    throw new RepliesServiceError(
      error?.message ?? "Could not create reply draft.",
    );
  }

  return data;
}

async function insertReplyClassification(
  context: RepliesContext,
  input: { messageId: string; classification: ReplyClassificationJson },
) {
  const parsed = replyClassificationJsonSchema.parse(input.classification);
  const { data, error } = await context.supabase
    .from("reply_classifications")
    .insert({
      user_id: context.userId,
      message_id: input.messageId,
      category: parsed.category,
      confidence: parsed.confidence,
      summary: parsed.summary,
      suggested_action: parsed.suggested_action,
    })
    .select("*")
    .single();

  if (error || !data) {
    throw new RepliesServiceError(
      error?.message ?? "Could not save reply classification.",
    );
  }

  return data;
}

async function loadEmailThread(context: RepliesContext, gmailThreadId: string) {
  const { data, error } = await context.supabase
    .from("email_threads")
    .select("*")
    .eq("user_id", context.userId)
    .eq("gmail_thread_id", gmailThreadId)
    .maybeSingle();

  if (error) {
    throw new RepliesServiceError(error.message);
  }

  return data;
}

async function updateEmailThread(
  context: RepliesContext,
  thread: Tables<"email_threads">,
  reply: NewReply,
) {
  const { error } = await context.supabase
    .from("email_threads")
    .update({
      last_message_at: reply.received_at.toISOString(),
      participant_emails: unionText(thread.participant_emails, [
        reply.from_email,
      ]),
    })
    .eq("id", thread.id)
    .eq("user_id", context.userId);

  if (error) {
    throw new RepliesServiceError(error.message);
  }
}

async function loadMessageByGmailId(context: RepliesContext, gmailMessageId: string) {
  const { data, error } = await context.supabase
    .from("messages")
    .select("*")
    .eq("user_id", context.userId)
    .eq("gmail_message_id", gmailMessageId)
    .maybeSingle();

  if (error) {
    throw new RepliesServiceError(error.message);
  }

  return data;
}

async function loadCampaign(context: RepliesContext, campaignId: string) {
  const { data, error } = await context.supabase
    .from("campaigns")
    .select("*")
    .eq("user_id", context.userId)
    .eq("id", campaignId)
    .single();

  if (error || !data) {
    throw new RepliesServiceError(error?.message ?? "Campaign not found.");
  }

  return data;
}

async function loadCreatorProfile(context: RepliesContext, profileId: string) {
  const { data, error } = await context.supabase
    .from("creator_profiles")
    .select("*")
    .eq("user_id", context.userId)
    .eq("id", profileId)
    .single();

  if (error || !data) {
    throw new RepliesServiceError(
      error?.message ?? "Creator profile not found.",
    );
  }

  return data;
}

async function loadBrand(context: RepliesContext, brandId: string) {
  const { data, error } = await context.supabase
    .from("brands")
    .select("*")
    .eq("user_id", context.userId)
    .eq("id", brandId)
    .single();

  if (error || !data) {
    throw new RepliesServiceError(error?.message ?? "Brand not found.");
  }

  return data;
}

async function loadContacts(context: RepliesContext, brandId: string) {
  const { data, error } = await context.supabase
    .from("brand_contacts")
    .select("*")
    .eq("user_id", context.userId)
    .eq("brand_id", brandId);

  if (error) {
    throw new RepliesServiceError(error.message);
  }

  return data ?? [];
}

async function loadSignals(context: RepliesContext, brandId: string) {
  const { data, error } = await context.supabase
    .from("source_signals")
    .select("signal_type,evidence_json")
    .eq("user_id", context.userId)
    .eq("brand_id", brandId);

  if (error) {
    throw new RepliesServiceError(error.message);
  }

  return data ?? [];
}

async function loadUser(context: RepliesContext) {
  const { data, error } = await context.supabase
    .from("users")
    .select("*")
    .eq("user_id", context.userId)
    .single();

  if (error || !data) {
    throw new RepliesServiceError(error?.message ?? "User settings not found.");
  }

  return data;
}

async function loadLatestOutboundMessage(
  context: RepliesContext,
  campaignId: string,
) {
  const { data, error } = await context.supabase
    .from("messages")
    .select("*")
    .eq("user_id", context.userId)
    .eq("campaign_id", campaignId)
    .neq("status", "replied")
    .not("sent_at", "is", null)
    .order("sent_at", { ascending: false })
    .limit(1);

  if (error) {
    throw new RepliesServiceError(error.message);
  }

  return data?.[0] ?? null;
}

async function loadActiveVoiceGuide(context: RepliesContext, profileId: string) {
  const { data, error } = await context.supabase
    .from("voice_style_guides")
    .select("style_doc_json")
    .eq("user_id", context.userId)
    .eq("creator_profile_id", profileId)
    .eq("is_active", true)
    .order("version", { ascending: false })
    .limit(1)
    .single();

  if (error || !data) {
    throw new RepliesServiceError(
      error?.message ?? "Active voice guide not found.",
    );
  }

  return voiceStyleGuideJsonSchema.parse(data.style_doc_json);
}

async function loadActiveMediaKit(context: RepliesContext, profileId: string) {
  const { data, error } = await context.supabase
    .from("media_kits")
    .select("*")
    .eq("user_id", context.userId)
    .eq("creator_profile_id", profileId)
    .eq("is_active", true)
    .order("version", { ascending: false })
    .limit(1)
    .single();

  if (error || !data) {
    throw new RepliesServiceError(
      error?.message ?? "Active media kit not found.",
    );
  }

  return data;
}

async function loadThreadHistory(
  context: RepliesContext,
  campaignId: string,
): Promise<ThreadMessage[]> {
  const { data, error } = await context.supabase
    .from("messages")
    .select("subject,body_text,sent_at,status")
    .eq("user_id", context.userId)
    .eq("campaign_id", campaignId)
    .order("created_at", { ascending: true });

  if (error) {
    throw new RepliesServiceError(error.message);
  }

  return (data ?? []).map((message) => ({
    direction: message.status === "replied" ? "inbound" : "outbound",
    subject: message.subject,
    body_text: message.body_text,
    sent_at: message.sent_at,
  }));
}

async function loadClassificationForMessage(
  context: RepliesContext,
  messageId: string,
) {
  const { data, error } = await context.supabase
    .from("reply_classifications")
    .select("*")
    .eq("user_id", context.userId)
    .eq("message_id", messageId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new RepliesServiceError(error.message);
  }

  return data;
}

async function nextMessageVersion(context: RepliesContext, campaignId: string) {
  const { data, error } = await context.supabase
    .from("messages")
    .select("version")
    .eq("user_id", context.userId)
    .eq("campaign_id", campaignId)
    .order("version", { ascending: false })
    .limit(1);

  if (error) {
    throw new RepliesServiceError(error.message);
  }

  return (data?.[0]?.version ?? 0) + 1;
}

async function updateCampaign(
  context: RepliesContext,
  campaignId: string,
  values: Partial<Tables<"campaigns">>,
) {
  const { error } = await context.supabase
    .from("campaigns")
    .update(values)
    .eq("id", campaignId)
    .eq("user_id", context.userId);

  if (error) {
    throw new RepliesServiceError(error.message);
  }
}

async function cancelFollowUps(
  context: RepliesContext,
  campaignId: string,
  reason: string,
) {
  const { error } = await context.supabase
    .from("follow_up_sequences")
    .update({
      cancelled: true,
      cancelled_reason: reason,
    })
    .eq("user_id", context.userId)
    .eq("campaign_id", campaignId);

  if (error) {
    throw new RepliesServiceError(error.message);
  }
}

async function upsertBrandSuppressions(
  context: RepliesContext,
  input: {
    creatorProfileId: string;
    brandId: string;
    reason: Tables<"draft_suppressions">["reason"];
    days: number;
  },
) {
  const suppressedUntil = new Date(
    Date.now() + input.days * 24 * 60 * 60 * 1000,
  ).toISOString();
  const rows = DEAL_TYPES.map((dealType) => ({
    user_id: context.userId,
    creator_profile_id: input.creatorProfileId,
    brand_id: input.brandId,
    deal_type: dealType,
    suppressed_until: suppressedUntil,
    reason: input.reason,
  }));
  const { error } = await context.supabase.from("draft_suppressions").upsert(
    rows,
    {
      onConflict: "creator_profile_id,brand_id,deal_type",
    },
  );

  if (error) {
    throw new RepliesServiceError(error.message);
  }
}

async function updateHookReplyCounts(
  context: RepliesContext,
  campaign: Tables<"campaigns">,
  category: ReplyCategory,
) {
  if (!campaign.hook_chosen) {
    return;
  }

  const { data } = await context.supabase
    .from("hook_library")
    .select("*")
    .eq("user_id", context.userId)
    .eq("creator_profile_id", campaign.creator_profile_id)
    .eq("hook_pattern", campaign.hook_chosen)
    .limit(1);
  const row = data?.[0];

  if (!row) {
    return;
  }

  const isPositive =
    category === "interested" ||
    category === "asks_rate" ||
    category === "asks_more_info";

  await context.supabase
    .from("hook_library")
    .update({
      reply_count: row.reply_count + 1,
      positive_reply_count: row.positive_reply_count + (isPositive ? 1 : 0),
    })
    .eq("id", row.id)
    .eq("user_id", context.userId);
}

function toCreatorSummary(profile: Tables<"creator_profiles">): CreatorProfileSummary {
  return {
    handle: profile.handle,
    display_name: profile.display_name,
    niche_tags: profile.niche_tags,
    aesthetic_keywords: profile.aesthetic_keywords,
    bio_extract: profile.bio_extract,
    recent_post_themes: profile.recent_post_themes,
    tier: profile.tier,
  };
}

function toScoringBrand(
  brand: Tables<"brands">,
  contacts: Tables<"brand_contacts">[],
  signals: { signal_type: string; evidence_json: Json }[],
): ScoringBrand {
  return {
    ...brand,
    contacts_count: contacts.length,
    contact_roles: [
      ...new Set(
        contacts
          .map((contact) => contact.role)
          .filter((role): role is string => Boolean(role)),
      ),
    ],
    has_hunter_contacts: contacts.some((contact) => contact.source === "hunter"),
    has_page_scrape_contacts: contacts.some(
      (contact) => contact.source === "page_scrape",
    ),
    source_signal_kinds: [...new Set(signals.map((signal) => signal.signal_type))],
    source_signal_evidence_text: signals
      .map((signal) => jsonToSearchText(signal.evidence_json))
      .join(" ")
      .toLowerCase(),
    paid_partnership_signal_count: signals.reduce(
      (sum, signal) => sum + readPaidPartnershipCount(signal.evidence_json),
      0,
    ),
    has_past_brand_work: false,
  };
}

function readPaidPartnershipCount(value: Json) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return 0;
  }

  const count = value.paid_partnership_count;
  return typeof count === "number" ? count : 0;
}

function jsonToSearchText(value: Json) {
  try {
    return JSON.stringify(value ?? "");
  } catch {
    return "";
  }
}

function readJsonRecord(value: Json | null) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
}

function isReplyHandled(message: Tables<"messages">) {
  const record = readJsonRecord(message.edit_diff);
  return typeof record.handled_at === "string";
}

function toReplySubject(subject: string) {
  return subject.toLowerCase().startsWith("re:") ? subject : `Re: ${subject}`;
}

function unionText(base: string[], additions: string[]) {
  const byLowercase = new Map<string, string>();

  for (const item of [...base, ...additions]) {
    const trimmed = item.trim();

    if (trimmed) {
      byLowercase.set(trimmed.toLowerCase(), trimmed);
    }
  }

  return [...byLowercase.values()].sort((left, right) =>
    left.localeCompare(right),
  );
}

export function createNewReplyFixture(
  input: Partial<NewReply> = {},
): NewReply {
  return {
    gmail_message_id: "reply-message-id",
    gmail_thread_id: "gmail-thread-id",
    from_email: "press@brand.test",
    from_name: "Press Team",
    subject: "Re: Athena x Brand",
    snippet: "Could you send your rates?",
    body_text: "Could you send your rate sheet?",
    body_html: null,
    received_at: new Date(),
    in_reply_to: null,
    ...input,
  };
}

export function createReplyClassificationFixture(
  input: Partial<ReplyClassificationJson> = {},
): ReplyClassificationJson {
  return replyClassificationJsonSchema.parse({
    category: "asks_rate",
    confidence: 95,
    summary: "They asked for Athena's rate sheet.",
    suggested_action: "draft_reply",
    detected_signals: ["asked for rate sheet"],
    ...input,
  });
}
