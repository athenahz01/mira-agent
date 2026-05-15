import { defaultVoiceStyleGuide } from "../lib/db/style-guide.ts";
import type { MediaKitJson } from "../lib/db/media-kit.ts";
import { researchBriefJsonSchema } from "../lib/db/research-brief.ts";
import { generateResearchBrief } from "../lib/llm/research-brief.ts";
import type { ScoringBrand } from "../lib/scoring/rules.ts";

if (!process.env.ANTHROPIC_API_KEY) {
  console.log("Skipped research brief shape test: ANTHROPIC_API_KEY is unset.");
  process.exit(0);
}

async function main() {
  const brief = await generateResearchBrief({
    creatorProfile: {
      handle: "athena_hz",
      display_name: "Athena Huo",
      niche_tags: ["fashion", "lifestyle", "ugc"],
      aesthetic_keywords: ["clean", "dewy", "polished"],
      bio_extract:
        "NYC-based fashion, lifestyle, and UGC creator making polished everyday content.",
      recent_post_themes: ["fit checks", "UGC demos", "NYC routines"],
      tier: "micro",
    },
    voiceStyleGuide: defaultVoiceStyleGuide,
    mediaKit: fixtureMediaKit(),
    brand: fixtureBrand(),
    fitScore: {
      base_fit_score: 82,
      base_rationale: ["+20 aesthetic overlap", "+15 category overlap"],
      deal_type: "paid",
      deal_type_score: 88,
      deal_type_rationale: ["+20 brand signals it pays creators"],
      computed_at: new Date().toISOString(),
    },
    dealType: "paid",
    pastBrandWork: [],
  });

  researchBriefJsonSchema.parse(brief);
  console.log("Research brief shape test passed.");
}

function fixtureMediaKit(): MediaKitJson {
  return {
    version: 1,
    profile_summary: {
      handle: "athena_hz",
      display_name: "Athena Huo",
      tagline: "NYC fashion and lifestyle creator with UGC range.",
      location: "NYC",
      languages: ["English", "Mandarin"],
    },
    audience: {
      platform: "instagram",
      follower_count: 8000,
      engagement_rate: 0.04,
      tier: "micro",
      demographics: {},
    },
    niche: {
      categories: ["fashion", "lifestyle", "ugc"],
      aesthetic_keywords: ["clean", "dewy", "polished"],
      content_pillars: ["fit checks", "UGC demos", "NYC lifestyle"],
    },
    deliverables: [
      {
        kind: "ig_reel",
        description: "Short-form editorial reel.",
        suggested_rate_usd: { min: 300, max: 800 },
        usage_rights_included: "Organic usage for 30 days.",
        typical_turnaround_days: 7,
      },
    ],
    past_brand_work: [],
    contact: {
      email: "zhengathenahuo@gmail.com",
      website: "https://athenahuo.com",
      instagram: "https://instagram.com/athena_hz",
    },
    rate_methodology_note:
      "Rates are estimated from creator tier, deliverable complexity, usage rights, and industry data.",
  };
}

function fixtureBrand(): ScoringBrand {
  return {
    id: "00000000-0000-0000-0000-000000000001",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    user_id: "00000000-0000-0000-0000-000000000002",
    identity_key: "domain:glossier.com",
    name: "Glossier",
    aliases: [],
    domain: "glossier.com",
    instagram_handle: "glossier",
    tiktok_handle: null,
    category: ["beauty", "skincare"],
    aesthetic_tags: ["clean", "dewy"],
    size_estimate: "established-dtc",
    creator_friendliness_score: null,
    pays_creators: true,
    last_pitched_at: null,
    pitch_count: 0,
    source_signals_summary: "Competitor paid partnership signal.",
    excluded: false,
    exclusion_reason: null,
    contacts_count: 1,
    contact_roles: ["pr"],
    has_hunter_contacts: true,
    has_page_scrape_contacts: false,
    source_signal_kinds: ["rapidapi_competitor_scrape", "hunter_enrichment"],
    source_signal_evidence_text: "paid partnership by similar creators",
    paid_partnership_signal_count: 2,
    has_past_brand_work: false,
  };
}

main().catch((error: unknown) => {
  const message =
    error instanceof Error
      ? error.message
      : "Unknown research brief shape test failure";
  console.error(message);
  process.exitCode = 1;
});
