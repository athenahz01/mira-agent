"use server";

import { revalidatePath } from "next/cache";

import type { VoiceStyleGuideJson } from "@/lib/db/style-guide";
import type { Tables } from "@/lib/db/types";
import {
  addVoiceSamples as addVoiceSamplesRows,
  completeOnboarding as completeOnboardingForUser,
  ensureDefaultCreatorProfiles,
  generateAndPersistVoiceGuide,
  saveVoiceGuideEdits as saveVoiceGuideEditsForUser,
  upsertCreatorProfile as upsertCreatorProfileForUser,
  upsertUserBasics as upsertUserBasicsForUser,
  type OnboardingContext,
} from "@/lib/onboarding/service";
import type {
  CreatorProfileInput,
  VoiceSampleInput,
} from "@/lib/onboarding/schemas";
import { createClient } from "@/lib/supabase/server";

export type ActionResult<T> =
  | {
      ok: true;
      data: T;
      message: string;
    }
  | {
      ok: false;
      error: string;
    };

export async function upsertUserBasics(
  input: unknown,
): Promise<ActionResult<Tables<"users">>> {
  return runOnboardingAction("Account basics saved.", async (context) =>
    upsertUserBasicsForUser(context, input),
  );
}

export async function upsertCreatorProfile(
  input: CreatorProfileInput,
): Promise<ActionResult<Tables<"creator_profiles">>> {
  return runOnboardingAction("Creator profile saved.", async (context) =>
    upsertCreatorProfileForUser(context, input),
  );
}

export async function addVoiceSamples(
  profileId: string,
  samples: VoiceSampleInput[],
): Promise<ActionResult<Tables<"voice_samples">[]>> {
  return runOnboardingAction("Voice samples saved.", async (context) =>
    addVoiceSamplesRows(context, {
      profileId,
      samples,
    }),
  );
}

export async function generateVoiceGuide(
  profileId: string,
): Promise<ActionResult<Tables<"voice_style_guides">>> {
  return runOnboardingAction("Voice guide generated.", async (context) =>
    generateAndPersistVoiceGuide(context, {
      profileId,
    }),
  );
}

export async function saveVoiceGuideEdits(
  guideId: string,
  edits: VoiceStyleGuideJson,
): Promise<ActionResult<Tables<"voice_style_guides">>> {
  return runOnboardingAction("Voice guide edits saved.", async (context) =>
    saveVoiceGuideEditsForUser(context, {
      guideId,
      edits,
    }),
  );
}

export async function completeOnboarding(): Promise<
  ActionResult<Tables<"users">>
> {
  return runOnboardingAction("Onboarding complete.", async (context) =>
    completeOnboardingForUser(context),
  );
}

export async function ensureOnboardingProfiles(): Promise<
  ActionResult<Tables<"creator_profiles">[]>
> {
  return runOnboardingAction("Creator profiles ready.", async (context) =>
    ensureDefaultCreatorProfiles(context),
  );
}

async function runOnboardingAction<T>(
  message: string,
  callback: (context: OnboardingContext) => Promise<T>,
): Promise<ActionResult<T>> {
  try {
    const context = await getOnboardingContext();
    const data = await callback(context);
    revalidatePath("/onboarding");
    revalidatePath("/dashboard");

    return {
      ok: true,
      data,
      message,
    };
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : "Mira could not save that yet.",
    };
  }
}

async function getOnboardingContext(): Promise<OnboardingContext> {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    throw new Error("Please sign in first.");
  }

  return {
    supabase,
    userId: user.id,
    email: user.email ?? "",
  };
}
