import type { EnrichmentContext, ContactDiscoveryResult } from "./contacts.ts";
import { discoverContactsForBrand } from "./contacts.ts";

export type BulkEnrichmentResult = {
  processed: number;
  succeeded: number;
  skipped: number;
  errors: { brand_id: string; message: string }[];
  results: ContactDiscoveryResult[];
};

export async function enrichUnenrichedBrandsForUser(
  context: EnrichmentContext,
  options: { limit?: number } = {},
): Promise<BulkEnrichmentResult> {
  const limit = options.limit ?? 25;
  const [{ data: brands, error: brandsError }, signalsResult] =
    await Promise.all([
      context.supabase
        .from("brands")
        .select("id,domain")
        .eq("user_id", context.userId)
        .order("created_at", {
          ascending: true,
        }),
      context.supabase
        .from("source_signals")
        .select("brand_id")
        .eq("user_id", context.userId)
        .eq("signal_type", "hunter_enrichment"),
    ]);

  if (brandsError) {
    throw new Error(brandsError.message);
  }

  if (signalsResult.error) {
    throw new Error(signalsResult.error.message);
  }

  const enrichedBrandIds = new Set(
    (signalsResult.data ?? []).map((signal) => signal.brand_id),
  );
  const targets = (brands ?? [])
    .filter((brand) => brand.domain && !enrichedBrandIds.has(brand.id))
    .slice(0, limit);
  const results: ContactDiscoveryResult[] = [];

  for (const brand of targets) {
    results.push(await discoverContactsForBrand(context, brand.id));
  }

  return {
    processed: results.filter((result) => result.skipped_reason !== "no_domain")
      .length,
    succeeded: results.filter((result) => result.status === "success").length,
    skipped: results.filter((result) => result.status === "skipped").length,
    errors: results
      .filter((result) => result.status === "error")
      .map((result) => ({
        brand_id: result.brand_id,
        message: result.error_message ?? "Unknown enrichment error",
      })),
    results,
  };
}
