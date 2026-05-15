import { redirect } from "next/navigation";

import { RepliesClient } from "@/app/replies/replies-client";
import { listRecentReplies } from "@/lib/replies/service";
import { createClient } from "@/lib/supabase/server";

export default async function RepliesPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const [appUserResult, rows] = await Promise.all([
    supabase
      .from("users")
      .select("inbox_last_polled_at,inbox_poll_paused")
      .eq("user_id", user.id)
      .single(),
    listRecentReplies(
      {
        supabase,
        userId: user.id,
      },
      {
        hideHandled: true,
      },
    ),
  ]);

  return (
    <RepliesClient
      inboxLastPolledAt={appUserResult.data?.inbox_last_polled_at ?? null}
      inboxPollPaused={appUserResult.data?.inbox_poll_paused ?? false}
      initialRows={rows}
    />
  );
}
