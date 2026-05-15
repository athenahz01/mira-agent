"use client";

import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import type React from "react";
import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { toast } from "sonner";

import {
  approveDraftAction,
  enqueueAutoDraftBatch,
  excludeBrandFromQueueAction,
  getAutoDraftBatchStatus,
  listPendingApprovalsAction,
  regenerateDraftAction,
  skipDraftAction,
  undoApprovalAction,
} from "@/app/actions/drafting";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import type {
  PendingApprovalListResult,
  PendingApprovalRow,
} from "@/lib/drafting/service";
import { DEAL_TYPES, type DealType } from "@/lib/scoring/rules";

type ProfileOption = {
  id: string;
  handle: string;
  display_name: string;
};

type DraftEditState = {
  subject: string;
  body: string;
  angleHint: string;
};

type BatchStatus = {
  id: string;
  status: string;
  created_at: string;
  finished_at: string | null;
  result_json: unknown;
  error_message: string | null;
} | null;

export function ApprovalsClient({
  initialList,
  profiles,
  focusMessageId,
}: {
  initialList: PendingApprovalListResult;
  profiles: ProfileOption[];
  focusMessageId: string | null;
}) {
  const router = useRouter();
  const [list, setList] = useState(initialList);
  const [profileId, setProfileId] = useState<string>("all");
  const [dealTypes, setDealTypes] = useState<DealType[]>([]);
  const [minScore, setMinScore] = useState(40);
  const [sort, setSort] = useState<"score_desc" | "drafted_desc">("score_desc");
  const [expandedId, setExpandedId] = useState<string | null>(focusMessageId);
  const [edits, setEdits] = useState<Record<string, DraftEditState>>({});
  const [batchStatus, setBatchStatus] = useState<BatchStatus>(null);
  const [isLoading, startLoading] = useTransition();
  const [isMutating, startMutating] = useTransition();
  const pendingCount = list.total;
  const filters = useMemo(
    () => ({
      creatorProfileId: profileId === "all" ? null : profileId,
      dealTypes: dealTypes.length > 0 ? dealTypes : undefined,
      minScore,
      sort,
    }),
    [dealTypes, minScore, profileId, sort],
  );

  useEffect(() => {
    if (!focusMessageId) {
      return;
    }

    setExpandedId(focusMessageId);
  }, [focusMessageId]);

  const refreshList = useCallback(async (nextFilters = filters) => {
    const result = await listPendingApprovalsAction(nextFilters);

    if (!result.ok) {
      toast.error(result.error);
      return;
    }

    setList(result.data);
  }, [filters]);

  useEffect(() => {
    if (!batchStatus || isTerminalJob(batchStatus.status)) {
      return;
    }

    const interval = window.setInterval(async () => {
      const status = await getAutoDraftBatchStatus();

      if (!status.ok) {
        toast.error(status.error);
        return;
      }

      setBatchStatus(status.data);

      if (status.data && isTerminalJob(status.data.status)) {
        await refreshList();
      }
    }, 3000);

    return () => window.clearInterval(interval);
  }, [batchStatus, refreshList]);

  function loadWithFilters() {
    startLoading(async () => {
      await refreshList();
    });
  }

  function toggleDealType(dealType: DealType) {
    setDealTypes((current) =>
      current.includes(dealType)
        ? current.filter((item) => item !== dealType)
        : [...current, dealType],
    );
  }

  function draftBatch() {
    startMutating(async () => {
      const result = await enqueueAutoDraftBatch();

      if (!result.ok) {
        toast.error(result.error);
        return;
      }

      setBatchStatus({
        id: result.data.id,
        status: result.data.status,
        created_at: result.data.created_at,
        finished_at: result.data.finished_at,
        result_json: result.data.result_json,
        error_message: result.data.error_message,
      });
      toast.success("Draft batch queued.");
    });
  }

  function ensureEdit(row: PendingApprovalRow) {
    setEdits((current) => {
      if (current[row.message.id]) {
        return current;
      }

      return {
        ...current,
        [row.message.id]: {
          subject: row.message.subject,
          body: row.message.body_text,
          angleHint: "",
        },
      };
    });
  }

  function updateEdit(messageId: string, next: Partial<DraftEditState>) {
    setEdits((current) => ({
      ...current,
      [messageId]: {
        subject: current[messageId]?.subject ?? "",
        body: current[messageId]?.body ?? "",
        angleHint: current[messageId]?.angleHint ?? "",
        ...next,
      },
    }));
  }

  function approve(row: PendingApprovalRow) {
    const edit = edits[row.message.id] ?? {
      subject: row.message.subject,
      body: row.message.body_text,
      angleHint: "",
    };

    startMutating(async () => {
      const result = await approveDraftAction(row.message.id, {
        editedSubject: edit.subject,
        editedBody: edit.body,
      });

      if (!result.ok) {
        toast.error(result.error);
        return;
      }

      if (result.data.decision.kind === "send_immediately") {
        toast.success("Sending in 30s.", {
          duration: 30_000,
          action: {
            label: "Undo",
            onClick: () => undoApprovalFromToast(row.message.id),
          },
        });
      } else if (result.data.decision.kind === "schedule_at") {
        toast.success(
          `Scheduled for ${new Date(
            result.data.decision.scheduled_send_at,
          ).toLocaleString()}.`,
        );
      } else {
        toast.error("Mira could not schedule this send.");
      }
      await refreshList();
    });
  }

  function undoApprovalFromToast(messageId: string) {
    startMutating(async () => {
      const result = await undoApprovalAction(messageId);

      if (!result.ok) {
        toast.error(result.error);
        return;
      }

      toast.success("Approval undone.");
      await refreshList();
    });
  }

  function skip(row: PendingApprovalRow) {
    startMutating(async () => {
      const result = await skipDraftAction(row.message.id);

      if (!result.ok) {
        toast.error(result.error);
        return;
      }

      toast.success("Draft skipped.");
      await refreshList();
    });
  }

  function exclude(row: PendingApprovalRow) {
    const reason = window.prompt("Reason for excluding this brand?") ?? null;

    startMutating(async () => {
      const result = await excludeBrandFromQueueAction(row.brand.id, reason);

      if (!result.ok) {
        toast.error(result.error);
        return;
      }

      toast.success("Brand excluded.");
      await refreshList();
    });
  }

  function regenerate(row: PendingApprovalRow) {
    const angleHint = edits[row.message.id]?.angleHint ?? "";

    startMutating(async () => {
      const result = await regenerateDraftAction(row.message.id, angleHint);

      if (!result.ok) {
        toast.error(result.error);
        return;
      }

      toast.success("Draft regenerated.");
      setExpandedId(result.data.id);
      router.replace(`/approvals?focus=${result.data.id}`);
      await refreshList();
    });
  }

  return (
    <main className="min-h-screen bg-muted/30 px-6 py-10">
      <section className="mx-auto grid w-full max-w-6xl gap-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-muted-foreground">Mira</p>
            <h1 className="mt-2 text-3xl font-semibold tracking-normal">
              Approval Queue
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              {pendingCount} pending draft{pendingCount === 1 ? "" : "s"}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline">
              <a href="/brands">Brand pool</a>
            </Button>
            <Button disabled={isMutating} onClick={draftBatch} type="button">
              {isMutating ? <Loader2 className="animate-spin" /> : null}
              Draft today
            </Button>
          </div>
        </div>

        {batchStatus ? <BatchStatusCard status={batchStatus} /> : null}

        <Card>
          <CardHeader>
            <CardTitle>Filters</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4">
            <div className="grid gap-4 md:grid-cols-4">
              <Field label="Creator profile">
                <select
                  className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                  onChange={(event) => setProfileId(event.target.value)}
                  value={profileId}
                >
                  <option value="all">All profiles</option>
                  {profiles.map((profile) => (
                    <option key={profile.id} value={profile.id}>
                      @{profile.handle}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={`Minimum score: ${minScore}`}>
                <Input
                  max={100}
                  min={0}
                  onChange={(event) => setMinScore(Number(event.target.value))}
                  type="range"
                  value={minScore}
                />
              </Field>
              <Field label="Sort">
                <select
                  className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                  onChange={(event) =>
                    setSort(event.target.value as "score_desc" | "drafted_desc")
                  }
                  value={sort}
                >
                  <option value="score_desc">Score desc</option>
                  <option value="drafted_desc">Drafted desc</option>
                </select>
              </Field>
              <div className="flex items-end">
                <Button
                  disabled={isLoading}
                  onClick={loadWithFilters}
                  type="button"
                  variant="outline"
                >
                  {isLoading ? <Loader2 className="animate-spin" /> : null}
                  Apply
                </Button>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {DEAL_TYPES.map((dealType) => (
                <Button
                  key={dealType}
                  onClick={() => toggleDealType(dealType)}
                  size="sm"
                  type="button"
                  variant={dealTypes.includes(dealType) ? "default" : "outline"}
                >
                  {dealType}
                </Button>
              ))}
            </div>
          </CardContent>
        </Card>

        {list.rows.length === 0 ? (
          <Card>
            <CardContent className="p-10 text-center text-sm text-muted-foreground">
              No drafts pending. Click Draft today to fire auto-batch, or visit
              /brands and click Draft this pitch on a ranked brand.
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4">
            {list.rows.map((row) => (
              <DraftCard
                edit={edits[row.message.id]}
                expanded={expandedId === row.message.id}
                isMutating={isMutating}
                key={row.message.id}
                onApprove={() => approve(row)}
                onExclude={() => exclude(row)}
                onRegenerate={() => regenerate(row)}
                onSkip={() => skip(row)}
                onToggleExpanded={() => {
                  ensureEdit(row);
                  setExpandedId((current) =>
                    current === row.message.id ? null : row.message.id,
                  );
                }}
                onUpdateEdit={(next) => updateEdit(row.message.id, next)}
                row={row}
              />
            ))}
          </div>
        )}
      </section>
    </main>
  );
}

function DraftCard({
  row,
  expanded,
  edit,
  isMutating,
  onApprove,
  onExclude,
  onRegenerate,
  onSkip,
  onToggleExpanded,
  onUpdateEdit,
}: {
  row: PendingApprovalRow;
  expanded: boolean;
  edit: DraftEditState | undefined;
  isMutating: boolean;
  onApprove: () => void;
  onExclude: () => void;
  onRegenerate: () => void;
  onSkip: () => void;
  onToggleExpanded: () => void;
  onUpdateEdit: (next: Partial<DraftEditState>) => void;
}) {
  const currentEdit = edit ?? {
    subject: row.message.subject,
    body: row.message.body_text,
    angleHint: "",
  };

  return (
    <Card id={row.message.id}>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="text-lg">
              @{row.creator_profile.handle} · {row.campaign.deal_type} ·{" "}
              {row.brand.name}
            </CardTitle>
            <CardDescription>
              Drafted {new Date(row.message.created_at).toLocaleString()}
            </CardDescription>
          </div>
          <Badge>{row.campaign.score ?? 0}/100</Badge>
        </div>
      </CardHeader>
      <CardContent className="grid gap-4">
        <SummaryLine label="Why this brand" value={row.brief.why_this_brand} />
        <SummaryLine
          label="Why this deal type"
          value={row.brief.why_this_deal_type}
        />
        <SummaryLine
          label="Recommended hook"
          value={row.brief.recommended_hook.pattern_name}
        />
        {row.brief.risk_flags.length > 0 ? (
          <SummaryLine label="Risks" value={row.brief.risk_flags.join(" · ")} />
        ) : null}
        <div className="flex flex-wrap gap-2">
          <Button onClick={onToggleExpanded} type="button" variant="outline">
            {expanded ? "Hide draft" : "Show draft"}
          </Button>
          <Button onClick={onSkip} type="button" variant="outline">
            Skip
          </Button>
          <Button onClick={onExclude} type="button" variant="outline">
            Exclude brand
          </Button>
        </div>
        {expanded ? (
          <>
            <Separator />
            <div className="grid gap-3">
              <Field label="Subject">
                <select
                  className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                  onChange={(event) =>
                    onUpdateEdit({ subject: event.target.value })
                  }
                  value={currentEdit.subject}
                >
                  {row.subject_variants.map((subject) => (
                    <option key={subject} value={subject}>
                      {subject}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Body">
                <Textarea
                  className="min-h-[320px] font-mono text-sm"
                  onChange={(event) => onUpdateEdit({ body: event.target.value })}
                  value={currentEdit.body}
                />
              </Field>
              <Field label="Different angle">
                <Input
                  onChange={(event) =>
                    onUpdateEdit({ angleHint: event.target.value })
                  }
                  placeholder="lean into the recent product launch"
                  value={currentEdit.angleHint}
                />
              </Field>
              <div className="flex flex-wrap gap-2">
                <Button disabled={isMutating} onClick={onApprove} type="button">
                  {isMutating ? <Loader2 className="animate-spin" /> : null}
                  Approve & send
                </Button>
                <Button
                  disabled={isMutating}
                  onClick={onRegenerate}
                  type="button"
                  variant="outline"
                >
                  Regenerate
                </Button>
                <Button onClick={onSkip} type="button" variant="outline">
                  Skip
                </Button>
                <Button onClick={onExclude} type="button" variant="outline">
                  Exclude brand
                </Button>
              </div>
            </div>
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}

function BatchStatusCard({ status }: { status: Exclude<BatchStatus, null> }) {
  const summary = readBatchSummary(status.result_json);

  return (
    <Card>
      <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4 text-sm">
        <div>
          <p className="font-medium">Latest auto-draft batch: {status.status}</p>
          {summary ? (
            <p className="text-muted-foreground">
              {summary.draftsCreated} drafts created from{" "}
              {summary.candidatesProcessed} candidates.
            </p>
          ) : status.error_message ? (
            <p className="text-muted-foreground">{status.error_message}</p>
          ) : null}
        </div>
        {!isTerminalJob(status.status) ? (
          <Badge variant="secondary">Running</Badge>
        ) : null}
      </CardContent>
    </Card>
  );
}

function SummaryLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-1 text-sm">
      <p className="font-medium">{label}</p>
      <p className="text-muted-foreground">{value}</p>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="grid gap-2 text-sm">
      <Label>{label}</Label>
      {children}
    </label>
  );
}

function isTerminalJob(status: string) {
  return status === "succeeded" || status === "failed" || status === "cancelled";
}

function readBatchSummary(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;
  const draftsCreated = record.draftsCreated;
  const candidatesProcessed = record.candidatesProcessed;

  if (typeof draftsCreated !== "number" || typeof candidatesProcessed !== "number") {
    return null;
  }

  return {
    draftsCreated,
    candidatesProcessed,
  };
}
