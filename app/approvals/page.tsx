import { redirect } from "next/navigation";

import { ApprovalsClient } from "@/app/approvals/approvals-client";
import { listPendingApprovals } from "@/lib/drafting/service";
import { createClient } from "@/lib/supabase/server";

type ApprovalsPageProps = {
  searchParams?: Record<string, string | string[] | undefined>;
};

export default async function ApprovalsPage({
  searchParams,
}: ApprovalsPageProps) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const context = {
    supabase,
    userId: user.id,
  };
  const [initialList, profiles] = await Promise.all([
    listPendingApprovals(context, {
      minScore: Number(valueOf(searchParams?.minScore) ?? 40),
    }),
    loadProfiles(context),
  ]);

  return (
    <ApprovalsClient
      focusMessageId={valueOf(searchParams?.focus) ?? null}
      initialList={initialList}
      profiles={profiles}
    />
  );
}

async function loadProfiles(context: {
  supabase: Awaited<ReturnType<typeof createClient>>;
  userId: string;
}) {
  const { data, error } = await context.supabase
    .from("creator_profiles")
    .select("id,handle,display_name")
    .eq("user_id", context.userId)
    .eq("active", true)
    .order("handle", { ascending: true });

  if (error) {
    throw new Error(error.message);
  }

  return data ?? [];
}

function valueOf(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}
