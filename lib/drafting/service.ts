import type { SupabaseClient } from "@supabase/supabase-js";

import {
  draftJsonSchema,
  type DraftJson,
} from "../db/draft.ts";
import {
  mediaKitJsonSchema,
  type MediaKitJson,
  type PastBrandWorkInput,
} from "../db/media-kit.ts";
import {
  researchBriefJsonSchema,
  type ResearchBriefJson,
} from "../db/research-brief.ts";
import {
  voiceStyleGuideJsonSchema,
  type VoiceStyleGuideJson,
} from "../db/style-guide.ts";
import type { Database, Json, Tables, TablesInsert } from "../db/types";
import {
  generateDraft,
  type DraftInput,
} from "../llm/draft.ts";
import {
  generateResearchBrief,
  type BrandFitScoreSummary,
  type ResearchBriefInput,
} from "../llm/research-brief.ts";
import type { CreatorProfileSummary } from "../llm/voice-guide";
import {
  DEAL_TYPES,
  type DealType,
  type ScoringBrand,
} from "../scoring/rules.ts";
import type { ScoreRationaleJson } from "../scoring/service.ts";

export const DEFAULT_SKIP_SUPPRESSION_DAYS = 30;
export const EXCLUDED_BRAND_SUPPRESSION_DAYS = 365 * 5;

const nonTerminalCampaignStatuses = [
  "queued",
  "researching",
  "drafted",
  "approved",
  "sent",
  "bounced",
  "opened",
  "replied",
  "negotiating",
] as const;

const preferredContactRoles = ["pr", "partnerships", "marketing"] as const;

export type DraftingContext = {
  supabase: SupabaseClient<Database>;
  userId: string;
};

export type DraftGenerators = {
  brief?: typeof generateResearchBrief;
  draft?: typeof generateDraft;
};

export type PendingApprovalFilters = {
  creatorProfileId?: string | null;
  dealTypes?: DealType[];
  minScore?: number;
  sort?: "score_desc" | "drafted_desc";
  page?: number;
};

export type PendingApprovalRow = {
  message: Tables<"messages">;
  subject_variants: string[];
  campaign: Tables<"campaigns">;
  creator_profile: Tables<"creator_profiles">;
  brand: Tables<"brands">;
  brief: ResearchBriefJson;
  score_rationale: ScoreRationaleJson | null;
};

export type PendingApprovalListResult = {
  rows: PendingApprovalRow[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

type LoadedPitchContext = {
  user: Tables<"users">;
  creatorProfile: Tables<"creator_profiles">;
  creatorSummary: CreatorProfileSummary;
  voiceStyleGuide: VoiceStyleGuideJson;
  mediaKit: MediaKitJson;
  mediaKitRow: Tables<"media_kits">;
  brand: Tables<"brands">;
  scoringBrand: ScoringBrand;
  fitScoreRow: Tables<"brand_fit_scores">;
  fitScore: BrandFitScoreSummary;
  contacts: Tables<"brand_contacts">[];
  pastBrandWork: PastBrandWorkInput[];
};

export class DraftingServiceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DraftingServiceError";
  }
}

export class DuplicateDraftError extends DraftingServiceError {
  constructor() {
    super("A live campaign already exists for this brand, profile, and deal type.");
    this.name = "DuplicateDraftError";
  }
}

export class SuppressedDraftError extends DraftingServiceError {
  constructor(suppressedUntil: string) {
    super(`This pitch is suppressed until ${suppressedUntil}.`);
    this.name = "SuppressedDraftError";
  }
}

