import type { SupabaseClient } from "@supabase/supabase-js";

import type { BrandContext } from "@/lib/brands/service";
import type { Database, Json, Tables } from "@/lib/db/types";
import { enqueueJob } from "@/lib/jobs/queue";

export type PageScrapeJobSummary = Pick<
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

export type BulkPageScrapeEnqueueResult = {
  enqueued: number;
  skipped: number;
};

export type JobSummary = {
  queued: number;
  running: number;
  failedLast7Days: number;
};

export async function enqueuePageScrapeForBrand(
  context: BrandContext,
  brandId: string,
): Promise<PageScrapeJobSummary> {
  const { data: brand, error } = await context.supabase
    .from("brands")
    .select("id,domain")
    .eq("id", brandId)
    .eq("user_id", context.userId)
    .single();

  if (error || !brand) {
    throw new Error(error?.message ?? "Brand not found.");
  }

  if (!brand.domain) {
    throw new Error("Add a domain before scraping contact pages.");
  }

  const activeJob = await getActivePageScrapeJob(context, brand.id);

  if (activeJob) {
    return activeJob;
  }

  return enqueueJob(context.supabase, {
    userId: context.userId,
    kind: "page_scrape",
    payload: {
      brand_id: brand.id,
      domain: brand.domain,
    },
  });
}

export async function enqueueBulkPageScrapesForUser(
  context: BrandContext,
  options: { limit?: number } = {},
): Promise<BulkPageScrapeEnqueueResult> {
  const limit = options.limit ?? 25;
  const [brandsResult, contactsResult, activeJobsResult] = await Promise.all([
    context.supabase
      .from("brands")
      .select("id,domain")
      .eq("user_id", context.userId)
      .order("created_at", {
        ascending: true,
      }),
    context.supabase
      .from("brand_contacts")
      .select("brand_id")
      .eq("user_id", context.userId),
    context.supabase
      .from("jobs")
      .select("payload_json")
      .eq("user_id", context.userId)
      .eq("kind", "page_scrape")
      .in("status", ["queued", "running"]),
  ]);

  if (brandsResult.error) {
    throw new Error(brandsResult.error.message);
  }

  if (contactsResult.error) {
    throw new Error(contactsResult.error.message);
  }

  if (activeJobsResult.error) {
    throw new Error(activeJobsResult.error.message);
  }

  const brandsWithContacts = new Set(
    (contactsResult.data ?? []).map((contact) => contact.brand_id),
  );
  const brandsWithActiveJobs = new Set(
    (activeJobsResult.data ?? [])
      .map((job) => readBrandIdFromPayload(job.payload_json))
      .filter((brandId): brandId is string => Boolean(brandId)),
  );
  const targets = (brandsResult.data ?? [])
    .filter(
      (brand) =>
        brand.domain &&
        !brandsWithContacts.has(brand.id) &&
        !brandsWithActiveJobs.has(brand.id),
    )
    .slice(0, limit);

  for (const brand of targets) {
    await enqueueJob(context.supabase, {
      userId: context.userId,
      kind: "page_scrape",
      payload: {
        brand_id: brand.id,
        domain: brand.domain ?? "",
      },
    });
  }

  return {
    enqueued: targets.length,
    skipped: Math.max(0, (brandsResult.data ?? []).length - targets.length),
  };
}

export async function getBrandPageScrapeJobStatus(
  context: BrandContext,
  brandId: string,
): Promise<PageScrapeJobSummary | null> {
  return getLatestPageScrapeJob(context.supabase, context.userId, brandId);
}

export async function getJobSummary(
  context: {
    supabase: SupabaseClient<Database>;
    userId: string;
  },
): Promise<JobSummary> {
  const failedSince = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
    .toISOString();
  const [queuedResult, runningResult, failedResult] = await Promise.all([
    context.supabase
      .from("jobs")
      .select("id", {
        count: "exact",
        head: true,
      })
      .eq("user_id", context.userId)
      .eq("status", "queued"),
    context.supabase
      .from("jobs")
      .select("id", {
        count: "exact",
        head: true,
      })
      .eq("user_id", context.userId)
      .eq("status", "running"),
    context.supabase
      .from("jobs")
      .select("id", {
        count: "exact",
        head: true,
      })
      .eq("user_id", context.userId)
      .eq("status", "failed")
      .gte("finished_at", failedSince),
  ]);

  if (queuedResult.error) {
    throw new Error(queuedResult.error.message);
  }

  if (runningResult.error) {
    throw new Error(runningResult.error.message);
  }

  if (failedResult.error) {
    throw new Error(failedResult.error.message);
  }

  return {
    queued: queuedResult.count ?? 0,
    running: runningResult.count ?? 0,
    failedLast7Days: failedResult.count ?? 0,
  };
}

async function getActivePageScrapeJob(
  context: BrandContext,
  brandId: string,
) {
  const { data, error } = await context.supabase
    .from("jobs")
    .select(
      "id,status,payload_json,result_json,error_message,created_at,started_at,finished_at",
    )
    .eq("user_id", context.userId)
    .eq("kind", "page_scrape")
    .in("status", ["queued", "running"])
    .contains("payload_json", {
      brand_id: brandId,
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

async function getLatestPageScrapeJob(
  supabase: SupabaseClient<Database>,
  userId: string,
  brandId: string,
) {
  const { data, error } = await supabase
    .from("jobs")
    .select(
      "id,status,payload_json,result_json,error_message,created_at,started_at,finished_at",
    )
    .eq("user_id", userId)
    .eq("kind", "page_scrape")
    .contains("payload_json", {
      brand_id: brandId,
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

function readBrandIdFromPayload(payload: Json): string | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }

  const brandId = payload.brand_id;

  return typeof brandId === "string" ? brandId : null;
}
