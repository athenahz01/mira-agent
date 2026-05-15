"use client";

import { Loader2 } from "lucide-react";
import type React from "react";
import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";

import {
  disconnectGmail,
  upsertOutreachRules,
  upsertUserBasics,
} from "@/app/actions/settings";
import { ChipInput } from "@/components/ui/chip-input";
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
import { Textarea } from "@/components/ui/textarea";
import type { Tables } from "@/lib/db/types";
import type { OutreachRulesInput } from "@/lib/settings/schemas";

type SettingsClientProps = {
  appUser: Tables<"users"> | null;
  authEmail: string;
  profiles: Tables<"creator_profiles">[];
  rules: Tables<"outreach_rules">[];
  gmailCredential: Tables<"gmail_credentials"> | null;
  gmailStatus?: string;
};

export function SettingsClient({
  appUser,
  authEmail,
  profiles,
  rules,
  gmailCredential,
  gmailStatus,
}: SettingsClientProps) {
  useEffect(() => {
    if (gmailStatus === "connected") {
      toast.success("Gmail connected.");
    } else if (gmailStatus && gmailStatus !== "connected") {
      toast.error(`Gmail connection returned: ${gmailStatus}`);
    }
  }, [gmailStatus]);

  return (
    <main className="min-h-screen bg-muted/30 px-6 py-10">
      <section className="mx-auto grid w-full max-w-5xl gap-6">
        <div>
          <p className="text-sm font-medium text-muted-foreground">Mira</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-normal">
            Settings
          </h1>
        </div>

        <AccountSettings appUser={appUser} authEmail={authEmail} />
        <GmailSettings credential={gmailCredential} />
        <OutreachRulesSettings profiles={profiles} rules={rules} />
      </section>
    </main>
  );
}

function AccountSettings({
  appUser,
  authEmail,
}: {
  appUser: Tables<"users"> | null;
  authEmail: string;
}) {
  const [isPending, startTransition] = useTransition();
  const [form, setForm] = useState({
    name: appUser?.name ?? "Athena Huo",
    sender_display_name: appUser?.sender_display_name ?? "Athena Huo",
    physical_address: appUser?.physical_address ?? "",
    timezone: appUser?.timezone ?? "America/New_York",
  });

  function save() {
    startTransition(async () => {
      const result = await upsertUserBasics(form);

      if (!result.ok) {
        toast.error(result.error);
        return;
      }

      toast.success(result.message);
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Account</CardTitle>
        <CardDescription>{authEmail}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Name">
            <Input
              onChange={(event) =>
                setForm((current) => ({ ...current, name: event.target.value }))
              }
              value={form.name}
            />
          </Field>
          <Field label="Sender display name">
            <Input
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  sender_display_name: event.target.value,
                }))
              }
              value={form.sender_display_name}
            />
          </Field>
          <Field label="Timezone">
            <Input
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  timezone: event.target.value,
                }))
              }
              value={form.timezone}
            />
          </Field>
        </div>
        <Field label="Physical address">
          <Textarea
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                physical_address: event.target.value,
              }))
            }
            value={form.physical_address}
          />
        </Field>
        <Button className="w-fit" disabled={isPending} onClick={save}>
          {isPending ? <Loader2 className="animate-spin" /> : null}
          Save account
        </Button>
      </CardContent>
    </Card>
  );
}

