import Papa from "papaparse";
import type { SupabaseClient } from "@supabase/supabase-js";

import type {
  Database,
  Json,
  Tables,
  TablesInsert,
  TablesUpdate,
} from "../db/types";
import type { PageScrapeJobSummary } from "../jobs/brand-page-scrape";
import {
  brandIdentityCandidates,
  brandIdentityKey,
  identityKeyRank,
  normalizeDomain,
  normalizeHandle,
} from "./identity.ts";
import {
  findFuzzyBrandCandidates,
  FUZZY_AUTO_MERGE_THRESHOLD,
  FUZZY_REVIEW_THRESHOLD,
  type FuzzyMatchCandidate,
} from "./fuzzy.ts";
import {
  brandCsvHeaders,
  brandFiltersSchema,
  brandFormSchema,
  brandSizeEstimateSchema,
  brandUpdateSchema,
  csvBrandRowSchema,
  type BrandFilters,
  type BrandFormInput,
  type BrandFormValues,
  type BrandUpdateInput,
  type BrandUpdateValues,
  type CsvBrandRow,
} from "./schemas.ts";

export const CSV_IMPORT_ROW_CAP = 500;
export const BRAND_PAGE_SIZE = 25;

export type BrandContext = {
  supabase: SupabaseClient<Database>;
  userId: string;
};

export type BrandMatchSource =
  | "manual_seed"
  | "csv_import"
  | "instagram_scrape";

export type FindOrCreateBrandResult =
  | {
      brand: Tables<"brands">;
      created: boolean;
      promoted: boolean;
      auto_merged?: boolean;
      queued_for_review?: false;
    }
  | {
      brand: null;
      created: false;
      promoted: false;
      queued_for_review: true;
      proposal_id: string;
    };

export type CsvImportResult = {
  created: number;
  merged: number;
  queued_for_review: number;
  skipped: { row_number: number; reason: string }[];
};

export type BrandListRow = Tables<"brands"> & {
  has_contacts: boolean;
  contact_count: number;
  contacts: Tables<"brand_contacts">[];
  page_scrape_job: PageScrapeJobSummary | null;
};

export type BrandListResult = {
  brands: BrandListRow[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  categoryOptions: string[];
  unenrichedHunterCount: number;
  openMatchProposalCount: number;
  filters: BrandFilters;
};

export type BrandPoolSummary = {
  total: number;
  excluded: number;
  openMatchProposals: number;
  totalContacts: number;
  brandsWithContacts: number;
  topCategories: { category: string; count: number }[];
};

export type BrandMatchProposalWithCandidates =
  Tables<"brand_match_proposals"> & {
    candidates: Tables<"brands">[];
  };

export type BrandMatchProposalResolution =
  | { action: "merge_into"; candidateId: string }
  | { action: "create_new" }
  | { action: "dismiss" };

export async function findOrCreateBrand(
  context: BrandContext,
  input: BrandFormInput,
  options: {
    source?: BrandMatchSource;
    skipFuzzy?: boolean;
  } = {},
): Promise<FindOrCreateBrandResult> {
  const values = normalizeBrandValues(brandFormSchema.parse(input));
  const primaryIdentityKey = brandIdentityKey(values);
  const candidates = brandIdentityCandidates(values);
  const candidateKeys = candidates.map((candidate) => candidate.key);

  const { data: existingRows, error: lookupError } = await context.supabase
    .from("brands")
    .select("*")
    .eq("user_id", context.userId)
    .in("identity_key", candidateKeys);

  if (lookupError) {
    throw new Error(lookupError.message);
  }

  const existing =
    pickExistingBrand(existingRows ?? [], candidateKeys) ??
    (await findByStoredIdentityFields(context, values));

  if (existing) {
    return mergeExistingBrand(context, existing, values, primaryIdentityKey);
  }

  if (!options.skipFuzzy) {
    const fuzzyCandidates = await findFuzzyBrandCandidates(context, values);
    const topCandidate = fuzzyCandidates[0];

    if (topCandidate && topCandidate.score >= FUZZY_AUTO_MERGE_THRESHOLD) {
      const candidateBrand = await loadBrand(context, topCandidate.brand_id);
      const result = await mergeExistingBrand(
        context,
        candidateBrand,
        values,
        primaryIdentityKey,
      );

      return {
        ...result,
        auto_merged: true,
      };
    }

    if (topCandidate && topCandidate.score >= FUZZY_REVIEW_THRESHOLD) {
      const proposal = await createBrandMatchProposal(context, {
        incoming: input,
        candidates: fuzzyCandidates.slice(0, 3),
        source: options.source ?? "manual_seed",
      });

      return {
        brand: null,
        created: false,
        promoted: false,
        queued_for_review: true,
        proposal_id: proposal.id,
      };
    }
  }

  return createBrand(context, primaryIdentityKey, values);
}

async function createBrand(
  context: BrandContext,
  primaryIdentityKey: string,
  values: ReturnType<typeof normalizeBrandValues<BrandFormValues>>,
) {
  const { data, error } = await context.supabase
    .from("brands")
    .insert(toBrandInsert(context.userId, primaryIdentityKey, values))
    .select("*")
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? "Could not create brand.");
  }

  return {
    brand: data,
    created: true,
    promoted: false,
  };
}

