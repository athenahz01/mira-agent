import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database, Tables } from "../../lib/db/types.ts";
import {
  runFollowUpScan,
  type RunFollowUpScanResult,
} from "../../lib/follow-ups/service.ts";

export async function processFollowUpGenerateJob(
  supabase: SupabaseClient<Database>,
  job: Tables<"jobs">,
): Promise<RunFollowUpScanResult> {
  return runFollowUpScan({
    supabase,
    userId: job.user_id,
  });
}
