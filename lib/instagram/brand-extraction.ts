import type { IgPost } from "./rapidapi-client";

export type InstagramBrandCandidate = {
  instagram_handle: string;
  display_name: string;
  first_seen_at_unix: number;
  confidence_tier: "high" | "medium" | "low";
  evidence_post_codes: string[];
  paid_partnership_count: number;
};

export type InstagramBrandExtractionResult = {
  competitor_handle: string;
  posts_analyzed: number;
  candidate_brands: InstagramBrandCandidate[];
};

type CandidateSignal = {
  username: string;
  fullName: string | null;
  postCode: string;
  takenAtUnix: number;
  tier: InstagramBrandCandidate["confidence_tier"];
  paidPartnership: boolean;
};

const DISCLOSURE_REGEX =
  /(?:^|[\s#])(ad|ads|partner|sponsored|gifted|paidpartner|paidpartnership)(?:\b|$)/i;
const MENTION_REGEX = /@([a-zA-Z0-9._]+)/g;
const tierRank: Record<InstagramBrandCandidate["confidence_tier"], number> = {
  high: 3,
  medium: 2,
  low: 1,
};

export function extractBrandCandidatesFromInstagramPosts(input: {
  competitorHandle: string;
  posts: IgPost[];
  excludedCreatorHandles?: string[];
  maxAgeDays?: number;
}): InstagramBrandExtractionResult {
  const maxAgeDays = input.maxAgeDays ?? 90;
  const cutoffUnix = Math.floor(Date.now() / 1000) - maxAgeDays * 86_400;
  const excludedHandles = new Set(
    [
      input.competitorHandle,
      ...(input.excludedCreatorHandles ?? []),
    ].map(normalizeHandle),
  );
  const signals: CandidateSignal[] = [];
  const recentPosts = input.posts.filter(
    (post) => post.taken_at_unix >= cutoffUnix,
  );

  for (const post of recentPosts) {
    const caption = post.caption ?? "";
    const captionMentions = new Set(readCaptionMentions(caption));
    const taggedUsers = post.usertags.filter((user) =>
      looksLikeBrandHandle(user.username, excludedHandles),
    );

    if (post.is_paid_partnership) {
      for (const sponsor of post.sponsor_tags.filter((user) =>
        looksLikeBrandHandle(user.username, excludedHandles),
      )) {
        signals.push(signalFromUser(sponsor, post, "high", true));
      }

      for (const taggedUser of taggedUsers) {
        signals.push(signalFromUser(taggedUser, post, "high", true));
      }

      continue;
    }

    if (DISCLOSURE_REGEX.test(caption)) {
      for (const taggedUser of taggedUsers) {
        signals.push(signalFromUser(taggedUser, post, "medium", false));
      }
    }

    for (const taggedUser of taggedUsers) {
      if (captionMentions.has(normalizeHandle(taggedUser.username))) {
        signals.push(signalFromUser(taggedUser, post, "low", false));
      } else {
        signals.push(signalFromUser(taggedUser, post, "low", false));
      }
    }
  }

  return {
    competitor_handle: normalizeHandle(input.competitorHandle),
    posts_analyzed: recentPosts.length,
    candidate_brands: combineSignals(signals),
  };
}

export function looksLikeBrandHandle(
  username: string,
  excludedCreatorHandles: Set<string>,
) {
  const normalized = normalizeHandle(username);

  if (!normalized || excludedCreatorHandles.has(normalized)) {
    return false;
  }

  if (normalized.endsWith("_official") || normalized.startsWith("official_")) {
    return false;
  }

  return true;
}

function readCaptionMentions(caption: string) {
  return [...caption.matchAll(MENTION_REGEX)].map((match) =>
    normalizeHandle(match[1] ?? ""),
  );
}

function signalFromUser(
  user: {
    username: string;
    full_name?: string | null;
  },
  post: IgPost,
  tier: InstagramBrandCandidate["confidence_tier"],
  paidPartnership: boolean,
): CandidateSignal {
  return {
    username: normalizeHandle(user.username),
    fullName: user.full_name ?? null,
    postCode: post.code,
    takenAtUnix: post.taken_at_unix,
    tier,
    paidPartnership,
  };
}

function combineSignals(signals: CandidateSignal[]) {
  const byHandle = new Map<string, InstagramBrandCandidate>();

  for (const signal of signals) {
    const existing = byHandle.get(signal.username);

    if (!existing) {
      byHandle.set(signal.username, {
        instagram_handle: signal.username,
        display_name: signal.fullName ?? signal.username,
        first_seen_at_unix: signal.takenAtUnix,
        confidence_tier: signal.tier,
        evidence_post_codes: [signal.postCode],
        paid_partnership_count: signal.paidPartnership ? 1 : 0,
      });
      continue;
    }

    if (tierRank[signal.tier] > tierRank[existing.confidence_tier]) {
      existing.confidence_tier = signal.tier;
    }

    if (signal.fullName && existing.display_name === existing.instagram_handle) {
      existing.display_name = signal.fullName;
    }

    existing.first_seen_at_unix = Math.min(
      existing.first_seen_at_unix,
      signal.takenAtUnix,
    );

    if (!existing.evidence_post_codes.includes(signal.postCode)) {
      existing.evidence_post_codes = [
        ...existing.evidence_post_codes,
        signal.postCode,
      ].slice(0, 3);
    }

    if (signal.paidPartnership) {
      existing.paid_partnership_count += 1;
    }
  }

  return [...byHandle.values()].sort(
    (a, b) =>
      tierRank[b.confidence_tier] - tierRank[a.confidence_tier] ||
      b.paid_partnership_count - a.paid_partnership_count ||
      a.instagram_handle.localeCompare(b.instagram_handle),
  );
}

function normalizeHandle(value: string) {
  return value.trim().toLowerCase().replace(/^@/, "");
}
