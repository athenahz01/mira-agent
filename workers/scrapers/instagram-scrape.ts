import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import {
  findOrCreateBrand,
  insertSourceSignal,
} from "../../lib/brands/service.ts";
import type { Database, Tables } from "../../lib/db/types.ts";
import {
  extractBrandCandidatesFromInstagramPosts,
  type InstagramBrandCandidate,
} from "../../lib/instagram/brand-extraction.ts";
import {
  createRapidApiInstagramClient,
  type IgPost,
  type RapidApiInstagramClient,
} from "../../lib/instagram/rapidapi-client.ts";

const instagramScrapePayloadSchema = z.object({
  competitor_handle_id: z.string().uuid(),
  handle: z.string().min(1),
  platform: z.string().default("instagram"),
  max_posts: z.number().int().positive().max(200).optional().default(100),
});

export type InstagramScrapeResult = {
  competitor_handle_id: string;
  posts_scraped: number;
  brands_created: number;
  brands_merged: number;
  brands_queued_for_review: number;
  brands_skipped: number;
};

export async function processInstagramScrapeJob(
  supabase: SupabaseClient<Database>,
  job: Tables<"jobs">,
  options: {
    instagramClient?: RapidApiInstagramClient;
  } = {},
): Promise<InstagramScrapeResult> {
  const payload = instagramScrapePayloadSchema.parse(job.payload_json);
  const client = options.instagramClient ?? createRapidApiInstagramClient();
  const posts = await client.fetchRecentPosts({
    username: payload.handle,
    maxPosts: payload.max_posts,
    maxAgeDays: 90,
  });
  const excludedCreatorHandles = await loadCreatorHandles(supabase, job.user_id);
  const extraction = extractBrandCandidatesFromInstagramPosts({
    competitorHandle: payload.handle,
    posts,
    excludedCreatorHandles,
    maxAgeDays: 90,
  });
  const result: InstagramScrapeResult = {
    competitor_handle_id: payload.competitor_handle_id,
    posts_scraped: extraction.posts_analyzed,
    brands_created: 0,
    brands_merged: 0,
    brands_queued_for_review: 0,
    brands_skipped: 0,
  };
  const context = {
    supabase,
    userId: job.user_id,
  };

  for (const candidate of extraction.candidate_brands) {
    try {
      const brandResult = await findOrCreateBrand(
        context,
        {
          name: candidate.display_name,
          domain: null,
          instagram_handle: candidate.instagram_handle,
          tiktok_handle: null,
          category: [],
          aesthetic_tags: [],
          size_estimate: null,
          pays_creators: null,
          notes: "",
        },
        {
          source: "instagram_scrape",
        },
      );

      if (brandResult.queued_for_review) {
        result.brands_queued_for_review += 1;
        continue;
      }

      if (brandResult.created) {
        result.brands_created += 1;
      } else {
        result.brands_merged += 1;
      }

      await insertSourceSignal(context, {
        brandId: brandResult.brand.id,
        signalType: "rapidapi_competitor_scrape",
        evidence: candidateToEvidence(payload.handle, candidate, posts),
      });
    } catch {
      result.brands_skipped += 1;
    }
  }

  await markCompetitorHandleScraped(supabase, job.user_id, payload.competitor_handle_id);
  return result;
}

async function loadCreatorHandles(
  supabase: SupabaseClient<Database>,
  userId: string,
) {
  const { data, error } = await supabase
    .from("creator_profiles")
    .select("handle")
    .eq("user_id", userId);

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []).map((profile) => profile.handle);
}

async function markCompetitorHandleScraped(
  supabase: SupabaseClient<Database>,
  userId: string,
  competitorHandleId: string,
) {
  const { error } = await supabase
    .from("competitor_handles")
    .update({
      last_scraped_at: new Date().toISOString(),
    })
    .eq("id", competitorHandleId)
    .eq("user_id", userId);

  if (error) {
    throw new Error(error.message);
  }
}

function candidateToEvidence(
  competitorHandle: string,
  candidate: InstagramBrandCandidate,
  posts: IgPost[],
) {
  const postsByCode = new Map(posts.map((post) => [post.code, post]));

  return {
    competitor_handle: competitorHandle,
    instagram_handle: candidate.instagram_handle,
    confidence_tier: candidate.confidence_tier,
    paid_partnership_count: candidate.paid_partnership_count,
    post_urls: candidate.evidence_post_codes.map(
      (code) => `https://instagram.com/p/${code}/`,
    ),
    caption_snippets: candidate.evidence_post_codes
      .map((code) => postsByCode.get(code)?.caption ?? null)
      .filter((caption): caption is string => Boolean(caption))
      .map((caption) => caption.slice(0, 240)),
  };
}
