import type { SupabaseClient } from "@supabase/supabase-js";

import { brandFiltersSchema, type BrandFilters } from "@/lib/brands/schemas";
import type { Database, Json, Tables, TablesInsert } from "@/lib/db/types";
import {
  DEAL_TYPES,
  scoreBrand,
  type DealType,
  type ScoringBrand,
  type ScoringCreatorProfile,
} from "@/lib/scoring/rules";

export const SCORE_CACHE_DAYS = 7;
export const RANKED_BRAND_PAGE_SIZE = 25;

export type ScoringContext = {
  supabase: SupabaseClient<Database>;
  userId: string;
};

export type ComputeFitScoresResult = {
  pairs_processed: number;
  scores_written: number;
  scores_cached: number;
};

export type RankedBrandRow = {
  score: Tables<"brand_fit_scores">;
  brand: Tables<"brands"> & {
    contact_count: number;
  };
  rationale: ScoreRationaleJson;
};

export type RankedBrandListResult = {
  rows: RankedBrandRow[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  creatorProfileId: string | null;
  dealType: DealType;
  filters: BrandFilters;
};

export type TopOpportunity = {
  profile_id: string;
  brand_id: string;
  brand_name: string;
  deal_type: DealType;
  score: number;
};

export type ScoreRationaleJson = {
  base_fit_score: number;
  base_rationale: string[];
  deal_type: DealType;
  deal_type_score: number;
  deal_type_rationale: string[];
  computed_at: string;
};

type BrandSignalSummary = {
  sourceKinds: string[];
  evidenceText: string;
  paidPartnershipSignalCount: number;
};

export async function computeBrandFitScores(
  context: ScoringContext,
  options: {
    creatorProfileIds?: string[];
    brandIds?: string[];
    forceRecompute?: boolean;
  } = {},
): Promise<ComputeFitScoresResult> {
  const [profiles, brands] = await Promise.all([
    loadCreatorProfiles(context, options.creatorProfileIds),
    loadBrands(context, options.brandIds),
  ]);
  const brandIds = brands.map((brand) => brand.id);
  const profileIds = profiles.map((profile) => profile.id);
  const [contactsByBrand, signalsByBrand, pastBrandWorkByProfile] =
    await Promise.all([
      loadContactsByBrand(context, brandIds),
      loadSignalsByBrand(context, brandIds),
      loadPastBrandWorkByProfile(context, profileIds),
    ]);
  const freshScoreKeys = options.forceRecompute
    ? new Set<string>()
    : await loadFreshScorePairKeys(context, profileIds, brandIds);
  const summary: ComputeFitScoresResult = {
    pairs_processed: 0,
    scores_written: 0,
    scores_cached: 0,
  };

  for (const profile of profiles) {
    for (const brand of brands) {
      const pairKey = scorePairKey(profile.id, brand.id);

      if (freshScoreKeys.has(pairKey)) {
        summary.scores_cached += DEAL_TYPES.length;
        continue;
      }

      const enrichedBrand = enrichBrandForScoring(
        brand,
        contactsByBrand.get(brand.id) ?? [],
        signalsByBrand.get(brand.id) ?? {
          sourceKinds: [],
          evidenceText: "",
          paidPartnershipSignalCount: 0,
        },
        pastBrandWorkByProfile.get(profile.id) ?? [],
      );
      const result = scoreBrand({
        creatorProfile: profile,
        brand: enrichedBrand,
      });
      const computedAt = new Date().toISOString();
      const rows = DEAL_TYPES.map((dealType) =>
        toScoreInsertRow({
          userId: context.userId,
          profile,
          brand,
          dealType,
          computedAt,
          baseScore: result.base_fit_score,
          baseRationale: result.base_rationale,
          dealScore: result.deal_type_scores[dealType].score,
          dealRationale: result.deal_type_scores[dealType].rationale,
        }),
      );
      const { error } = await context.supabase
        .from("brand_fit_scores")
        .upsert(rows, {
          onConflict: "creator_profile_id,brand_id,deal_type",
        });

      if (error) {
        throw new Error(error.message);
      }

      summary.pairs_processed += 1;
      summary.scores_written += rows.length;
    }
  }

  return summary;
}

export async function listRankedBrandsForUser(
  context: ScoringContext,
  input: {
    creatorProfileId?: string | null;
    dealType: DealType;
    filters?: Partial<BrandFilters>;
  },
): Promise<RankedBrandListResult> {
  const filters = brandFiltersSchema.parse(input.filters ?? {});

  if (!input.creatorProfileId) {
    return emptyRankedResult(input.dealType, filters);
  }

  await assertCreatorProfile(context, input.creatorProfileId);
  const { data: scores, error } = await context.supabase
    .from("brand_fit_scores")
    .select("*")
    .eq("user_id", context.userId)
    .eq("creator_profile_id", input.creatorProfileId)
    .eq("deal_type", input.dealType)
    .order("deal_type_score", {
      ascending: false,
    });

  if (error) {
    throw new Error(error.message);
  }

  const brandIds = [...new Set((scores ?? []).map((score) => score.brand_id))];
  const [brandsById, contactsByBrand] = await Promise.all([
    loadBrandsById(context, brandIds),
    loadContactsByBrand(context, brandIds),
  ]);
  const rows = (scores ?? [])
    .map((score) => {
      const brand = brandsById.get(score.brand_id);

      if (!brand) {
        return null;
      }

      return {
        score,
        brand: {
          ...brand,
          contact_count: contactsByBrand.get(brand.id)?.length ?? 0,
        },
        rationale: readScoreRationale(score.score_rationale_json),
      };
    })
    .filter((row): row is RankedBrandRow => Boolean(row))
    .filter((row) => matchesRankedFilters(row, filters));
  const total = rows.length;
  const totalPages = Math.max(1, Math.ceil(total / RANKED_BRAND_PAGE_SIZE));
  const page = Math.min(filters.page, totalPages);
  const start = (page - 1) * RANKED_BRAND_PAGE_SIZE;

  return {
    rows: rows.slice(start, start + RANKED_BRAND_PAGE_SIZE),
    total,
    page,
    pageSize: RANKED_BRAND_PAGE_SIZE,
    totalPages,
    creatorProfileId: input.creatorProfileId,
    dealType: input.dealType,
    filters: {
      ...filters,
      page,
    },
  };
}

export async function getTopOpportunitiesForUser(
  context: ScoringContext,
  profileIds: string[],
): Promise<Record<string, TopOpportunity[]>> {
  if (profileIds.length === 0) {
    return {};
  }

  const { data: scores, error } = await context.supabase
    .from("brand_fit_scores")
    .select("*")
    .eq("user_id", context.userId)
    .in("creator_profile_id", profileIds)
    .order("deal_type_score", {
      ascending: false,
    });

  if (error) {
    throw new Error(error.message);
  }

  const brandIds = [...new Set((scores ?? []).map((score) => score.brand_id))];
  const brandsById = await loadBrandsById(context, brandIds);
  const bestByProfileBrand = new Map<string, TopOpportunity>();

  for (const score of scores ?? []) {
    const brand = brandsById.get(score.brand_id);

    if (!brand) {
      continue;
    }

    const key = `${score.creator_profile_id}:${score.brand_id}`;
    const existing = bestByProfileBrand.get(key);

    if (existing && existing.score >= score.deal_type_score) {
      continue;
    }

    bestByProfileBrand.set(key, {
      profile_id: score.creator_profile_id,
      brand_id: score.brand_id,
      brand_name: brand.name,
      deal_type: readDealType(score.deal_type),
      score: score.deal_type_score,
    });
  }

  const grouped: Record<string, TopOpportunity[]> = {};

  for (const opportunity of bestByProfileBrand.values()) {
    grouped[opportunity.profile_id] = [
      ...(grouped[opportunity.profile_id] ?? []),
      opportunity,
    ];
  }

  for (const [profileId, opportunities] of Object.entries(grouped)) {
    grouped[profileId] = opportunities
      .sort((a, b) => b.score - a.score || a.brand_name.localeCompare(b.brand_name))
      .slice(0, 3);
  }

  return grouped;
}

async function loadCreatorProfiles(
  context: ScoringContext,
  creatorProfileIds?: string[],
): Promise<ScoringCreatorProfile[]> {
  let query = context.supabase
    .from("creator_profiles")
    .select("id,handle,tier,niche_tags,aesthetic_keywords,recent_post_themes")
    .eq("user_id", context.userId)
    .eq("active", true);

  if (creatorProfileIds?.length) {
    query = query.in("id", creatorProfileIds);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(error.message);
  }

  return data ?? [];
}

async function loadBrands(
  context: ScoringContext,
  brandIds?: string[],
): Promise<Tables<"brands">[]> {
  let query = context.supabase
    .from("brands")
    .select("*")
    .eq("user_id", context.userId);

  if (brandIds?.length) {
    query = query.in("id", brandIds);
  } else {
    query = query.eq("excluded", false);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(error.message);
  }

  return data ?? [];
}

async function loadBrandsById(context: ScoringContext, brandIds: string[]) {
  if (brandIds.length === 0) {
    return new Map<string, Tables<"brands">>();
  }

  const { data, error } = await context.supabase
    .from("brands")
    .select("*")
    .eq("user_id", context.userId)
    .in("id", brandIds);

  if (error) {
    throw new Error(error.message);
  }

  return new Map((data ?? []).map((brand) => [brand.id, brand]));
}

async function assertCreatorProfile(
  context: ScoringContext,
  creatorProfileId: string,
) {
  const { data, error } = await context.supabase
    .from("creator_profiles")
    .select("id")
    .eq("user_id", context.userId)
    .eq("id", creatorProfileId)
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? "Creator profile not found.");
  }
}

