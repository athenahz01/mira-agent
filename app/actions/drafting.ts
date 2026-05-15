"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import {
  approveDraft,
  excludeBrandFromQueue,
  generateAndPersistPitch,
  listPendingApprovals,
  regenerateDraft,
  skipDraft,
  type DraftingContext,
  type PendingApprovalListResult,
} from "@/lib/drafting/service";
import type { Json, Tables } from "@/lib/db/types";
import { enqueueJob } from "@/lib/jobs/queue";
import { DEAL_TYPES, type DealType } from "@/lib/scoring/rules";
import type { ActionResult } from "@/lib/server/action";
import { createClient } from "@/lib/supabase/server";

const uuidSchema = z.string().uuid();
const dealTypeSchema = z.enum(DEAL_TYPES);
const pendingApprovalFiltersSchema = z.object({
  creatorProfileId: z.string().uuid().nullable().optional(),
  dealTypes: z.array(dealTypeSchema).optional(),
  minScore: z.number().int().min(0).max(100).optional(),
  sort: z.enum(["score_desc", "drafted_desc"]).optional(),
  page: z.number().int().positive().optional(),
});
const approveDraftSchema = z.object({
  editedSubject: z.string().trim().min(1).optional(),
  editedBody: z.string().min(1).optional(),
});

export type AutoDraftJobStatus = Pick<
  Tables<"jobs">,
  "id" | "status" | "created_at" | "finished_at" | "result_json" | "error_message"
> | null;

export async function enqueueAutoDraftBatch(
  creatorProfileIds?: string[],
): Promise<ActionResult<Tables<"jobs">>> {
  return runDraftingAction("Draft batch queued.", async (context) => {
    const profileIds = z.array(uuidSchema).optional().parse(creatorProfileIds);

    return enqueueJob(context.supabase, {
      userId: context.userId,
      kind: "auto_draft",
      payload: {
        creator_profile_ids: profileIds,
      } as Json,
      maxAttempts: 1,
    });
  });
}

export async function getAutoDraftBatchStatus(): Promise<
  ActionResult<AutoDraftJobStatus>
> {
  return runDraftingAction("Draft batch status loaded.", async (context) => {
    const { data, error } = await context.supabase
      .from("jobs")
      .select("id,status,created_at,finished_at,result_json,error_message")
      .eq("user_id", context.userId)
      .eq("kind", "auto_draft")
      .order("created_at", { ascending: false })
      .limit(1);

    if (error) {
      throw new Error(error.message);
    }

    return data?.[0] ?? null;
  });
}

export async function draftBrandManually(
  creatorProfileId: string,
  brandId: string,
  dealType: DealType,
): Promise<
  ActionResult<{
    campaign: Tables<"campaigns">;
    message: Tables<"messages">;
  }>
> {
  return runDraftingAction("Draft created.", async (context) => {
    const result = await generateAndPersistPitch(context, {
      creatorProfileId: uuidSchema.parse(creatorProfileId),
      brandId: uuidSchema.parse(brandId),
      dealType: dealTypeSchema.parse(dealType),
    });

    return {
      campaign: result.campaign,
      message: result.message,
    };
  });
}

export async function listPendingApprovalsAction(
  filters: unknown = {},
): Promise<ActionResult<PendingApprovalListResult>> {
  return runDraftingAction("Pending drafts loaded.", async (context) =>
    listPendingApprovals(context, pendingApprovalFiltersSchema.parse(filters)),
  );
}

export async function approveDraftAction(
  messageId: string,
  edits: unknown,
): Promise<ActionResult<Tables<"messages">>> {
  return runDraftingAction("Draft approved.", async (context) =>
    approveDraft(
      context,
      uuidSchema.parse(messageId),
      approveDraftSchema.parse(edits),
    ),
  );
}

export async function skipDraftAction(
  messageId: string,
  suppressionDays?: number,
): Promise<ActionResult<void>> {
  return runDraftingAction("Draft skipped.", async (context) =>
    skipDraft(
      context,
      uuidSchema.parse(messageId),
      z.number().int().positive().optional().parse(suppressionDays),
    ),
  );
}

export async function regenerateDraftAction(
  messageId: string,
  angleHint?: string,
): Promise<ActionResult<Tables<"messages">>> {
  return runDraftingAction("Draft regenerated.", async (context) =>
    regenerateDraft(
      context,
      uuidSchema.parse(messageId),
      z.string().trim().max(500).optional().parse(angleHint) || undefined,
    ),
  );
}

export async function excludeBrandFromQueueAction(
  brandId: string,
  reason?: string | null,
): Promise<ActionResult<void>> {
  return runDraftingAction("Brand excluded from queue.", async (context) =>
    excludeBrandFromQueue(
      context,
      uuidSchema.parse(brandId),
      z.string().trim().nullable().optional().parse(reason),
    ),
  );
}

async function runDraftingAction<T>(
  message: string,
  callback: (context: DraftingContext) => Promise<T>,
): Promise<ActionResult<T>> {
  try {
    const context = await getDraftingContext();
    const data = await callback(context);
    revalidatePath("/approvals");
    revalidatePath("/brands");
    revalidatePath("/dashboard");
    revalidatePath("/settings");

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
          : "Mira could not update the drafting queue.",
    };
  }
}

async function getDraftingContext(): Promise<DraftingContext> {
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
