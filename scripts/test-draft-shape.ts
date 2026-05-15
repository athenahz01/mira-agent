import { defaultVoiceStyleGuide } from "../lib/db/style-guide.ts";
import type { MediaKitJson } from "../lib/db/media-kit.ts";
import type { ResearchBriefJson } from "../lib/db/research-brief.ts";
import { draftJsonSchema } from "../lib/db/draft.ts";
import { generateDraft } from "../lib/llm/draft.ts";
import type { ScoringBrand } from "../lib/scoring/rules.ts";

if (!process.env.ANTHROPIC_API_KEY) {
  console.log("Skipped draft shape test: ANTHROPIC_API_KEY is unset.");
  process.exit(0);
}

async function main() {
  const draft = await generateDraft({
    creatorProfile: {
      handle: "athena_hz",
      display_name: "Athena Huo",
      niche_tags: ["fashion", "lifestyle", "ugc"],
      aesthetic_keywords: ["clean", "dewy", "polished"],
      bio_extract: "NYC fashion and lifestyle creator.",
      recent_post_themes: ["fit checks", "UGC demos", "NYC routines"],
      tier: "micro",
    },
    voiceStyleGuide: defaultVoiceStyleGuide,
    mediaKit: fixtureMediaKit(),
    brand: fixtureBrand(),
    researchBrief: fixtureBrief(),
    dealType: "paid",
    senderDisplayName: "Athena Huo",
    senderEmail: "zhengathenahuo@gmail.com",
    physicalAddress: "Configured, hidden from generated footer",
    targetContact: null,
  });

  draftJsonSchema.parse(draft);
  if (draft.body_text.includes("Mira")) {
    throw new Error("Draft footer/body should not mention Mira.");
  }
  if (!draft.body_text.includes("NYC, NY")) {
    throw new Error("Draft footer should include NYC, NY.");
  }

  console.log("Draft shape test passed.");
}

function fixtureBrief(): ResearchBriefJson {
  return {
    why_this_brand:
      "Glossier overlaps with Athena's beauty and lifestyle audience and has paid creator signals from competitor posts.",
    why_this_deal_type:
      "Paid fits because the brand has creator budget signals and a PR contact path.",
    recommended_hook: {
      pattern_name: "specific-product-hook",
      one_liner:
        "I had a content idea around making your everyday staples feel more lived-in for a NYC audience.",
      why_this_hook: "It connects the brand's aesthetic to Athena's audience.",
    },
    suggested_subject_themes: ["NYC content idea", "creator fit", "paid collab"],
    risk_flags: [],
    confidence: 86,
  };
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
    error instanceof Error ? error.message : "Unknown draft shape test failure";
  console.error(message);
  process.exitCode = 1;
});
