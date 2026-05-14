import { randomUUID } from "node:crypto";

import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

import type { Database } from "../lib/db/types";
import type {
  IgPost,
  RapidApiInstagramClient,
} from "../lib/instagram/rapidapi-client.ts";
import { processInstagramScrapeJob } from "../workers/scrapers/instagram-scrape.ts";

const envSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
});

const envResult = envSchema.safeParse(process.env);

if (!envResult.success) {
  console.error(envResult.error.message);
  process.exit(1);
}

const service = createClient<Database>(
  envResult.data.NEXT_PUBLIC_SUPABASE_URL,
  envResult.data.SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  },
);
let createdUserId: string | null = null;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

async function createTestUser() {
  const { data, error } = await service.auth.admin.createUser({
    email: `mira-instagram-job-${randomUUID()}@example.com`,
    password: `Test-${randomUUID()}!`,
    email_confirm: true,
  });

  if (error || !data.user) {
    throw new Error(error?.message ?? "Could not create test user.");
  }

  createdUserId = data.user.id;
  return data.user.id;
}

async function main() {
  const userId = await createTestUser();
  const { data: profile, error: profileError } = await service
    .from("creator_profiles")
    .insert({
      user_id: userId,
      handle: "athena_hz",
      display_name: "Athena Huo",
    })
    .select("*")
    .single();

  if (profileError || !profile) {
    throw new Error(profileError?.message ?? "Could not seed creator profile.");
  }

  const { data: competitor, error: competitorError } = await service
    .from("competitor_handles")
    .insert({
      user_id: userId,
      creator_profile_id: profile.id,
      handle: "competitor_creator",
      platform: "instagram",
    })
    .select("*")
    .single();

  if (competitorError || !competitor) {
    throw new Error(
      competitorError?.message ?? "Could not seed competitor handle.",
    );
  }

  const { data: job, error: jobError } = await service
    .from("jobs")
    .insert({
      user_id: userId,
      kind: "instagram_scrape",
      status: "running",
      payload_json: {
        competitor_handle_id: competitor.id,
        handle: competitor.handle,
        platform: "instagram",
        max_posts: 100,
      },
    })
    .select("*")
    .single();

  if (jobError || !job) {
    throw new Error(jobError?.message ?? "Could not seed job.");
  }

  const result = await processInstagramScrapeJob(service, job, {
    instagramClient: fakeInstagramClient(),
  });

  assert(result.posts_scraped === 5, "Mock job should analyze five posts.");
  assert(result.brands_created >= 3, "Mock job should create at least 3 brands.");

  const { data: brands, error: brandsError } = await service
    .from("brands")
    .select("*")
    .eq("user_id", userId);

  if (brandsError) {
    throw new Error(brandsError.message);
  }

  assert((brands ?? []).length >= 3, "Brand rows should be created.");

  const { data: signals, error: signalsError } = await service
    .from("source_signals")
    .select("*")
    .eq("user_id", userId)
    .eq("signal_type", "rapidapi_competitor_scrape");

  if (signalsError) {
    throw new Error(signalsError.message);
  }

  assert(
    (signals ?? []).length >= result.brands_created,
    "Source signals should be written for created brands.",
  );

  const { data: updatedCompetitor, error: updatedCompetitorError } =
    await service
      .from("competitor_handles")
      .select("*")
      .eq("id", competitor.id)
      .single();

  if (updatedCompetitorError || !updatedCompetitor) {
    throw new Error(
      updatedCompetitorError?.message ?? "Could not reload competitor handle.",
    );
  }

  assert(
    updatedCompetitor.last_scraped_at,
    "Competitor last_scraped_at should be updated.",
  );

  console.log("Instagram job mock test passed.");
}

function fakeInstagramClient(): RapidApiInstagramClient {
  return {
    async fetchRecentPosts() {
      return mockPosts();
    },
  };
}

function mockPosts(): IgPost[] {
  const nowUnix = Math.floor(Date.now() / 1000);

  return [
    post("paid-a", nowUnix, true, [
      { username: "tower28beauty", full_name: "Tower 28", pk: "1" },
    ]),
    post("paid-b", nowUnix, true, [
      { username: "rarebeauty", full_name: "Rare Beauty", pk: "2" },
    ]),
    {
      ...post("ad-a", nowUnix, false, [
        { username: "topicals", full_name: "Topicals", pk: "3" },
      ]),
      caption: "#ad spring shelf reset",
    },
    post("tag-only", nowUnix, false, [
      { username: "glossier", full_name: "Glossier", pk: "4" },
    ]),
    post("own-profile", nowUnix, false, [
      { username: "athena_hz", full_name: "Athena Huo", pk: "5" },
    ]),
  ];
}

function post(
  code: string,
  takenAtUnix: number,
  isPaid: boolean,
  usertags: IgPost["usertags"],
): IgPost {
  return {
    code,
    taken_at_unix: takenAtUnix,
    caption: isPaid ? "Paid partnership post" : "Regular post",
    accessibility_caption: null,
    is_paid_partnership: isPaid,
    sponsor_tags: isPaid
      ? usertags.map((user) => ({
          username: user.username,
          full_name: user.full_name,
        }))
      : [],
    usertags,
    like_count: 100,
    comment_count: 5,
    media_type: 1,
  };
}

async function cleanup() {
  if (createdUserId) {
    await service.auth.admin.deleteUser(createdUserId);
  }
}

main()
  .catch((error: unknown) => {
    const message =
      error instanceof Error ? error.message : "Unknown Instagram job error";
    console.error(message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await cleanup();
  });