export async function generateAndPersistPitch(
  context: DraftingContext,
  input: {
    creatorProfileId: string;
    brandId: string;
    dealType: DealType;
    angleHint?: string;
  },
  generators: DraftGenerators = {},
): Promise<{
  campaign: Tables<"campaigns">;
  message: Tables<"messages">;
  brief: ResearchBriefJson;
  draft: DraftJson;
}> {
  await assertNoLiveCampaign(context, input);
  await assertNotSuppressed(context, input);

  const loaded = await loadPitchContext(context, input);
  const briefInput: ResearchBriefInput = {
    creatorProfile: loaded.creatorSummary,
    voiceStyleGuide: loaded.voiceStyleGuide,
    mediaKit: loaded.mediaKit,
    brand: loaded.scoringBrand,
    fitScore: loaded.fitScore,
    dealType: input.dealType,
    pastBrandWork: loaded.pastBrandWork,
  };
  const brief = await (generators.brief ?? generateResearchBrief)(briefInput);
  const targetContact = chooseTargetContact(loaded.contacts);
  const briefWithContactRisk =
    targetContact || brief.risk_flags.includes("no contacts found")
      ? brief
      : {
          ...brief,
          risk_flags: [...brief.risk_flags, "no contacts found"].slice(0, 3),
        };
  const draftInput: DraftInput = {
    creatorProfile: loaded.creatorSummary,
    voiceStyleGuide: loaded.voiceStyleGuide,
    mediaKit: loaded.mediaKit,
    brand: loaded.scoringBrand,
    researchBrief: briefWithContactRisk,
    dealType: input.dealType,
    senderDisplayName:
      loaded.user.sender_display_name ?? loaded.user.name ?? "Athena Huo",
    senderEmail: loaded.user.email,
    physicalAddress: loaded.user.physical_address ?? "",
    targetContact,
    angleHint: input.angleHint,
  };
  const draft = await (generators.draft ?? generateDraft)(draftInput);
  const campaign = await insertCampaign(context, {
    creatorProfileId: input.creatorProfileId,
    brandId: input.brandId,
    dealType: input.dealType,
    score: loaded.fitScoreRow.deal_type_score,
    scoreRationale: loaded.fitScore,
    brief: briefWithContactRisk,
    targetContactId: targetContact?.id ?? null,
  });
  const message = await insertInitialMessage(context, campaign.id, draft);
  await incrementHookLibrary(context, {
    creatorProfileId: input.creatorProfileId,
    dealType: input.dealType,
    hookPattern: briefWithContactRisk.recommended_hook.pattern_name,
  });

  return {
    campaign,
    message,
    brief: briefWithContactRisk,
    draft,
  };
}

export async function listPendingApprovals(
  context: DraftingContext,
  filters: PendingApprovalFilters,
): Promise<PendingApprovalListResult> {
  const pageSize = 25;
  const page = Math.max(1, filters.page ?? 1);
  const { data: messages, error } = await context.supabase
    .from("messages")
    .select("*")
    .eq("user_id", context.userId)
    .eq("status", "pending_approval")
    .order("created_at", { ascending: false });

  if (error) {
    throw new DraftingServiceError(error.message);
  }

  const latestMessages = latestMessagePerCampaign(messages ?? []);
  const campaignIds = latestMessages.map((message) => message.campaign_id);
  const campaigns = await loadCampaignsById(context, campaignIds);
  const profileIds = [
    ...new Set(
      [...campaigns.values()].map((campaign) => campaign.creator_profile_id),
    ),
  ];
  const brandIds = [
    ...new Set([...campaigns.values()].map((campaign) => campaign.brand_id)),
  ];
  const [profiles, brands] = await Promise.all([
    loadCreatorProfilesById(context, profileIds),
    loadBrandsById(context, brandIds),
  ]);
  const rows = latestMessages
    .map((message) => {
      const campaign = campaigns.get(message.campaign_id);

      if (!campaign) {
        return null;
      }

      const profile = profiles.get(campaign.creator_profile_id);
      const brand = brands.get(campaign.brand_id);

      if (!profile || !brand) {
        return null;
      }

      return {
        message,
        subject_variants: readSubjectVariants(message),
        campaign,
        creator_profile: profile,
        brand,
        brief: readResearchBrief(campaign.research_brief_json),
        score_rationale: readScoreRationale(campaign.score_rationale_json),
      };
    })
    .filter((row): row is PendingApprovalRow => Boolean(row))
    .filter((row) => matchesPendingFilters(row, filters))
    .sort((left, right) => sortPendingRows(left, right, filters.sort));
  const total = rows.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, totalPages);
  const start = (safePage - 1) * pageSize;

  return {
    rows: rows.slice(start, start + pageSize),
    total,
    page: safePage,
    pageSize,
    totalPages,
  };
}

