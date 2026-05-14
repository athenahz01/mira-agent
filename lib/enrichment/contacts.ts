import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import type { Database, Json, Tables, TablesInsert } from "../db/types";
import {
  createHunterClient,
  HunterApiError,
  type HunterClient,
  type HunterDomainEmail,
} from "./hunter.ts";

export type EnrichmentContext = {
  supabase: SupabaseClient<Database>;
  userId: string;
  hunterClient?: HunterClient;
};

export type ContactDiscoveryResult = {
  brand_id: string;
  status: "success" | "skipped" | "error";
  contacts_added: number;
  contacts_updated: number;
  skipped_reason?: "no_domain" | "no_hunter_results" | "rate_limited";
  error_message?: string;
};

const contactRoleSchema = z.enum([
  "pr",
  "marketing",
  "partnerships",
  "founder",
  "generic_info",
  "unknown",
]);

export const manualBrandContactSchema = z.object({
  email: z.string().trim().email(),
  name: z
    .string()
    .trim()
    .transform((value) => (value.length > 0 ? value : null))
    .nullable()
    .optional(),
  role: contactRoleSchema.default("unknown"),
});

export type ManualBrandContactInput = z.input<typeof manualBrandContactSchema>;

type RoleMappingInput = {
  email: string;
  type?: string | null;
  department?: string | null;
  position?: string | null;
};

export async function discoverContactsForBrand(
  context: EnrichmentContext,
  brandId: string,
): Promise<ContactDiscoveryResult> {
  const { data: brand, error: brandError } = await context.supabase
    .from("brands")
    .select("*")
    .eq("id", brandId)
    .eq("user_id", context.userId)
    .single();

  if (brandError || !brand) {
    return {
      brand_id: brandId,
      status: "error",
      contacts_added: 0,
      contacts_updated: 0,
      error_message: brandError?.message ?? "Brand not found.",
    };
  }

  if (!brand.domain) {
    await insertEnrichmentSignal(context, brand.id, "enrichment_skipped", {
      reason: "no_domain",
    });

    return {
      brand_id: brand.id,
      status: "skipped",
      contacts_added: 0,
      contacts_updated: 0,
      skipped_reason: "no_domain",
    };
  }

  try {
    const client = context.hunterClient ?? createHunterClient();
    const response = await client.domainSearch({
      domain: brand.domain,
      limit: 10,
    });
    const emails = response.data.emails;

    if (emails.length === 0) {
      await insertEnrichmentSignal(context, brand.id, "hunter_enrichment", {
        contacts_found: 0,
        hunter_meta: {
          domain: response.data.domain ?? brand.domain,
          organization: response.data.organization ?? null,
          pattern: response.data.pattern ?? null,
        },
      });

      return {
        brand_id: brand.id,
        status: "skipped",
        contacts_added: 0,
        contacts_updated: 0,
        skipped_reason: "no_hunter_results",
      };
    }

    const rows = emails.map((email) =>
      hunterEmailToContactRow(context.userId, brand.id, email),
    );
    const { data: existingContacts, error: existingError } =
      await context.supabase
        .from("brand_contacts")
        .select("email")
        .eq("user_id", context.userId)
        .eq("brand_id", brand.id)
        .in(
          "email",
          rows.map((row) => row.email),
        );

    if (existingError) {
      throw new Error(existingError.message);
    }

    const existingEmails = new Set(
      (existingContacts ?? []).map((row) => row.email),
    );
    const { error: upsertError } = await context.supabase
      .from("brand_contacts")
      .upsert(rows, {
        onConflict: "brand_id,email",
      });

    if (upsertError) {
      throw new Error(upsertError.message);
    }

    await insertEnrichmentSignal(context, brand.id, "hunter_enrichment", {
      contacts_found: rows.length,
      hunter_meta: {
        domain: response.data.domain ?? brand.domain,
        organization: response.data.organization ?? null,
        pattern: response.data.pattern ?? null,
      },
    });

    return {
      brand_id: brand.id,
      status: "success",
      contacts_added: rows.filter((row) => !existingEmails.has(row.email))
        .length,
      contacts_updated: rows.filter((row) => existingEmails.has(row.email))
        .length,
    };
  } catch (error) {
    const isRateLimit =
      error instanceof HunterApiError && error.status === 429;

    return {
      brand_id: brand.id,
      status: isRateLimit ? "skipped" : "error",
      contacts_added: 0,
      contacts_updated: 0,
      skipped_reason: isRateLimit ? "rate_limited" : undefined,
      error_message: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

export async function addManualBrandContact(
  context: EnrichmentContext,
  brandId: string,
  input: ManualBrandContactInput,
): Promise<Tables<"brand_contacts">> {
  const values = manualBrandContactSchema.parse(input);
  const { data, error } = await context.supabase
    .from("brand_contacts")
    .upsert(
      {
        user_id: context.userId,
        brand_id: brandId,
        email: values.email.toLowerCase(),
        name: values.name ?? null,
        role: values.role,
        source: "manual",
        confidence: null,
        verified_at: null,
      },
      {
        onConflict: "brand_id,email",
      },
    )
    .select("*")
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? "Could not save contact.");
  }

  return data;
}

export async function markBrandContactUnreachable(
  context: EnrichmentContext,
  contactId: string,
  unreachable: boolean,
): Promise<Tables<"brand_contacts">> {
  const { data, error } = await context.supabase
    .from("brand_contacts")
    .update({
      marked_unreachable: unreachable,
    })
    .eq("id", contactId)
    .eq("user_id", context.userId)
    .select("*")
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? "Could not update contact.");
  }

  return data;
}

