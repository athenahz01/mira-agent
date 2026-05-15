import {
  buildRfc2822Message,
  decodeRawMessage,
  encodeRawMessage,
  sendEmailViaGmail,
  type GmailSendClient,
} from "../lib/gmail/send.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

let capturedRaw = "";
const fakeClient: GmailSendClient = {
  users: {
    messages: {
      async send(input) {
        capturedRaw = input.requestBody.raw;

        return {
          data: {
            id: "gmail-message-id",
            threadId: "gmail-thread-id",
          },
        };
      },
    },
  },
};

const input = {
  userId: "user-id",
  to: "press@brand.com",
  toName: "Press Team",
  fromEmail: "zhengathenahuo@gmail.com",
  fromDisplayName: "Athena Huo",
  replyToEmail: null,
  subject: "Athena x Brand",
  bodyText: "Hi team,\n\nA quick idea.\n\nBest,\nAthena",
  bodyHtml: null,
};
const message = buildRfc2822Message(input);

assert(
  message.includes('From: "Athena Huo" <zhengathenahuo@gmail.com>'),
  "Message should include From header.",
);
assert(
  message.includes('To: "Press Team" <press@brand.com>'),
  "Message should include To header.",
);
assert(
  message.includes("Reply-To: zhengathenahuo@gmail.com"),
  "Message should include Reply-To header.",
);
assert(message.includes("Subject: Athena x Brand"), "Subject should be set.");
assert(message.includes("Date:"), "Date header should be present.");
assert(message.includes("Message-ID:"), "Message-ID header should be present.");
assert(
  message.includes("Content-Type: text/plain; charset=UTF-8"),
  "Plain-text content type should be set.",
);

const raw = encodeRawMessage(message);
assert(decodeRawMessage(raw) === message, "Base64url should roundtrip.");

const result = await sendEmailViaGmail(input, fakeClient);
assert(result.gmail_message_id === "gmail-message-id", "Gmail id should parse.");
assert(result.gmail_thread_id === "gmail-thread-id", "Thread id should parse.");
assert(decodeRawMessage(capturedRaw).includes("Athena x Brand"), "Raw sent body should decode.");

console.log("Gmail send mock test passed.");