export async function approveDraft(
  context: DraftingContext,
  messageId: string,
  options: { editedSubject?: string; editedBody?: string },
): Promise<Tables<"messages">> {
  const { message, campaign } = await loadMessageWithCampaign(context, messageId);
  const editedSubject = options.editedSubject?.trim() || message.subject;
  const editedBody = options.editedBody ?? message.body_text;
  const subjectChanged = editedSubject !== message.subject;
  const bodyChanged = editedBody !== message.body_text;
  const existingEditDiff = readJsonRecord(message.edit_diff);
  const nextEditDiff = {
    ...existingEditDiff,
    approval_edit:
      subjectChanged || bodyChanged
        ? {
            original_subject: message.subject,
            edited_subject: editedSubject,
            original_body: message.body_text,
            edited_body: editedBody,
          }
        : null,
  };

  if (bodyChanged) {
    await insertEditedVoiceSample(context, campaign, message.body_text, editedBody);
  }

  const { data, error } = await context.supabase
    .from("messages")
    .update({
      subject: editedSubject,
      body_text: editedBody,
      status: "approved",
      approved_at: new Date().toISOString(),
      approved_by: context.userId,
      was_edited_before_send: subjectChanged || bodyChanged,
      edit_diff: nextEditDiff as Json,
    })
    .eq("id", message.id)
    .eq("user_id", context.userId)
    .select("*")
    .single();

  if (error || !data) {
    throw new DraftingServiceError(error?.message ?? "Could not approve draft.");
  }

  await updateCampaignStatus(context, campaign.id, "approved");
  return data;
}

export async function skipDraft(
  context: DraftingContext,
  messageId: string,
  suppressionDays = DEFAULT_SKIP_SUPPRESSION_DAYS,
): Promise<void> {
  const { message, campaign } = await loadMessageWithCampaign(context, messageId);

  await updateMessageStatus(context, message.id, "skipped");
  await updateCampaignStatus(context, campaign.id, "skipped");
  await upsertDraftSuppression(context, {
    creatorProfileId: campaign.creator_profile_id,
    brandId: campaign.brand_id,
    dealType: readDealType(campaign.deal_type),
    reason: "skipped",
    suppressionDays,
  });
}

export async function regenerateDraft(
  context: DraftingContext,
  messageId: string,
  angleHint?: string,
  generator: typeof generateDraft = generateDraft,
): Promise<Tables<"messages">> {
  const { campaign } = await loadMessageWithCampaign(context, messageId);
  const loaded = await loadPitchContext(context, {
    creatorProfileId: campaign.creator_profile_id,
    brandId: campaign.brand_id,
    dealType: readDealType(campaign.deal_type),
  });
  const brief = readResearchBrief(campaign.research_brief_json);
  const targetContact =
    campaign.target_contact_id === null
      ? null
      : loaded.contacts.find((contact) => contact.id === campaign.target_contact_id) ??
        chooseTargetContact(loaded.contacts);
  const draft = await generator({
    creatorProfile: loaded.creatorSummary,
    voiceStyleGuide: loaded.voiceStyleGuide,
    mediaKit: loaded.mediaKit,
    brand: loaded.scoringBrand,
    researchBrief: brief,
    dealType: readDealType(campaign.deal_type),
    senderDisplayName:
      loaded.user.sender_display_name ?? loaded.user.name ?? "Athena Huo",
    senderEmail: loaded.user.email,
    physicalAddress: loaded.user.physical_address ?? "",
    targetContact,
    angleHint,
  });
  const nextVersion = await nextMessageVersion(context, campaign.id);

  return insertMessageVersion(context, campaign.id, nextVersion, draft);
}

