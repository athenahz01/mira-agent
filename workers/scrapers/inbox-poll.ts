import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database, Tables } from "../../lib/db/types.ts";
import {
  pollInboxForReplies,
} from "../../lib/gmail/inbox.ts";
import {
  processInboundReply,
  setInboxLastPolledAt,
} from "../../lib/replies/service.ts";

export async function processInboxPollJob(
  supabase: SupabaseClient<Database>,
  job: Tables<"jobs">,
): Promise<{
  threads_inspected: number;
  new_replies_found: number;
  new_replies: Array<{
    gmail_message_id: string;
    gmail_thread_id: string;
    from_email: string;
    subject: string;
    received_at: string;
  }>;
  replies_processed: number;
}> {
  const { data: user, error } = await supabase
    .from("users")
    .select("inbox_last_polled_at,inbox_poll_paused")
    .eq("user_id", job.user_id)
    .single();

  if (error || !user) {
    throw new Error(error?.message ?? "User not found for inbox poll.");
  }

  if (user.inbox_poll_paused) {
    return {
      threads_inspected: 0,
      new_replies_found: 0,
      new_replies: [],
      replies_processed: 0,
    };
  }

  const since = user.inbox_last_polled_at
    ? new Date(user.inbox_last_polled_at)
    : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const pollResult = await pollInboxForReplies({
    userId: job.user_id,
    sinceTimestampUnix: Math.floor(since.getTime() / 1000),
  });
  let repliesProcessed = 0;

  for (const reply of pollResult.new_replies) {
    const result = await processInboundReply(
      {
        supabase,
        userId: job.user_id,
      },
      reply,
    );

    if (result) {
      repliesProcessed += 1;
    }
  }

  await setInboxLastPolledAt(
    {
      supabase,
      userId: job.user_id,
    },
    new Date(),
  );

  return {
    threads_inspected: pollResult.threads_inspected,
    new_replies_found: pollResult.new_replies_found,
    new_replies: pollResult.new_replies.map((reply) => ({
      gmail_message_id: reply.gmail_message_id,
      gmail_thread_id: reply.gmail_thread_id,
      from_email: reply.from_email,
      subject: reply.subject,
      received_at: reply.received_at.toISOString(),
    })),
    replies_processed: repliesProcessed,
  };
}
