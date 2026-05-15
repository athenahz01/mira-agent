import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database, Tables } from "../../lib/db/types.ts";
import { processSendQueue } from "../../lib/sending/service.ts";

export async function processSendEmailJob(
  supabase: SupabaseClient<Database>,
  _job: Tables<"jobs">,
): Promise<{ processed: number; sent: number; failed: number }> {
  return processSendQueue({
    supabase,
  });
}