export async function excludeBrandFromQueue(
  context: DraftingContext,
  brandId: string,
  reason?: string | null,
): Promise<void> {
  const { error: brandError } = await context.supabase
    .from("brands")
    .update({
      excluded: true,
      exclusion_reason: reason?.trim() || "Excluded from approval queue.",
    })
    .eq("id", brandId)
    .eq("user_id", context.userId);

  if (brandError) {
    throw new DraftingServiceError(brandError.message);
  }

  const campaigns = await loadCampaignsForBrand(context, brandId);
  const campaignIds = campaigns.map((campaign) => campaign.id);

  if (campaignIds.length > 0) {
    const { error: messageError } = await context.supabase
      .from("messages")
      .update({ status: "skipped" })
      .eq("user_id", context.userId)
      .eq("status", "pending_approval")
      .in("campaign_id", campaignIds);

    if (messageError) {
      throw new DraftingServiceError(messageError.message);
    }

    const { error: campaignError } = await context.supabase
      .from("campaigns")
      .update({ status: "skipped" })
      .eq("user_id", context.userId)
      .in("id", campaignIds)
      .eq("status", "drafted");

    if (campaignError) {
      throw new DraftingServiceError(campaignError.message);
    }
  }

  const suppressions = await loadSuppressionTargetsForBrand(context, brandId);

  for (const suppression of suppressions) {
    await upsertDraftSuppression(context, {
      ...suppression,
      reason: "excluded",
      suppressionDays: EXCLUDED_BRAND_SUPPRESSION_DAYS,
    });
  }
}

async function loadPitchContext(
  context: DraftingContext,
  input: {
    creatorProfileId: string;
    brandId: string;
    dealType: DealType;
  },
): Promise<LoadedPitchContext> {
  const [user, creatorProfile, brand] = await Promise.all([
    loadUser(context),
    loadCreatorProfile(context, input.creatorProfileId),
    loadBrand(context, input.brandId),
  ]);
  const [voiceStyleGuide, mediaKitRow, contacts, signals, fitScoreRow, pastBrandWork] =
    await Promise.all([
      loadActiveVoiceGuide(context, input.creatorProfileId),
      loadActiveMediaKit(context, input.creatorProfileId),
      loadContacts(context, input.brandId),
      loadSignals(context, input.brandId),
      loadFitScore(context, input),
      loadPastBrandWork(context, input.creatorProfileId),
    ]);
  const mediaKit = mediaKitJsonSchema.parse(mediaKitRow.data_json);
  const fitScore = readScoreRationale(fitScoreRow.score_rationale_json);

  if (!fitScore) {
    throw new DraftingServiceError("Fit score rationale is missing.");
  }

  return {
    user,
    creatorProfile,
    creatorSummary: toCreatorSummary(creatorProfile),
    voiceStyleGuide,
    mediaKit,
    mediaKitRow,
    brand,
    scoringBrand: toScoringBrand(brand, contacts, signals, pastBrandWork),
    fitScoreRow,
    fitScore,
    contacts,
    pastBrandWork,
  };
}

async function assertNoLiveCampaign(
  context: DraftingContext,
  input: { creatorProfileId: string; brandId: string; dealType: DealType },
) {
  const { data, error } = await context.supabase
    .from("campaigns")
    .select("id")
    .eq("user_id", context.userId)
    .eq("creator_profile_id", input.creatorProfileId)
    .eq("brand_id", input.brandId)
    .eq("deal_type", input.dealType)
    .in("status", [...nonTerminalCampaignStatuses])
    .limit(1);

  if (error) {
    throw new DraftingServiceError(error.message);
  }

  if ((data ?? []).length > 0) {
    throw new DuplicateDraftError();
  }
}

async function assertNotSuppressed(
  context: DraftingContext,
  input: { creatorProfileId: string; brandId: string; dealType: DealType },
) {
  const { data, error } = await context.supabase
    .from("draft_suppressions")
    .select("suppressed_until")
    .eq("user_id", context.userId)
    .eq("creator_profile_id", input.creatorProfileId)
    .eq("brand_id", input.brandId)
    .eq("deal_type", input.dealType)
    .gt("suppressed_until", new Date().toISOString())
    .limit(1);

  if (error) {
    throw new DraftingServiceError(error.message);
  }

  const suppression = data?.[0];

  if (suppression) {
    throw new SuppressedDraftError(suppression.suppressed_until);
  }
}

async function loadUser(context: DraftingContext) {
  const { data, error } = await context.supabase
    .from("users")
    .select("*")
    .eq("user_id", context.userId)
    .single();

  if (error || !data) {
    throw new DraftingServiceError(error?.message ?? "User settings not found.");
  }

  return data;
}

async function loadCreatorProfile(
  context: DraftingContext,
  creatorProfileId: string,
) {
  const { data, error } = await context.supabase
    .from("creator_profiles")
    .select("*")
    .eq("user_id", context.userId)
    .eq("id", creatorProfileId)
    .single();

  if (error || !data) {
    throw new DraftingServiceError(
      error?.message ?? "Creator profile not found.",
    );
  }

  return data;
}