function GmailSettings({
  credential,
}: {
  credential: Tables<"gmail_credentials"> | null;
}) {
  const [isPending, startTransition] = useTransition();
  const [connected, setConnected] = useState(Boolean(credential));

  function disconnect() {
    startTransition(async () => {
      const result = await disconnectGmail();

      if (!result.ok) {
        toast.error(result.error);
        return;
      }

      setConnected(false);
      toast.success(result.message);
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Gmail</CardTitle>
        <CardDescription>
          Mira will use this connection in Phase 4 for sending and reading mail.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap items-center justify-between gap-4">
        {connected && credential ? (
          <div>
            <p className="font-medium">{credential.google_email}</p>
            <p className="text-sm text-muted-foreground">
              Last refreshed: {credential.last_refreshed_at ?? "not yet"}
            </p>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No Gmail connected.</p>
        )}
        {connected ? (
          <Button disabled={isPending} onClick={disconnect} variant="outline">
            {isPending ? <Loader2 className="animate-spin" /> : null}
            Disconnect
          </Button>
        ) : (
          <Button asChild>
            <a href="/api/gmail/connect">Connect Gmail</a>
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

function OutreachRulesSettings({
  profiles,
  rules,
}: {
  profiles: Tables<"creator_profiles">[];
  rules: Tables<"outreach_rules">[];
}) {
  const orderedRules = [
    ...rules.filter((rule) => rule.creator_profile_id === null),
    ...profiles
      .map((profile) =>
        rules.find((rule) => rule.creator_profile_id === profile.id),
      )
      .filter((rule): rule is Tables<"outreach_rules"> => Boolean(rule)),
  ];

  return (
    <div className="grid gap-5">
      {orderedRules.map((rule) => (
        <OutreachRuleCard
          key={rule.id}
          label={
            rule.creator_profile_id
              ? `@${profiles.find((profile) => profile.id === rule.creator_profile_id)?.handle ?? "profile"}`
              : "Global"
          }
          rule={rule}
        />
      ))}
    </div>
  );
}

function OutreachRuleCard({
  label,
  rule,
}: {
  label: string;
  rule: Tables<"outreach_rules">;
}) {
  const [isPending, startTransition] = useTransition();
  const [form, setForm] = useState<OutreachRulesInput>({
    id: rule.id,
    creator_profile_id: rule.creator_profile_id,
    max_sends_per_day: rule.max_sends_per_day,
    max_drafts_per_day: rule.max_drafts_per_day,
    follow_up_enabled: rule.follow_up_enabled,
    follow_up_1_days_after: rule.follow_up_1_days_after,
    follow_up_2_days_after_initial: rule.follow_up_2_days_after_initial,
    follow_up_max_count: rule.follow_up_max_count,
    send_mode:
      rule.send_mode === "queued" || rule.send_mode === "immediate"
        ? rule.send_mode
        : "immediate",
    send_window_start_hour: rule.send_window_start_hour,
    send_window_end_hour: rule.send_window_end_hour,
    send_timezone: rule.send_timezone,
    min_minutes_between_sends: rule.min_minutes_between_sends,
    max_minutes_between_sends: rule.max_minutes_between_sends,
    send_on_weekends: rule.send_on_weekends,
    excluded_categories: rule.excluded_categories,
    auto_send_after_approval: rule.auto_send_after_approval,
    require_per_email_approval: rule.require_per_email_approval,
    warmup_mode: rule.warmup_mode,
    warmup_max_per_day: rule.warmup_max_per_day,
  });

  function save() {
    startTransition(async () => {
      const result = await upsertOutreachRules(form);

      if (!result.ok) {
        toast.error(result.error);
        return;
      }

      toast.success(result.message);
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{label} outreach rules</CardTitle>
        <CardDescription>Adjust pacing and approval defaults.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="grid gap-3 rounded-md border p-3">
          <div>
            <p className="font-medium">Sending</p>
            <p className="text-sm text-muted-foreground">
              Immediate sends wait 30 seconds for undo. Queued sends stay inside
              the send window and use spacing rules.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              onClick={() =>
                setForm((current) => ({ ...current, send_mode: "immediate" }))
              }
              type="button"
              variant={form.send_mode === "immediate" ? "default" : "outline"}
            >
              Immediate
            </Button>
            <Button
              onClick={() =>
                setForm((current) => ({ ...current, send_mode: "queued" }))
              }
              type="button"
              variant={form.send_mode === "queued" ? "default" : "outline"}
            >
              Queued
            </Button>
          </div>
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          <NumberField
            label="Max sends per day"
            onChange={(value) =>
              setForm((current) => ({ ...current, max_sends_per_day: value }))
            }
            value={form.max_sends_per_day}
          />
          <NumberField
            label="Max drafts per day"
            max={50}
            onChange={(value) =>
              setForm((current) => ({ ...current, max_drafts_per_day: value }))
            }
            value={form.max_drafts_per_day}
          />
          <NumberField
            label="Send window start"
            onChange={(value) =>
              setForm((current) => ({
                ...current,
                send_window_start_hour: value,
              }))
            }
            value={form.send_window_start_hour}
          />
          <NumberField
            label="Send window end"
            onChange={(value) =>
              setForm((current) => ({
                ...current,
                send_window_end_hour: value,
              }))
            }
            value={form.send_window_end_hour}
          />
          <Field label="Send timezone">
            <Input readOnly value={form.send_timezone} />
          </Field>
          <NumberField
            label="Min minutes between sends"
            onChange={(value) =>
              setForm((current) => ({
                ...current,
                min_minutes_between_sends: value,
              }))
            }
            value={form.min_minutes_between_sends}
          />
          <NumberField
            label="Max minutes between sends"
            onChange={(value) =>
              setForm((current) => ({
                ...current,
                max_minutes_between_sends: value,
              }))
            }
            value={form.max_minutes_between_sends}
          />
          <NumberField
            label="Warmup max per day"
            onChange={(value) =>
              setForm((current) => ({ ...current, warmup_max_per_day: value }))
            }
            value={form.warmup_max_per_day}
          />
        </div>
        <Field label="Excluded categories">
          <ChipInput
            onChange={(value) =>
              setForm((current) => ({ ...current, excluded_categories: value }))
            }
            value={form.excluded_categories}
          />
        </Field>
        <p className="text-sm text-muted-foreground">
          Excluded brand IDs are deferred until the brand pool exists in Phase 2.
        </p>
        <div className="grid gap-3 rounded-md border p-3">
          <div>
            <p className="font-medium">Follow-ups</p>
            <p className="text-sm text-muted-foreground">
              Follow-up drafts still go through approval and count toward send
              caps.
            </p>
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            <NumberField
              label="Follow-up 1 days after"
              max={30}
              min={1}
              onChange={(value) =>
                setForm((current) => ({
                  ...current,
                  follow_up_1_days_after: value,
                }))
              }
              value={form.follow_up_1_days_after}
            />
            <NumberField
              label="Follow-up 2 days after initial"
              max={60}
              min={1}
              onChange={(value) =>
                setForm((current) => ({
                  ...current,
                  follow_up_2_days_after_initial: value,
                }))
              }
              value={form.follow_up_2_days_after_initial}
            />
            <NumberField
              label="Follow-up max count"
              max={3}
              onChange={(value) =>
                setForm((current) => ({ ...current, follow_up_max_count: value }))
              }
              value={form.follow_up_max_count}
            />
          </div>
          <Toggle
            checked={form.follow_up_enabled}
            label="Follow-ups enabled"
            onChange={(value) =>
              setForm((current) => ({ ...current, follow_up_enabled: value }))
            }
          />
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <Toggle
            checked={form.send_on_weekends}
            label="Send on weekends"
            onChange={(value) =>
              setForm((current) => ({ ...current, send_on_weekends: value }))
            }
          />
          <Toggle
            checked={form.auto_send_after_approval}
            label="Auto-send after approval"
            onChange={(value) =>
              setForm((current) => ({
                ...current,
                auto_send_after_approval: value,
              }))
            }
          />
          <Toggle
            checked={form.require_per_email_approval}
            label="Require per-email approval"
            onChange={(value) =>
              setForm((current) => ({
                ...current,
                require_per_email_approval: value,
              }))
            }
          />
          <Toggle
            checked={form.warmup_mode}
            label="Warmup mode"
            onChange={(value) =>
              setForm((current) => ({ ...current, warmup_mode: value }))
            }
          />
        </div>
        <Button className="w-fit" disabled={isPending} onClick={save}>
          {isPending ? <Loader2 className="animate-spin" /> : null}
          Save rules
        </Button>
      </CardContent>
    </Card>
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
    <div className="grid gap-2">
      <Label>{label}</Label>
      {children}
    </div>
  );
}

function NumberField({
  label,
  value,
  onChange,
  max,
  min = 0,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  max?: number;
  min?: number;
}) {
  return (
    <Field label={label}>
      <Input
        max={max}
        min={min}
        onChange={(event) => onChange(Number(event.target.value))}
        type="number"
        value={value}
      />
    </Field>
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-3 rounded-md border px-3 py-3 text-sm">
      <input
        checked={checked}
        className="size-4 accent-primary"
        onChange={(event) => onChange(event.target.checked)}
        type="checkbox"
      />
      {label}
    </label>
  );
}
