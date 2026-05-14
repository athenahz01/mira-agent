import { signOut } from "@/app/actions/auth";
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

async function getDashboardName() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return null;
  }

  const profileResult = await supabase
    .from("users")
    .select("*")
    .eq("user_id", user.id)
    .maybeSingle();
  const profile = profileResult.data as AppUser | null;
  const metadataName =
    typeof user.user_metadata.name === "string"
      ? user.user_metadata.name
      : null;

  return profile?.name ?? metadataName ?? user.email ?? "Athena";
}

export default async function DashboardPage() {
  const name = await getDashboardName();

  if (!name) {
    return null;
  }

  return (
    <main className="min-h-screen bg-muted/30 px-6 py-10">
      <section className="mx-auto flex w-full max-w-3xl flex-col gap-6">
        <div>
          <p className="text-sm font-medium text-muted-foreground">Mira</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-normal">
            Welcome, {name}
          </h1>
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
      </section>
    </main>
  );
}
