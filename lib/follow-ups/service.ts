import type { SupabaseClient } from "@supabase/supabase-js";

import { followUpDraftJsonSchema, type FollowUpDraftJson } from "../db/follow-up.ts";
import { mediaKitJsonSchema } from "../db/media-kit.ts";
import {
  researchBriefJsonSchema,
  type ResearchBriefJson,
} from "../db/research-brief.ts";
import { voiceStyleGuideJsonSchema } from "../db/style-guide.ts";
import type { Database, Json, Tables } from "../db/types";
import {
  generateFollowUpDraft,
  type FollowUpDraftInput,
} from "../llm/follow-up.ts";
import type { CreatorProfileSummary } from "../llm/voice-guide";
import type { ScoringBrand } from "../scoring/rules.ts";
import type { RepliesContext } from "../replies/service.ts";

export type FollowUpResult =
  | {
      status: "created";
      message: Tables<"messages">;
      follow_up_kind: "follow_up_1" | "follow_up_2";
    }
  | {
      status: "skipped";
      reason:
        | "reply_received"
        | "disabled"
        | "not_due"
        | "pending_follow_up_exists"
        | "missing_initial_message";
    }
  | {
      status: "ghosted";
      campaign: Tables<"campaigns">;
    };

export type RunFollowUpScanResult = {
  campaignsScanned: number;
  followUpsCreated: number;
  campaignsGhosted: number;
  skipped: number;
  errors: { campaignId: string; message: string }[];
};

export class FollowUpServiceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FollowUpServiceError";
  }
}

export async function generateFollowUpsForCampaign(
  context: RepliesContext,
  campaignId: string,
  generator: typeof generateFollowUpDraft = generateFollowUpDraft,
): Promise<FollowUpResult> {
  const campaign = await loadCampaign(context, campaignId);
  const rules = await loadRulesForProfile(context, campaign.creator_profile_id);

  if (!rules.follow_up_enabled || rules.follow_up_max_count === 0) {
    return { status: "skipped", reason: "disabled" };
  }

  if (await campaignHasReply(context, campaign.id)) {
    await cancelSequence(context, campaign.id, "reply_received");
    return { status: "skipped", reason: "reply_received" };
  }

  const initial = await loadInitialSentMessage(context, campaign.id);

  if (!initial?.sent_at) {
    return { status: "skipped", reason: "missing_initial_message" };
  }

  const followUps = await loadFollowUpMessages(context, campaign.id);

  if (followUps.some((message) => message.status === "pending_approval")) {
    return { status: "skipped", reason: "pending_follow_up_exists" };
  }

  const followUp2Sent = followUps.find(
    (message) => message.kind === "follow_up_2" && message.status === "sent",
  );

  if (followUp2Sent || followUps.length >= rules.follow_up_max_count) {
    const updated = await markCampaignGhosted(context, campaign.id);
    await cancelSequence(context, campaign.id, "max_follow_ups_sent");
    return { status: "ghosted", campaign: updated };
  }

  const daysSinceInitial = daysBetween(new Date(initial.sent_at), new Date());
  const followUp1 = followUps.find((message) => message.kind === "follow_up_1");
  const nextKind =
    !followUp1 && daysSinceInitial >= rules.follow_up_1_days_after
      ? "follow_up_1"
      : followUp1?.status === "sent" &&
          rules.follow_up_max_count >= 2 &&
          daysSinceInitial >= rules.follow_up_2_days_after_initial
        ? "follow_up_2"
        : null;

  if (!nextKind) {
    return { status: "skipped", reason: "not_due" };
  }

  const loaded = await loadFollowUpContext(context, campaign);
  const priorFollowUpText =
    followUps.find((message) => message.kind === "follow_up_1")?.body_text ?? null;
  const draft = await generator({
    creatorProfile: loaded.creatorSummary,
    voiceStyleGuide: loaded.voiceStyleGuide,
    mediaKit: loaded.mediaKit,
    campaign,
    brand: loaded.brand,
    researchBrief: loaded.researchBrief,
    originalMessage: {
      subject: initial.subject,
      body_text: initial.body_text,
    },
    followUpNumber: nextKind === "follow_up_1" ? 1 : 2,
    priorFollowUpTextIfAny: priorFollowUpText,
    senderDisplayName: loaded.user.sender_display_name ?? loaded.user.name ?? "Athena Huo",
    physicalAddress: loaded.user.physical_address ?? "",
  });
  const message = await insertFollowUpMessage(context, {
    campaign,
    initial,
    kind: nextKind,
    draft,
  });
  await upsertSequence(context, campaign.id, nextKind, draft);

  return {
    status: "created",
    message,
    follow_up_kind: nextKind,
  };
}