async function loadContactsByBrand(
  context: ScoringContext,
  brandIds: string[],
) {
  const grouped = new Map<string, Tables<"brand_contacts">[]>();

  if (brandIds.length === 0) {
    return grouped;
  }

  const { data, error } = await context.supabase
    .from("brand_contacts")
    .select("*")
    .eq("user_id", context.userId)
    .in("brand_id", brandIds);

  if (error) {
    throw new Error(error.message);
  }

  for (const contact of data ?? []) {
    grouped.set(contact.brand_id, [
      ...(grouped.get(contact.brand_id) ?? []),
      contact,
    ]);
  }

  return grouped;
}

async function loadSignalsByBrand(
  context: ScoringContext,
  brandIds: string[],
) {
  const grouped = new Map<string, BrandSignalSummary>();

  if (brandIds.length === 0) {
    return grouped;
  }

  const { data, error } = await context.supabase
    .from("source_signals")
    .select("brand_id,signal_type,evidence_json")
    .eq("user_id", context.userId)
    .in("brand_id", brandIds);

  if (error) {
    throw new Error(error.message);
  }

  for (const signal of data ?? []) {
    const existing = grouped.get(signal.brand_id) ?? {
      sourceKinds: [],
      evidenceText: "",
      paidPartnershipSignalCount: 0,
    };

    existing.sourceKinds = [...new Set([...existing.sourceKinds, signal.signal_type])];
    existing.evidenceText = `${existing.evidenceText} ${jsonToSearchText(
      signal.evidence_json,
    )}`.toLowerCase();
    existing.paidPartnershipSignalCount += readPaidPartnershipCount(
      signal.evidence_json,
    );
    grouped.set(signal.brand_id, existing);
  }

  return grouped;
}

