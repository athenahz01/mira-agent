"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import type { Tables } from "@/lib/db/types";
import {
  cancelScheduledSend,
  sendScheduledMessageNow,
  type SendingContext,
} from "@/lib/sending/service";
import type { ActionResult } from "@/lib/server/action";
import { createClient } from "@/lib/supabase/server";

const uuidSchema = z.string().uuid();

export async function sendScheduledNowAction(
  messageId: string,
): Promise<ActionResult<Tables<"messages">>> {
  return runSendsAction("Send queued for now.", async (context) =>
    sendScheduledMessageNow(context, uuidSchema.parse(messageId)),
  );
}

export async function cancelScheduledSendAction(
  messageId: string,
): Promise<ActionResult<Tables<"messages">>> {
  return runSendsAction("Scheduled send cancelled.", async (context) =>
    cancelScheduledSend(context, uuidSchema.parse(messageId)),
  );
}

async function runSendsAction<T>(
  message: string,
  callback: (context: SendingContext) => Promise<T>,
): Promise<ActionResult<T>> {
  try {
    const context = await getSendingContext();
    const data = await callback(context);
    revalidatePath("/sends");
    revalidatePath("/approvals");
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
          : "Mira could not update the send queue.",
    };
  }
}

async function getSendingContext(): Promise<SendingContext> {
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
