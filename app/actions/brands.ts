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
  toggleBrandExcludedForUser,
  updateBrandForUser,
  type BrandContext,
  type BrandListResult,
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

const brandIdSchema = z.string().uuid();
const contactIdSchema = z.string().uuid();
const toggleExcludedSchema = z.object({
  id: z.string().uuid(),
  excluded: z.boolean(),
  reason: z.string().trim().nullable().optional(),
});

export async function addBrandManual(
  input: BrandFormInput,
): Promise<
  ActionResult<{
    brand: Tables<"brands">;
    created: boolean;
    promoted: boolean;
  }>
> {
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

async function runBrandAction<T>(
  message: string,
  callback: (context: BrandContext) => Promise<T>,
): Promise<ActionResult<T>> {
  try {
    const context = await getBrandContext();
    const data = await callback(context);
    revalidatePath("/brands");
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
