"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import type { Json, Tables } from "@/lib/db/types";
import { enqueueJob } from "@/lib/jobs/queue";
import {
  listRecentReplies,
  markReplyHandled,
  pauseInboxPolling,
  type RecentReplyFilters,
  type RecentReplyRow,
  type RepliesContext,
} from "@/lib/replies/service";
import type { ActionResult } from "@/lib/server/action";
import { createClient } from "@/lib/supabase/server";

const uuidSchema = z.string().uuid();
const categorySchema = z.enum([
  "interested",
  "asks_rate",
  "asks_more_info",
  "decline_polite",
  "decline_firm",
  "out_of_office",
  "wrong_person",
  "unsubscribe",
  "spam",
  "other",
]);
const filtersSchema = z.object({
  categories: z.array(categorySchema).optional(),
  hideHandled: z.boolean().optional(),
  since: z.string().nullable().optional(),
  until: z.string().nullable().optional(),
});

export async function enqueueInboxPoll(): Promise<ActionResult<Tables<"jobs">>> {
  return runRepliesAction("Inbox poll queued.", async (context) =>
    enqueueJob(context.supabase, {
      userId: context.userId,
      kind: "inbox_poll",
      payload: {} as Json,
      maxAttempts: 1,
    }),
  );
}

export async function enqueueFollowUpScan(): Promise<ActionResult<Tables<"jobs">>> {
  return runRepliesAction("Follow-up scan queued.", async (context) =>
    enqueueJob(context.supabase, {
      userId: context.userId,
      kind: "follow_up_generate",
      payload: {} as Json,
      maxAttempts: 1,
    }),
  );
}

export async function listRecentRepliesAction(
  filters: unknown = {},
): Promise<ActionResult<RecentReplyRow[]>> {
  return runRepliesAction("Replies loaded.", async (context) =>
    listRecentReplies(context, filtersSchema.parse(filters) as RecentReplyFilters),
  );
}

export async function markReplyHandledAction(
  messageId: string,
): Promise<ActionResult<Tables<"messages">>> {
  return runRepliesAction("Reply marked handled.", async (context) =>
    markReplyHandled(context, uuidSchema.parse(messageId)),
  );
}

export async function pauseInboxPollingAction(
  paused: boolean,
): Promise<ActionResult<Tables<"users">>> {
  return runRepliesAction("Inbox polling updated.", async (context) =>
    pauseInboxPolling(context, z.boolean().parse(paused)),
  );
}

export async function setCampaignOutcomeAction(
  campaignId: string,
  outcome: "won" | "lost",
): Promise<ActionResult<Tables<"campaigns">>> {
  return runRepliesAction("Campaign updated.", async (context) => {
    const parsedOutcome = z.enum(["won", "lost"]).parse(outcome);
    const { data, error } = await context.supabase
      .from("campaigns")
      .update({
        status: parsedOutcome,
        outcome: parsedOutcome,
        closed_at: new Date().toISOString(),
      })
      .eq("id", uuidSchema.parse(campaignId))
      .eq("user_id", context.userId)
      .select("*")
      .single();

    if (error || !data) {
      throw new Error(error?.message ?? "Could not update campaign.");
    }

    return data;
  });
}

async function runRepliesAction<T>(
  message: string,
  callback: (context: RepliesContext) => Promise<T>,
): Promise<ActionResult<T>> {
  try {
    const context = await getRepliesContext();
    const data = await callback(context);
    revalidatePath("/replies");
    revalidatePath("/approvals");
    revalidatePath("/dashboard");
    revalidatePath("/sends");

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
          : "Mira could not update replies.",
    };
  }
}

async function getRepliesContext(): Promise<RepliesContext> {
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