export function mapHunterContactRole(input: RoleMappingInput) {
  const emailLocalPart = input.email.split("@")[0]?.toLowerCase() ?? "";
  const department = input.department?.toLowerCase() ?? "";
  const position = input.position?.toLowerCase() ?? "";
  const type = input.type?.toLowerCase() ?? "";

  if (position.includes("founder") || /\b(ceo|cmo)\b/.test(position)) {
    return "founder";
  }

  if (
    department === "communication" ||
    position.includes("pr") ||
    position.includes("comms") ||
    position.includes("communications")
  ) {
    return "pr";
  }

  if (position.includes("partnership")) {
    return "partnerships";
  }

  if (department === "marketing" || position.includes("marketing")) {
    return "marketing";
  }

  if (
    department === "press" ||
    department === "social media" ||
    position.includes("press") ||
    position.includes("social media")
  ) {
    return department === "social media" ? "marketing" : "pr";
  }

  if (
    type === "generic" ||
    ["info", "hello", "contact", "press"].includes(emailLocalPart)
  ) {
    return "generic_info";
  }

  return "unknown";
}

function hunterEmailToContactRow(
  userId: string,
  brandId: string,
  email: HunterDomainEmail,
): TablesInsert<"brand_contacts"> {
  const name = [email.first_name, email.last_name].filter(Boolean).join(" ");

  return {
    user_id: userId,
    brand_id: brandId,
    email: email.value.toLowerCase(),
    name: name || null,
    role: mapHunterContactRole({
      email: email.value,
      type: email.type,
      department: email.department,
      position: email.position,
    }),
    source: "hunter",
    confidence: Math.round(email.confidence ?? 0),
    verified_at: null,
  };
}

async function insertEnrichmentSignal(
  context: EnrichmentContext,
  brandId: string,
  signalType: string,
  evidence: unknown,
) {
  const { error } = await context.supabase.from("source_signals").insert({
    user_id: context.userId,
    brand_id: brandId,
    signal_type: signalType,
    evidence_json: evidence as Json,
    weight: 1,
  });

  if (error) {
    throw new Error(error.message);
  }
}
