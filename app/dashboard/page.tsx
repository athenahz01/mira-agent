import { signOut } from "@/app/actions/auth";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { BrandPoolSummary } from "@/lib/brands/service";
import { getBrandPoolSummary } from "@/lib/brands/service";
import type { Database } from "@/lib/db/types";
import type { JobSummary } from "@/lib/jobs/brand-page-scrape";
import { getJobSummary } from "@/lib/jobs/brand-page-scrape";
import type { TopOpportunity } from "@/lib/scoring/service";
import { getTopOpportunitiesForUser } from "@/lib/scoring/service";
import { createClient } from "@/lib/supabase/server";

type AppUser = Database["public"]["Tables"]["users"]["Row"];
type CreatorProfile = Database["public"]["Tables"]["creator_profiles"]["Row"];
type VoiceGuide = Database["public"]["Tables"]["voice_style_guides"]["Row"];
type MediaKit = Database["public"]["Tables"]["media_kits"]["Row"];
type Job = Database["public"]["Tables"]["jobs"]["Row"];

type DraftingSummary = {
  pendingApprovals: number;
  approvedToday: number;
  approvedThisWeek: number;
  latestAutoDraftJob: Job | null;
};

type SendPipelineSummary = {
  scheduledCount: number;
  nextScheduledAt: string | null;
  sentToday: number;
  sentThisWeek: number;
  failedLast7Days: number;
};

type InboxSummary = {
  repliesLast7Days: number;
  categoryCounts: { category: string; count: number }[];
  pendingReplyDrafts: number;
  pendingFollowUps: number;
  inboxLastPolledAt: string | null;
  inboxPollPaused: boolean;
};

type DashboardData = {
  name: string;
  profiles: CreatorProfile[];
  activeGuidesByProfileId: Record<string, VoiceGuide>;
  activeKitsByProfileId: Record<string, MediaKit>;
  brandSummary: BrandPoolSummary;
  jobSummary: JobSummary;
  topOpportunitiesByProfileId: Record<string, TopOpportunity[]>;
  draftingSummary: DraftingSummary;
  sendPipelineSummary: SendPipelineSummary;
  inboxSummary: InboxSummary;
};

async function getDashboardData(): Promise<DashboardData | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return null;
  }

  const [
    profileResult,
    creatorProfilesResult,
    guidesResult,
    kitsResult,
    brandSummary,
    jobSummary,
    draftingSummary,
    sendPipelineSummary,
    inboxSummary,
  ] = await Promise.all([
    supabase
      .from("users")
      .select("*")
      .eq("user_id", user.id)
      .maybeSingle(),
    supabase
      .from("creator_profiles")
      .select("*")
      .eq("user_id", user.id)
      .order("handle"),
    supabase
      .from("voice_style_guides")
      .select("*")
      .eq("user_id", user.id)
      .eq("is_active", true),
    supabase
      .from("media_kits")
      .select("*")
      .eq("user_id", user.id)
      .eq("is_active", true),
    getBrandPoolSummary({
      supabase,
      userId: user.id,
    }),
    getJobSummary({
      supabase,
      userId: user.id,
    }),
    getDraftingSummary({
      supabase,
      userId: user.id,
    }),
    getSendPipelineSummary({
      supabase,
      userId: user.id,
    }),
    getInboxSummary({
      supabase,
      userId: user.id,
    }),
  ]);
  const profile = profileResult.data as AppUser | null;
  const metadataName =
    typeof user.user_metadata.name === "string"
      ? user.user_metadata.name
      : null;
  const activeGuidesByProfileId: Record<string, VoiceGuide> = {};
  const activeKitsByProfileId: Record<string, MediaKit> = {};

  for (const guide of guidesResult.data ?? []) {
    activeGuidesByProfileId[guide.creator_profile_id] = guide;
  }

  for (const kit of kitsResult.data ?? []) {
    activeKitsByProfileId[kit.creator_profile_id] = kit;
  }

  const profiles = creatorProfilesResult.data ?? [];
  const topOpportunitiesByProfileId = await getTopOpportunitiesForUser(
    {
      supabase,
      userId: user.id,
    },
    profiles.map((item) => item.id),
  );

  return {
    name: profile?.name ?? metadataName ?? user.email ?? "Athena",
    profiles,
    activeGuidesByProfileId,
    activeKitsByProfileId,
    brandSummary,
    jobSummary,
    topOpportunitiesByProfileId,
    draftingSummary,
    sendPipelineSummary,
    inboxSummary,
  };
}

