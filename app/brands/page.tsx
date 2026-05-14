import { redirect } from "next/navigation";

import { BrandsClient } from "@/app/brands/brands-client";
import { brandFiltersSchema } from "@/lib/brands/schemas";
import { listBrandsForUser } from "@/lib/brands/service";
import { createClient } from "@/lib/supabase/server";

type BrandsPageProps = {
  searchParams?: Record<string, string | string[] | undefined>;
};

export default async function BrandsPage({ searchParams }: BrandsPageProps) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const filters = brandFiltersSchema.parse({
    query: valueOf(searchParams?.query),
    categories: valuesOf(searchParams?.category),
    size_estimate: valueOf(searchParams?.size_estimate) ?? null,
    has_contacts: valueOf(searchParams?.has_contacts) === "true",
    excluded: valueOf(searchParams?.excluded) === "true",
    page: Number(valueOf(searchParams?.page) ?? 1),
    sort: valueOf(searchParams?.sort) ?? "created_at",
    direction: valueOf(searchParams?.direction) ?? "desc",
  });
  const brandList = await listBrandsForUser(
    {
      supabase,
      userId: user.id,
    },
    filters,
  );

  return <BrandsClient initialList={brandList} />;
}

function valueOf(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function valuesOf(value: string | string[] | undefined) {
  if (!value) {
    return [];
  }

  return Array.isArray(value) ? value : [value];
}
