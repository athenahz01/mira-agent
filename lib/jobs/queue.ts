import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database, Json, Tables } from "@/lib/db/types";

export type Job = Tables<"jobs">;

export type JobKind = "page_scrape" | "instagram_scrape" | "auto_draft";

export async function claimNextJob(
  supabase: SupabaseClient<Database>,
  workerId: string,
  kind: JobKind,
  leaseSeconds = 300,
): Promise<Job | null> {
  const { data, error } = await supabase.rpc("claim_next_job", {
    p_kind: kind,
    p_worker_id: workerId,
    p_lease_seconds: leaseSeconds,
  });

  if (error) {
    throw new Error(error.message);
  }

  return data?.[0] ?? null;
}

export async function completeJob(
  supabase: SupabaseClient<Database>,
  jobId: string,
  result: Json,
): Promise<void> {
  const { error } = await supabase
    .from("jobs")
    .update({
      status: "succeeded",
      result_json: result,
      error_message: null,
      finished_at: new Date().toISOString(),
      locked_by: null,
      locked_until: null,
    })
    .eq("id", jobId);

  if (error) {
    throw new Error(error.message);
  }
}

export async function failJob(
  supabase: SupabaseClient<Database>,
  jobId: string,
  errorMessage: string,
  backoffSeconds: number,
): Promise<void> {
  const { data: job, error: loadError } = await supabase
    .from("jobs")
    .select("attempts,max_attempts")
    .eq("id", jobId)
    .single();

  if (loadError || !job) {
    throw new Error(loadError?.message ?? "Could not load job.");
  }

  const exhaustedAttempts = job.attempts >= job.max_attempts;
  const nextAttemptAt = new Date(Date.now() + backoffSeconds * 1000);
  const { error } = await supabase
    .from("jobs")
    .update({
      status: exhaustedAttempts ? "failed" : "queued",
      error_message: errorMessage,
      next_attempt_at: exhaustedAttempts
        ? new Date().toISOString()
        : nextAttemptAt.toISOString(),
      finished_at: exhaustedAttempts ? new Date().toISOString() : null,
      locked_by: null,
      locked_until: null,
    })
    .eq("id", jobId);

  if (error) {
    throw new Error(error.message);
  }
}

export async function enqueueJob(
  supabase: SupabaseClient<Database>,
  input: {
    userId: string;
    kind: JobKind;
    payload: Json;
    maxAttempts?: number;
  },
): Promise<Job> {
  const { data, error } = await supabase
    .from("jobs")
    .insert({
      user_id: input.userId,
      kind: input.kind,
      payload_json: input.payload,
      max_attempts: input.maxAttempts ?? 3,
    })
    .select("*")
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? "Could not enqueue job.");
  }

  return data;
}
