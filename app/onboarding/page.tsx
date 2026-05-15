import { redirect } from "next/navigation";

import { OnboardingClient } from "@/app/onboarding/onboarding-client";
import { voiceStyleGuideJsonSchema } from "@/lib/db/style-guide";
import type { VoiceStyleGuideJson } from "@/lib/db/style-guide";
import { defaultCreatorProfiles } from "@/lib/onboarding/defaults";
import {
  getDefaultUserBasics,
  getOnboardingSnapshot,
  type CreatorProfile,
} from "@/lib/onboarding/service";
import { createClient } from "@/lib/supabase/server";

type OnboardingPageProps = {
  searchParams?: {
    step?: string;
    profile?: string;
  };
};

export default async function OnboardingPage({
  searchParams,
}: OnboardingPageProps) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const snapshot = await getOnboardingSnapshot({
    supabase,
    userId: user.id,
    email: user.email ?? "",
  });
  const profiles =
    snapshot.creatorProfiles.length > 0
      ? snapshot.creatorProfiles
      : defaultCreatorProfiles.map(
          (profile) =>
            ({
              id: "",
              created_at: "",
              updated_at: "",
              user_id: user.id,
              voice_style_guide_id: null,
              audience_size_snapshot: null,
              engagement_rate_snapshot: null,
              tier: null,
              bio_extract: null,
              handle: profile.handle,
              display_name: profile.display_name,
              platform: profile.platform ?? "instagram",
              niche_tags: profile.niche_tags ?? [],
              aesthetic_keywords: profile.aesthetic_keywords ?? [],
              recent_post_themes: profile.recent_post_themes ?? [],
              active: profile.active ?? true,
              cross_pitch_cooldown_days:
                profile.cross_pitch_cooldown_days ?? 90,
            }) satisfies CreatorProfile,
        );
  const guideJsonByProfileId: Record<string, VoiceStyleGuideJson> = {};

  for (const [profileId, guide] of Object.entries(
    snapshot.activeGuideByProfileId,
  )) {
    const parsed = voiceStyleGuideJsonSchema.safeParse(guide.style_doc_json);

    if (parsed.success) {
      guideJsonByProfileId[profileId] = parsed.data;
    }
  }

  return (
    <OnboardingClient
      authDefaults={getDefaultUserBasics(user)}
      initialActiveGuides={snapshot.activeGuideByProfileId}
      initialGuideJsonByProfileId={guideJsonByProfileId}
      initialProfiles={profiles}
      initialStep={normalizeStep(searchParams?.step)}
      initialUser={snapshot.user}
      initialCompetitorHandlesByProfileId={snapshot.competitorHandlesByProfileId}
      profileFocus={searchParams?.profile}
      voiceSampleCountsByProfileId={snapshot.voiceSampleCountsByProfileId}
    />
  );
}

function normalizeStep(step: string | undefined) {
  if (step === "profiles") {
    return 2;
  }

  if (step === "voice") {
    return 3;
  }

  if (step === "guide") {
    return 4;
  }

  if (step === "competitors") {
    return 5;
  }

  return 1;
}
