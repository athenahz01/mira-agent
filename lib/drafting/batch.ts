import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database, Tables } from "../db/types";
import { DEAL_TYPES, type DealType } from "../scoring/rules.ts";
import {
  DuplicateDraftError,
  SuppressedDraftError,
  generateAndPersistPitch,
  type DraftGenerators,
  type DraftingContext,
} from "./service.ts";

export const MIN_AUTO_DRAFT_SCORE = 40;

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

export type DraftCandidate = {
  profileId: string;
  brandId: string;
  dealType: DealType;
  score: number;
};

export type BatchProgress = {
  profileId: string;
  processed: number;
  total: number;
};

export type RunAutoDraftBatchResult = {
  profilesProcessed: number;
  candidatesProcessed: number;
  draftsCreated: number;
  errors: { candidate: DraftCandidate; message: string }[];
};

export async function selectDraftCandidatesForBatch(
  context: DraftingContext,
  creatorProfileId: string,
  limit: number,
): Promise<DraftCandidate[]> {
  if (limit <= 0) {
    return [];
  }

  const { data: scores, error } = await context.supabase
    .from("brand_fit_scores")
    .select("*")
    .eq("user_id", context.userId)
    .eq("creator_profile_id", creatorProfileId)
    .gte("deal_type_score", MIN_AUTO_DRAFT_SCORE)
    .order("deal_type_score", { ascending: false });

  if (error) {
    throw new Error(error.message);
  }

  const scoreRows = scores ?? [];
  const brandIds = [...new Set(scoreRows.map((score) => score.brand_id))];
  const [brandsById, liveCampaignKeys, suppressionKeys] = await Promise.all([
    loadBrandsById(context.supabase, context.userId, brandIds),
    loadLiveCampaignKeys(context, creatorProfileId, brandIds),
    loadActiveSuppressionKeys(context, creatorProfileId, brandIds),
  ]);
  const selected: DraftCandidate[] = [];
  const selectedBrandIds = new Set<string>();

  for (const score of scoreRows) {
    if (selected.length >= limit) {
      break;
    }

    const dealType = readDealType(score.deal_type);
    const key = trioKey(creatorProfileId, score.brand_id, dealType);
    const brand = brandsById.get(score.brand_id);

    if (
      !brand ||
      brand.excluded ||
      selectedBrandIds.has(score.brand_id) ||
      liveCampaignKeys.has(key) ||
      suppressionKeys.has(key)
    ) {
      continue;
    }

    selected.push({
      profileId: creatorProfileId,
      brandId: score.brand_id,
      dealType,
      score: score.deal_type_score,
    });
    selectedBrandIds.add(score.brand_id);
  }

  return selected;
}

export async function runAutoDraftBatch(
  context: DraftingContext,
  options: {
    creatorProfileIds?: string[];
    onProgress?: (progress: BatchProgress) => void;
  } = {},
  generators: DraftGenerators = {},
): Promise<RunAutoDraftBatchResult> {
  const profileIds =
    options.creatorProfileIds && options.creatorProfileIds.length > 0
      ? options.creatorProfileIds
      : await loadActiveProfileIds(context);
  const result: RunAutoDraftBatchResult = {
    profilesProcessed: 0,
    candidatesProcessed: 0,
    draftsCreated: 0,
    errors: [],
  };

  for (const profileId of profileIds) {
    const limit = await loadMaxDraftsPerDay(context, profileId);
    const candidates = await selectDraftCandidatesForBatch(context, profileId, limit);
    result.profilesProcessed += 1;

    for (const [index, candidate] of candidates.entries()) {
      options.onProgress?.({
        profileId,
        processed: index,
        total: candidates.length,
      });
      result.candidatesProcessed += 1;

      try {
        await generateAndPersistPitch(
          context,
          {
            creatorProfileId: candidate.profileId,
            brandId: candidate.brandId,
            dealType: candidate.dealType,
          },
          generators,
        );
        result.draftsCreated += 1;
      } catch (error) {
        if (error instanceof DuplicateDraftError || error instanceof SuppressedDraftError) {
          continue;
        }

        result.errors.push({
          candidate,
          message: error instanceof Error ? error.message : "Unknown drafting error",
        });
      }
    }

    options.onProgress?.({
      profileId,
      processed: candidates.length,
      total: candidates.length,
    });
  }

  return result;
}

