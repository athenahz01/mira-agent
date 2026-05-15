import { randomUUID } from "node:crypto";

import { replyClassificationJsonSchema } from "../lib/db/reply-classification.ts";
import { defaultVoiceStyleGuide } from "../lib/db/style-guide.ts";
import type { Tables } from "../lib/db/types";
import { classifyReply } from "../lib/llm/reply-classify.ts";
import { createNewReplyFixture } from "../lib/replies/service.ts";

if (!process.env.ANTHROPIC_API_KEY) {
  console.log("Skipping reply classification shape test; ANTHROPIC_API_KEY unset.");
  process.exit(0);
}

const now = new Date().toISOString();
const campaign = {
  id: randomUUID(),
  created_at: now,
  updated_at: now,
  user_id: randomUUID(),
  creator_profile_id: randomUUID(),
  brand_id: randomUUID(),
  deal_type: "paid",
  status: "sent",
  score: 80,
  score_rationale_json: null,
  hook_chosen: "specific-product-hook",
  research_brief_json: null,
  target_contact_id: null,
  scheduled_send_at: null,
  sent_at: now,
  replied_at: null,
  closed_at: null,
  outcome: null,
  deal_value_usd: null,
  notes: null,
} satisfies Tables<"campaigns">;

const brand = {
  id: randomUUID(),
  created_at: now,
  updated_at: now,
  user_id: campaign.user_id,
  name: "Glossier",
  identity_key: "domain:glossier.com",
  aliases: [],
  domain: "glossier.com",
  instagram_handle: "glossier",
  tiktok_handle: null,
  category: ["beauty"],
  aesthetic_tags: ["clean"],
  size_estimate: "established-dtc",
  creator_friendliness_score: null,
  pays_creators: true,
  last_pitched_at: now,
  pitch_count: 1,
  source_signals_summary: null,
  excluded: false,
  exclusion_reason: null,
  contacts_count: 1,
  contact_roles: ["pr"],
  has_hunter_contacts: false,
  has_page_scrape_contacts: false,
  source_signal_kinds: ["manual_seed"],
  source_signal_evidence_text: "",
  paid_partnership_signal_count: 0,
  has_past_brand_work: false,
};

const result = await classifyReply({
  creatorProfile: {
    handle: "athena_hz",
    display_name: "Athena Huo",
    niche_tags: ["fashion", "beauty"],
    aesthetic_keywords: ["clean"],
    bio_extract: "NYC fashion and lifestyle creator.",
    recent_post_themes: ["fit checks"],
    tier: "micro",
  },
  voiceStyleGuide: defaultVoiceStyleGuide,
  campaign,
  brand,
  miraOriginalMessage: {
    subject: "A quick creator idea",
    body_text: "Hi team, I had a paid content idea.",
  },
  reply: createNewReplyFixture({
    body_text: "Thanks for reaching out. Could you send your rate sheet?",
  }),
  threadHistory: [],
});

replyClassificationJsonSchema.parse(result);
console.log("Reply classification shape test passed.");