async function loadBrand(context: DraftingContext, brandId: string) {
  const { data, error } = await context.supabase
    .from("brands")
    .select("*")
    .eq("user_id", context.userId)
    .eq("id", brandId)
    .single();

  if (error || !data) {
    throw new DraftingServiceError(error?.message ?? "Brand not found.");
  }

  return data;
}

async function loadActiveVoiceGuide(
  context: DraftingContext,
  creatorProfileId: string,
) {
  const { data, error } = await context.supabase
    .from("voice_style_guides")
    .select("style_doc_json")
    .eq("user_id", context.userId)
    .eq("creator_profile_id", creatorProfileId)
    .eq("is_active", true)
    .order("version", { ascending: false })
    .limit(1)
    .single();

  if (error || !data) {
    throw new DraftingServiceError(
      error?.message ?? "Active voice guide not found.",
    );
  }

  return voiceStyleGuideJsonSchema.parse(data.style_doc_json);
}

async function loadActiveMediaKit(
  context: DraftingContext,
  creatorProfileId: string,
) {
  const { data, error } = await context.supabase
    .from("media_kits")
    .select("*")
    .eq("user_id", context.userId)
    .eq("creator_profile_id", creatorProfileId)
    .eq("is_active", true)
    .order("version", { ascending: false })
    .limit(1)
    .single();

  if (error || !data) {
    throw new DraftingServiceError(
      error?.message ?? "Active media kit not found.",
    );
  }

  return data;
}

async function loadContacts(context: DraftingContext, brandId: string) {
  const { data, error } = await context.supabase
    .from("brand_contacts")
    .select("*")
    .eq("user_id", context.userId)
    .eq("brand_id", brandId)
    .eq("marked_unreachable", false)
    .order("confidence", { ascending: false, nullsFirst: false });

  if (error) {
    throw new DraftingServiceError(error.message);
  }

  return data ?? [];
}

async function loadSignals(context: DraftingContext, brandId: string) {
  const { data, error } = await context.supabase
    .from("source_signals")
    .select("signal_type,evidence_json")
    .eq("user_id", context.userId)
    .eq("brand_id", brandId);

  if (error) {
    throw new DraftingServiceError(error.message);
  }

  return data ?? [];
}

async function loadFitScore(
  context: DraftingContext,
  input: { creatorProfileId: string; brandId: string; dealType: DealType },
) {
  const { data, error } = await context.supabase
    .from("brand_fit_scores")
    .select("*")
    .eq("user_id", context.userId)
    .eq("creator_profile_id", input.creatorProfileId)
    .eq("brand_id", input.brandId)
    .eq("deal_type", input.dealType)
    .single();

  if (error || !data) {
    throw new DraftingServiceError(
      error?.message ?? "Fit score not found. Recompute scores first.",
    );
  }

  return data;
}

async function loadPastBrandWork(
  context: DraftingContext,
  creatorProfileId: string,
): Promise<PastBrandWorkInput[]> {
  const { data, error } = await context.supabase
    .from("past_brand_work")
    .select("brand_name,year,deal_type,one_liner,link,sort_order")
    .eq("user_id", context.userId)
    .eq("creator_profile_id", creatorProfileId)
    .order("sort_order", { ascending: true });

  if (error) {
    throw new DraftingServiceError(error.message);
  }

  return (data ?? []).map((entry) => ({
    brand_name: entry.brand_name,
    year: entry.year,
    deal_type: readDealType(entry.deal_type),
    one_liner: entry.one_liner,
    link: entry.link ?? undefined,
  }));
}

async function insertCampaign(
  context: DraftingContext,
  input: {
    creatorProfileId: string;
    brandId: string;
    dealType: DealType;
    score: number;
    scoreRationale: BrandFitScoreSummary;
    brief: ResearchBriefJson;
    targetContactId: string | null;
  },
) {
  const { data, error } = await context.supabase
    .from("campaigns")
    .insert({
      user_id: context.userId,
      creator_profile_id: input.creatorProfileId,
      brand_id: input.brandId,
      deal_type: input.dealType,
      status: "drafted",
      score: input.score,
      score_rationale_json: input.scoreRationale as unknown as Json,
      hook_chosen: input.brief.recommended_hook.pattern_name,
      research_brief_json: input.brief as unknown as Json,
      target_contact_id: input.targetContactId,
    })
    .select("*")
    .single();

  if (error || !data) {
    throw new DraftingServiceError(error?.message ?? "Could not create campaign.");
  }

  return data;
}

