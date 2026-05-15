import { redirect } from "next/navigation";

import { SendsClient } from "@/app/sends/sends-client";
import { listScheduledSends } from "@/lib/sending/service";
import { createClient } from "@/lib/supabase/server";

export default async function SendsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const rows = await listScheduledSends({
    supabase,
    userId: user.id,
  });

  return <SendsClient initialRows={rows} />;
}
