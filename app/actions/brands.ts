"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import type { Tables } from "@/lib/db/types";
import type { ActionResult } from "@/lib/server/action";
import { createClient } from "@/lib/supabase/server";
import {
  addBrandManualForUser,
  addBrandsFromCsvForUser,
  listBrandsForUser,
  resolveBrandMatchProposalForUser,
  toggleBrandExcludedForUser,
  updateBrandForUser,
  type BrandContext,
  type BrandListResult,
  type FindOrCreateBrandResult,
  type CsvImportResult,
} from "@/lib/brands/service";
import { brandFiltersSchema } from "@/lib/brands/schemas";
import type { BrandFormInput, BrandUpdateInput } from "@/lib/brands/schemas";
import { enrichUnenrichedBrandsForUser } from "@/lib/enrichment/bulk";
import type { BulkEnrichmentResult } from "@/lib/enrichment/bulk";
import {
  addManualBrandContact,
  discoverContactsForBrand,
  markBrandContactUnreachable,
  manualBrandContactSchema,
  type ContactDiscoveryResult,
  type ManualBrandContactInput,
} from "@/lib/enrichment/contacts";
import {
  enqueueBulkPageScrapesForUser,
  enqueuePageScrapeForBrand as enqueuePageScrapeForBrandJob,
  getBrandPageScrapeJobStatus,
  type BulkPageScrapeEnqueueResult,
  type PageScrapeJobSummary,
} from "@/lib/jobs/brand-page-scrape";
import {
  addCompetitorHandleForUser,
  enqueueAllCompetitorScrapesForUser,
  enqueueInstagramCompetitorScrapeForUser,
  removeCompetitorHandleForUser,
  type BulkInstagramScrapeEnqueueResult,
  type InstagramScrapeJobSummary,
} from "@/lib/instagram/competitors";

const brandIdSchema = z.string().uuid();
const contactIdSchema = z.string().uuid();
const creatorProfileIdSchema = z.string().uuid();
const competitorHandleIdSchema = z.string().uuid();
const competitorHandleSchema = z.string().trim().min(1);
const toggleExcludedSchema = z.object({
  id: z.string().uuid(),
  excluded: z.boolean(),
  reason: z.string().trim().nullable().optional(),
});

export async function addBrandManual(
  input: BrandFormInput,
): Promise<ActionResult<FindOrCreateBrandResult>> {
  return runBrandAction("Brand saved.", async (context) =>
    addBrandManualForUser(context, input),
  );
}

export async function addBrandsFromCsv(
  csvText: string,
): Promise<ActionResult<CsvImportResult>> {
  return runBrandAction("CSV import finished.", async (context) =>
    addBrandsFromCsvForUser(context, z.string().min(1).parse(csvText)),
  );
}

export async function updateBrand(
  id: string,
  input: BrandUpdateInput,
): Promise<ActionResult<Tables<"brands">>> {
  return runBrandAction("Brand updated.", async (context) =>
    updateBrandForUser(context, brandIdSchema.parse(id), input),
  );
}

export async function toggleBrandExcluded(
  id: string,
  excluded: boolean,
  reason?: string | null,
): Promise<ActionResult<Tables<"brands">>> {
  return runBrandAction("Brand exclusion updated.", async (context) => {
    const values = toggleExcludedSchema.parse({
      id,
      excluded,
      reason,
    });

    return toggleBrandExcludedForUser(
      context,
      values.id,
      values.excluded,
      values.reason,
    );
  });
}

export async function listBrands(
  filters: unknown,
): Promise<ActionResult<BrandListResult>> {
  return runBrandAction("Brands loaded.", async (context) =>
    listBrandsForUser(context, brandFiltersSchema.parse(filters)),
  );
}

export async function enrichBrandContacts(
  brandId: string,
): Promise<ActionResult<ContactDiscoveryResult>> {
  return runBrandAction("Contact enrichment finished.", async (context) =>
    discoverContactsForBrand(context, brandIdSchema.parse(brandId)),
  );
}

export async function enrichUnenrichedBrands(): Promise<
  ActionResult<BulkEnrichmentResult>
> {
  return runBrandAction("Bulk enrichment finished.", async (context) =>
    enrichUnenrichedBrandsForUser(context, {
      limit: 25,
    }),
  );
}