async function insertInitialMessage(
  context: DraftingContext,
  campaignId: string,
  draft: DraftJson,
) {
  return insertMessageVersion(context, campaignId, 1, draft);
}

async function insertMessageVersion(
  context: DraftingContext,
  campaignId: string,
  version: number,
  draft: DraftJson,
) {
  const metadata = {
    subject_variants: draft.subject_variants,
  };
  const { data, error } = await context.supabase
    .from("messages")
    .insert({
      user_id: context.userId,
      campaign_id: campaignId,
      version,
      kind: "initial",
      subject: draft.subject_variants[0],
      body_text: draft.body_text,
      body_html: draft.body_html,
      status: "pending_approval",
      model_used: draft.model_used,
      prompt_hash: draft.prompt_hash,
      edit_diff: metadata as Json,
    })
    .select("*")
    .single();

  if (error || !data) {
    throw new DraftingServiceError(error?.message ?? "Could not create message.");
  }

  return data;
}

async function incrementHookLibrary(
  context: DraftingContext,
  input: { creatorProfileId: string; dealType: DealType; hookPattern: string },
) {
  const { data: existing, error: loadError } = await context.supabase
    .from("hook_library")
    .select("*")
    .eq("user_id", context.userId)
    .eq("creator_profile_id", input.creatorProfileId)
    .eq("hook_pattern", input.hookPattern)
    .limit(1);

  if (loadError) {
    throw new DraftingServiceError(loadError.message);
  }

  const match = existing?.[0];

  if (!match) {
    const { error } = await context.supabase.from("hook_library").insert({
      user_id: context.userId,
      creator_profile_id: input.creatorProfileId,
      hook_pattern: input.hookPattern,
      applies_to_deal_types: [input.dealType],
      usage_count: 1,
    });

    if (error) {
      throw new DraftingServiceError(error.message);
    }

    return;
  }

  const { error } = await context.supabase
    .from("hook_library")
    .update({
      applies_to_deal_types: unionText(match.applies_to_deal_types, [
        input.dealType,
      ]),
      usage_count: match.usage_count + 1,
    })
    .eq("id", match.id)
    .eq("user_id", context.userId);

  if (error) {
    throw new DraftingServiceError(error.message);
  }
}

async function loadMessageWithCampaign(context: DraftingContext, messageId: string) {
  const { data: message, error: messageError } = await context.supabase
    .from("messages")
    .select("*")
    .eq("id", messageId)
    .eq("user_id", context.userId)
    .single();

  if (messageError || !message) {
    throw new DraftingServiceError(messageError?.message ?? "Message not found.");
  }

  const { data: campaign, error: campaignError } = await context.supabase
    .from("campaigns")
    .select("*")
    .eq("id", message.campaign_id)
    .eq("user_id", context.userId)
    .single();

  if (campaignError || !campaign) {
    throw new DraftingServiceError(
      campaignError?.message ?? "Campaign not found.",
    );
  }

  return { message, campaign };
}

async function insertEditedVoiceSample(
  context: DraftingContext,
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
    throw new DraftingServiceError(error.message);
  }
}

async function updateMessageStatus(
  context: DraftingContext,
  messageId: string,
  status: Tables<"messages">["status"],
) {
  const { error } = await context.supabase
    .from("messages")
    .update({ status })
    .eq("id", messageId)
    .eq("user_id", context.userId);

  if (error) {
    throw new DraftingServiceError(error.message);
  }
}

async function updateCampaignStatus(
  context: DraftingContext,
  campaignId: string,
  status: Tables<"campaigns">["status"],
) {
  const { error } = await context.supabase
    .from("campaigns")
    .update({ status })
    .eq("id", campaignId)
    .eq("user_id", context.userId);

  if (error) {
    throw new DraftingServiceError(error.message);
  }
}

