import {
  extractBrandCandidatesFromInstagramPosts,
  looksLikeBrandHandle,
} from "../lib/instagram/brand-extraction.ts";
import type { IgPost } from "../lib/instagram/rapidapi-client.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

const nowUnix = Math.floor(Date.now() / 1000);
const posts: IgPost[] = [
  {
    code: "paid1",
    taken_at_unix: nowUnix - 86_400,
    caption: "A favorite launch.",
    accessibility_caption: null,
    is_paid_partnership: true,
    sponsor_tags: [{ username: "Tower28Beauty", full_name: "Tower 28" }],
    usertags: [
      { username: "Tower28Beauty", full_name: "Tower 28", pk: "1" },
      { username: "athena_hz", full_name: "Athena Huo", pk: "2" },
    ],
    like_count: 100,
    comment_count: 4,
    media_type: 1,
  },
  {
    code: "ad1",
    taken_at_unix: nowUnix - 2 * 86_400,
    caption: "#ad loved this color story",
    accessibility_caption: null,
    is_paid_partnership: false,
    sponsor_tags: [],
    usertags: [{ username: "Topicals", full_name: "Topicals", pk: "3" }],
    like_count: 200,
    comment_count: 8,
    media_type: 2,
  },
  {
    code: "cross1",
    taken_at_unix: nowUnix - 3 * 86_400,
    caption: "Styling @glossier today",
    accessibility_caption: null,
    is_paid_partnership: false,
    sponsor_tags: [],
    usertags: [{ username: "Glossier", full_name: "Glossier", pk: "4" }],
    like_count: 150,
    comment_count: 3,
    media_type: 1,
  },
  {
    code: "tag1",
    taken_at_unix: nowUnix - 4 * 86_400,
    caption: "Plain outfit post",
    accessibility_caption: null,
    is_paid_partnership: false,
    sponsor_tags: [],
    usertags: [
      { username: "RareBeauty", full_name: "Rare Beauty", pk: "5" },
      { username: "official_fanpage", full_name: "Fan Page", pk: "6" },
    ],
    like_count: 90,
    comment_count: 2,
    media_type: 1,
  },
  {
    code: "old1",
    taken_at_unix: nowUnix - 120 * 86_400,
    caption: "#ad old post",
    accessibility_caption: null,
    is_paid_partnership: false,
    sponsor_tags: [],
    usertags: [{ username: "OldBrand", full_name: "Old Brand", pk: "7" }],
    like_count: 40,
    comment_count: 1,
    media_type: 1,
  },
];

const result = extractBrandCandidatesFromInstagramPosts({
  competitorHandle: "competitor_creator",
  posts,
  excludedCreatorHandles: ["athena_hz", "athena_huo"],
  maxAgeDays: 90,
});
const byHandle = new Map(
  result.candidate_brands.map((brand) => [brand.instagram_handle, brand]),
);

assert(result.posts_analyzed === 4, "Only recent posts should be analyzed.");
assert(byHandle.get("tower28beauty")?.confidence_tier === "high", "Paid partnership should be high confidence.");
assert(byHandle.get("topicals")?.confidence_tier === "medium", "#ad photo tag should be medium confidence.");
assert(byHandle.get("glossier")?.confidence_tier === "low", "Caption mention plus photo tag should be low confidence.");
assert(byHandle.get("rarebeauty")?.confidence_tier === "low", "Brandy tag-only account should be low confidence.");
assert(!byHandle.has("athena_hz"), "Athena's own profile should be filtered.");
assert(!byHandle.has("official_fanpage"), "official_ fan-style handles should be filtered.");
assert(!byHandle.has("oldbrand"), "Old posts should be filtered.");
assert(
  !looksLikeBrandHandle("brand_official", new Set()),
  "brand_official should be filtered as non-brand signal.",
);

console.log("Instagram brand extraction test passed.");
