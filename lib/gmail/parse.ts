type GmailPart = {
  mimeType?: string | null;
  filename?: string | null;
  body?: {
    data?: string | null;
  } | null;
  parts?: GmailPart[] | null;
};

type Header = {
  name?: string | null;
  value?: string | null;
};

export function extractEmailAddress(headerValue: string | null | undefined) {
  if (!headerValue) {
    return "";
  }

  const angleMatch = headerValue.match(/<([^>]+)>/);
  const candidate = angleMatch?.[1] ?? headerValue;
  const emailMatch = candidate.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);

  return emailMatch?.[0]?.toLowerCase() ?? "";
}

export function extractDisplayName(headerValue: string | null | undefined) {
  if (!headerValue) {
    return null;
  }

  const trimmed = headerValue.trim();
  const angleIndex = trimmed.indexOf("<");

  if (angleIndex === -1) {
    return null;
  }

  const name = trimmed
    .slice(0, angleIndex)
    .trim()
    .replace(/^"|"$/g, "")
    .replace(/\\"/g, '"');

  return name || null;
}

export function extractHeader(headers: Header[] | null | undefined, name: string) {
  return (
    headers?.find(
      (header) => header.name?.toLowerCase() === name.toLowerCase(),
    )?.value ?? null
  );
}

export function extractTextBody(payload: GmailPart | null | undefined) {
  if (!payload) {
    return {
      body_text: "",
      body_html: null as string | null,
    };
  }

  const plain = collectBodyParts(payload, "text/plain");
  const html = collectBodyParts(payload, "text/html");
  const bodyHtml = html.length > 0 ? html.join("\n\n") : null;

  return {
    body_text:
      plain.length > 0
        ? plain.join("\n\n").trim()
        : stripHtml(bodyHtml ?? "").trim(),
    body_html: bodyHtml,
  };
}

export function decodeBase64Body(rawBody: string | null | undefined) {
  if (!rawBody) {
    return "";
  }

  const normalized = rawBody.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(
    normalized.length + ((4 - (normalized.length % 4)) % 4),
    "=",
  );

  return Buffer.from(padded, "base64").toString("utf8");
}

function collectBodyParts(part: GmailPart, mimeType: string): string[] {
  const own =
    part.mimeType === mimeType && !part.filename
      ? [decodeBase64Body(part.body?.data)]
      : [];
  const childParts = (part.parts ?? []).flatMap((child) =>
    collectBodyParts(child, mimeType),
  );

  return [...own, ...childParts].filter(Boolean);
}

function stripHtml(value: string) {
  return value
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+\n/g, "\n")
    .replace(/\n\s+/g, "\n")
    .replace(/[ \t]+/g, " ");
}
