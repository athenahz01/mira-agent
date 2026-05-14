import type { Tables } from "../db/types";
import type { BrandIdentityInput } from "./identity.ts";
import { normalizeDomain, normalizeName } from "./identity.ts";
import type { BrandContext } from "./service.ts";

export const FUZZY_MIN_SCORE = 0.55;

// Conservative first-pass threshold: only near-identical normalized names or
// domains auto-merge without Athena seeing a proposal.
export const FUZZY_AUTO_MERGE_THRESHOLD = 0.92;

// Anything below auto-merge but above this score is close enough to ask Athena.
export const FUZZY_REVIEW_THRESHOLD = 0.78;

export type FuzzyMatchCandidate = {
  brand_id: string;
  score: number;
  matched_field: "name" | "domain";
};

export async function findFuzzyBrandCandidates(
  context: BrandContext,
  input: BrandIdentityInput,
  options: { minScore?: number } = {},
): Promise<FuzzyMatchCandidate[]> {
  const minScore = options.minScore ?? FUZZY_MIN_SCORE;
  const normalizedName = normalizeName(input.name);
  const normalizedDomain = normalizeDomain(input.domain);
  const { data, error } = await context.supabase.rpc("fuzzy_match_brands", {
    p_user_id: context.userId,
    p_name: normalizedName ?? "",
    p_domain: normalizedDomain ?? "",
    p_min_score: minScore,
  });

  if (error) {
    throw new Error(error.message);
  }

  const rpcCandidates = (data ?? [])
    .filter(
      (row): row is FuzzyMatchCandidate =>
        (row.matched_field === "name" || row.matched_field === "domain") &&
        typeof row.score === "number",
    )
    .sort((a, b) => b.score - a.score);
  const localCandidates = await findLocalCandidates(context, {
    name: normalizedName,
    domain: normalizedDomain,
    minScore,
  });

  return combineCandidates([...rpcCandidates, ...localCandidates]);
}

async function findLocalCandidates(
  context: BrandContext,
  input: {
    name: string | null;
    domain: string | null;
    minScore: number;
  },
) {
  const { data, error } = await context.supabase
    .from("brands")
    .select("id,name,domain")
    .eq("user_id", context.userId);

  if (error) {
    throw new Error(error.message);
  }

  const candidates: FuzzyMatchCandidate[] = [];

  for (const brand of data ?? []) {
    const scored = scoreBrand(brand, input);

    if (scored && scored.score >= input.minScore) {
      candidates.push({
        brand_id: brand.id,
        score: scored.score,
        matched_field: scored.matchedField,
      });
    }
  }

  return candidates;
}

function scoreBrand(
  brand: Pick<Tables<"brands">, "name" | "domain">,
  input: {
    name: string | null;
    domain: string | null;
  },
): { score: number; matchedField: "name" | "domain" } | null {
  const scores: { score: number; matchedField: "name" | "domain" }[] = [];
  const brandName = normalizeName(brand.name);
  const brandDomain = normalizeDomain(brand.domain);

  if (input.name && brandName) {
    scores.push({
      score: scoreText(brandName, input.name),
      matchedField: "name",
    });
  }

  if (input.domain && brandDomain) {
    scores.push({
      score: scoreText(brandDomain, input.domain),
      matchedField: "domain",
    });
  }

  return scores.sort((a, b) => b.score - a.score)[0] ?? null;
}

function scoreText(existing: string, incoming: string) {
  if (existing === incoming) {
    return 1;
  }

  const strippedExisting = stripBusinessSuffixes(existing);
  const strippedIncoming = stripBusinessSuffixes(incoming);

  if (strippedExisting === strippedIncoming) {
    return 0.94;
  }

  if (
    strippedExisting.length >= 4 &&
    strippedIncoming.length >= 4 &&
    (strippedExisting.startsWith(strippedIncoming) ||
      strippedIncoming.startsWith(strippedExisting))
  ) {
    const shorter = Math.min(strippedExisting.length, strippedIncoming.length);
    const longer = Math.max(strippedExisting.length, strippedIncoming.length);

    return Math.max(0.78, shorter / longer);
  }

  return diceCoefficient(strippedExisting, strippedIncoming);
}

function stripBusinessSuffixes(value: string) {
  return value
    .replace(/\b(inc|llc|ltd|co|company|corp|corporation)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function diceCoefficient(left: string, right: string) {
  const leftBigrams = bigrams(left);
  const rightBigrams = bigrams(right);

  if (leftBigrams.length === 0 || rightBigrams.length === 0) {
    return 0;
  }

  const rightCounts = new Map<string, number>();

  for (const item of rightBigrams) {
    rightCounts.set(item, (rightCounts.get(item) ?? 0) + 1);
  }

  let intersection = 0;

  for (const item of leftBigrams) {
    const count = rightCounts.get(item) ?? 0;

    if (count > 0) {
      intersection += 1;
      rightCounts.set(item, count - 1);
    }
  }

  return (2 * intersection) / (leftBigrams.length + rightBigrams.length);
}

function bigrams(value: string) {
  const normalized = ` ${value} `;
  const items: string[] = [];

  for (let index = 0; index < normalized.length - 1; index += 1) {
    items.push(normalized.slice(index, index + 2));
  }

  return items;
}

function combineCandidates(candidates: FuzzyMatchCandidate[]) {
  const byBrand = new Map<string, FuzzyMatchCandidate>();

  for (const candidate of candidates) {
    const existing = byBrand.get(candidate.brand_id);

    if (!existing || candidate.score > existing.score) {
      byBrand.set(candidate.brand_id, candidate);
    }
  }

  return [...byBrand.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
}