async function mergeExistingBrand(
  context: BrandContext,
  existing: Tables<"brands">,
  values: ReturnType<typeof normalizeBrandValues<BrandFormValues>>,
  primaryIdentityKey: string,
) {
  const promoted =
    primaryIdentityKey !== existing.identity_key &&
    identityKeyRank(primaryIdentityKey) < identityKeyRank(existing.identity_key);
  const payload = mergeBrand(existing, values, promoted ? primaryIdentityKey : null);
  const { data, error } = await context.supabase
    .from("brands")
    .update(payload)
    .eq("id", existing.id)
    .eq("user_id", context.userId)
    .select("*")
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? "Could not merge brand.");
  }

  return {
    brand: data,
    created: false,
    promoted,
  };
}

async function loadBrand(
  context: BrandContext,
  brandId: string,
): Promise<Tables<"brands">> {
  const { data, error } = await context.supabase
    .from("brands")
    .select("*")
    .eq("id", brandId)
    .eq("user_id", context.userId)
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? "Brand not found.");
  }

  return data;
}

async function createBrandMatchProposal(
  context: BrandContext,
  input: {
    incoming: BrandFormInput;
    candidates: FuzzyMatchCandidate[];
    source: BrandMatchSource;
  },
): Promise<Tables<"brand_match_proposals">> {
  const normalizedScores = input.candidates.map((candidate) =>
    Number(candidate.score.toFixed(4)),
  );
  const { data, error } = await context.supabase
    .from("brand_match_proposals")
    .insert({
      user_id: context.userId,
      incoming_payload_json: brandFormSchema.parse(input.incoming) as Json,
      candidate_brand_ids: input.candidates.map(
        (candidate) => candidate.brand_id,
      ),
      candidate_scores: normalizedScores,
      source: input.source,
      status: "open",
    })
    .select("*")
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? "Could not queue brand match proposal.");
  }

  return data;
}

export async function addBrandManualForUser(
  context: BrandContext,
  input: BrandFormInput,
): Promise<FindOrCreateBrandResult> {
  const result = await findOrCreateBrand(context, input, {
    source: "manual_seed",
  });

  if (result.brand) {
    await insertSourceSignal(context, {
      brandId: result.brand.id,
      signalType: "manual_seed",
      evidence: brandFormSchema.parse(input),
    });
  }

  return result;
}

