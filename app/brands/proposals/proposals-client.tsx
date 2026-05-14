"use client";

import { ArrowLeft, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";

import { resolveBrandMatchProposal } from "@/app/actions/brands";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { Json } from "@/lib/db/types";
import type { BrandMatchProposalWithCandidates } from "@/lib/brands/service";

export function BrandMatchProposalsClient({
  proposals,
}: {
  proposals: BrandMatchProposalWithCandidates[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function resolve(
    proposalId: string,
    resolution:
      | { action: "merge_into"; candidateId: string }
      | { action: "create_new" }
      | { action: "dismiss" },
  ) {
    startTransition(async () => {
      const result = await resolveBrandMatchProposal(proposalId, resolution);

      if (!result.ok) {
        toast.error(result.error);
        return;
      }

      toast.success(result.message);
      router.refresh();
    });
  }

  return (
    <main className="min-h-screen bg-muted/30 px-6 py-10">
      <section className="mx-auto grid w-full max-w-5xl gap-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-muted-foreground">Mira</p>
            <h1 className="mt-2 text-3xl font-semibold tracking-normal">
              Brand Match Proposals
            </h1>
          </div>
          <Button asChild variant="outline">
            <a href="/brands">
              <ArrowLeft />
              Brand pool
            </a>
          </Button>
        </div>

        {proposals.length === 0 ? (
          <Card>
            <CardHeader>
              <CardTitle>No pending matches</CardTitle>
              <CardDescription>
                Mira will queue ambiguous brands here when she finds similar
                names already in your pool.
              </CardDescription>
            </CardHeader>
          </Card>
        ) : (
          proposals.map((proposal) => {
            const payload = readPayload(proposal.incoming_payload_json);

            return (
              <Card key={proposal.id}>
                <CardHeader>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <CardTitle>
                        {textValue(payload.name) ?? "Incoming brand"}
                      </CardTitle>
                      <CardDescription>
                        Source: {proposal.source}
                      </CardDescription>
                    </div>
                    <Badge variant="outline">Open</Badge>
                  </div>
                </CardHeader>
                <CardContent className="grid gap-5 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
                  <div className="grid gap-3 rounded-md border bg-background p-4 text-sm">
                    <p>
                      <span className="font-medium">Domain:</span>{" "}
                      {textValue(payload.domain) ?? "None"}
                    </p>
                    <p>
                      <span className="font-medium">Instagram:</span>{" "}
                      {textValue(payload.instagram_handle) ?? "None"}
                    </p>
                    <p>
                      <span className="font-medium">Categories:</span>{" "}
                      {arrayValue(payload.category).join(", ") || "None"}
                    </p>
                    <div className="flex flex-wrap gap-2 pt-2">
                      <Button
                        disabled={isPending}
                        onClick={() =>
                          resolve(proposal.id, { action: "create_new" })
                        }
                        size="sm"
                        type="button"
                        variant="outline"
                      >
                        {isPending ? <Loader2 className="animate-spin" /> : null}
                        Create as new
                      </Button>
                      <Button
                        disabled={isPending}
                        onClick={() =>
                          resolve(proposal.id, { action: "dismiss" })
                        }
                        size="sm"
                        type="button"
                        variant="ghost"
                      >
                        Dismiss
                      </Button>
                    </div>
                  </div>

                  <div className="grid gap-3">
                    {proposal.candidates.map((candidate) => (
                      <div
                        className="grid gap-3 rounded-md border bg-background p-4 text-sm"
                        key={candidate.id}
                      >
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <p className="font-medium">{candidate.name}</p>
                            <p className="text-muted-foreground">
                              {candidate.identity_key}
                            </p>
                          </div>
                          <Badge variant="secondary">
                            {scoreForCandidate(proposal, candidate.id)} match
                          </Badge>
                        </div>
                        <p className="text-muted-foreground">
                          {candidate.domain ?? "No domain"} ·{" "}
                          {candidate.instagram_handle
                            ? `@${candidate.instagram_handle}`
                            : "No Instagram"}
                        </p>
                        <Button
                          className="w-fit"
                          disabled={isPending}
                          onClick={() =>
                            resolve(proposal.id, {
                              action: "merge_into",
                              candidateId: candidate.id,
                            })
                          }
                          size="sm"
                          type="button"
                        >
                          Merge into {candidate.name}
                        </Button>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            );
          })
        )}
      </section>
    </main>
  );
}

function readPayload(value: Json): Record<string, Json | undefined> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return value;
}

function textValue(value: Json | undefined) {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function arrayValue(value: Json | undefined) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function scoreForCandidate(
  proposal: BrandMatchProposalWithCandidates,
  candidateId: string,
) {
  const index = proposal.candidate_brand_ids.indexOf(candidateId);
  const score = index >= 0 ? proposal.candidate_scores[index] : null;

  return typeof score === "number" ? `${Math.round(score * 100)}%` : "Fuzzy";
}
