import type { SupabaseClient } from "@supabase/supabase-js";

import {
  mediaKitJsonSchema,
  type MediaKitJson,
  type PastBrandWorkInput,
} from "../db/media-kit.ts";
import { voiceStyleGuideJsonSchema } from "../db/style-guide.ts";
import type { Database, Json, Tables, TablesInsert } from "../db/types";
import {
  generateMediaKitData,
  rateBenchmarks,
  type MediaKitAudienceSnapshot,
} from "../llm/media-kit.ts";
import type { CreatorProfileSummary } from "../llm/voice-guide";

export type MediaKitContext = {
  supabase: SupabaseClient<Database>;
  userId: string;
  email: string;
};

export type MediaKitRow = Tables<"media_kits">;
export type CreatorProfileRow = Tables<"creator_profiles">;
export type PastBrandWorkRow = Tables<"past_brand_work">;

type MediaKitGenerator = typeof generateMediaKitData;

export type MediaKitPageProfile = {
  profile: CreatorProfileRow;
  activeKit: MediaKitRow | null;
  activeKitJson: MediaKitJson | null;
  pastBrandWork: PastBrandWorkRow[];
};

export async function listMediaKitPageProfiles(
  context: MediaKitContext,
): Promise<MediaKitPageProfile[]> {
  const { data: profiles, error: profilesError } = await context.supabase
    .from("creator_profiles")
    .select("*")
    .eq("user_id", context.userId)
    .eq("active", true)
    .order("handle");

  if (profilesError) {
    throw new Error(profilesError.message);
  }

  const profileIds = (profiles ?? []).map((profile) => profile.id);
  const [kitsResult, workResult] =
    profileIds.length > 0
      ? await Promise.all([
          context.supabase
            .from("media_kits")
            .select("*")
            .eq("user_id", context.userId)
            .eq("is_active", true)
            .in("creator_profile_id", profileIds),
          context.supabase
            .from("past_brand_work")
            .select("*")
            .eq("user_id", context.userId)
            .in("creator_profile_id", profileIds)
            .order("sort_order"),
        ])
      : [
          { data: [], error: null },
          { data: [], error: null },
        ];

  if (kitsResult.error) {
    throw new Error(kitsResult.error.message);
  }

  if (workResult.error) {
    throw new Error(workResult.error.message);
  }

  return (profiles ?? []).map((profile) => {
    const activeKit =
      kitsResult.data?.find((kit) => kit.creator_profile_id === profile.id) ??
      null;
    const parsedKit = activeKit
      ? mediaKitJsonSchema.safeParse(activeKit.data_json)
      : null;

    return {
      profile,
      activeKit,
      activeKitJson: parsedKit?.success ? parsedKit.data : null,
      pastBrandWork:
        workResult.data?.filter(
          (work) => work.creator_profile_id === profile.id,
        ) ?? [],
    };
  });
}

export async function upsertPastBrandWork(
  context: MediaKitContext,
  profileId: string,
  entries: PastBrandWorkInput[],
): Promise<PastBrandWorkRow[]> {
  await getCreatorProfile(context, profileId);
  const { error: deleteError } = await context.supabase
    .from("past_brand_work")
    .delete()
    .eq("user_id", context.userId)
    .eq("creator_profile_id", profileId);

  if (deleteError) {
    throw new Error(deleteError.message);
  }

  if (entries.length === 0) {
    return [];
  }

  const rows: TablesInsert<"past_brand_work">[] = entries.map(
    (entry, index) => ({
      ...entry,
      user_id: context.userId,
      creator_profile_id: profileId,
      sort_order: index,
    }),
  );
  const { data, error } = await context.supabase
    .from("past_brand_work")
    .insert(rows)
    .select("*")
    .order("sort_order");

  if (error || !data) {
    throw new Error(error?.message ?? "Could not save past brand work.");
  }

  return data;
}

export async function generateAndPersistMediaKit(
  context: MediaKitContext,
  profileId: string,
  pastBrandWork: PastBrandWorkInput[],
  generator: MediaKitGenerator = generateMediaKitData,
): Promise<MediaKitRow> {
  const [profile, voiceGuide] = await Promise.all([
    getCreatorProfile(context, profileId),
    getActiveVoiceGuide(context, profileId),
  ]);
  await upsertPastBrandWork(context, profileId, pastBrandWork);
  const audienceSnapshot: MediaKitAudienceSnapshot = {
    follower_count: profile.audience_size_snapshot ?? 0,
    engagement_rate: profile.engagement_rate_snapshot ?? 0,
    tier: normalizeTier(profile.tier, profile.audience_size_snapshot ?? 0),
  };
  const generated = await generator({
    creatorProfile: toCreatorProfileSummary(profile),
    voiceStyleGuide: voiceGuide,
    audienceSnapshot,
    pastBrandWork,
    industryBenchmarks: rateBenchmarks,
    userEmail: context.email,
    userWebsite: "https://athenahuo.com",
  });

  return persistMediaKit(context, profileId, generated);
}