export async function addBrandsFromCsvForUser(
  context: BrandContext,
  csvText: string,
): Promise<CsvImportResult> {
  const parsed = Papa.parse<Record<string, string>>(csvText, {
    header: true,
    skipEmptyLines: "greedy",
  });
  const skipped: CsvImportResult["skipped"] = [];

  if (parsed.errors.length > 0) {
    skipped.push(
      ...parsed.errors.map((error) => ({
        row_number: (error.row ?? 0) + 2,
        reason: error.message,
      })),
    );
  }

  const headers = parsed.meta.fields ?? [];
  const missingHeaders = brandCsvHeaders.filter(
    (header) => !headers.includes(header),
  );

  if (missingHeaders.length > 0) {
    return {
      created: 0,
      merged: 0,
      queued_for_review: 0,
      skipped: [
        {
          row_number: 1,
          reason: `Missing required headers: ${missingHeaders.join(", ")}`,
        },
      ],
    };
  }

  let created = 0;
  let merged = 0;
  let queuedForReview = 0;
  const rowsToProcess = parsed.data.slice(0, CSV_IMPORT_ROW_CAP);

  if (parsed.data.length > CSV_IMPORT_ROW_CAP) {
    skipped.push(
      ...parsed.data.slice(CSV_IMPORT_ROW_CAP).map((_, index) => ({
        row_number: CSV_IMPORT_ROW_CAP + index + 2,
        reason: `CSV imports are capped at ${CSV_IMPORT_ROW_CAP} rows.`,
      })),
    );
  }

  for (const [index, row] of rowsToProcess.entries()) {
    const rowNumber = index + 2;
    const rowResult = csvBrandRowSchema.safeParse(row);

    if (!rowResult.success) {
      skipped.push({
        row_number: rowNumber,
        reason: rowResult.error.issues
          .map((issue) => issue.message)
          .join("; "),
      });
      continue;
    }

    const inputResult = csvRowToBrandInput(rowResult.data);

    if (!inputResult.ok) {
      skipped.push({
        row_number: rowNumber,
        reason: inputResult.reason,
      });
      continue;
    }

    try {
      const result = await findOrCreateBrand(context, inputResult.input, {
        source: "csv_import",
      });

      if (result.queued_for_review) {
        queuedForReview += 1;
      } else if (result.created) {
        created += 1;
      } else {
        merged += 1;
      }

      if (result.brand) {
        await insertSourceSignal(context, {
          brandId: result.brand.id,
          signalType: "csv_import",
          evidence: rowResult.data,
        });
      }
    } catch (error) {
      skipped.push({
        row_number: rowNumber,
        reason: error instanceof Error ? error.message : "Unknown import error",
      });
    }
  }

  return {
    created,
    merged,
    queued_for_review: queuedForReview,
    skipped,
  };
}

export async function updateBrandForUser(
  context: BrandContext,
  brandId: string,
  input: BrandUpdateInput,
): Promise<Tables<"brands">> {
  const values = normalizeBrandValues(brandUpdateSchema.parse(input));
  const identity_key = brandIdentityKey(values);
  const { data, error } = await context.supabase
    .from("brands")
    .update({
      name: values.name,
      aliases: values.aliases,
      domain: values.domain,
      instagram_handle: values.instagram_handle,
      tiktok_handle: values.tiktok_handle,
      category: values.category,
      aesthetic_tags: values.aesthetic_tags,
      size_estimate: values.size_estimate,
      pays_creators: values.pays_creators,
      source_signals_summary: values.notes || null,
      excluded: values.excluded,
      exclusion_reason: values.excluded ? values.exclusion_reason ?? null : null,
      identity_key,
    })
    .eq("id", brandId)
    .eq("user_id", context.userId)
    .select("*")
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? "Could not update brand.");
  }

  return data;
}

export async function toggleBrandExcludedForUser(
  context: BrandContext,
  brandId: string,
  excluded: boolean,
  reason?: string | null,
): Promise<Tables<"brands">> {
  const { data, error } = await context.supabase
    .from("brands")
    .update({
      excluded,
      exclusion_reason: excluded ? reason?.trim() || null : null,
    })
    .eq("id", brandId)
    .eq("user_id", context.userId)
    .select("*")
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? "Could not update brand exclusion.");
  }

  return data;
}

export async function listOpenBrandMatchProposals(
  context: BrandContext,
): Promise<BrandMatchProposalWithCandidates[]> {
  const { data: proposals, error } = await context.supabase
    .from("brand_match_proposals")
    .select("*")
    .eq("user_id", context.userId)
    .eq("status", "open")
    .order("created_at", {
      ascending: false,
    });

  if (error) {
    throw new Error(error.message);
  }

  const candidateIds = uniqueSorted(
    (proposals ?? []).flatMap((proposal) => proposal.candidate_brand_ids),
  );
  const { data: candidates, error: candidatesError } =
    candidateIds.length > 0
      ? await context.supabase
          .from("brands")
          .select("*")
          .eq("user_id", context.userId)
          .in("id", candidateIds)
      : { data: [], error: null };

  if (candidatesError) {
    throw new Error(candidatesError.message);
  }

  const brandsById = new Map(
    (candidates ?? []).map((candidate) => [candidate.id, candidate]),
  );

  return (proposals ?? []).map((proposal) => ({
    ...proposal,
    candidates: proposal.candidate_brand_ids
      .map((brandId) => brandsById.get(brandId))
      .filter((brand): brand is Tables<"brands"> => Boolean(brand)),
  }));
}

