export type BrandIdentityInput = {
  name?: string | null;
  domain?: string | null;
  instagram_handle?: string | null;
  tiktok_handle?: string | null;
};

type IdentityField =
  | "domain"
  | "instagram_handle"
  | "tiktok_handle"
  | "name";

const identityPriority: IdentityField[] = [
  "domain",
  "instagram_handle",
  "tiktok_handle",
  "name",
];

// Identity keys are intentionally deterministic but mutable at the row level:
// if a lower-confidence record such as `name:glossier` later receives a
// higher-priority field such as `domain:glossier.com`, the brand service
// promotes the stored identity_key while preserving the existing row.
export function brandIdentityKey(input: BrandIdentityInput): string {
  const candidate = brandIdentityCandidates(input)[0];

  if (!candidate) {
    throw new Error("Brand identity requires a name, domain, or social handle.");
  }

  return candidate.key;
}

export function brandIdentityCandidates(input: BrandIdentityInput) {
  return identityPriority
    .map((field) => identityKeyForField(input, field))
    .filter(
      (candidate): candidate is { field: IdentityField; key: string } =>
        candidate !== null,
    );
}

export function identityKeyRank(identityKey: string) {
  const prefix = identityKey.split(":", 1)[0];

  switch (prefix) {
    case "domain":
      return 0;
    case "ig":
      return 1;
    case "tt":
      return 2;
    case "name":
      return 3;
    default:
      return Number.POSITIVE_INFINITY;
  }
}

function identityKeyForField(
  input: BrandIdentityInput,
  field: IdentityField,
): { field: IdentityField; key: string } | null {
  if (field === "domain") {
    const normalized = normalizeDomain(input.domain);
    return normalized ? { field, key: `domain:${normalized}` } : null;
  }

  if (field === "instagram_handle") {
    const normalized = normalizeHandle(input.instagram_handle, "instagram");
    return normalized ? { field, key: `ig:${normalized}` } : null;
  }

  if (field === "tiktok_handle") {
    const normalized = normalizeHandle(input.tiktok_handle, "tiktok");
    return normalized ? { field, key: `tt:${normalized}` } : null;
  }

  const normalized = normalizeName(input.name);
  return normalized ? { field, key: `name:${normalized}` } : null;
}

export function normalizeDomain(value?: string | null) {
  const trimmed = value?.trim().toLowerCase();

  if (!trimmed) {
    return null;
  }

  return trimmed
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/[/#?].*$/, "")
    .replace(/\/+$/, "")
    .trim();
}

export function normalizeHandle(
  value?: string | null,
  platform?: "instagram" | "tiktok",
) {
  const trimmed = value?.trim().toLowerCase();

  if (!trimmed) {
    return null;
  }

  let normalized = trimmed
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/[/#?]+$/, "");

  if (platform === "instagram") {
    normalized = normalized.replace(/^instagram\.com\//, "");
  }

  if (platform === "tiktok") {
    normalized = normalized.replace(/^tiktok\.com\//, "");
  }

  return normalized
    .replace(/[/#?].*$/, "")
    .replace(/^@/, "")
    .trim();
}

export function normalizeName(value?: string | null) {
  const trimmed = value?.trim().toLowerCase();

  if (!trimmed) {
    return null;
  }

  return trimmed
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
