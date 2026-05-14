import { redirect } from "next/navigation";

import { BrandMatchProposalsClient } from "@/app/brands/proposals/proposals-client";
import { listOpenBrandMatchProposals } from "@/lib/brands/service";
import { createClient } from "@/lib/supabase/server";

export default async function BrandMatchProposalsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const proposals = await listOpenBrandMatchProposals({
    supabase,
    userId: user.id,
  });

  return <BrandMatchProposalsClient proposals={proposals} />;
}