async function upsertDraftSuppression(
  context: DraftingContext,
  input: {
    creatorProfileId: string;
    brandId: string;
    dealType: DealType;
    reason: Tables<"draft_suppressions">["reason"];
    suppressionDays: number;
  },
) {
  const suppressedUntil = new Date(
    Date.now() + input.suppressionDays * 24 * 60 * 60 * 1000,
  ).toISOString();
  const { error } = await context.supabase.from("draft_suppressions").upsert(
    {
      user_id: context.userId,
      creator_profile_id: input.creatorProfileId,
      brand_id: input.brandId,
      deal_type: input.dealType,
      suppressed_until: suppressedUntil,
      reason: input.reason,
    },
    {
      onConflict: "creator_profile_id,brand_id,deal_type",
    },
  );

  if (error) {
    throw new DraftingServiceError(error.message);
  }
}

async function nextMessageVersion(context: DraftingContext, campaignId: string) {
  const { data, error } = await context.supabase
    .from("messages")
    .select("version")
    .eq("user_id", context.userId)
    .eq("campaign_id", campaignId)
    .order("version", { ascending: false })
    .limit(1);

  if (error) {
    throw new DraftingServiceError(error.message);
  }

  return (data?.[0]?.version ?? 0) + 1;
}

async function loadCampaignsById(context: DraftingContext, campaignIds: string[]) {
  const rows = new Map<string, Tables<"campaigns">>();

  if (campaignIds.length === 0) {
    return rows;
  }

  const { data, error } = await context.supabase
    .from("campaigns")
    .select("*")
    .eq("user_id", context.userId)
    .in("id", campaignIds);

  if (error) {
    throw new DraftingServiceError(error.message);
  }

  return new Map((data ?? []).map((campaign) => [campaign.id, campaign]));
}

async function loadCreatorProfilesById(
  context: DraftingContext,
  profileIds: string[],
) {
  if (profileIds.length === 0) {
    return new Map<string, Tables<"creator_profiles">>();
  }

  const { data, error } = await context.supabase
    .from("creator_profiles")
    .select("*")
    .eq("user_id", context.userId)
    .in("id", profileIds);

  if (error) {
    throw new DraftingServiceError(error.message);
  }

  return new Map((data ?? []).map((profile) => [profile.id, profile]));
}

async function loadBrandsById(context: DraftingContext, brandIds: string[]) {
  if (brandIds.length === 0) {
    return new Map<string, Tables<"brands">>();
  }

  const { data, error } = await context.supabase
    .from("brands")
    .select("*")
    .eq("user_id", context.userId)
    .in("id", brandIds);

  if (error) {
    throw new DraftingServiceError(error.message);
  }

  return new Map((data ?? []).map((brand) => [brand.id, brand]));
}

async function loadCampaignsForBrand(context: DraftingContext, brandId: string) {
  const { data, error } = await context.supabase
    .from("campaigns")
    .select("*")
    .eq("user_id", context.userId)
    .eq("brand_id", brandId);

  if (error) {
    throw new DraftingServiceError(error.message);
  }

  return data ?? [];
}

async function loadSuppressionTargetsForBrand(
  context: DraftingContext,
  brandId: string,
) {
  const { data, error } = await context.supabase
    .from("brand_fit_scores")
    .select("creator_profile_id,brand_id,deal_type")
    .eq("user_id", context.userId)
    .eq("brand_id", brandId);

  if (error) {
    throw new DraftingServiceError(error.message);
  }

  return (data ?? []).map((row) => ({
    creatorProfileId: row.creator_profile_id,
    brandId: row.brand_id,
    dealType: readDealType(row.deal_type),
  }));
}

function latestMessagePerCampaign(messages: Tables<"messages">[]) {
  const latest = new Map<string, Tables<"messages">>();

  for (const message of messages) {
    const existing = latest.get(message.campaign_id);

    if (!existing || message.version > existing.version) {
      latest.set(message.campaign_id, message);
    }
  }

  return [...latest.values()];
}

function matchesPendingFilters(
  row: PendingApprovalRow,
  filters: PendingApprovalFilters,
) {
  if (
    filters.creatorProfileId &&
    row.campaign.creator_profile_id !== filters.creatorProfileId
  ) {
    return false;
  }

  if (
    filters.dealTypes?.length &&
    !filters.dealTypes.includes(readDealType(row.campaign.deal_type))
  ) {
    return false;
  }

  if ((row.campaign.score ?? 0) < (filters.minScore ?? 0)) {
    return false;
  }

  return true;
}

