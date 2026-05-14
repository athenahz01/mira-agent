import { randomUUID } from "node:crypto";

import { createClient } from "@supabase/supabase-js";

import type { Database, Json, Tables } from "../lib/db/types.ts";
import {
  claimNextJob,
  completeJob,
  failJob,
  type JobKind,
} from "../lib/jobs/queue.ts";
import { processPageScrapeJob } from "./scrapers/page-scrape.ts";

const workerId = process.env.WORKER_ID ?? randomUUID();
const workerKind = readWorkerKind();
const supabase = createWorkerSupabaseClient();
let shuttingDown = false;

process.on("SIGTERM", requestShutdown);
process.on("SIGINT", requestShutdown);

console.log(`worker starting, id=${workerId}, kind=${workerKind}`);

while (!shuttingDown) {
  const job = await claimNextJob(supabase, workerId, workerKind);

  if (!job) {
    await sleep(5_000);
    continue;
  }

  await processJob(job);
}

console.log(`worker stopped, id=${workerId}`);

async function processJob(job: Tables<"jobs">) {
  console.log(`worker ${workerId} claimed job ${job.id} (${job.kind})`);

  try {
    const result = await dispatchJob(job);
    await completeJob(supabase, job.id, result);
    console.log(`worker ${workerId} completed job ${job.id}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown job error";
    const backoffSeconds = Math.min(60 * 5, 30 * Math.pow(2, job.attempts));

    await failJob(supabase, job.id, message, backoffSeconds);
    console.error(`worker ${workerId} failed job ${job.id}: ${message}`);
  }
}

async function dispatchJob(job: Tables<"jobs">): Promise<Json> {
  switch (job.kind) {
    case "page_scrape":
      return (await processPageScrapeJob(supabase, job)) as Json;
    case "apify_scrape":
      throw new Error("apify_scrape is not implemented until Phase 2d.");
    default:
      throw new Error(`Unknown job kind: ${job.kind}`);
  }
}

function createWorkerSupabaseClient() {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error(
      "Missing SUPABASE_URL/NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.",
    );
  }

  return createClient<Database>(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

function readWorkerKind(): JobKind {
  const value = process.env.WORKER_KIND ?? "page_scrape";

  if (value === "page_scrape" || value === "apify_scrape") {
    return value;
  }

  throw new Error(`Unsupported WORKER_KIND: ${value}`);
}

function requestShutdown() {
  shuttingDown = true;
  console.log(`worker shutdown requested, id=${workerId}`);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
