import { createServiceSupabaseClient, getActiveCredential } from "./client.ts";
import { createGmailClient } from "./client.ts";
import {
  extractDisplayName,
  extractEmailAddress,
  extractHeader,
  extractTextBody,
} from "./parse.ts";

export type InboxPollResult = {
  threads_inspected: number;
  new_replies_found: number;
  new_replies: NewReply[];
};

export type NewReply = {
  gmail_message_id: string;
  gmail_thread_id: string;
  from_email: string;
  from_name: string | null;
  subject: string;
  snippet: string;
  body_text: string;
  body_html: string | null;
  received_at: Date;
  in_reply_to: string | null;
};

type GmailPayload = {
  headers?: Array<{ name?: string | null; value?: string | null }> | null;
  mimeType?: string | null;
  body?: { data?: string | null } | null;
  parts?: GmailPayload[] | null;
};

export class InboxPollError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InboxPollError";
  }
}

export async function pollInboxForReplies(input: {
  userId: string;
  sinceTimestampUnix: number;
}): Promise<InboxPollResult> {
  const [gmail, credential, knownThreadIds] = await Promise.all([
    createGmailClient(input.userId),
    getActiveCredential(input.userId),
    loadKnownThreadIds(input.userId),
  ]);

  if (!credential) {
    throw new InboxPollError("No active Gmail credential.");
  }

  const listResponse = await gmail.users.messages.list({
    userId: "me",
    q: `in:inbox after:${Math.floor(input.sinceTimestampUnix)}`,
    maxResults: 50,
  });
  const messages = listResponse.data.messages ?? [];
  const newReplies: NewReply[] = [];

  for (const message of messages) {
    if (!message.id) {
      continue;
    }

    const full = await gmail.users.messages.get({
      userId: "me",
      id: message.id,
      format: "full",
    });
    const data = full.data;

    if (!data.threadId || !knownThreadIds.has(data.threadId)) {
      continue;
    }

    const payload = data.payload as GmailPayload | undefined;
    const headers = payload?.headers ?? [];
    const fromHeader = extractHeader(headers, "From");
    const fromEmail = extractEmailAddress(fromHeader);

    if (!fromEmail || fromEmail === credential.google_email.toLowerCase()) {
      continue;
    }

    const { body_text, body_html } = extractTextBody(payload);
    const receivedAt = data.internalDate
      ? new Date(Number(data.internalDate))
      : new Date();

    newReplies.push({
      gmail_message_id: data.id ?? message.id,
      gmail_thread_id: data.threadId,
      from_email: fromEmail,
      from_name: extractDisplayName(fromHeader),
      subject: extractHeader(headers, "Subject") ?? "",
      snippet: data.snippet ?? "",
      body_text,
      body_html,
      received_at: receivedAt,
      in_reply_to: extractHeader(headers, "In-Reply-To"),
    });
  }

  return {
    threads_inspected: messages.length,
    new_replies_found: newReplies.length,
    new_replies: newReplies,
  };
}

async function loadKnownThreadIds(userId: string) {
  const supabase = createServiceSupabaseClient();
  const { data, error } = await supabase
    .from("email_threads")
    .select("gmail_thread_id")
    .eq("user_id", userId);

  if (error) {
    throw new InboxPollError(error.message);
  }

  return new Set((data ?? []).map((thread) => thread.gmail_thread_id));
}
