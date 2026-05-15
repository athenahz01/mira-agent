"use client";

import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";

import { enqueueSendQueueDrain } from "@/app/actions/drafting";
import {
  cancelScheduledSendAction,
  sendScheduledNowAction,
} from "@/app/actions/sends";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { ScheduledSendRow } from "@/lib/sending/service";

export function SendsClient({
  initialRows,
}: {
  initialRows: ScheduledSendRow[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function refresh() {
    router.refresh();
  }

  function sendNow(messageId: string) {
    startTransition(async () => {
      const result = await sendScheduledNowAction(messageId);

      if (!result.ok) {
        toast.error(result.error);
        return;
      }

      toast.success("Queued to send now.");
      refresh();
    });
  }

  function cancel(messageId: string) {
    startTransition(async () => {
      const result = await cancelScheduledSendAction(messageId);

      if (!result.ok) {
        toast.error(result.error);
        return;
      }

      toast.success("Send cancelled.");
      refresh();
    });
  }

  function drainQueue() {
    startTransition(async () => {
      const result = await enqueueSendQueueDrain();

      if (!result.ok) {
        toast.error(result.error);
        return;
      }

      toast.success("Send queue drain queued.");
      refresh();
    });
  }

  return (
    <main className="min-h-screen bg-muted/30 px-6 py-10">
      <section className="mx-auto grid w-full max-w-5xl gap-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-muted-foreground">Mira</p>
            <h1 className="mt-2 text-3xl font-semibold tracking-normal">
              Scheduled Sends
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Approved pitches waiting for their send time.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline">
              <a href="/approvals">Approval queue</a>
            </Button>
            <Button disabled={isPending} onClick={drainQueue} type="button">
              {isPending ? <Loader2 className="animate-spin" /> : null}
              Send any pending now
            </Button>
          </div>
        </div>

        {initialRows.length === 0 ? (
          <Card>
            <CardContent className="p-10 text-center text-sm text-muted-foreground">
              No sends are scheduled.
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4">
            {initialRows.map((row) => (
              <Card key={row.message.id}>
                <CardHeader>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <CardTitle className="text-lg">
                        {row.brand.name} - @{row.creator_profile.handle}
                      </CardTitle>
                      <CardDescription>
                        {formatScheduled(row.message.scheduled_send_at)}
                      </CardDescription>
                    </div>
                    <div className="flex items-center gap-2">
                      {row.message.kind.startsWith("follow_up") ? (
                        <Badge variant="secondary">
                          {row.message.kind === "follow_up_1"
                            ? "Follow-up 1"
                            : "Follow-up 2"}
                        </Badge>
                      ) : null}
                      <Badge variant="secondary">{row.message.status}</Badge>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="grid gap-4">
                  <div className="grid gap-1 text-sm">
                    <p className="font-medium">{row.message.subject}</p>
                    <p className="text-muted-foreground">
                      To: {row.contact?.name ? `${row.contact.name} - ` : ""}
                      {row.contact?.email ?? "No contact"}
                    </p>
                  </div>
                  {row.message.send_error ? (
                    <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                      {row.message.send_error}
                    </p>
                  ) : null}
                  <div className="flex flex-wrap gap-2">
                    <Button
                      disabled={isPending}
                      onClick={() => sendNow(row.message.id)}
                      type="button"
                    >
                      {isPending ? <Loader2 className="animate-spin" /> : null}
                      Send now
                    </Button>
                    <Button
                      disabled={isPending}
                      onClick={() => cancel(row.message.id)}
                      type="button"
                      variant="outline"
                    >
                      Cancel
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

function formatScheduled(value: string | null) {
  if (!value) {
    return "Paused";
  }

  const date = new Date(value);
  const diffMs = date.getTime() - Date.now();
  const diffMinutes = Math.round(diffMs / 60_000);

  if (diffMinutes > 0 && diffMinutes < 60) {
    return `in ${diffMinutes}m`;
  }

  if (diffMinutes >= 60 && diffMinutes < 24 * 60) {
    return `in ${Math.round(diffMinutes / 60)}h`;
  }

  return date.toLocaleString();
}
