"use client";

import { Loader2 } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import {
  enqueueFollowUpScan,
  enqueueInboxPoll,
  listRecentRepliesAction,
  markReplyHandledAction,
  pauseInboxPollingAction,
  setCampaignOutcomeAction,
} from "@/app/actions/replies";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { ReplyCategory } from "@/lib/db/reply-classification";
import type { RecentReplyRow } from "@/lib/replies/service";

const categories: ReplyCategory[] = [
  "interested",
  "asks_rate",
  "asks_more_info",
  "decline_polite",
  "decline_firm",
  "out_of_office",
  "wrong_person",
  "unsubscribe",
  "spam",
  "other",
];

export function RepliesClient({
  initialRows,
  inboxLastPolledAt,
  inboxPollPaused,
}: {
  initialRows: RecentReplyRow[];
  inboxLastPolledAt: string | null;
  inboxPollPaused: boolean;
}) {
  const [rows, setRows] = useState(initialRows);
  const [selectedCategories, setSelectedCategories] = useState<ReplyCategory[]>(
    [],
  );
  const [hideHandled, setHideHandled] = useState(true);
  const [paused, setPaused] = useState(inboxPollPaused);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function refresh() {
    startTransition(async () => {
      const result = await listRecentRepliesAction({
        categories:
          selectedCategories.length > 0 ? selectedCategories : undefined,
        hideHandled,
      });

      if (!result.ok) {
        toast.error(result.error);
        return;
      }

      setRows(result.data);
    });
  }

  function pollNow() {
    startTransition(async () => {
      const result = await enqueueInboxPoll();

      if (!result.ok) {
        toast.error(result.error);
        return;
      }

      toast.success("Inbox poll queued.");
    });
  }

  function runFollowUps() {
    startTransition(async () => {
      const result = await enqueueFollowUpScan();

      if (!result.ok) {
        toast.error(result.error);
        return;
      }

      toast.success("Follow-up scan queued.");
    });
  }

  function togglePaused() {
    startTransition(async () => {
      const result = await pauseInboxPollingAction(!paused);

      if (!result.ok) {
        toast.error(result.error);
        return;
      }

      setPaused(!paused);
      toast.success(!paused ? "Inbox polling paused." : "Inbox polling resumed.");
    });
  }

  function markHandled(messageId: string) {
    startTransition(async () => {
      const result = await markReplyHandledAction(messageId);

      if (!result.ok) {
        toast.error(result.error);
        return;
      }

      setRows((current) => current.filter((row) => row.message.id !== messageId));
      toast.success("Reply marked handled.");
    });
  }

  function setOutcome(campaignId: string, outcome: "won" | "lost") {
    startTransition(async () => {
      const result = await setCampaignOutcomeAction(campaignId, outcome);

      if (!result.ok) {
        toast.error(result.error);
        return;
      }

      toast.success(`Campaign marked ${outcome}.`);
      refresh();
    });
  }

  function toggleCategory(category: ReplyCategory) {
    setSelectedCategories((current) =>
      current.includes(category)
        ? current.filter((item) => item !== category)
        : [...current, category],
    );
  }

  return (
    <main className="min-h-screen bg-muted/30 px-6 py-10">
      <section className="mx-auto grid w-full max-w-6xl gap-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-muted-foreground">Mira</p>
            <h1 className="mt-2 text-3xl font-semibold tracking-normal">
              Replies
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Last polled:{" "}
              {inboxLastPolledAt
                ? new Date(inboxLastPolledAt).toLocaleString()
                : "not yet"}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline">
              <a href="/approvals">Approval queue</a>
            </Button>
            <Button
              disabled={isPending}
              onClick={pollNow}
              type="button"
              variant="outline"
            >
              {isPending ? <Loader2 className="animate-spin" /> : null}
              Poll inbox now
            </Button>
            <Button
              disabled={isPending}
              onClick={runFollowUps}
              type="button"
              variant="outline"
            >
              Generate follow-ups now
            </Button>
            <Button disabled={isPending} onClick={togglePaused} type="button">
              {paused ? "Resume polling" : "Pause polling"}
            </Button>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Filters</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4">
            <div className="flex flex-wrap gap-2">
              {categories.map((category) => (
                <Button
                  key={category}
                  onClick={() => toggleCategory(category)}
                  size="sm"
                  type="button"
                  variant={
                    selectedCategories.includes(category) ? "default" : "outline"
                  }
                >
                  {category}
                </Button>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-2 text-sm">
                <input
                  checked={hideHandled}
                  className="size-4 accent-primary"
                  onChange={(event) => setHideHandled(event.target.checked)}
                  type="checkbox"
                />
                Hide handled
              </label>
              <Button disabled={isPending} onClick={refresh} type="button">
                Apply
              </Button>
            </div>
          </CardContent>
        </Card>

        {rows.length === 0 ? (
          <Card>
            <CardContent className="p-10 text-center text-sm text-muted-foreground">
              No replies to review.
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4">
            {rows.map((row) => (
              <Card key={row.message.id}>
                <CardHeader>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <CardTitle className="text-lg">
                        {row.brand.name} - {row.campaign.deal_type}
                      </CardTitle>
                      <CardDescription>
                        {row.message.sent_at
                          ? new Date(row.message.sent_at).toLocaleString()
                          : row.message.created_at}
                      </CardDescription>
                    </div>
                    {row.classification ? (
                      <Badge className={categoryClass(row.classification.category)}>
                        {row.classification.category}
                      </Badge>
                    ) : (
                      <Badge variant="outline">unclassified</Badge>
                    )}
                  </div>
                </CardHeader>
                <CardContent className="grid gap-4">
                  <div className="grid gap-1 text-sm">
                    <p className="font-medium">
                      {row.classification?.summary ?? "No summary yet."}
                    </p>
                    <p className="text-muted-foreground">
                      Suggested:{" "}
                      {row.classification?.suggested_action ?? "no_action"}
                    </p>
                  </div>
                  <div className="rounded-md border bg-background px-3 py-3 text-sm text-muted-foreground">
                    {expandedId === row.message.id
                      ? row.message.body_text
                      : `${row.message.body_text.slice(0, 260)}${
                          row.message.body_text.length > 260 ? "..." : ""
                        }`}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      onClick={() =>
                        setExpandedId((current) =>
                          current === row.message.id ? null : row.message.id,
                        )
                      }
                      type="button"
                      variant="outline"
                    >
                      {expandedId === row.message.id ? "Collapse" : "Expand"}
                    </Button>
                    {row.message.gmail_thread_id ? (
                      <Button asChild variant="outline">
                        <a
                          href={`https://mail.google.com/mail/u/0/#inbox/${row.message.gmail_thread_id}`}
                          rel="noreferrer"
                          target="_blank"
                        >
                          Reply in Gmail
                        </a>
                      </Button>
                    ) : null}
                    {row.classification?.category === "asks_rate" ? (
                      <Button asChild variant="outline">
                        <a href="/approvals">Open approval queue</a>
                      </Button>
                    ) : null}
                    <Button
                      disabled={isPending}
                      onClick={() => markHandled(row.message.id)}
                      type="button"
                      variant="outline"
                    >
                      Mark handled
                    </Button>
                    <Button
                      disabled={isPending}
                      onClick={() => setOutcome(row.campaign.id, "won")}
                      type="button"
                      variant="outline"
                    >
                      Mark won
                    </Button>
                    <Button
                      disabled={isPending}
                      onClick={() => setOutcome(row.campaign.id, "lost")}
                      type="button"
                      variant="outline"
                    >
                      Mark lost
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}

function categoryClass(category: string) {
  if (category === "interested") {
    return "bg-emerald-600 text-white";
  }

  if (category === "asks_rate") {
    return "bg-blue-600 text-white";
  }

  if (category === "out_of_office") {
    return "bg-yellow-500 text-black";
  }

  if (category === "wrong_person") {
    return "bg-orange-500 text-white";
  }

  if (
    category === "decline_firm" ||
    category === "unsubscribe" ||
    category === "spam"
  ) {
    return "bg-red-600 text-white";
  }

  return "";
}