export async function resolveBrandMatchProposalForUser(
  context: BrandContext,
  proposalId: string,
  resolution: BrandMatchProposalResolution,
): Promise<Tables<"brand_match_proposals">> {
  const { data: proposal, error } = await context.supabase
    .from("brand_match_proposals")
    .select("*")
    .eq("id", proposalId)
    .eq("user_id", context.userId)
    .eq("status", "open")
    .single();

  if (error || !proposal) {
    throw new Error(error?.message ?? "Brand match proposal not found.");
  }

  if (resolution.action === "dismiss") {
    return updateProposalResolution(context, proposal.id, {
      status: "dismissed",
      resolved_brand_id: null,
    });
  }

  const incoming = brandFormSchema.parse(proposal.incoming_payload_json);
  let resolvedBrand: Tables<"brands">;

  if (resolution.action === "merge_into") {
    if (!proposal.candidate_brand_ids.includes(resolution.candidateId)) {
      throw new Error("Choose one of the proposed candidate brands.");
    }

    const candidateBrand = await loadBrand(context, resolution.candidateId);
    const values = normalizeBrandValues(incoming);
    const primaryIdentityKey = brandIdentityKey(values);
    const result = await mergeExistingBrand(
      context,
      candidateBrand,
      values,
      primaryIdentityKey,
    );
    resolvedBrand = result.brand;
  } else {
    const result = await findOrCreateBrand(context, incoming, {
      skipFuzzy: true,
      source: readBrandMatchSource(proposal.source),
    });

    if (!result.brand) {
      throw new Error("Could not create brand from proposal.");
    }

    resolvedBrand = result.brand;
  }

  return updateProposalResolution(context, proposal.id, {
    status: resolution.action === "merge_into" ? "merged_into" : "created_new",
    resolved_brand_id: resolvedBrand.id,
  });
}

async function updateProposalResolution(
  context: BrandContext,
  proposalId: string,
  values: Pick<
    TablesUpdate<"brand_match_proposals">,
    "status" | "resolved_brand_id"
  >,
): Promise<Tables<"brand_match_proposals">> {
  const { data, error } = await context.supabase
    .from("brand_match_proposals")
    .update({
      ...values,
      resolved_at: new Date().toISOString(),
      resolved_by: context.userId,
    })
    .eq("id", proposalId)
    .eq("user_id", context.userId)
    .select("*")
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? "Could not resolve proposal.");
  }

  return data;
}