function sortPendingRows(
  left: PendingApprovalRow,
  right: PendingApprovalRow,
  sort: PendingApprovalFilters["sort"] = "score_desc",
) {
  if (sort === "drafted_desc") {
    return right.message.created_at.localeCompare(left.message.created_at);
  }

  return (
    (right.campaign.score ?? 0) - (left.campaign.score ?? 0) ||
    right.message.created_at.localeCompare(left.message.created_at)
  );
}

function chooseTargetContact(contacts: Tables<"brand_contacts">[]) {
  const sorted = [...contacts].sort((left, right) => {
    const leftPriority = contactRolePriority(left.role);
    const rightPriority = contactRolePriority(right.role);

    return (
      leftPriority - rightPriority ||
      (right.confidence ?? -1) - (left.confidence ?? -1) ||
      left.email.localeCompare(right.email)
    );
  });

  return sorted[0] ?? null;
}

function contactRolePriority(role: string | null) {
  const index = preferredContactRoles.findIndex((item) => item === role);
  return index === -1 ? preferredContactRoles.length : index;
}

function toCreatorSummary(
  profile: Tables<"creator_profiles">,
): CreatorProfileSummary {
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
  pastBrandWork: PastBrandWorkInput[],
): ScoringBrand {
  const evidenceText = signals.map((signal) => jsonToSearchText(signal.evidence_json));
  const normalizedBrandName = normalizeText(brand.name);

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
    source_signal_evidence_text: evidenceText.join(" ").toLowerCase(),
    paid_partnership_signal_count: signals.reduce(
      (sum, signal) => sum + readPaidPartnershipCount(signal.evidence_json),
      0,
    ),
    has_past_brand_work: pastBrandWork.some(
      (entry) => normalizeText(entry.brand_name) === normalizedBrandName,
    ),
  };
}

function readResearchBrief(value: Json): ResearchBriefJson {
  return researchBriefJsonSchema.parse(value);
}

function readScoreRationale(value: Json | null): ScoreRationaleJson | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const record = value;
  return {
    base_fit_score:
      typeof record.base_fit_score === "number" ? record.base_fit_score : 0,
    base_rationale: readStringArray(record.base_rationale),
    deal_type: readDealType(record.deal_type),
    deal_type_score:
      typeof record.deal_type_score === "number" ? record.deal_type_score : 0,
    deal_type_rationale: readStringArray(record.deal_type_rationale),
    computed_at:
      typeof record.computed_at === "string" ? record.computed_at : "",
  };
}

function readSubjectVariants(message: Tables<"messages">) {
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

function readStringArray(value: Json | undefined) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function readDealType(value: Json | string | undefined): DealType {
  return DEAL_TYPES.includes(value as DealType) ? (value as DealType) : "paid";
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

function normalizeText(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
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

export function createDraftFixture(input?: Partial<DraftJson>): DraftJson {
  return draftJsonSchema.parse({
    subject_variants: ["A quick collab idea", "Idea for your team", "Athena x brand"],
    body_text:
      "Hi there,\n\nI had a specific content idea for your team.\n\nBest,\nAthena\n---\nAthena Huo | @athena_hz | athenahuo.com | NYC, NY",
    body_html: null,
    hook_pattern_name: "specific-product-hook",
    model_used: "test-model",
    prompt_hash: "test-hash",
    ...input,
  });
}

export function createResearchBriefFixture(
  input?: Partial<ResearchBriefJson>,
): ResearchBriefJson {
  return researchBriefJsonSchema.parse({
    why_this_brand:
      "The brand overlaps with Athena's fashion and lifestyle audience. It has enough signal to be worth reviewing.",
    why_this_deal_type:
      "This deal type fits the current score rationale and available contacts.",
    recommended_hook: {
      pattern_name: "specific-product-hook",
      one_liner: "I had a content idea tied to your latest launch.",
      why_this_hook: "It turns the pitch into a concrete creator idea.",
    },
    suggested_subject_themes: ["content idea", "launch angle", "creator fit"],
    risk_flags: [],
    confidence: 80,
    ...input,
  });
}
