import type { MediaKitJson } from "../db/media-kit";

export type OutreachFooterInput = {
  senderDisplayName: string;
  creatorHandle: string;
  mediaKit: MediaKitJson;
  physicalAddress: string;
};

export class OutreachFooterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OutreachFooterError";
  }
}

export function buildOutreachFooterText(input: OutreachFooterInput) {
  const parts = [
    input.senderDisplayName,
    normalizeInstagramHandle(input.creatorHandle),
  ];

  if (input.mediaKit.contact.website) {
    parts.push(input.mediaKit.contact.website);
  }

  const address = input.physicalAddress.trim();

  if (!address) {
    throw new OutreachFooterError(
      "Missing physical address for CAN-SPAM footer. Set it in /settings.",
    );
  }

  parts.push(address);
  parts.push("reply to be removed from future outreach");
  return parts.join(" | ");
}

function normalizeInstagramHandle(handle: string) {
  return handle.startsWith("@") ? handle : `@${handle}`;
}
