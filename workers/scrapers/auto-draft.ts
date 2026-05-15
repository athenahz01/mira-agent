import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database, Tables } from "../../lib/db/types.ts";
import {
  runAutoDraftBatch,
  type RunAutoDraftBatchResult,
} from "../../lib/drafting/batch.ts";

export async function processAutoDraftJob(
  supabase: SupabaseClient<Database>,
  job: Tables<"jobs">,
): Promise<RunAutoDraftBatchResult> {
  const payload = parsePayload(job.payload_json);

  return runAutoDraftBatch({
    supabase,
    userId: job.user_id,
  }, {
    creatorProfileIds: payload.creator_profile_ids,
  });
}

function parsePayload(value: Tables<"jobs">["payload_json"]) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const creatorProfileIds = Array.isArray(value.creator_profile_ids)
    ? value.creator_profile_ids.filter(
        (item): item is string => typeof item === "string",
      )
    : undefined;

  return {
    creator_profile_ids: creatorProfileIds,
  };
}