export async function addBrandContactManual(
  brandId: string,
  input: ManualBrandContactInput,
): Promise<ActionResult<Tables<"brand_contacts">>> {
  return runBrandAction("Contact saved.", async (context) =>
    addManualBrandContact(
      context,
      brandIdSchema.parse(brandId),
      manualBrandContactSchema.parse(input),
    ),
  );
}

export async function markContactUnreachable(
  contactId: string,
  unreachable: boolean,
): Promise<ActionResult<Tables<"brand_contacts">>> {
  return runBrandAction("Contact updated.", async (context) =>
    markBrandContactUnreachable(
      context,
      contactIdSchema.parse(contactId),
      z.boolean().parse(unreachable),
    ),
  );
}

export async function enqueuePageScrapeForBrand(
  brandId: string,
): Promise<ActionResult<PageScrapeJobSummary>> {
  return runBrandAction("Scraping queued.", async (context) =>
    enqueuePageScrapeForBrandJob(context, brandIdSchema.parse(brandId)),
  );
}

export async function getBrandJobStatus(
  brandId: string,
): Promise<ActionResult<PageScrapeJobSummary | null>> {
  return runBrandAction("Job status loaded.", async (context) =>
    getBrandPageScrapeJobStatus(context, brandIdSchema.parse(brandId)),
  );
}

export async function enqueueBulkPageScrape(): Promise<
  ActionResult<BulkPageScrapeEnqueueResult>
> {
  return runBrandAction("Page scraping queued.", async (context) =>
    enqueueBulkPageScrapesForUser(context, {
      limit: 25,
    }),
  );
}

export async function resolveBrandMatchProposal(
  proposalId: string,
  input:
    | { action: "merge_into"; candidateId: string }
    | { action: "create_new" }
    | { action: "dismiss" },
): Promise<ActionResult<Tables<"brand_match_proposals">>> {
  const proposalIdValue = z.string().uuid().parse(proposalId);
  const resolution = z
    .discriminatedUnion("action", [
      z.object({
        action: z.literal("merge_into"),
        candidateId: z.string().uuid(),
      }),
      z.object({
        action: z.literal("create_new"),
      }),
      z.object({
        action: z.literal("dismiss"),
      }),
    ])
    .parse(input);

  return runBrandAction("Brand match resolved.", async (context) =>
    resolveBrandMatchProposalForUser(context, proposalIdValue, resolution),
  );
}

export async function addCompetitorHandle(
  creatorProfileId: string,
  handle: string,
): Promise<ActionResult<Tables<"competitor_handles">>> {
  return runBrandAction("Competitor handle saved.", async (context) =>
    addCompetitorHandleForUser(
      context,
      creatorProfileIdSchema.parse(creatorProfileId),
      competitorHandleSchema.parse(handle),
    ),
  );
}

export async function removeCompetitorHandle(
  competitorHandleId: string,
): Promise<ActionResult<void>> {
  return runBrandAction("Competitor handle removed.", async (context) =>
    removeCompetitorHandleForUser(
      context,
      competitorHandleIdSchema.parse(competitorHandleId),
    ),
  );
}

export async function enqueueInstagramCompetitorScrape(
  competitorHandleId: string,
): Promise<ActionResult<InstagramScrapeJobSummary>> {
  return runBrandAction("Instagram scrape queued.", async (context) =>
    enqueueInstagramCompetitorScrapeForUser(
      context,
      competitorHandleIdSchema.parse(competitorHandleId),
    ),
  );
}

export async function enqueueAllCompetitorScrapes(
  creatorProfileId: string,
): Promise<ActionResult<BulkInstagramScrapeEnqueueResult>> {
  return runBrandAction("Instagram scrapes queued.", async (context) =>
    enqueueAllCompetitorScrapesForUser(
      context,
      creatorProfileIdSchema.parse(creatorProfileId),
    ),
  );
}

async function runBrandAction<T>(
  message: string,
  callback: (context: BrandContext) => Promise<T>,
): Promise<ActionResult<T>> {
  try {
    const context = await getBrandContext();
    const data = await callback(context);
    revalidatePath("/brands");
    revalidatePath("/brands/proposals");
    revalidatePath("/dashboard");

    return {
      ok: true,
      data,
      message,
    };
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : "Mira could not update the brand pool.",
    };
  }
}

async function getBrandContext(): Promise<BrandContext> {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    throw new Error("Please sign in first.");
  }

  return {
    supabase,
    userId: user.id,
  };
}