async function getDraftingSummary(context: {
  supabase: Awaited<ReturnType<typeof createClient>>;
  userId: string;
}): Promise<DraftingSummary> {
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const startOfWeek = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const [
    pendingResult,
    approvedTodayResult,
    approvedWeekResult,
    latestJobResult,
  ] = await Promise.all([
    context.supabase
      .from("messages")
      .select("id", { count: "exact", head: true })
      .eq("user_id", context.userId)
      .eq("status", "pending_approval"),
    context.supabase
      .from("messages")
      .select("id", { count: "exact", head: true })
      .eq("user_id", context.userId)
      .eq("status", "approved")
      .gte("approved_at", startOfToday.toISOString()),
    context.supabase
      .from("messages")
      .select("id", { count: "exact", head: true })
      .eq("user_id", context.userId)
      .eq("status", "approved")
      .gte("approved_at", startOfWeek.toISOString()),
    context.supabase
      .from("jobs")
      .select("*")
      .eq("user_id", context.userId)
      .eq("kind", "auto_draft")
      .order("created_at", { ascending: false })
      .limit(1),
  ]);

  if (pendingResult.error) {
    throw new Error(pendingResult.error.message);
  }

  if (approvedTodayResult.error) {
    throw new Error(approvedTodayResult.error.message);
  }

  if (approvedWeekResult.error) {
    throw new Error(approvedWeekResult.error.message);
  }

  if (latestJobResult.error) {
    throw new Error(latestJobResult.error.message);
  }

  return {
    pendingApprovals: pendingResult.count ?? 0,
    approvedToday: approvedTodayResult.count ?? 0,
    approvedThisWeek: approvedWeekResult.count ?? 0,
    latestAutoDraftJob: latestJobResult.data?.[0] ?? null,
  };
}

async function getSendPipelineSummary(context: {
  supabase: Awaited<ReturnType<typeof createClient>>;
  userId: string;
}): Promise<SendPipelineSummary> {
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const startOfWeek = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const [
    scheduledResult,
    nextScheduledResult,
    sentTodayResult,
    sentWeekResult,
    failedResult,
  ] = await Promise.all([
    context.supabase
      .from("messages")
      .select("id", { count: "exact", head: true })
      .eq("user_id", context.userId)
      .eq("status", "approved")
      .is("sent_at", null),
    context.supabase
      .from("messages")
      .select("scheduled_send_at")
      .eq("user_id", context.userId)
      .eq("status", "approved")
      .is("sent_at", null)
      .not("scheduled_send_at", "is", null)
      .order("scheduled_send_at", { ascending: true })
      .limit(1),
    context.supabase
      .from("messages")
      .select("id", { count: "exact", head: true })
      .eq("user_id", context.userId)
      .eq("status", "sent")
      .gte("sent_at", startOfToday.toISOString()),
    context.supabase
      .from("messages")
      .select("id", { count: "exact", head: true })
      .eq("user_id", context.userId)
      .eq("status", "sent")
      .gte("sent_at", startOfWeek.toISOString()),
    context.supabase
      .from("send_events")
      .select("id", { count: "exact", head: true })
      .eq("user_id", context.userId)
      .eq("event_type", "failed")
      .gte("created_at", startOfWeek.toISOString()),
  ]);

  for (const result of [
    scheduledResult,
    nextScheduledResult,
    sentTodayResult,
    sentWeekResult,
    failedResult,
  ]) {
    if (result.error) {
      throw new Error(result.error.message);
    }
  }

  return {
    scheduledCount: scheduledResult.count ?? 0,
    nextScheduledAt: nextScheduledResult.data?.[0]?.scheduled_send_at ?? null,
    sentToday: sentTodayResult.count ?? 0,
    sentThisWeek: sentWeekResult.count ?? 0,
    failedLast7Days: failedResult.count ?? 0,
  };
}

