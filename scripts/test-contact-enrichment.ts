import { randomUUID } from "node:crypto";

import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

import {
  discoverContactsForBrand,
  type EnrichmentContext,
} from "../lib/enrichment/contacts.ts";
import type { HunterClient } from "../lib/enrichment/hunter.ts";
import type { Database } from "../lib/db/types";

const envSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
});

const envResult = envSchema.safeParse(process.env);

if (!envResult.success) {
  const missing = envResult.error.issues
    .map((issue) => issue.path.join("."))
    .join(", ");
  console.error(`Missing required env vars: ${missing}`);
  process.exit(1);
}

const env = envResult.data;
const service = createClient<Database>(
  env.NEXT_PUBLIC_SUPABASE_URL,
  env.SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  },
);
let createdUserId: string | null = null;

const fakeHunter: HunterClient = {
  async domainSearch() {
    return {
      data: {
        domain: "example.com",
        organization: "Example",
        pattern: "{first}",
        emails: [
          {
            value: "pr@example.com",
            type: "personal",
            confidence: 95,
            first_name: "Priya",
            last_name: "Comms",
            position: "Head of PR",
            department: "communication",
          },
          {
            value: "hello@example.com",
            type: "generic",
            confidence: 30,
            first_name: null,
            last_name: null,
            position: null,
            department: null,
          },
        ],
      },
    };
  },
  async emailVerifier({ email }) {
    return {
      data: {
        email,
        result: "deliverable",
        score: 95,
      },
    };
  },
};

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(message);
  }
}

async function createUser() {
  const email = `mira-contact-${randomUUID()}@example.com`;
  const { data, error } = await service.auth.admin.createUser({
    email,
    password: `Mira-${randomUUID()}-password`,
    email_confirm: true,
  });

  if (error || !data.user) {
    throw new Error(error?.message ?? "Could not create user.");
  }

  createdUserId = data.user.id;
  const { error: appUserError } = await service.from("users").insert({
    user_id: data.user.id,
    email,
    name: "Contact Test",
  });

  if (appUserError) {
    throw new Error(appUserError.message);
  }

  return data.user.id;
}

async function insertBrand(userId: string, name: string, domain: string | null) {
  const { data, error } = await service
    .from("brands")
    .insert({
      user_id: userId,
      name,
      domain,
      identity_key: domain ? `domain:${domain}` : `name:${name.toLowerCase()}`,
    })
    .select("*")
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? "Could not insert brand.");
  }

  return data;
}

async function cleanup() {
  if (!createdUserId) {
    return;
  }

  const { error } = await service.auth.admin.deleteUser(createdUserId);

  if (error) {
    console.warn(`Cleanup failed: ${error.message}`);
  }
}

async function main() {
  const userId = await createUser();
  const context: EnrichmentContext = {
    supabase: service,
    userId,
    hunterClient: fakeHunter,
  };
  const noDomain = await insertBrand(userId, "No Domain", null);
  const withDomain = await insertBrand(userId, "With Domain", "example.com");

  const skipped = await discoverContactsForBrand(context, noDomain.id);
  assert(skipped.status === "skipped", "No-domain brand should be skipped.");
  assert(
    skipped.skipped_reason === "no_domain",
    "No-domain skip reason should be no_domain.",
  );

  const first = await discoverContactsForBrand(context, withDomain.id);
  assert(first.status === "success", "Domain brand should enrich.");
  assert(first.contacts_added === 2, "Both high and low confidence contacts should add.");
  assert(first.contacts_updated === 0, "First run should not update contacts.");

  const second = await discoverContactsForBrand(context, withDomain.id);
  assert(second.contacts_added === 0, "Second run should not duplicate.");
  assert(second.contacts_updated === 2, "Second run should update contacts.");

  const [{ data: contacts, error: contactsError }, signalsResult] =
    await Promise.all([
      service
        .from("brand_contacts")
        .select("*")
        .eq("user_id", userId)
        .eq("brand_id", withDomain.id),
      service
        .from("source_signals")
        .select("*")
        .eq("user_id", userId)
        .eq("brand_id", withDomain.id)
        .eq("signal_type", "hunter_enrichment"),
    ]);

  if (contactsError) {
    throw new Error(contactsError.message);
  }

  if (signalsResult.error) {
    throw new Error(signalsResult.error.message);
  }

  assert(contacts?.length === 2, "Expected two contacts after rerun.");
  assert(
    contacts.some((contact) => contact.confidence === 30),
    "Low-confidence contact should remain visible.",
  );
  assert(
    signalsResult.data?.length === 2,
    "Expected a hunter_enrichment source signal for each run.",
  );

  console.log("Contact enrichment test passed.");
}

main()
  .catch((error: unknown) => {
    const message =
      error instanceof Error
        ? error.message
        : "Unknown contact enrichment error";
    console.error(message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await cleanup();
  });
