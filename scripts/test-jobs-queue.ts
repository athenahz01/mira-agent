import { randomUUID } from "node:crypto";

import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

import type { Database } from "../lib/db/types.ts";
import {
  claimNextJob,
  completeJob,
  enqueueJob,
  failJob,
} from "../lib/jobs/queue.ts";

const envSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
});

const envResult = envSchema.safeParse(process.env);

if (!envResult.success) {
  const missing = envResult.error.issues
    .map((issue) => issue.path.join("."))
    .join(", ");
  console.error(`Missing required env vars: ${missing}`);
  process.exit(1);
}

const env = envResult.data;
const service = createClient<Database>(
  env.NEXT_PUBLIC_SUPABASE_URL,
  env.SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  },
);
let createdUserId: string | null = null;

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(message);
  }
}

async function createUser() {
  const email = `mira-jobs-${randomUUID()}@example.com`;
  const { data, error } = await service.auth.admin.createUser({
    email,
    password: `Mira-${randomUUID()}-password`,
    email_confirm: true,
  });

  if (error || !data.user) {
    throw new Error(error?.message ?? "Could not create user.");
  }

  createdUserId = data.user.id;
  const { error: appUserError } = await service.from("users").insert({
    user_id: data.user.id,
    email,
    name: "Jobs Test",
  });

  if (appUserError) {
    throw new Error(appUserError.message);
  }

  return data.user.id;
}

async function loadJob(jobId: string) {
  const { data, error } = await service
    .from("jobs")
    .select("*")
    .eq("id", jobId)
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? "Could not load job.");
  }

  return data;
}

async function cleanup() {
  if (!createdUserId) {
    return;
  }

  const { error } = await service.auth.admin.deleteUser(createdUserId);

  if (error) {
    console.warn(`Cleanup failed: ${error.message}`);
  }
}

async function main() {
  const userId = await createUser();
  const job = await enqueueJob(service, {
    userId,
    kind: "page_scrape",
    payload: {
      brand_id: randomUUID(),
      domain: "example.com",
    },
  });

  assert(job.status === "queued", "Expected new job to be queued.");

  const [claimA, claimB] = await Promise.all([
    claimNextJob(service, "worker-a", "page_scrape", 300),
    claimNextJob(service, "worker-b", "page_scrape", 300),
  ]);
  const claimed = [claimA, claimB].filter((item) => item !== null);

  assert(claimed.length === 1, "Expected only one worker to claim the job.");
  assert(claimed[0]?.id === job.id, "Expected the queued job to be claimed.");
  assert(
    claimed[0]?.attempts === 1,
    `Expected attempts to be 1 after claim, got ${claimed[0]?.attempts}.`,
  );

  await completeJob(service, job.id, {
    ok: true,
  });
  const completed = await loadJob(job.id);
  assert(completed.status === "succeeded", "Expected job to complete.");
  assert(completed.locked_by === null, "Expected completed job lease cleared.");

  const retryJob = await enqueueJob(service, {
    userId,
    kind: "page_scrape",
    payload: {
      brand_id: randomUUID(),
      domain: "retry.example",
    },
    maxAttempts: 2,
  });
  const claimedRetry = await claimNextJob(
    service,
    "worker-retry",
    "page_scrape",
    300,
  );

  assert(claimedRetry?.id === retryJob.id, "Expected retry job claim.");
  await failJob(service, retryJob.id, "temporary error", 45);
  const retryQueued = await loadJob(retryJob.id);
  assert(retryQueued.status === "queued", "Expected retry job to requeue.");
  assert(
    retryQueued.next_attempt_at > retryQueued.created_at,
    "Expected retry job next_attempt_at to move forward.",
  );

  const finalJob = await enqueueJob(service, {
    userId,
    kind: "page_scrape",
    payload: {
      brand_id: randomUUID(),
      domain: "final.example",
    },
    maxAttempts: 1,
  });
  const claimedFinal = await claimNextJob(
    service,
    "worker-final",
    "page_scrape",
    300,
  );

  assert(claimedFinal?.id === finalJob.id, "Expected final job claim.");
  await failJob(service, finalJob.id, "permanent error", 45);
  const failed = await loadJob(finalJob.id);
  assert(failed.status === "failed", "Expected max-attempt job to fail.");
  assert(failed.finished_at !== null, "Expected failed job to have finished_at.");

  console.log("Jobs queue test passed.");
}

main()
  .catch((error: unknown) => {
    const message =
      error instanceof Error ? error.message : "Unknown jobs queue error";
    console.error(message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await cleanup();
  });