export async function runFollowUpScan(
  context: RepliesContext,
  generator: typeof generateFollowUpDraft = generateFollowUpDraft,
): Promise<RunFollowUpScanResult> {
  const { data: campaigns, error } = await context.supabase
    .from("campaigns")
    .select("*")
    .eq("user_id", context.userId)
    .eq("status", "sent")
    .order("sent_at", { ascending: true });

  if (error) {
    throw new FollowUpServiceError(error.message);
  }

  const result: RunFollowUpScanResult = {
    campaignsScanned: campaigns?.length ?? 0,
    followUpsCreated: 0,
    campaignsGhosted: 0,
    skipped: 0,
    errors: [],
  };

  for (const campaign of campaigns ?? []) {
    try {
      const followUp = await generateFollowUpsForCampaign(
        context,
        campaign.id,
        generator,
      );

      if (followUp.status === "created") {
        result.followUpsCreated += 1;
      } else if (followUp.status === "ghosted") {
        result.campaignsGhosted += 1;
      } else {
        result.skipped += 1;
      }
    } catch (error) {
      result.errors.push({
        campaignId: campaign.id,
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  return result;
}

async function loadCampaign(context: RepliesContext, campaignId: string) {
  const { data, error } = await context.supabase
    .from("campaigns")
    .select("*")
    .eq("user_id", context.userId)
    .eq("id", campaignId)
    .single();

  if (error || !data) {
    throw new FollowUpServiceError(error?.message ?? "Campaign not found.");
  }

  return data;
}

async function loadRulesForProfile(context: RepliesContext, profileId: string) {
  const { data, error } = await context.supabase
    .from("outreach_rules")
    .select("*")
    .eq("user_id", context.userId)
    .or(`creator_profile_id.eq.${profileId},creator_profile_id.is.null`);

  if (error) {
    throw new FollowUpServiceError(error.message);
  }

  const rows = data ?? [];
  const profileRule = rows.find((rule) => rule.creator_profile_id === profileId);
  const globalRule = rows.find((rule) => rule.creator_profile_id === null);

  return profileRule ?? globalRule ?? fail("Outreach rules are missing.");
}

async function campaignHasReply(context: RepliesContext, campaignId: string) {
  const { count, error } = await context.supabase
    .from("messages")
    .select("id", { count: "exact", head: true })
    .eq("user_id", context.userId)
    .eq("campaign_id", campaignId)
    .eq("kind", "reply")
    .eq("status", "replied");

  if (error) {
    throw new FollowUpServiceError(error.message);
  }

  return (count ?? 0) > 0;
}

async function loadInitialSentMessage(context: RepliesContext, campaignId: string) {
  const { data, error } = await context.supabase
    .from("messages")
    .select("*")
    .eq("user_id", context.userId)
    .eq("campaign_id", campaignId)
    .eq("kind", "initial")
    .eq("status", "sent")
    .order("sent_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new FollowUpServiceError(error.message);
  }

  return data;
}

async function loadFollowUpMessages(context: RepliesContext, campaignId: string) {
  const { data, error } = await context.supabase
    .from("messages")
    .select("*")
    .eq("user_id", context.userId)
    .eq("campaign_id", campaignId)
    .in("kind", ["follow_up_1", "follow_up_2"])
    .order("version", { ascending: true });

  if (error) {
    throw new FollowUpServiceError(error.message);
  }

  return data ?? [];
}

async function loadFollowUpContext(
  context: RepliesContext,
  campaign: Tables<"campaigns">,
) {
  const [profile, user, voiceRow, mediaRow, brand, contacts, signals] =
    await Promise.all([
      loadCreatorProfile(context, campaign.creator_profile_id),
      loadUser(context),
      context.supabase
        .from("voice_style_guides")
        .select("style_doc_json")
        .eq("user_id", context.userId)
        .eq("creator_profile_id", campaign.creator_profile_id)
        .eq("is_active", true)
        .order("version", { ascending: false })
        .limit(1)
        .single(),
      context.supabase
        .from("media_kits")
        .select("*")
        .eq("user_id", context.userId)
        .eq("creator_profile_id", campaign.creator_profile_id)
        .eq("is_active", true)
        .order("version", { ascending: false })
        .limit(1)
        .single(),
      loadBrand(context, campaign.brand_id),
      loadContacts(context, campaign.brand_id),
      loadSignals(context, campaign.brand_id),
    ]);

  if (voiceRow.error || !voiceRow.data) {
    throw new FollowUpServiceError(
      voiceRow.error?.message ?? "Active voice guide not found.",
    );
  }

  if (mediaRow.error || !mediaRow.data) {
    throw new FollowUpServiceError(
      mediaRow.error?.message ?? "Active media kit not found.",
    );
  }

  return {
    creatorSummary: toCreatorSummary(profile),
    user,
    voiceStyleGuide: voiceStyleGuideJsonSchema.parse(voiceRow.data.style_doc_json),
    mediaKit: mediaKitJsonSchema.parse(mediaRow.data.data_json),
    researchBrief: readResearchBrief(campaign.research_brief_json),
    brand: toScoringBrand(brand, contacts, signals),
  };
}

async function loadCreatorProfile(context: RepliesContext, profileId: string) {
  const { data, error } = await context.supabase
    .from("creator_profiles")
    .select("*")
    .eq("user_id", context.userId)
    .eq("id", profileId)
    .single();

  if (error || !data) {
    throw new FollowUpServiceError(
      error?.message ?? "Creator profile not found.",
    );
  }

  return data;
}

async function loadUser(context: RepliesContext) {
  const { data, error } = await context.supabase
    .from("users")
    .select("*")
    .eq("user_id", context.userId)
    .single();

  if (error || !data) {
    throw new FollowUpServiceError(error?.message ?? "User not found.");
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
    throw new FollowUpServiceError(error?.message ?? "Brand not found.");
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
    throw new FollowUpServiceError(error.message);
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
    throw new FollowUpServiceError(error.message);
  }

  return data ?? [];
}

async function insertFollowUpMessage(
  context: RepliesContext,
  input: {
    campaign: Tables<"campaigns">;
    initial: Tables<"messages">;
    kind: "follow_up_1" | "follow_up_2";
    draft: FollowUpDraftJson;
  },
) {
  const version = await nextMessageVersion(context, input.campaign.id);
  const { data, error } = await context.supabase
    .from("messages")
    .insert({
      user_id: context.userId,
      campaign_id: input.campaign.id,
      version,
      kind: input.kind,
      subject: toReplySubject(input.initial.subject),
      body_text: input.draft.body_text,
      body_html: null,
      status: "pending_approval",
      gmail_thread_id: input.initial.gmail_thread_id,
      model_used: input.draft.model_used,
      prompt_hash: input.draft.prompt_hash,
    })
    .select("*")
    .single();

  if (error || !data) {
    throw new FollowUpServiceError(
      error?.message ?? "Could not create follow-up.",
    );
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
    throw new FollowUpServiceError(error.message);
  }

  return (data?.[0]?.version ?? 0) + 1;
}

async function upsertSequence(
  context: RepliesContext,
  campaignId: string,
  kind: "follow_up_1" | "follow_up_2",
  draft: FollowUpDraftJson,
) {
  const { data: existing, error: loadError } = await context.supabase
    .from("follow_up_sequences")
    .select("*")
    .eq("user_id", context.userId)
    .eq("campaign_id", campaignId)
    .maybeSingle();

  if (loadError) {
    throw new FollowUpServiceError(loadError.message);
  }

  const steps = readSteps(existing?.steps_json);
  const nextSteps = [
    ...steps.filter((step) => step.kind !== kind),
    {
      kind,
      draft_status: "pending_approval",
      angle: draft.angle_used,
      created_at: new Date().toISOString(),
    },
  ];
  const payload = {
    user_id: context.userId,
    campaign_id: campaignId,
    cancelled: false,
    cancelled_reason: null,
    steps_json: nextSteps as unknown as Json,
  };
  const { error } = await context.supabase.from("follow_up_sequences").upsert(
    payload,
    {
      onConflict: "campaign_id",
    },
  );

  if (error) {
    throw new FollowUpServiceError(error.message);
  }
}

async function cancelSequence(
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
    throw new FollowUpServiceError(error.message);
  }
}

async function markCampaignGhosted(context: RepliesContext, campaignId: string) {
  const { data, error } = await context.supabase
    .from("campaigns")
    .update({
      status: "ghosted",
      outcome: "ghost",
      closed_at: new Date().toISOString(),
    })
    .eq("user_id", context.userId)
    .eq("id", campaignId)
    .select("*")
    .single();

  if (error || !data) {
    throw new FollowUpServiceError(
      error?.message ?? "Could not mark campaign ghosted.",
    );
  }

  return data;
}

function readResearchBrief(value: Json | null): ResearchBriefJson {
  return researchBriefJsonSchema.parse(value ?? {});
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

function readSteps(value: Json | undefined) {
  return Array.isArray(value)
    ? value.filter(
        (step): step is { kind: string; draft_status: string; angle: string } =>
          Boolean(step) && typeof step === "object" && !Array.isArray(step),
      )
    : [];
}

function toReplySubject(subject: string) {
  return subject.toLowerCase().startsWith("re:") ? subject : `Re: ${subject}`;
}

function daysBetween(start: Date, end: Date) {
  return Math.floor((end.getTime() - start.getTime()) / 86_400_000);
}

function fail(message: string): never {
  throw new FollowUpServiceError(message);
}

export function createFollowUpDraftFixture(
  input: Partial<FollowUpDraftJson> = {},
): FollowUpDraftJson {
  return followUpDraftJsonSchema.parse({
    body_text:
      "Hi again,\n\nI had one more content idea that could be a fit.\n\nBest,\nAthena",
    angle_used: "new content concept",
    model_used: "test-model",
    prompt_hash: "test-hash",
    ...input,
  });
}
