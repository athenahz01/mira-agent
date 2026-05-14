import Papa from "papaparse";
import type { SupabaseClient } from "@supabase/supabase-js";

import type {
  Database,
  Json,
  Tables,
  TablesInsert,
  TablesUpdate,
} from "../db/types";
import {
  brandIdentityCandidates,
  brandIdentityKey,
  identityKeyRank,
  normalizeDomain,
  normalizeHandle,
} from "./identity.ts";
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

export type FindOrCreateBrandResult = {
  brand: Tables<"brands">;
  created: boolean;
  promoted: boolean;
};

export type CsvImportResult = {
  created: number;
  merged: number;
  skipped: { row_number: number; reason: string }[];
};

export type BrandListRow = Tables<"brands"> & {
  has_contacts: boolean;
};

export type BrandListResult = {
  brands: BrandListRow[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  categoryOptions: string[];
  filters: BrandFilters;
};

export type BrandPoolSummary = {
  total: number;
  excluded: number;
  topCategories: { category: string; count: number }[];
};

export async function findOrCreateBrand(
  context: BrandContext,
  input: BrandFormInput,
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

  if (!existing) {
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

export async function addBrandManualForUser(
  context: BrandContext,
  input: BrandFormInput,
): Promise<FindOrCreateBrandResult> {
  const result = await findOrCreateBrand(context, input);
  await insertSourceSignal(context, {
    brandId: result.brand.id,
    signalType: "manual_seed",
    evidence: brandFormSchema.parse(input),
  });

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
      const result = await findOrCreateBrand(context, inputResult.input);
      await insertSourceSignal(context, {
        brandId: result.brand.id,
        signalType: "csv_import",
        evidence: rowResult.data,
      });

      if (result.created) {
        created += 1;
      } else {
        merged += 1;
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

export async function listBrandsForUser(
  context: BrandContext,
  rawFilters: Partial<BrandFilters>,
): Promise<BrandListResult> {
  const filters = brandFiltersSchema.parse(rawFilters);
  const [{ data: brands, error: brandsError }, contactsResult] =
    await Promise.all([
      context.supabase
        .from("brands")
        .select("*")
        .eq("user_id", context.userId),
      context.supabase
        .from("brand_contacts")
        .select("brand_id")
        .eq("user_id", context.userId),
    ]);

  if (brandsError) {
    throw new Error(brandsError.message);
  }

  if (contactsResult.error) {
    throw new Error(contactsResult.error.message);
  }

  const contactBrandIds = new Set(
    (contactsResult.data ?? []).map((contact) => contact.brand_id),
  );
  const categoryOptions = uniqueSorted(
    (brands ?? []).flatMap((brand) => brand.category),
  );
  const filtered = applyBrandFilters(
    (brands ?? []).map((brand) => ({
      ...brand,
      has_contacts: contactBrandIds.has(brand.id),
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
    filters: {
      ...filters,
      page,
    },
  };
}

export async function getBrandPoolSummary(
  context: BrandContext,
): Promise<BrandPoolSummary> {
  const { data, error } = await context.supabase
    .from("brands")
    .select("category,excluded")
    .eq("user_id", context.userId);

  if (error) {
    throw new Error(error.message);
  }

  const categoryCounts = new Map<string, number>();

  for (const brand of data ?? []) {
    for (const category of brand.category) {
      categoryCounts.set(category, (categoryCounts.get(category) ?? 0) + 1);
    }
  }

  return {
    total: data?.length ?? 0,
    excluded: (data ?? []).filter((brand) => brand.excluded).length,
    topCategories: [...categoryCounts.entries()]
      .map(([category, count]) => ({ category, count }))
      .sort((a, b) => b.count - a.count || a.category.localeCompare(b.category))
      .slice(0, 5),
  };
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