async function loadPastBrandWorkByProfile(
  context: ScoringContext,
  profileIds: string[],
) {
  const grouped = new Map<string, string[]>();

  if (profileIds.length === 0) {
    return grouped;
  }

  const { data, error } = await context.supabase
    .from("past_brand_work")
    .select("creator_profile_id,brand_name")
    .eq("user_id", context.userId)
    .in("creator_profile_id", profileIds);

  if (error) {
    throw new Error(error.message);
  }

  for (const entry of data ?? []) {
    grouped.set(entry.creator_profile_id, [
      ...(grouped.get(entry.creator_profile_id) ?? []),
      entry.brand_name,
    ]);
  }

  return grouped;
}

async function loadFreshScorePairKeys(
  context: ScoringContext,
  profileIds: string[],
  brandIds: string[],
) {
  const freshKeys = new Set<string>();

  if (profileIds.length === 0 || brandIds.length === 0) {
    return freshKeys;
  }

  const cutoff = new Date(
    Date.now() - SCORE_CACHE_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();
  const { data, error } = await context.supabase
    .from("brand_fit_scores")
    .select("creator_profile_id,brand_id,deal_type,computed_at")
    .eq("user_id", context.userId)
    .in("creator_profile_id", profileIds)
    .in("brand_id", brandIds)
    .gte("computed_at", cutoff);

  if (error) {
    throw new Error(error.message);
  }

  const dealTypesByPair = new Map<string, Set<string>>();

  for (const score of data ?? []) {
    const key = scorePairKey(score.creator_profile_id, score.brand_id);
    dealTypesByPair.set(key, dealTypesByPair.get(key) ?? new Set<string>());
    dealTypesByPair.get(key)?.add(score.deal_type);
  }

  for (const [key, dealTypes] of dealTypesByPair) {
    if (DEAL_TYPES.every((dealType) => dealTypes.has(dealType))) {
      freshKeys.add(key);
    }
  }

  return freshKeys;
}

function enrichBrandForScoring(
  brand: Tables<"brands">,
  contacts: Tables<"brand_contacts">[],
  signals: BrandSignalSummary,
  pastBrandNames: string[],
): ScoringBrand {
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
    source_signal_kinds: signals.sourceKinds,
    source_signal_evidence_text: signals.evidenceText,
    paid_partnership_signal_count: signals.paidPartnershipSignalCount,
    has_past_brand_work: pastBrandNames.some(
      (name) => normalizeText(name) === normalizedBrandName,
    ),
  };
}

