"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import type { ActionResult } from "@/lib/server/action";
import {
  computeBrandFitScores,
  listRankedBrandsForUser,
  type ComputeFitScoresResult,
  type RankedBrandListResult,
  type ScoringContext,
} from "@/lib/scoring/service";
import { DEAL_TYPES, type DealType } from "@/lib/scoring/rules";
import { brandFiltersSchema } from "@/lib/brands/schemas";
import { createClient } from "@/lib/supabase/server";

const brandIdSchema = z.string().uuid();
const profileIdSchema = z.string().uuid();
const dealTypeSchema = z.enum(DEAL_TYPES);

export async function computeFitScoresForAllBrands(): Promise<
  ActionResult<ComputeFitScoresResult>
> {
  return runScoringAction("Scores recomputed.", async (context) =>
    computeBrandFitScores(context, {
      forceRecompute: true,
    }),
  );
}

export async function computeFitScoresForBrand(
  brandId: string,
): Promise<ActionResult<ComputeFitScoresResult>> {
  return runScoringAction("Brand scores recomputed.", async (context) =>
    computeBrandFitScores(context, {
      brandIds: [brandIdSchema.parse(brandId)],
      forceRecompute: true,
    }),
  );
}

export async function getRankedBrandsForCreatorProfile(
  profileId: string,
  dealType: DealType,
  options: unknown = {},
): Promise<ActionResult<RankedBrandListResult>> {
  return runScoringAction("Ranked brands loaded.", async (context) =>
    listRankedBrandsForUser(context, {
      creatorProfileId: profileIdSchema.parse(profileId),
      dealType: dealTypeSchema.parse(dealType),
      filters: brandFiltersSchema.partial().parse(options),
    }),
  );
}

async function runScoringAction<T>(
  message: string,
  callback: (context: ScoringContext) => Promise<T>,
): Promise<ActionResult<T>> {
  try {
    const context = await getScoringContext();
    const data = await callback(context);
    revalidatePath("/brands");
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
          : "Mira could not update scoring.",
    };
  }
}

async function getScoringContext(): Promise<ScoringContext> {
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
  };
}