async function loadActiveProfileIds(context: DraftingContext) {
  const { data, error } = await context.supabase
    .from("creator_profiles")
    .select("id")
    .eq("user_id", context.userId)
    .eq("active", true);

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []).map((profile) => profile.id);
}

async function loadMaxDraftsPerDay(context: DraftingContext, profileId: string) {
  const [profileRule, globalRule] = await Promise.all([
    loadRule(context, profileId),
    loadRule(context, null),
  ]);

  return profileRule?.max_drafts_per_day ?? globalRule?.max_drafts_per_day ?? 10;
}

async function loadRule(context: DraftingContext, profileId: string | null) {
  let query = context.supabase
    .from("outreach_rules")
    .select("max_drafts_per_day,updated_at")
    .eq("user_id", context.userId)
    .order("updated_at", { ascending: false })
    .limit(1);

  query =
    profileId === null
      ? query.is("creator_profile_id", null)
      : query.eq("creator_profile_id", profileId);

  const { data, error } = await query;

  if (error) {
    throw new Error(error.message);
  }

  return data?.[0] ?? null;
}

async function loadBrandsById(
  supabase: SupabaseClient<Database>,
  userId: string,
  brandIds: string[],
) {
  if (brandIds.length === 0) {
    return new Map<string, Tables<"brands">>();
  }

  const { data, error } = await supabase
    .from("brands")
    .select("*")
    .eq("user_id", userId)
    .in("id", brandIds);

  if (error) {
    throw new Error(error.message);
  }

  return new Map((data ?? []).map((brand) => [brand.id, brand]));
}

async function loadLiveCampaignKeys(
  context: DraftingContext,
  creatorProfileId: string,
  brandIds: string[],
) {
  const keys = new Set<string>();

  if (brandIds.length === 0) {
    return keys;
  }

  const { data, error } = await context.supabase
    .from("campaigns")
    .select("creator_profile_id,brand_id,deal_type")
    .eq("user_id", context.userId)
    .eq("creator_profile_id", creatorProfileId)
    .in("brand_id", brandIds)
    .in("status", [...nonTerminalCampaignStatuses]);

  if (error) {
    throw new Error(error.message);
  }

  for (const campaign of data ?? []) {
    keys.add(
      trioKey(
        campaign.creator_profile_id,
        campaign.brand_id,
        readDealType(campaign.deal_type),
      ),
    );
  }

  return keys;
}

async function loadActiveSuppressionKeys(
  context: DraftingContext,
  creatorProfileId: string,
  brandIds: string[],
) {
  const keys = new Set<string>();

  if (brandIds.length === 0) {
    return keys;
  }

  const { data, error } = await context.supabase
    .from("draft_suppressions")
    .select("creator_profile_id,brand_id,deal_type")
    .eq("user_id", context.userId)
    .eq("creator_profile_id", creatorProfileId)
    .in("brand_id", brandIds)
    .gt("suppressed_until", new Date().toISOString());

  if (error) {
    throw new Error(error.message);
  }

  for (const suppression of data ?? []) {
    keys.add(
      trioKey(
        suppression.creator_profile_id,
        suppression.brand_id,
        readDealType(suppression.deal_type),
      ),
    );
  }

  return keys;
}

function trioKey(profileId: string, brandId: string, dealType: DealType) {
  return `${profileId}:${brandId}:${dealType}`;
}

function readDealType(value: string): DealType {
  return DEAL_TYPES.includes(value as DealType) ? (value as DealType) : "paid";
}
