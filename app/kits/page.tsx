import { redirect } from "next/navigation";

import { KitsClient } from "@/app/kits/kits-client";
import { listMediaKitPageProfiles } from "@/lib/media-kit/service";
import { createClient } from "@/lib/supabase/server";

export default async function KitsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const profiles = await listMediaKitPageProfiles({
    supabase,
    userId: user.id,
    email: user.email ?? "zhengathenahuo@gmail.com",
  });

  return <KitsClient initialProfiles={profiles} />;
}