export async function listBrandsForUser(
  context: BrandContext,
  rawFilters: Partial<BrandFilters>,
): Promise<BrandListResult> {
  const filters = brandFiltersSchema.parse(rawFilters);
  const [
    { data: brands, error: brandsError },
    contactsResult,
    signalsResult,
    jobsResult,
    proposalsResult,
  ] = await Promise.all([
      context.supabase
        .from("brands")
        .select("*")
        .eq("user_id", context.userId),
      context.supabase
        .from("brand_contacts")
        .select("*")
        .eq("user_id", context.userId),
      context.supabase
        .from("source_signals")
        .select("brand_id")
        .eq("user_id", context.userId)
        .eq("signal_type", "hunter_enrichment"),
      context.supabase
        .from("jobs")
        .select(
          "id,status,payload_json,result_json,error_message,created_at,started_at,finished_at",
        )
        .eq("user_id", context.userId)
        .eq("kind", "page_scrape")
        .in("status", ["queued", "running"])
        .order("created_at", {
          ascending: false,
        }),
      context.supabase
        .from("brand_match_proposals")
        .select("id", {
          count: "exact",
          head: true,
        })
        .eq("user_id", context.userId)
        .eq("status", "open"),
    ]);

  if (brandsError) {
    throw new Error(brandsError.message);
  }

  if (contactsResult.error) {
    throw new Error(contactsResult.error.message);
  }

  if (signalsResult.error) {
    throw new Error(signalsResult.error.message);
  }

  if (jobsResult.error) {
    throw new Error(jobsResult.error.message);
  }

  if (proposalsResult.error) {
    throw new Error(proposalsResult.error.message);
  }

  const contactsByBrandId = groupContactsByBrand(contactsResult.data ?? []);
  const activePageScrapeJobsByBrandId = groupPageScrapeJobsByBrand(
    jobsResult.data ?? [],
  );
  const hunterEnrichedBrandIds = new Set(
    (signalsResult.data ?? []).map((signal) => signal.brand_id),
  );
  const categoryOptions = uniqueSorted(
    (brands ?? []).flatMap((brand) => brand.category),
  );
  const filtered = applyBrandFilters(
    (brands ?? []).map((brand) => ({
      ...brand,
      contacts: sortContacts(contactsByBrandId.get(brand.id) ?? []),
      contact_count: contactsByBrandId.get(brand.id)?.length ?? 0,
      has_contacts: (contactsByBrandId.get(brand.id)?.length ?? 0) > 0,
      page_scrape_job: activePageScrapeJobsByBrandId.get(brand.id) ?? null,
    })),
    filters,
  );
  const sorted = sortBrands(filtered, filters);
  const total = sorted.length;
  const totalPages = Math.max(1, Math.ceil(total / BRAND_PAGE_SIZE));
  const page = Math.min(filters.page, totalPages);
  const start = (page - 1) * BRAND_PAGE_SIZE;

  return {
    brands: sorted.slice(start, start + BRAND_PAGE_SIZE),
    total,
    page,
    pageSize: BRAND_PAGE_SIZE,
    totalPages,
    categoryOptions,
    unenrichedHunterCount: (brands ?? []).filter(
      (brand) => brand.domain && !hunterEnrichedBrandIds.has(brand.id),
    ).length,
    openMatchProposalCount: proposalsResult.count ?? 0,
    filters: {
      ...filters,
      page,
    },
  };
}

export async function getBrandPoolSummary(
  context: BrandContext,
): Promise<BrandPoolSummary> {
  const [{ data, error }, proposalsResult] = await Promise.all([
    context.supabase
      .from("brands")
      .select("id,category,excluded")
      .eq("user_id", context.userId),
    context.supabase
      .from("brand_match_proposals")
      .select("id", {
        count: "exact",
        head: true,
      })
      .eq("user_id", context.userId)
      .eq("status", "open"),
  ]);

  if (error) {
    throw new Error(error.message);
  }

  if (proposalsResult.error) {
    throw new Error(proposalsResult.error.message);
  }

  const categoryCounts = new Map<string, number>();

  for (const brand of data ?? []) {
    for (const category of brand.category) {
      categoryCounts.set(category, (categoryCounts.get(category) ?? 0) + 1);
    }
  }

  const { data: contacts, error: contactsError } = await context.supabase
    .from("brand_contacts")
    .select("brand_id")
    .eq("user_id", context.userId);

  if (contactsError) {
    throw new Error(contactsError.message);
  }

  const contactBrandIds = new Set(
    (contacts ?? []).map((contact) => contact.brand_id),
  );

  return {
    total: data?.length ?? 0,
    excluded: (data ?? []).filter((brand) => brand.excluded).length,
    openMatchProposals: proposalsResult.count ?? 0,
    totalContacts: contacts?.length ?? 0,
    brandsWithContacts: contactBrandIds.size,
    topCategories: [...categoryCounts.entries()]
      .map(([category, count]) => ({ category, count }))
      .sort((a, b) => b.count - a.count || a.category.localeCompare(b.category))
      .slice(0, 5),
  };
}

function groupContactsByBrand(contacts: Tables<"brand_contacts">[]) {
  const grouped = new Map<string, Tables<"brand_contacts">[]>();

  for (const contact of contacts) {
    const existing = grouped.get(contact.brand_id) ?? [];
    existing.push(contact);
    grouped.set(contact.brand_id, existing);
  }

  return grouped;
}

function sortContacts(contacts: Tables<"brand_contacts">[]) {
  return [...contacts].sort(
    (a, b) =>
      (b.confidence ?? -1) - (a.confidence ?? -1) ||
      a.email.localeCompare(b.email),
  );
}

