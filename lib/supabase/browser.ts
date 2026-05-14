import { createBrowserClient } from "@supabase/ssr";

import type { Database } from "@/lib/db/types";
import { getSupabasePublicEnv } from "@/lib/supabase/env";

export function createClient() {
  const env = getSupabasePublicEnv();

  return createBrowserClient<Database>(env.url, env.anonKey);
}