export async function persistMediaKit(
  context: MediaKitContext,
  profileId: string,
  kit: MediaKitJson,
): Promise<MediaKitRow> {
  await getCreatorProfile(context, profileId);
  const parsedKit = mediaKitJsonSchema.parse(kit);
  const { data: latest, error: latestError } = await context.supabase
    .from("media_kits")
    .select("version")
    .eq("user_id", context.userId)
    .eq("creator_profile_id", profileId)
    .order("version", {
      ascending: false,
    })
    .limit(1);

  if (latestError) {
    throw new Error(latestError.message);
  }

  const nextVersion = (latest?.[0]?.version ?? 0) + 1;
  const { error: deactivateError } = await context.supabase
    .from("media_kits")
    .update({
      is_active: false,
    })
    .eq("user_id", context.userId)
    .eq("creator_profile_id", profileId);

  if (deactivateError) {
    throw new Error(deactivateError.message);
  }

  const { data, error } = await context.supabase
    .from("media_kits")
    .insert({
      user_id: context.userId,
      creator_profile_id: profileId,
      version: nextVersion,
      data_json: parsedKit as unknown as Json,
      is_active: true,
    })
    .select("*")
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? "Could not save media kit.");
  }

  return data;
}

export async function saveMediaKitEdits(
  context: MediaKitContext,
  kitId: string,
  edits: MediaKitJson,
): Promise<MediaKitRow> {
  const parsed = mediaKitJsonSchema.parse(edits);
  const { data, error } = await context.supabase
    .from("media_kits")
    .update({
      data_json: parsed as unknown as Json,
    })
    .eq("id", kitId)
    .eq("user_id", context.userId)
    .select("*")
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? "Could not save media kit edits.");
  }

  return data;
}

export async function updateMediaKitPdfPath(
  context: MediaKitContext,
  kitId: string,
  pdfPath: string,
): Promise<MediaKitRow> {
  const { data, error } = await context.supabase
    .from("media_kits")
    .update({
      pdf_url: pdfPath,
    })
    .eq("id", kitId)
    .eq("user_id", context.userId)
    .select("*")
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? "Could not save media kit PDF path.");
  }

  return data;
}

export async function getMediaKit(
  context: MediaKitContext,
  kitId: string,
): Promise<{ row: MediaKitRow; json: MediaKitJson }> {
  const { data, error } = await context.supabase
    .from("media_kits")
    .select("*")
    .eq("id", kitId)
    .eq("user_id", context.userId)
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? "Could not find media kit.");
  }

  return {
    row: data,
    json: mediaKitJsonSchema.parse(data.data_json),
  };
}

async function getCreatorProfile(
  context: MediaKitContext,
  profileId: string,
): Promise<CreatorProfileRow> {
  const { data, error } = await context.supabase
    .from("creator_profiles")
    .select("*")
    .eq("id", profileId)
    .eq("user_id", context.userId)
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? "Could not find creator profile.");
  }

  return data;
}

async function getActiveVoiceGuide(
  context: MediaKitContext,
  profileId: string,
) {
  const { data, error } = await context.supabase
    .from("voice_style_guides")
    .select("style_doc_json")
    .eq("user_id", context.userId)
    .eq("creator_profile_id", profileId)
    .eq("is_active", true)
    .single();

  if (error || !data) {
    throw new Error(
      error?.message ?? "Generate a voice guide before creating a media kit.",
    );
  }

  return voiceStyleGuideJsonSchema.parse(data.style_doc_json);
}

function toCreatorProfileSummary(
  profile: CreatorProfileRow,
): CreatorProfileSummary {
  return {
    handle: profile.handle,
    display_name: profile.display_name,
    niche_tags: profile.niche_tags,
    aesthetic_keywords: profile.aesthetic_keywords,
    bio_extract: profile.bio_extract,
    recent_post_themes: profile.recent_post_themes,
    tier: profile.tier,
  };
}

function normalizeTier(tier: string | null, followers: number) {
  if (tier === "nano" || tier === "micro" || tier === "mid" || tier === "macro") {
    return tier;
  }

  if (followers < 10_000) {
    return "nano";
  }

  if (followers < 100_000) {
    return "micro";
  }

  if (followers < 500_000) {
    return "mid";
  }

  return "macro";
}