async function getInboxSummary(context: {
  supabase: Awaited<ReturnType<typeof createClient>>;
  userId: string;
}): Promise<InboxSummary> {
  const startOfWeek = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const [
    appUserResult,
    repliesResult,
    classificationsResult,
    pendingReplyDraftsResult,
    pendingFollowUpsResult,
  ] = await Promise.all([
    context.supabase
      .from("users")
      .select("inbox_last_polled_at,inbox_poll_paused")
      .eq("user_id", context.userId)
      .single(),
    context.supabase
      .from("messages")
      .select("id", { count: "exact", head: true })
      .eq("user_id", context.userId)
      .eq("kind", "reply")
      .eq("status", "replied")
      .gte("sent_at", startOfWeek.toISOString()),
    context.supabase
      .from("reply_classifications")
      .select("category")
      .eq("user_id", context.userId)
      .gte("created_at", startOfWeek.toISOString()),
    context.supabase
      .from("messages")
      .select("id", { count: "exact", head: true })
      .eq("user_id", context.userId)
      .eq("kind", "reply")
      .eq("status", "pending_approval"),
    context.supabase
      .from("messages")
      .select("id", { count: "exact", head: true })
      .eq("user_id", context.userId)
      .in("kind", ["follow_up_1", "follow_up_2"])
      .in("status", ["pending_approval", "approved"]),
  ]);

  for (const result of [
    appUserResult,
    repliesResult,
    classificationsResult,
    pendingReplyDraftsResult,
    pendingFollowUpsResult,
  ]) {
    if (result.error) {
      throw new Error(result.error.message);
    }
  }

  const categoryMap = new Map<string, number>();

  for (const row of classificationsResult.data ?? []) {
    categoryMap.set(row.category, (categoryMap.get(row.category) ?? 0) + 1);
  }

  return {
    repliesLast7Days: repliesResult.count ?? 0,
    categoryCounts: [...categoryMap.entries()].map(([category, count]) => ({
      category,
      count,
    })),
    pendingReplyDrafts: pendingReplyDraftsResult.count ?? 0,
    pendingFollowUps: pendingFollowUpsResult.count ?? 0,
    inboxLastPolledAt: appUserResult.data?.inbox_last_polled_at ?? null,
    inboxPollPaused: appUserResult.data?.inbox_poll_paused ?? false,
  };
}

function readDraftingJobSummary(value: Job["result_json"]) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return "no summary yet";
  }

  const draftsCreated = value.draftsCreated;
  const profilesProcessed = value.profilesProcessed;

  if (typeof draftsCreated !== "number" || typeof profilesProcessed !== "number") {
    return "no summary yet";
  }

  return `${profilesProcessed} profile${profilesProcessed === 1 ? "" : "s"}, ${draftsCreated} draft${draftsCreated === 1 ? "" : "s"} created`;
}

