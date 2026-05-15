import { randomUUID } from "node:crypto";

import { createClient } from "@supabase/supabase-js";

import type { Database, Json, Tables } from "../lib/db/types.ts";
import {
  claimNextJob,
  completeJob,
  failJob,
  type JobKind,
} from "../lib/jobs/queue.ts";
import { processAutoDraftJob } from "./scrapers/auto-draft.ts";
import { processInstagramScrapeJob } from "./scrapers/instagram-scrape.ts";
import { processPageScrapeJob } from "./scrapers/page-scrape.ts";
import { processSendEmailJob } from "./scrapers/send-email.ts";

const workerId = process.env.WORKER_ID ?? randomUUID();
const workerKinds = readWorkerKinds();
const supabase = createWorkerSupabaseClient();
let shuttingDown = false;

process.on("SIGTERM", requestShutdown);
process.on("SIGINT", requestShutdown);

console.log(`worker starting, id=${workerId}, kinds=${workerKinds.join(",")}`);

while (!shuttingDown) {
  const job = await claimNextAvailableJob();

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
    case "instagram_scrape":
      return (await processInstagramScrapeJob(supabase, job)) as Json;
    case "auto_draft":
      return (await processAutoDraftJob(supabase, job)) as Json;
    case "send_email":
      return (await processSendEmailJob(supabase, job)) as Json;
    default:
      throw new Error(`Unknown job kind: ${job.kind}`);
  }
}

async function claimNextAvailableJob() {
  for (const kind of workerKinds) {
    const job = await claimNextJob(supabase, workerId, kind);

    if (job) {
      return job;
    }
  }

  return null;
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

function readWorkerKinds(): JobKind[] {
  const value = process.env.WORKER_KIND ?? "page_scrape";
  const rawKinds =
    value.trim().toLowerCase() === "all"
      ? ["page_scrape", "instagram_scrape", "auto_draft", "send_email"]
      : value.split(",").map((kind) => kind.trim());
  const kinds: JobKind[] = [];

  for (const kind of rawKinds) {
    if (
      kind === "page_scrape" ||
      kind === "instagram_scrape" ||
      kind === "auto_draft" ||
      kind === "send_email"
    ) {
      if (!kinds.includes(kind)) {
        kinds.push(kind);
      }
      continue;
    }

    throw new Error(`Unsupported WORKER_KIND: ${value}`);
  }

  if (kinds.length === 0) {
    throw new Error("WORKER_KIND must include at least one supported kind.");
  }

  return kinds;
}

function requestShutdown() {
  shuttingDown = true;
  console.log(`worker shutdown requested, id=${workerId}`);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
