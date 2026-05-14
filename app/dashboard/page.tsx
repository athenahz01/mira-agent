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
import { createClient } from "@/lib/supabase/server";

type AppUser = Database["public"]["Tables"]["users"]["Row"];
type CreatorProfile = Database["public"]["Tables"]["creator_profiles"]["Row"];
type VoiceGuide = Database["public"]["Tables"]["voice_style_guides"]["Row"];
type MediaKit = Database["public"]["Tables"]["media_kits"]["Row"];

type DashboardData = {
  name: string;
  profiles: CreatorProfile[];
  activeGuidesByProfileId: Record<string, VoiceGuide>;
  activeKitsByProfileId: Record<string, MediaKit>;
  brandSummary: BrandPoolSummary;
  jobSummary: JobSummary;
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

  return {
    name: profile?.name ?? metadataName ?? user.email ?? "Athena",
    profiles: creatorProfilesResult.data ?? [],
    activeGuidesByProfileId,
    activeKitsByProfileId,
    brandSummary,
    jobSummary,
  };
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