export default async function DashboardPage() {
  const data = await getDashboardData();

  if (!data) {
    return null;
  }

  return (
    <main className="min-h-screen bg-muted/30 px-6 py-10">
      <section className="mx-auto flex w-full max-w-3xl flex-col gap-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-muted-foreground">Mira</p>
            <h1 className="mt-2 text-3xl font-semibold tracking-normal">
              Welcome, {data.name}
            </h1>
          </div>
          <Button asChild variant="outline">
            <a href="/settings">Settings</a>
          </Button>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Dashboard foundation</CardTitle>
            <CardDescription>
              The database, RLS policies, and app shell are being set up first.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex items-center justify-between gap-4">
            <p className="text-sm text-muted-foreground">
              Product workflows start in the next phase.
            </p>
            <form action={signOut}>
              <Button type="submit" variant="outline">
                Sign out
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Voice Guides</CardTitle>
            <CardDescription>
              Mira uses these when she writes sponsorship outreach.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            {data.profiles.map((profile) => {
              const guide = data.activeGuidesByProfileId[profile.id];

              return (
                <div
                  className="flex flex-wrap items-center justify-between gap-3 rounded-md border px-3 py-3"
                  key={profile.id}
                >
                  <div>
                    <p className="font-medium">@{profile.handle}</p>
                    <p className="text-sm text-muted-foreground">
                      {profile.display_name}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    {guide ? (
                      <Badge>v{guide.version} active</Badge>
                    ) : (
                      <Badge variant="outline">No guide</Badge>
                    )}
                    <Button asChild size="sm" variant="outline">
                      <a href={`/onboarding?step=voice&profile=${profile.id}`}>
                        Edit voice
                      </a>
                    </Button>
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Media Kits</CardTitle>
            <CardDescription>
              Brand-facing kit versions for each active profile.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            {data.profiles.map((profile) => {
              const kit = data.activeKitsByProfileId[profile.id];

              return (
                <div
                  className="flex flex-wrap items-center justify-between gap-3 rounded-md border px-3 py-3"
                  key={profile.id}
                >
                  <div>
                    <p className="font-medium">@{profile.handle}</p>
                    <p className="text-sm text-muted-foreground">
                      {profile.display_name}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    {kit ? (
                      <Badge>v{kit.version} active</Badge>
                    ) : (
                      <Badge variant="outline">No kit</Badge>
                    )}
                    <Button asChild size="sm" variant="outline">
                      <a href="/kits">Edit</a>
                    </Button>
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Brand Pool</CardTitle>
            <CardDescription>
              Manual seeds and CSV imports for Mira to research later.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-md border px-3 py-3">
                <p className="text-2xl font-semibold">
                  {data.brandSummary.total}
                </p>
                <p className="text-sm text-muted-foreground">Total brands</p>
              </div>
              <div className="rounded-md border px-3 py-3">
                <p className="text-2xl font-semibold">
                  {data.brandSummary.excluded}
                </p>
                <p className="text-sm text-muted-foreground">Excluded</p>
              </div>
              <div className="rounded-md border px-3 py-3">
                <p className="text-2xl font-semibold">
                  {data.brandSummary.totalContacts}
                </p>
                <p className="text-sm text-muted-foreground">Total contacts</p>
              </div>
            </div>
            <p className="text-sm text-muted-foreground">
              Brands with contacts: {data.brandSummary.brandsWithContacts} /{" "}
              {data.brandSummary.total}
            </p>
            <p className="text-sm text-muted-foreground">
              Match proposals: {data.brandSummary.openMatchProposals}
            </p>
            {data.brandSummary.topCategories.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {data.brandSummary.topCategories.map((category) => (
                  <Badge key={category.category} variant="secondary">
                    {category.category}: {category.count}
                  </Badge>
                ))}
              </div>
            ) : null}
            <Button asChild className="w-fit" variant="outline">
              <a href="/brands">Open brand pool</a>
            </Button>
            {data.brandSummary.openMatchProposals > 0 ? (
              <Button asChild className="w-fit" variant="outline">
                <a href="/brands/proposals">Review match proposals</a>
              </Button>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Top Opportunities</CardTitle>
            <CardDescription>
              Highest scored brand/deal-type pairs currently in Mira&apos;s pool.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            {data.profiles.map((profile) => {
              const opportunities =
                data.topOpportunitiesByProfileId[profile.id] ?? [];

              return (
                <div className="grid gap-2 rounded-md border p-3" key={profile.id}>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <p className="font-medium">@{profile.handle}</p>
                    <Button asChild size="sm" variant="outline">
                      <a href={`/brands?view=paid&profile=${profile.id}`}>
                        Open
                      </a>
                    </Button>
                  </div>
                  {opportunities.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      No scores yet - click Recompute on /brands.
                    </p>
                  ) : (
                    <div className="grid gap-2">
                      {opportunities.map((opportunity) => (
                        <div
                          className="flex flex-wrap items-center justify-between gap-2 text-sm"
                          key={`${opportunity.brand_id}-${opportunity.deal_type}`}
                        >
                          <span>{opportunity.brand_name}</span>
                          <span className="text-muted-foreground">
                            {opportunity.deal_type} · {opportunity.score}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Drafting</CardTitle>
            <CardDescription>
              Pending pitches and recent approval activity.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-md border px-3 py-3">
                <p className="text-2xl font-semibold">
                  {data.draftingSummary.pendingApprovals}
                </p>
                <p className="text-sm text-muted-foreground">
                  Pending approvals
                </p>
              </div>
              <div className="rounded-md border px-3 py-3">
                <p className="text-2xl font-semibold">
                  {data.draftingSummary.approvedToday}
                </p>
                <p className="text-sm text-muted-foreground">
                  Approved today
                </p>
              </div>
              <div className="rounded-md border px-3 py-3">
                <p className="text-2xl font-semibold">
                  {data.draftingSummary.approvedThisWeek}
                </p>
                <p className="text-sm text-muted-foreground">
                  Approved this week
                </p>
              </div>
            </div>
            {data.draftingSummary.latestAutoDraftJob ? (
              <p className="text-sm text-muted-foreground">
                Last auto-draft batch:{" "}
                {data.draftingSummary.latestAutoDraftJob.status} ·{" "}
                {readDraftingJobSummary(
                  data.draftingSummary.latestAutoDraftJob.result_json,
                )}
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">
                No auto-draft batch has run yet.
              </p>
            )}
            <Button asChild className="w-fit" variant="outline">
              <a href="/approvals">Open approval queue</a>
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Send Pipeline</CardTitle>
            <CardDescription>
              Approved pitches waiting on Gmail and recent outbound health.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-md border px-3 py-3">
                <p className="text-2xl font-semibold">
                  {data.draftingSummary.pendingApprovals}
                </p>
                <p className="text-sm text-muted-foreground">
                  Pending approvals
                </p>
              </div>
              <div className="rounded-md border px-3 py-3">
                <p className="text-2xl font-semibold">
                  {data.sendPipelineSummary.scheduledCount}
                </p>
                <p className="text-sm text-muted-foreground">
                  Scheduled to send
                </p>
              </div>
              <div className="rounded-md border px-3 py-3">
                <p className="text-2xl font-semibold">
                  {data.sendPipelineSummary.failedLast7Days}
                </p>
                <p className="text-sm text-muted-foreground">
                  Failed, last 7 days
                </p>
              </div>
            </div>
            <p className="text-sm text-muted-foreground">
              Next scheduled:{" "}
              {data.sendPipelineSummary.nextScheduledAt
                ? new Date(
                    data.sendPipelineSummary.nextScheduledAt,
                  ).toLocaleString()
                : "none"}
            </p>
            <p className="text-sm text-muted-foreground">
              Sent today: {data.sendPipelineSummary.sentToday} - sent this week:{" "}
              {data.sendPipelineSummary.sentThisWeek}
            </p>
            <Button asChild className="w-fit" variant="outline">
              <a href="/sends">Open send queue</a>
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Inbox</CardTitle>
            <CardDescription>
              Replies, rate-response drafts, and follow-up work.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-md border px-3 py-3">
                <p className="text-2xl font-semibold">
                  {data.inboxSummary.repliesLast7Days}
                </p>
                <p className="text-sm text-muted-foreground">
                  Replies, last 7 days
                </p>
              </div>
              <div className="rounded-md border px-3 py-3">
                <p className="text-2xl font-semibold">
                  {data.inboxSummary.pendingReplyDrafts}
                </p>
                <p className="text-sm text-muted-foreground">
                  Reply drafts
                </p>
              </div>
              <div className="rounded-md border px-3 py-3">
                <p className="text-2xl font-semibold">
                  {data.inboxSummary.pendingFollowUps}
                </p>
                <p className="text-sm text-muted-foreground">
                  Pending follow-ups
                </p>
              </div>
            </div>
            <p className="text-sm text-muted-foreground">
              Polling: {data.inboxSummary.inboxPollPaused ? "paused" : "active"}{" "}
              - last polled{" "}
              {data.inboxSummary.inboxLastPolledAt
                ? new Date(
                    data.inboxSummary.inboxLastPolledAt,
                  ).toLocaleString()
                : "never"}
            </p>
            {data.inboxSummary.categoryCounts.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {data.inboxSummary.categoryCounts.map((item) => (
                  <Badge key={item.category} variant="secondary">
                    {item.category}: {item.count}
                  </Badge>
                ))}
              </div>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <Button asChild className="w-fit" variant="outline">
                <a href="/replies">Open replies</a>
              </Button>
              <Button asChild className="w-fit" variant="outline">
                <a href="/approvals">Open approvals</a>
              </Button>
              <Button asChild className="w-fit" variant="outline">
                <a href="/sends">Open sends</a>
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Jobs</CardTitle>
            <CardDescription>
              Background work Mira has queued for brand research.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-md border px-3 py-3">
                <p className="text-2xl font-semibold">
                  {data.jobSummary.queued}
                </p>
                <p className="text-sm text-muted-foreground">Queued</p>
              </div>
              <div className="rounded-md border px-3 py-3">
                <p className="text-2xl font-semibold">
                  {data.jobSummary.running}
                </p>
                <p className="text-sm text-muted-foreground">Running</p>
              </div>
              <div className="rounded-md border px-3 py-3">
                <p className="text-2xl font-semibold">
                  {data.jobSummary.failedLast7Days}
                </p>
                <p className="text-sm text-muted-foreground">
                  Failed, last 7 days
                </p>
              </div>
            </div>
            <Button asChild className="w-fit" variant="outline">
              <a href="/brands">Open brand pool</a>
            </Button>
          </CardContent>
        </Card>
      </section>
    </main>
  );
}