function groupPageScrapeJobsByBrand(jobs: PageScrapeJobSummary[]) {
  const grouped = new Map<string, PageScrapeJobSummary>();

  for (const job of jobs) {
    const brandId = readBrandIdFromJobPayload(job.payload_json);

    if (!brandId || grouped.has(brandId)) {
      continue;
    }

    grouped.set(brandId, job);
  }

  return grouped;
}

function readBrandIdFromJobPayload(payload: Json) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }

  const brandId = payload.brand_id;

  return typeof brandId === "string" ? brandId : null;
}

export async function insertSourceSignal(
  context: BrandContext,
  input: {
    brandId: string;
    signalType: string;
    evidence: unknown;
  },
) {
  const { error } = await context.supabase.from("source_signals").insert({
    user_id: context.userId,
    brand_id: input.brandId,
    signal_type: input.signalType,
    evidence_json: input.evidence as Json,
    weight: 1,
  });

  if (error) {
    throw new Error(error.message);
  }
}

function normalizeBrandValues<T extends BrandFormValues | BrandUpdateValues>(
  values: T,
) {
  return {
    ...values,
    domain: normalizeDomain(values.domain) ?? null,
    instagram_handle: normalizeHandle(values.instagram_handle, "instagram"),
    tiktok_handle: normalizeHandle(values.tiktok_handle, "tiktok"),
  };
}

async function findByStoredIdentityFields(
  context: BrandContext,
  values: ReturnType<typeof normalizeBrandValues<BrandFormValues>>,
): Promise<Tables<"brands"> | null> {
  const { data, error } = await context.supabase
    .from("brands")
    .select("*")
    .eq("user_id", context.userId);

  if (error) {
    throw new Error(error.message);
  }

  const rows = data ?? [];

  if (values.domain) {
    const match = rows.find((row) => row.domain === values.domain);

    if (match) {
      return match;
    }
  }

  if (values.instagram_handle) {
    const match = rows.find(
      (row) => row.instagram_handle === values.instagram_handle,
    );

    if (match) {
      return match;
    }
  }

  if (values.tiktok_handle) {
    const match = rows.find(
      (row) => row.tiktok_handle === values.tiktok_handle,
    );

    if (match) {
      return match;
    }
  }

  return null;
}

function pickExistingBrand(
  rows: Tables<"brands">[],
  candidateKeys: string[],
): Tables<"brands"> | null {
  for (const key of candidateKeys) {
    const match = rows.find((row) => row.identity_key === key);

    if (match) {
      return match;
    }
  }

  return null;
}

function toBrandInsert(
  userId: string,
  identityKey: string,
  values: ReturnType<typeof normalizeBrandValues<BrandFormValues>>,
): TablesInsert<"brands"> {
  return {
    user_id: userId,
    identity_key: identityKey,
    name: values.name,
    aliases: [],
    domain: values.domain,
    instagram_handle: values.instagram_handle,
    tiktok_handle: values.tiktok_handle,
    category: values.category,
    aesthetic_tags: values.aesthetic_tags,
    size_estimate: values.size_estimate,
    pays_creators: values.pays_creators,
    source_signals_summary: values.notes || null,
  };
}

function mergeBrand(
  existing: Tables<"brands">,
  values: ReturnType<typeof normalizeBrandValues<BrandFormValues>>,
  promotedIdentityKey: string | null,
): TablesUpdate<"brands"> {
  return {
    identity_key: promotedIdentityKey ?? existing.identity_key,
    name: existing.name || values.name,
    aliases: mergeAliases(existing, values.name),
    domain: existing.domain ?? values.domain,
    instagram_handle: existing.instagram_handle ?? values.instagram_handle,
    tiktok_handle: existing.tiktok_handle ?? values.tiktok_handle,
    category: uniqueSorted([...existing.category, ...values.category]),
    aesthetic_tags: uniqueSorted([
      ...existing.aesthetic_tags,
      ...values.aesthetic_tags,
    ]),
    size_estimate: existing.size_estimate ?? values.size_estimate,
    pays_creators: existing.pays_creators ?? values.pays_creators,
    source_signals_summary:
      (existing.source_signals_summary ?? values.notes) || null,
  };
}

