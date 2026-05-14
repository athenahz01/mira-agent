import type { Tables } from "@/lib/db/types";

export const DEAL_TYPES = [
  "paid",
  "gifting",
  "affiliate",
  "ugc",
  "ambassador",
] as const;

export type DealType = (typeof DEAL_TYPES)[number];

export type ScoringCreatorProfile = Pick<
  Tables<"creator_profiles">,
  | "id"
  | "handle"
  | "tier"
  | "niche_tags"
  | "aesthetic_keywords"
  | "recent_post_themes"
>;

export type ScoringBrand = Tables<"brands"> & {
  contacts_count: number;
  contact_roles: string[];
  has_hunter_contacts: boolean;
  has_page_scrape_contacts: boolean;
  source_signal_kinds: string[];
  source_signal_evidence_text: string;
  paid_partnership_signal_count: number;
  has_past_brand_work: boolean;
};

export type ScoringInputs = {
  creatorProfile: ScoringCreatorProfile;
  brand: ScoringBrand;
};

export type DealTypeScore = {
  score: number;
  rationale: string[];
};

export type ScoringResult = {
  base_fit_score: number;
  base_rationale: string[];
  deal_type_scores: Record<DealType, DealTypeScore>;
};

export const BASE_SCORE_START = 50;

export const SCORING_WEIGHTS = {
  aestheticOverlap: 20,
  nicheOverlap: 15,
  hasDomain: 10,
  hasContacts: 5,
  multiSourceSignal: 5,
  excluded: -10,
  unknownSize: -10,
  macroIndieMismatch: -20,
  paidPaysCreators: 20,
  paidPartnershipSignal: 15,
  paidPreLaunch: -15,
  paidNoContacts: -10,
  paidLegacyMicroMismatch: -15,
  giftingPrSignal: 15,
  giftingIndieStage: 5,
  giftingPreLaunch: -15,
  affiliateSignal: 20,
  affiliatePreLaunch: -10,
  ugcMarketingContact: 15,
  ugcAuthenticAesthetic: 10,
  ugcLongFormPenalty: -5,
  ambassadorStartPenalty: -10,
  ambassadorPastWork: 20,
  ambassadorStrongAestheticOverlap: 10,
  ambassadorNoContacts: -20,
} as const;

export function scoreBrand(input: ScoringInputs): ScoringResult {
  const baseRationale: string[] = [];
  let base = BASE_SCORE_START;
  baseRationale.push(`Start at ${BASE_SCORE_START} neutral fit`);

  const aestheticOverlap = intersection(
    input.brand.aesthetic_tags,
    input.creatorProfile.aesthetic_keywords,
  );
  const nicheOverlap = intersection(
    input.brand.category,
    input.creatorProfile.niche_tags,
  );

  if (aestheticOverlap.length > 0) {
    base += SCORING_WEIGHTS.aestheticOverlap;
    baseRationale.push(
      `+20 aesthetic overlap: ${aestheticOverlap.join(", ")}`,
    );
  }

  if (nicheOverlap.length > 0) {
    base += SCORING_WEIGHTS.nicheOverlap;
    baseRationale.push(`+15 niche/category overlap: ${nicheOverlap.join(", ")}`);
  }

  if (input.brand.domain) {
    base += SCORING_WEIGHTS.hasDomain;
    baseRationale.push("+10 brand has a domain");
  }

  if (input.brand.contacts_count > 0) {
    base += SCORING_WEIGHTS.hasContacts;
    baseRationale.push("+5 contact available");
  }

  if (input.brand.source_signal_kinds.length > 1) {
    const boost =
      SCORING_WEIGHTS.multiSourceSignal *
      (input.brand.source_signal_kinds.length - 1);
    base += boost;
    baseRationale.push(
      `+${boost} multi-source signal (${input.brand.source_signal_kinds.length} sources)`,
    );
  }

  if (input.brand.excluded) {
    base += SCORING_WEIGHTS.excluded;
    baseRationale.push("-10 brand is excluded");
  }

  if (!input.brand.size_estimate) {
    base += SCORING_WEIGHTS.unknownSize;
    baseRationale.push("-10 size estimate unknown");
  }

  if (
    input.creatorProfile.tier === "macro" &&
    (input.brand.size_estimate === "pre-launch" ||
      input.brand.size_estimate === "indie-small")
  ) {
    base += SCORING_WEIGHTS.macroIndieMismatch;
    baseRationale.push("-20 macro creator vs. very small brand");
  }

  const base_fit_score = clampScore(base);

  return {
    base_fit_score,
    base_rationale: baseRationale,
    deal_type_scores: {
      paid: scorePaid(input, base_fit_score),
      gifting: scoreGifting(input, base_fit_score),
      affiliate: scoreAffiliate(input, base_fit_score),
      ugc: scoreUgc(input, base_fit_score, aestheticOverlap),
      ambassador: scoreAmbassador(input, base_fit_score, aestheticOverlap),
    },
  };
}

