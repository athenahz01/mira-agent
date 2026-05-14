import type { BrandContext } from "@/lib/brands/service";
import type { Json, Tables } from "@/lib/db/types";
import { enqueueJob } from "@/lib/jobs/queue";

export type InstagramScrapeJobSummary = Pick<
  Tables<"jobs">,
  | "id"
  | "status"
  | "payload_json"
  | "result_json"
  | "error_message"
  | "created_at"
  | "started_at"
  | "finished_at"
>;

export type CompetitorHandleRow = Tables<"competitor_handles"> & {
  latest_job: InstagramScrapeJobSummary | null;
};

export type CreatorProfileOption = Pick<
  Tables<"creator_profiles">,
  "id" | "handle" | "display_name"
>;

export type CompetitorScraperPanelData = {
  profiles: CreatorProfileOption[];
  handles: CompetitorHandleRow[];
};

export type BulkInstagramScrapeEnqueueResult = {
  enqueued: number;
  skipped: number;
};

export async function listCompetitorScrapersForUser(
  context: BrandContext,
): Promise<CompetitorScraperPanelData> {
  const [profilesResult, handlesResult, jobsResult] = await Promise.all([
    context.supabase
      .from("creator_profiles")
      .select("id,handle,display_name")
      .eq("user_id", context.userId)
      .eq("active", true)
      .order("handle"),
    context.supabase
      .from("competitor_handles")
      .select("*")
      .eq("user_id", context.userId)
      .order("created_at", {
        ascending: true,
      }),
    context.supabase
      .from("jobs")
      .select(
        "id,status,payload_json,result_json,error_message,created_at,started_at,finished_at",
      )
      .eq("user_id", context.userId)
      .eq("kind", "instagram_scrape")
      .order("created_at", {
        ascending: false,
      }),
  ]);

  if (profilesResult.error) {
    throw new Error(profilesResult.error.message);
  }

  if (handlesResult.error) {
    throw new Error(handlesResult.error.message);
  }

  if (jobsResult.error) {
    throw new Error(jobsResult.error.message);
  }

  const latestJobsByHandle = groupInstagramJobsByHandle(jobsResult.data ?? []);

  return {
    profiles: profilesResult.data ?? [],
    handles: (handlesResult.data ?? []).map((handle) => ({
      ...handle,
      latest_job: latestJobsByHandle.get(handle.id) ?? null,
    })),
  };
}

export async function addCompetitorHandleForUser(
  context: BrandContext,
  creatorProfileId: string,
  rawHandle: string,
): Promise<Tables<"competitor_handles">> {
  await assertCreatorProfileBelongsToUser(context, creatorProfileId);
  const handle = normalizeInstagramHandle(rawHandle);

  if (!handle) {
    throw new Error("Add an Instagram handle.");
  }

  const { data, error } = await context.supabase
    .from("competitor_handles")
    .upsert(
      {
        user_id: context.userId,
        creator_profile_id: creatorProfileId,
        handle,
        platform: "instagram",
      },
      {
        onConflict: "creator_profile_id,handle",
      },
    )
    .select("*")
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? "Could not save competitor handle.");
  }

  return data;
}

export async function removeCompetitorHandleForUser(
  context: BrandContext,
  competitorHandleId: string,
): Promise<void> {
  const { error } = await context.supabase
    .from("competitor_handles")
    .delete()
    .eq("id", competitorHandleId)
    .eq("user_id", context.userId);

  if (error) {
    throw new Error(error.message);
  }
}

export async function enqueueInstagramCompetitorScrapeForUser(
  context: BrandContext,
  competitorHandleId: string,
): Promise<InstagramScrapeJobSummary> {
  const handle = await loadCompetitorHandle(context, competitorHandleId);
  const activeJob = await getActiveInstagramScrapeJob(context, handle.id);

  if (activeJob) {
    return activeJob;
  }

  return enqueueJob(context.supabase, {
    userId: context.userId,
    kind: "instagram_scrape",
    payload: {
      competitor_handle_id: handle.id,
      handle: handle.handle,
      platform: handle.platform,
      max_posts: 100,
    },
  });
}

export async function enqueueAllCompetitorScrapesForUser(
  context: BrandContext,
  creatorProfileId: string,
): Promise<BulkInstagramScrapeEnqueueResult> {
  await assertCreatorProfileBelongsToUser(context, creatorProfileId);
  const [handlesResult, activeJobsResult] = await Promise.all([
    context.supabase
      .from("competitor_handles")
      .select("id,handle,platform")
      .eq("user_id", context.userId)
      .eq("creator_profile_id", creatorProfileId),
    context.supabase
      .from("jobs")
      .select("payload_json")
      .eq("user_id", context.userId)
      .eq("kind", "instagram_scrape")
      .in("status", ["queued", "running"]),
  ]);

  if (handlesResult.error) {
    throw new Error(handlesResult.error.message);
  }

  if (activeJobsResult.error) {
    throw new Error(activeJobsResult.error.message);
  }

  const activeHandleIds = new Set(
    (activeJobsResult.data ?? [])
      .map((job) => readCompetitorHandleIdFromPayload(job.payload_json))
      .filter((id): id is string => Boolean(id)),
  );
  const targets = (handlesResult.data ?? []).filter(
    (handle) => !activeHandleIds.has(handle.id),
  );

  for (const handle of targets) {
    await enqueueJob(context.supabase, {
      userId: context.userId,
      kind: "instagram_scrape",
      payload: {
        competitor_handle_id: handle.id,
        handle: handle.handle,
        platform: handle.platform,
        max_posts: 100,
      },
    });
  }

  return {
    enqueued: targets.length,
    skipped: Math.max(0, (handlesResult.data ?? []).length - targets.length),
  };
}

async function assertCreatorProfileBelongsToUser(
  context: BrandContext,
  creatorProfileId: string,
) {
  const { data, error } = await context.supabase
    .from("creator_profiles")
    .select("id")
    .eq("id", creatorProfileId)
    .eq("user_id", context.userId)
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? "Creator profile not found.");
  }
}

async function loadCompetitorHandle(
  context: BrandContext,
  competitorHandleId: string,
) {
  const { data, error } = await context.supabase
    .from("competitor_handles")
    .select("*")
    .eq("id", competitorHandleId)
    .eq("user_id", context.userId)
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? "Competitor handle not found.");
  }

  return data;
}

async function getActiveInstagramScrapeJob(
  context: BrandContext,
  competitorHandleId: string,
) {
  const { data, error } = await context.supabase
    .from("jobs")
    .select(
      "id,status,payload_json,result_json,error_message,created_at,started_at,finished_at",
    )
    .eq("user_id", context.userId)
    .eq("kind", "instagram_scrape")
    .in("status", ["queued", "running"])
    .contains("payload_json", {
      competitor_handle_id: competitorHandleId,
    })
    .order("created_at", {
      ascending: false,
    })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return data;
}

function groupInstagramJobsByHandle(jobs: InstagramScrapeJobSummary[]) {
  const grouped = new Map<string, InstagramScrapeJobSummary>();

  for (const job of jobs) {
    const handleId = readCompetitorHandleIdFromPayload(job.payload_json);

    if (!handleId || grouped.has(handleId)) {
      continue;
    }

    grouped.set(handleId, job);
  }

  return grouped;
}

function readCompetitorHandleIdFromPayload(payload: Json) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }

  const handleId = payload.competitor_handle_id;

  return typeof handleId === "string" ? handleId : null;
}

function normalizeInstagramHandle(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/^instagram\.com\//, "")
    .replace(/[/#?].*$/, "")
    .replace(/^@/, "")
    .trim();
}