function mergeAliases(existing: Tables<"brands">, incomingName: string) {
  const incomingIsCanonical =
    existing.name.trim().toLowerCase() === incomingName.trim().toLowerCase();

  return incomingIsCanonical
    ? existing.aliases
    : unionText(existing.aliases, [incomingName]);
}

function unionText(base: string[], additions: string[]) {
  const byLowercase = new Map<string, string>();

  for (const item of [...base, ...additions]) {
    const trimmed = item.trim();

    if (trimmed) {
      byLowercase.set(trimmed.toLowerCase(), trimmed);
    }
  }

  return [...byLowercase.values()].sort((a, b) => a.localeCompare(b));
}

function uniqueSorted(items: string[]) {
  return unionText([], items);
}

function csvRowToBrandInput(
  row: CsvBrandRow,
):
  | { ok: true; input: BrandFormInput }
  | { ok: false; reason: string } {
  const paysCreators = parsePaysCreators(row.pays_creators);

  if (!paysCreators.ok) {
    return paysCreators;
  }

  const sizeEstimateResult = row.size_estimate
    ? brandSizeEstimateSchema.safeParse(row.size_estimate)
    : null;

  if (sizeEstimateResult && !sizeEstimateResult.success) {
    return {
      ok: false,
      reason: `Invalid size_estimate: ${row.size_estimate}`,
    };
  }

  return {
    ok: true,
    input: {
      name: row.name,
      domain: row.domain,
      instagram_handle: row.instagram_handle,
      tiktok_handle: row.tiktok_handle,
      category: splitCell(row.category),
      aesthetic_tags: splitCell(row.aesthetic_tags),
      size_estimate: sizeEstimateResult?.data ?? null,
      pays_creators: paysCreators.value,
      notes: row.notes,
    },
  };
}

function parsePaysCreators(
  value: string,
): { ok: true; value: boolean | null } | { ok: false; reason: string } {
  const normalized = value.trim().toLowerCase();

  if (!normalized) {
    return { ok: true, value: null };
  }

  if (normalized === "yes") {
    return { ok: true, value: true };
  }

  if (normalized === "no") {
    return { ok: true, value: false };
  }

  return {
    ok: false,
    reason: `Invalid pays_creators value: ${value}`,
  };
}

function splitCell(value: string) {
  return value
    .split(";")
    .map((item) => item.trim())
    .filter(Boolean);
}

function readBrandMatchSource(source: string): BrandMatchSource {
  if (
    source === "manual_seed" ||
    source === "csv_import" ||
    source === "instagram_scrape"
  ) {
    return source;
  }

  return "manual_seed";
}

function applyBrandFilters(rows: BrandListRow[], filters: BrandFilters) {
  const query = filters.query.toLowerCase();

  return rows.filter((brand) => {
    if (query) {
      const matchesSearch =
        brand.name.toLowerCase().includes(query) ||
        brand.identity_key.toLowerCase().includes(query) ||
        brand.aliases.some((alias) => alias.toLowerCase().includes(query));

      if (!matchesSearch) {
        return false;
      }
    }

    if (
      filters.categories.length > 0 &&
      !filters.categories.some((category) => brand.category.includes(category))
    ) {
      return false;
    }

    if (filters.size_estimate && brand.size_estimate !== filters.size_estimate) {
      return false;
    }

    if (filters.has_contacts && !brand.has_contacts) {
      return false;
    }

    if (filters.excluded && !brand.excluded) {
      return false;
    }

    return true;
  });
}

function sortBrands(rows: BrandListRow[], filters: BrandFilters) {
  return [...rows].sort((a, b) => {
    const direction = filters.direction === "asc" ? 1 : -1;

    if (filters.sort === "name") {
      return a.name.localeCompare(b.name) * direction;
    }

    return (
      (new Date(a.created_at).getTime() - new Date(b.created_at).getTime()) *
      direction
    );
  });
}

export const brandCsvTemplate = `${brandCsvHeaders.join(",")}
Glossier,glossier.com,@glossier,,beauty;skincare,clean;minimal,established-dtc,yes,Known creator-friendly beauty brand
Tower 28,tower28beauty.com,@tower28beauty,,beauty;skincare,beachy;inclusive,indie-medium,yes,
`;
