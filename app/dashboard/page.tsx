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
import type { Database } from "@/lib/db/types";
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
};

async function getDashboardData(): Promise<DashboardData | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return null;
  }

  const [profileResult, creatorProfilesResult, guidesResult, kitsResult] =
    await Promise.all([
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
      </section>
    </main>
  );
}