function toScoreInsertRow(input: {
  userId: string;
  profile: ScoringCreatorProfile;
  brand: Tables<"brands">;
  dealType: DealType;
  computedAt: string;
  baseScore: number;
  baseRationale: string[];
  dealScore: number;
  dealRationale: string[];
}): TablesInsert<"brand_fit_scores"> {
  const rationale: ScoreRationaleJson = {
    base_fit_score: input.baseScore,
    base_rationale: input.baseRationale,
    deal_type: input.dealType,
    deal_type_score: input.dealScore,
    deal_type_rationale: input.dealRationale,
    computed_at: input.computedAt,
  };

  return {
    user_id: input.userId,
    creator_profile_id: input.profile.id,
    brand_id: input.brand.id,
    deal_type: input.dealType,
    base_fit_score: input.baseScore,
    deal_type_score: input.dealScore,
    score_rationale_json: rationale as unknown as Json,
    computed_at: input.computedAt,
  };
}

function emptyRankedResult(
  dealType: DealType,
  filters: BrandFilters,
): RankedBrandListResult {
  return {
    rows: [],
    total: 0,
    page: 1,
    pageSize: RANKED_BRAND_PAGE_SIZE,
    totalPages: 1,
    creatorProfileId: null,
    dealType,
    filters: {
      ...filters,
      page: 1,
    },
  };
}

function matchesRankedFilters(row: RankedBrandRow, filters: BrandFilters) {
  const query = filters.query.toLowerCase();

  if (query) {
    const matches =
      row.brand.name.toLowerCase().includes(query) ||
      row.brand.identity_key.toLowerCase().includes(query) ||
      row.brand.aliases.some((alias) => alias.toLowerCase().includes(query));

    if (!matches) {
      return false;
    }
  }

  if (
    filters.categories.length > 0 &&
    !filters.categories.some((category) => row.brand.category.includes(category))
  ) {
    return false;
  }

  if (
    filters.size_estimate &&
    row.brand.size_estimate !== filters.size_estimate
  ) {
    return false;
  }

  if (filters.has_contacts && row.brand.contact_count === 0) {
    return false;
  }

  if (filters.excluded && !row.brand.excluded) {
    return false;
  }

  return true;
}

function readScoreRationale(value: Json): ScoreRationaleJson {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return fallbackRationale();
  }

  const record = value;
  const dealType = readDealType(record.deal_type);

  return {
    base_fit_score:
      typeof record.base_fit_score === "number" ? record.base_fit_score : 0,
    base_rationale: readStringArray(record.base_rationale),
    deal_type: dealType,
    deal_type_score:
      typeof record.deal_type_score === "number" ? record.deal_type_score : 0,
    deal_type_rationale: readStringArray(record.deal_type_rationale),
    computed_at:
      typeof record.computed_at === "string" ? record.computed_at : "",
  };
}

function fallbackRationale(): ScoreRationaleJson {
  return {
    base_fit_score: 0,
    base_rationale: [],
    deal_type: "paid",
    deal_type_score: 0,
    deal_type_rationale: [],
    computed_at: "",
  };
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

function scorePairKey(profileId: string, brandId: string) {
  return `${profileId}:${brandId}`;
}

function normalizeText(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}
