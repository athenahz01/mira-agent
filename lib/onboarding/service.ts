import type { SupabaseClient } from "@supabase/supabase-js";

import type { VoiceStyleGuideJson } from "../db/style-guide";
import { voiceStyleGuideJsonSchema } from "../db/style-guide.ts";
import type { Database, Json, Tables, TablesInsert } from "../db/types";
import type {
  CreatorProfileSummary,
  VoiceSampleForGuide,
} from "../llm/voice-guide";
import { generateVoiceGuide } from "../llm/voice-guide.ts";
import {
  defaultCreatorProfiles,
  defaultSenderDisplayName,
  defaultTimezone,
} from "./defaults.ts";
import {
  addVoiceSamplesSchema,
  creatorProfileSchema,
  profileIdSchema,
  saveVoiceGuideEditsSchema,
  userBasicsSchema,
} from "./schemas.ts";

export type OnboardingContext = {
  supabase: SupabaseClient<Database>;
  userId: string;
  email: string;
};

export type OnboardingUser = Tables<"users">;
export type CreatorProfile = Tables<"creator_profiles">;
export type VoiceGuideRow = Tables<"voice_style_guides">;
export type VoiceSampleRow = Tables<"voice_samples">;

export type OnboardingSnapshot = {
  user: OnboardingUser | null;
  creatorProfiles: CreatorProfile[];
  activeGuideByProfileId: Record<string, VoiceGuideRow>;
  voiceSampleCountsByProfileId: Record<string, number>;
};

type VoiceGuideGenerator = typeof generateVoiceGuide;

export async function getOnboardingSnapshot(
  context: OnboardingContext,
): Promise<OnboardingSnapshot> {
  const [{ data: user, error: userError }, profiles] = await Promise.all([
    context.supabase
      .from("users")
      .select("*")
      .eq("user_id", context.userId)
      .maybeSingle(),
    listCreatorProfiles(context),
  ]);

  if (userError) {
    throw new Error(userError.message);
  }

  const profileIds = profiles.map((profile) => profile.id);
  const activeGuideByProfileId: Record<string, VoiceGuideRow> = {};
  const voiceSampleCountsByProfileId: Record<string, number> = {};

  if (profileIds.length > 0) {
    const [{ data: guides, error: guideError }, samples] = await Promise.all([
      context.supabase
        .from("voice_style_guides")
        .select("*")
        .eq("user_id", context.userId)
        .eq("is_active", true)
        .in("creator_profile_id", profileIds),
      listVoiceSamples(context),
    ]);

    if (guideError) {
      throw new Error(guideError.message);
    }

    for (const guide of guides ?? []) {
      activeGuideByProfileId[guide.creator_profile_id] = guide;
    }

    for (const sample of samples) {
      voiceSampleCountsByProfileId[sample.creator_profile_id] =
        (voiceSampleCountsByProfileId[sample.creator_profile_id] ?? 0) + 1;
    }
  }

  return {
    user,
    creatorProfiles: profiles,
    activeGuideByProfileId,
    voiceSampleCountsByProfileId,
  };
}

export async function ensureDefaultCreatorProfiles(
  context: OnboardingContext,
): Promise<CreatorProfile[]> {
  const rows: TablesInsert<"creator_profiles">[] = defaultCreatorProfiles.map(
    (profile) => ({
      ...profile,
      user_id: context.userId,
    }),
  );

  const { data, error } = await context.supabase
    .from("creator_profiles")
    .upsert(rows, {
      onConflict: "user_id,handle",
    })
    .select("*")
    .order("handle", {
      ascending: true,
    });

  if (error || !data) {
    throw new Error(error?.message ?? "Could not ensure creator profiles.");
  }

  return data;
}

export async function upsertUserBasics(
  context: OnboardingContext,
  input: unknown,
): Promise<OnboardingUser> {
  const values = userBasicsSchema.parse(input);
  const { data, error } = await context.supabase
    .from("users")
    .upsert(
      {
        user_id: context.userId,
        email: context.email,
        name: values.name,
        timezone: values.timezone,
        physical_address: values.physical_address,
        sender_display_name: values.sender_display_name,
      },
      {
        onConflict: "user_id",
      },
    )
    .select("*")
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? "Could not save account basics.");
  }

  return data;
}

export async function listCreatorProfiles(
  context: OnboardingContext,
): Promise<CreatorProfile[]> {
  const { data, error } = await context.supabase
    .from("creator_profiles")
    .select("*")
    .eq("user_id", context.userId)
    .order("handle", {
      ascending: true,
    });

  if (error) {
    throw new Error(error.message);
  }

  return data ?? [];
}

export async function upsertCreatorProfile(
  context: OnboardingContext,
  input: unknown,
): Promise<CreatorProfile> {
  const values = creatorProfileSchema.parse(input);
  const payload: TablesInsert<"creator_profiles"> = {
    ...values,
    user_id: context.userId,
  };

  if (values.id) {
    const { data, error } = await context.supabase
      .from("creator_profiles")
      .update(payload)
      .eq("id", values.id)
      .eq("user_id", context.userId)
      .select("*")
      .single();

    if (error || !data) {
      throw new Error(error?.message ?? "Could not save creator profile.");
    }

    return data;
  }

  const { data, error } = await context.supabase
    .from("creator_profiles")
    .upsert(payload, {
      onConflict: "user_id,handle",
    })
    .select("*")
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? "Could not save creator profile.");
  }

  return data;
}

