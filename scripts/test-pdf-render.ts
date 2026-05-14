import { Document, Page, Text, renderToBuffer } from "@react-pdf/renderer";
import React from "react";

import type { MediaKitJson } from "../lib/db/media-kit";

const fixtureKit: MediaKitJson = {
  version: 1,
  profile_summary: {
    handle: "athena_hz",
    display_name: "Athena Huo",
    tagline: "NYC fashion, lifestyle, and UGC creator.",
    location: "NYC",
    languages: ["English", "Mandarin"],
  },
  audience: {
    platform: "instagram",
    follower_count: 5000,
    engagement_rate: 0.04,
    tier: "nano",
    demographics: {},
  },
  niche: {
    categories: ["fashion", "lifestyle", "ugc"],
    aesthetic_keywords: ["warm-toned", "polished"],
    content_pillars: ["fit checks", "UGC demos", "NYC lifestyle"],
  },
  deliverables: [
    {
      kind: "ig_reel",
      description: "Short-form editorial reel.",
      suggested_rate_usd: { min: 150, max: 500 },
      usage_rights_included: "Organic social usage for 30 days.",
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
    "Rates are estimated from creator tier, deliverable complexity, usage rights, and current industry benchmarks.",
};

const document = React.createElement(
  Document,
  null,
  React.createElement(
    Page,
    { size: "LETTER" },
    React.createElement(Text, null, fixtureKit.profile_summary.display_name),
    React.createElement(Text, null, fixtureKit.profile_summary.tagline),
  ),
);

const buffer = await renderToBuffer(document);

if (buffer.length < 1000) {
  throw new Error("Expected a non-empty PDF buffer.");
}

if (!buffer.subarray(0, 5).equals(Buffer.from("%PDF-"))) {
  throw new Error("Expected PDF buffer to start with %PDF-.");
}

console.log("PDF render test passed.");
