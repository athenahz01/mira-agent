import { redirect } from "next/navigation";

import { SettingsClient } from "@/app/settings/settings-client";
import type { Tables } from "@/lib/db/types";
import { createClient } from "@/lib/supabase/server";

type SettingsPageProps = {
  searchParams?: {
    gmail?: string;
  };
};

export default async function SettingsPage({ searchParams }: SettingsPageProps) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const [appUserResult, profilesResult, rulesResult, gmailResult] =
    await Promise.all([
      supabase
        .from("users")
        .select("*")
        .eq("user_id", user.id)
        .maybeSingle(),
      supabase
        .from("creator_profiles")
        .select("*")
        .eq("user_id", user.id)
        .order("handle"),
      supabase
        .from("outreach_rules")
        .select("*")
        .eq("user_id", user.id)
        .order("creator_profile_id"),
      supabase
        .from("gmail_credentials")
        .select("*")
        .eq("user_id", user.id)
        .is("revoked_at", null)
        .order("created_at", {
          ascending: false,
        })
        .limit(1)
        .maybeSingle(),
    ]);

  const rules = await ensureRules(
    supabase,
    user.id,
    profilesResult.data ?? [],
    rulesResult.data ?? [],
  );

  return (
    <SettingsClient
      appUser={appUserResult.data}
      authEmail={user.email ?? "zhengathenahuo@gmail.com"}
      gmailCredential={gmailResult.data}
      gmailStatus={searchParams?.gmail}
      profiles={profilesResult.data ?? []}
      rules={rules}
    />
  );
}

async function ensureRules(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  profiles: { id: string }[],
  existingRules: Tables<"outreach_rules">[],
) {
  const existingKeys = new Set(
    existingRules.map((rule) => rule.creator_profile_id ?? "global"),
  );
  const missingRows = [
    !existingKeys.has("global")
      ? {
          user_id: userId,
          creator_profile_id: null,
        }
      : null,
    ...profiles
      .filter((profile) => !existingKeys.has(profile.id))
      .map((profile) => ({
        user_id: userId,
        creator_profile_id: profile.id,
      })),
  ].filter(
    (row): row is { user_id: string; creator_profile_id: string | null } =>
      row !== null,
  );

  if (missingRows.length === 0) {
    return existingRules;
  }

  const { data, error } = await supabase
    .from("outreach_rules")
    .insert(missingRows)
    .select("*");

  if (error) {
    throw new Error(error.message);
  }

  return [...existingRules, ...(data ?? [])];
}