export async function addVoiceSamples(
  context: OnboardingContext,
  input: unknown,
): Promise<VoiceSampleRow[]> {
  const values = addVoiceSamplesSchema.parse(input);
  await assertProfileOwner(context, values.profileId);

  const rows: TablesInsert<"voice_samples">[] = values.samples.map((sample) => ({
    user_id: context.userId,
    creator_profile_id: values.profileId,
    source: sample.source,
    text: sample.text,
    tag: sample.tag,
  }));

  const { data, error } = await context.supabase
    .from("voice_samples")
    .insert(rows)
    .select("*");

  if (error || !data) {
    throw new Error(error?.message ?? "Could not save voice samples.");
  }

  return data;
}

export async function generateAndPersistVoiceGuide(
  context: OnboardingContext,
  input: unknown,
  generator: VoiceGuideGenerator = generateVoiceGuide,
): Promise<VoiceGuideRow> {
  const { profileId } = profileIdSchema.parse(input);
  const [profile, samples] = await Promise.all([
    getCreatorProfile(context, profileId),
    listVoiceSamples(context, profileId),
  ]);

  const styleGuide = await generator({
    creatorProfile: toCreatorProfileSummary(profile),
    voiceSamples: samples.map(toVoiceSampleForGuide),
  });

  return persistVoiceGuide(context, profileId, styleGuide);
}

export async function persistVoiceGuide(
  context: OnboardingContext,
  profileId: string,
  styleGuide: VoiceStyleGuideJson,
): Promise<VoiceGuideRow> {
  await assertProfileOwner(context, profileId);
  const parsedGuide = voiceStyleGuideJsonSchema.parse(styleGuide);
  const { data: latest, error: latestError } = await context.supabase
    .from("voice_style_guides")
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
    .from("voice_style_guides")
    .update({
      is_active: false,
    })
    .eq("user_id", context.userId)
    .eq("creator_profile_id", profileId);

  if (deactivateError) {
    throw new Error(deactivateError.message);
  }

  const { data: guide, error: insertError } = await context.supabase
    .from("voice_style_guides")
    .insert({
      user_id: context.userId,
      creator_profile_id: profileId,
      version: nextVersion,
      is_active: true,
      style_doc_json: parsedGuide as unknown as Json,
      learned_from_message_ids: [],
    })
    .select("*")
    .single();

  if (insertError || !guide) {
    throw new Error(insertError?.message ?? "Could not save voice guide.");
  }

  const { error: profileError } = await context.supabase
    .from("creator_profiles")
    .update({
      voice_style_guide_id: guide.id,
    })
    .eq("id", profileId)
    .eq("user_id", context.userId);

  if (profileError) {
    throw new Error(profileError.message);
  }

  return guide;
}

export async function saveVoiceGuideEdits(
  context: OnboardingContext,
  input: unknown,
): Promise<VoiceGuideRow> {
  const { guideId, edits } = saveVoiceGuideEditsSchema.parse(input);
  const { data, error } = await context.supabase
    .from("voice_style_guides")
    .update({
      style_doc_json: edits as unknown as Json,
    })
    .eq("id", guideId)
    .eq("user_id", context.userId)
    .select("*")
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? "Could not save voice guide edits.");
  }

  return data;
}

export async function completeOnboarding(
  context: OnboardingContext,
): Promise<OnboardingUser> {
  const { data, error } = await context.supabase
    .from("users")
    .update({
      onboarding_completed_at: new Date().toISOString(),
    })
    .eq("user_id", context.userId)
    .select("*")
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? "Could not complete onboarding.");
  }

  return data;
}

export function getDefaultUserBasics(user: {
  email?: string | null;
  user_metadata?: {
    name?: unknown;
  };
}) {
  const metadataName =
    typeof user.user_metadata?.name === "string"
      ? user.user_metadata.name
      : defaultSenderDisplayName;

  return {
    name: metadataName,
    timezone: defaultTimezone,
    physical_address: "",
    sender_display_name: defaultSenderDisplayName,
    email: user.email ?? "",
  };
}

async function getCreatorProfile(
  context: OnboardingContext,
  profileId: string,
): Promise<CreatorProfile> {
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

async function assertProfileOwner(
  context: OnboardingContext,
  profileId: string,
) {
  await getCreatorProfile(context, profileId);
}

async function listVoiceSamples(
  context: OnboardingContext,
  profileId?: string,
): Promise<VoiceSampleRow[]> {
  const baseQuery = context.supabase
    .from("voice_samples")
    .select("*")
    .eq("user_id", context.userId)
    .order("created_at", {
      ascending: true,
    });

  const query = profileId
    ? baseQuery.eq("creator_profile_id", profileId)
    : baseQuery;

  const { data, error } = await query;

  if (error) {
    throw new Error(error.message);
  }

  return data ?? [];
}

function toCreatorProfileSummary(
  profile: CreatorProfile,
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

function toVoiceSampleForGuide(sample: VoiceSampleRow): VoiceSampleForGuide {
  return {
    source: sample.source,
    text: sample.text,
    tag: sample.tag,
  };
}
