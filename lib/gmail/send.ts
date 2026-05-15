import { randomUUID } from "node:crypto";

import { createGmailClient } from "./client.ts";

export type GmailSendInput = {
  userId: string;
  to: string;
  toName: string | null;
  fromEmail: string;
  fromDisplayName: string;
  replyToEmail: string | null;
  subject: string;
  bodyText: string;
  bodyHtml: string | null;
};

export type GmailSendResult = {
  gmail_message_id: string;
  gmail_thread_id: string;
};

export type GmailSendClient = {
  users: {
    messages: {
      send(input: {
        userId: "me";
        requestBody: { raw: string };
      }): Promise<{ data: { id?: string | null; threadId?: string | null } }>;
    };
  };
};

export class GmailSendError extends Error {
  status: number | null;
  tokenExpired: boolean;
  quotaExceeded: boolean;
  permissionDenied: boolean;
  permanentFailure: boolean;
  transientFailure: boolean;

  constructor(
    message: string,
    flags: {
      status?: number | null;
      tokenExpired?: boolean;
      quotaExceeded?: boolean;
      permissionDenied?: boolean;
      permanentFailure?: boolean;
      transientFailure?: boolean;
    } = {},
  ) {
    super(message);
    this.name = "GmailSendError";
    this.status = flags.status ?? null;
    this.tokenExpired = flags.tokenExpired ?? false;
    this.quotaExceeded = flags.quotaExceeded ?? false;
    this.permissionDenied = flags.permissionDenied ?? false;
    this.permanentFailure = flags.permanentFailure ?? false;
    this.transientFailure = flags.transientFailure ?? false;
  }
}

export async function sendEmailViaGmail(
  input: GmailSendInput,
  client?: GmailSendClient,
): Promise<GmailSendResult> {
  const gmail = client ?? ((await createGmailClient(input.userId)) as GmailSendClient);
  const raw = encodeRawMessage(buildRfc2822Message(input));

  try {
    const response = await gmail.users.messages.send({
      userId: "me",
      requestBody: {
        raw,
      },
    });
    const id = response.data.id;
    const threadId = response.data.threadId;

    if (!id || !threadId) {
      throw new GmailSendError("Gmail did not return a message id.", {
        transientFailure: true,
      });
    }

    return {
      gmail_message_id: id,
      gmail_thread_id: threadId,
    };
  } catch (error) {
    if (error instanceof GmailSendError) {
      throw error;
    }

    throw toGmailSendError(error);
  }
}

export function buildRfc2822Message(input: GmailSendInput) {
  const fromDomain = input.fromEmail.split("@")[1] || "gmail.com";
  const headers = [
    ["From", formatAddress(input.fromDisplayName, input.fromEmail)],
    ["To", formatAddress(input.toName, input.to)],
    ["Reply-To", input.replyToEmail ?? input.fromEmail],
    ["Subject", encodeHeader(input.subject)],
    ["Date", new Date().toUTCString()],
    ["Message-ID", `<${randomUUID()}@${fromDomain}>`],
    ["MIME-Version", "1.0"],
  ];

  if (!input.bodyHtml) {
    headers.push(["Content-Type", "text/plain; charset=UTF-8"]);
    headers.push(["Content-Transfer-Encoding", "8bit"]);

    return `${headers.map(([key, value]) => `${key}: ${value}`).join("\r\n")}\r\n\r\n${normalizeBody(input.bodyText)}`;
  }

  const boundary = `mira-${randomUUID()}`;
  headers.push([
    "Content-Type",
    `multipart/alternative; boundary="${boundary}"`,
  ]);

  return `${headers.map(([key, value]) => `${key}: ${value}`).join("\r\n")}\r\n\r\n--${boundary}\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: 8bit\r\n\r\n${normalizeBody(input.bodyText)}\r\n--${boundary}\r\nContent-Type: text/html; charset=UTF-8\r\nContent-Transfer-Encoding: 8bit\r\n\r\n${normalizeBody(input.bodyHtml)}\r\n--${boundary}--`;
}

export function encodeRawMessage(message: string) {
  return Buffer.from(message, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

export function decodeRawMessage(raw: string) {
  const padded = raw.padEnd(raw.length + ((4 - (raw.length % 4)) % 4), "=");

  return Buffer.from(
    padded.replace(/-/g, "+").replace(/_/g, "/"),
    "base64",
  ).toString("utf8");
}

function formatAddress(name: string | null, email: string) {
  if (!name?.trim()) {
    return `<${email}>`;
  }

  return `"${escapeQuoted(name.trim())}" <${email}>`;
}

function encodeHeader(value: string) {
  return /^[\x00-\x7F]*$/.test(value)
    ? value
    : `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
}

function escapeQuoted(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function normalizeBody(value: string) {
  return value.replace(/\r?\n/g, "\r\n");
}

function toGmailSendError(error: unknown) {
  const status = readStatus(error);
  const message = readErrorMessage(error);
  const reason = readReason(error);

  if (status === 401) {
    return new GmailSendError(message, {
      status,
      tokenExpired: true,
      transientFailure: true,
    });
  }

  if (status === 403) {
    const quotaExceeded = /quota|rate|limit/i.test(`${message} ${reason}`);

    return new GmailSendError(message, {
      status,
      quotaExceeded,
      permissionDenied: !quotaExceeded,
      permanentFailure: !quotaExceeded,
      transientFailure: quotaExceeded,
    });
  }

  if (status && status >= 500) {
    return new GmailSendError(message, {
      status,
      transientFailure: true,
    });
  }

  if (status && status >= 400) {
    return new GmailSendError(message, {
      status,
      permanentFailure: true,
    });
  }

  return new GmailSendError(message, {
    transientFailure: true,
  });
}

function readStatus(error: unknown) {
  if (!error || typeof error !== "object") {
    return null;
  }

  const record = error as {
    code?: unknown;
    status?: unknown;
    response?: { status?: unknown };
  };
  const status = record.response?.status ?? record.status ?? record.code;

  return typeof status === "number" ? status : null;
}

function readErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  return "Gmail send failed.";
}

function readReason(error: unknown) {
  if (!error || typeof error !== "object") {
    return "";
  }

  const record = error as {
    response?: {
      data?: {
        error?: {
          errors?: Array<{ reason?: unknown }>;
          message?: unknown;
        };
      };
    };
  };

  return [
    record.response?.data?.error?.message,
    ...(record.response?.data?.error?.errors?.map((item) => item.reason) ?? []),
  ]
    .filter((item): item is string => typeof item === "string")
    .join(" ");
}
