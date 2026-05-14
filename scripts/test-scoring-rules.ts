import { scoreBrand, type ScoringBrand } from "../lib/scoring/rules.ts";
import type { Tables } from "../lib/db/types";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

const creator = {
  id: "profile-1",
  handle: "athena_hz",
  tier: "micro",
  niche_tags: ["fashion", "beauty", "ugc"],
  aesthetic_keywords: ["clean", "dewy", "inclusive", "authentic"],
  recent_post_themes: ["fit checks", "campus vlog"],
};

const macroCreator = {
  ...creator,
  id: "profile-2",
  tier: "macro",
};

const strongFit = scoreBrand({
  creatorProfile: creator,
  brand: brandFixture({
    category: ["beauty"],
    aesthetic_tags: ["clean", "dewy", "inclusive"],
    contacts_count: 2,
    contact_roles: ["pr", "marketing"],
    domain: "example.com",
    pays_creators: true,
    size_estimate: "indie-medium",
    source_signal_kinds: ["manual_seed", "rapidapi_competitor_scrape"],
    paid_partnership_signal_count: 1,
  }),
});

assert(strongFit.base_fit_score >= 90, "Aesthetic + niche match should produce high base score.");
assert(
  strongFit.base_rationale.some((line) => line.includes("+20 aesthetic")),
  "Aesthetic rationale should be present.",
);
assert(
  strongFit.deal_type_scores.paid.score >= 90,
  "Pays-creators brand should score highly for paid.",
);
assert(
  strongFit.deal_type_scores.paid.rationale.some((line) =>
    line.includes("+20 brand signals it pays creators"),
  ),
  "Paid rationale should include pays-creators boost.",
);
assert(
  strongFit.deal_type_scores.gifting.rationale.some((line) =>
    line.includes("+15 PR or press"),
  ),
  "PR role should boost gifting.",
);

const weakPaid = scoreBrand({
  creatorProfile: creator,
  brand: brandFixture({
    category: [],
    aesthetic_tags: [],
    contacts_count: 0,
    contact_roles: [],
    domain: null,
    size_estimate: "pre-launch",
  }),
});

assert(weakPaid.deal_type_scores.paid.score < 40, "No contacts + pre-launch should be weak for paid.");
assert(
  weakPaid.deal_type_scores.paid.rationale.some((line) =>
    line.includes("-10 no contacts available"),
  ),
  "Paid rationale should include no-contact penalty.",
);

const affiliate = scoreBrand({
  creatorProfile: creator,
  brand: brandFixture({
    source_signals_summary: "Affiliate program through LTK",
    source_signal_evidence_text: "https://brand.com/affiliate",
  }),
});

assert(
  affiliate.deal_type_scores.affiliate.rationale.some((line) =>
    line.includes("+20 affiliate signal"),
  ),
  "Affiliate rationale should include affiliate signal.",
);

const macroMismatch = scoreBrand({
  creatorProfile: macroCreator,
  brand: brandFixture({
    size_estimate: "indie-small",
  }),
});

assert(
  macroMismatch.base_rationale.some((line) =>
    line.includes("-20 macro creator"),
  ),
  "Macro creator plus indie-small brand should include mismatch penalty.",
);

const legacyForMicro = scoreBrand({
  creatorProfile: creator,
  brand: brandFixture({
    size_estimate: "legacy-large",
  }),
});

assert(
  legacyForMicro.deal_type_scores.paid.rationale.some((line) =>
    line.includes("-15 legacy-large"),
  ),
  "Micro creator plus legacy-large brand should include paid mismatch penalty.",
);

console.log("Scoring rules test passed.");

function brandFixture(
  overrides: Partial<ScoringBrand> = {},
): ScoringBrand {
  const base: Tables<"brands"> = {
    id: "brand-1",
    user_id: "user-1",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    name: "Example Brand",
    aliases: [],
    domain: "example.com",
    instagram_handle: "example",
    tiktok_handle: null,
    category: ["beauty"],
    aesthetic_tags: ["clean"],
    size_estimate: "indie-medium",
    creator_friendliness_score: null,
    pays_creators: null,
    last_pitched_at: null,
    pitch_count: 0,
    source_signals_summary: null,
    excluded: false,
    exclusion_reason: null,
    identity_key: "domain:example.com",
  };

  return {
    ...base,
    contacts_count: 1,
    contact_roles: [],
    has_hunter_contacts: false,
    has_page_scrape_contacts: false,
    source_signal_kinds: ["manual_seed"],
    source_signal_evidence_text: "",
    paid_partnership_signal_count: 0,
    has_past_brand_work: false,
    ...overrides,
  };
}