function scorePaid(input: ScoringInputs, base: number): DealTypeScore {
  const rationale: string[] = [];
  let score = base;

  if (input.brand.pays_creators === true) {
    score += SCORING_WEIGHTS.paidPaysCreators;
    rationale.push("+20 brand signals it pays creators");
  }

  if (input.brand.paid_partnership_signal_count > 0) {
    score += SCORING_WEIGHTS.paidPartnershipSignal;
    rationale.push("+15 paid partnership signal from competitor scrape");
  }

  if (input.brand.size_estimate === "pre-launch") {
    score += SCORING_WEIGHTS.paidPreLaunch;
    rationale.push("-15 pre-launch brand likely has low paid budget");
  }

  if (input.brand.contacts_count === 0) {
    score += SCORING_WEIGHTS.paidNoContacts;
    rationale.push("-10 no contacts available");
  }

  if (
    input.brand.size_estimate === "legacy-large" &&
    (input.creatorProfile.tier === "nano" || input.creatorProfile.tier === "micro")
  ) {
    score += SCORING_WEIGHTS.paidLegacyMicroMismatch;
    rationale.push("-15 legacy-large brand may prioritize larger creators");
  }

  return withClampedScore(score, rationale);
}

function scoreGifting(input: ScoringInputs, base: number): DealTypeScore {
  const rationale: string[] = [];
  let score = base;
  const hasPrSignal =
    input.brand.contact_roles.includes("pr") ||
    input.brand.source_signal_evidence_text.includes("press") ||
    input.brand.source_signal_evidence_text.includes("press-kit");

  if (hasPrSignal) {
    score += SCORING_WEIGHTS.giftingPrSignal;
    rationale.push("+15 PR or press signal suggests gifting openness");
  }

  if (
    input.brand.size_estimate === "indie-small" ||
    input.brand.size_estimate === "indie-medium"
  ) {
    score += SCORING_WEIGHTS.giftingIndieStage;
    rationale.push("+5 indie-stage brand may be open to gifting");
  }

  if (input.brand.size_estimate === "pre-launch") {
    score += SCORING_WEIGHTS.giftingPreLaunch;
    rationale.push("-15 pre-launch brand may not be ready for gifting");
  }

  return withClampedScore(score, rationale);
}

function scoreAffiliate(input: ScoringInputs, base: number): DealTypeScore {
  const rationale: string[] = [];
  let score = base;

  if (hasAffiliateSignal(input.brand)) {
    score += SCORING_WEIGHTS.affiliateSignal;
    rationale.push("+20 affiliate signal found in notes or evidence");
  }

  if (input.brand.size_estimate === "pre-launch") {
    score += SCORING_WEIGHTS.affiliatePreLaunch;
    rationale.push("-10 pre-launch brand likely has no affiliate program yet");
  }

  return withClampedScore(score, rationale);
}

function scoreUgc(
  input: ScoringInputs,
  base: number,
  aestheticOverlap: string[],
): DealTypeScore {
  const rationale: string[] = [];
  let score = base;

  if (
    input.brand.contact_roles.includes("marketing") ||
    input.brand.contact_roles.includes("partnerships")
  ) {
    score += SCORING_WEIGHTS.ugcMarketingContact;
    rationale.push("+15 marketing or partnerships contact available");
  }

  if (
    input.brand.aesthetic_tags.includes("inclusive") ||
    input.brand.aesthetic_tags.includes("authentic")
  ) {
    score += SCORING_WEIGHTS.ugcAuthenticAesthetic;
    rationale.push("+10 inclusive/authentic aesthetic fits UGC asks");
  }

  if (creatorLooksLongForm(input.creatorProfile.recent_post_themes)) {
    score += SCORING_WEIGHTS.ugcLongFormPenalty;
    rationale.push("-5 recent themes skew long-form");
  }

  if (aestheticOverlap.length > 0) {
    rationale.push(`Fit signal: aesthetic overlap on ${aestheticOverlap.join(", ")}`);
  }

  return withClampedScore(score, rationale);
}

function scoreAmbassador(
  input: ScoringInputs,
  base: number,
  aestheticOverlap: string[],
): DealTypeScore {
  const rationale = ["-10 ambassador deals are a higher bar"];
  let score = base + SCORING_WEIGHTS.ambassadorStartPenalty;

  if (
    input.brand.paid_partnership_signal_count > 0 &&
    input.brand.has_past_brand_work
  ) {
    score += SCORING_WEIGHTS.ambassadorPastWork;
    rationale.push("+20 prior paid signal plus past brand work");
  }

  if (aestheticOverlap.length >= 3) {
    score += SCORING_WEIGHTS.ambassadorStrongAestheticOverlap;
    rationale.push("+10 strong aesthetic overlap");
  }

  if (input.brand.contacts_count === 0) {
    score += SCORING_WEIGHTS.ambassadorNoContacts;
    rationale.push("-20 no contacts available");
  }

  return withClampedScore(score, rationale);
}

function hasAffiliateSignal(brand: ScoringBrand) {
  const text = `${brand.source_signals_summary ?? ""} ${
    brand.source_signal_evidence_text
  }`.toLowerCase();

  return /affiliate|referral|utm_|impact\.com|shareasale|rakuten|rewardstyle|ltk/.test(
    text,
  );
}

function creatorLooksLongForm(themes: string[]) {
  return themes.some((theme) => /vlog|tutorial|series/i.test(theme));
}

function withClampedScore(score: number, rationale: string[]): DealTypeScore {
  return {
    score: clampScore(score),
    rationale,
  };
}

function clampScore(score: number) {
  return Math.max(0, Math.min(100, Math.round(score)));
}

function intersection(left: string[], right: string[]) {
  const rightSet = new Set(right.map(normalize));

  return [...new Set(left.map(normalize))]
    .filter((item) => rightSet.has(item))
    .sort((a, b) => a.localeCompare(b));
}

function normalize(value: string) {
  return value.trim().toLowerCase();
}
