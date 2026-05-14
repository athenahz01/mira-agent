import type { z } from "zod";

import { deliverableKindSchema } from "../db/media-kit.ts";

export const creatorTiers = ["nano", "micro", "mid", "macro"] as const;

export type CreatorTier = (typeof creatorTiers)[number];
export type DeliverableKind = z.infer<typeof deliverableKindSchema>;
export type RateRange = {
  min: number;
  max: number;
};
export type RateBenchmarks = Record<
  CreatorTier,
  Record<DeliverableKind, RateRange>
>;

// Conservative internal anchors synthesized from public 2025 creator-rate
// reporting: Fohr creator rate reporting and Influencer Marketing Hub's annual
// influencer marketing benchmark/rate data. Keep source names internal; the
// brand-facing kit uses a general "tier + industry data" methodology note.
export const rateBenchmarks: RateBenchmarks = {
  nano: {
    ig_reel: { min: 150, max: 500 },
    ig_static: { min: 100, max: 350 },
    ig_story: { min: 50, max: 200 },
    tiktok: { min: 150, max: 500 },
    ugc_video: { min: 200, max: 650 },
    ugc_photo_set: { min: 150, max: 450 },
  },
  micro: {
    ig_reel: { min: 500, max: 1500 },
    ig_static: { min: 300, max: 900 },
    ig_story: { min: 150, max: 500 },
    tiktok: { min: 500, max: 1500 },
    ugc_video: { min: 500, max: 1500 },
    ugc_photo_set: { min: 350, max: 1000 },
  },
  mid: {
    ig_reel: { min: 1500, max: 5500 },
    ig_static: { min: 900, max: 3000 },
    ig_story: { min: 500, max: 1500 },
    tiktok: { min: 1500, max: 5500 },
    ugc_video: { min: 1200, max: 4000 },
    ugc_photo_set: { min: 900, max: 2500 },
  },
  macro: {
    ig_reel: { min: 5500, max: 15000 },
    ig_static: { min: 3000, max: 9000 },
    ig_story: { min: 1500, max: 5000 },
    tiktok: { min: 5500, max: 15000 },
    ugc_video: { min: 3000, max: 9000 },
    ugc_photo_set: { min: 2500, max: 7000 },
  },
};
