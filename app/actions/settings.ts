"use server";

import { revalidatePath } from "next/cache";

import { upsertUserBasics as upsertUserBasicsForUser } from "@/lib/onboarding/service";
import { outreachRulesSchema } from "@/lib/settings/schemas";
import type { OutreachRulesInput } from "@/lib/settings/schemas";
import { createClient } from "@/lib/supabase/server";
import type { Database, Tables } from "@/lib/db/types";
import type { SupabaseClient } from "@supabase/supabase-js";
import { decryptRefreshToken } from "@/lib/gmail/encryption";
import { createGoogleOAuthClient } from "@/lib/gmail/oauth";

export type ActionResult<T> =
  | {
      ok: true;
      data: T;
      message: string;
    }
  | {
      ok: false;
      error: string;
    };

type SettingsContext = {
  supabase: SupabaseClient<Database>;
  userId: string;
  email: string;
};

export async function upsertUserBasics(
  input: unknown,
): Promise<ActionResult<Tables<"users">>> {
  return runSettingsAction("Account settings saved.", async (context) =>
    upsertUserBasicsForUser(context, input),
  );
}

export async function upsertOutreachRules(
  input: OutreachRulesInput,
): Promise<ActionResult<Tables<"outreach_rules">>> {
  return runSettingsAction("Outreach rules saved.", async (context) => {
    const values = outreachRulesSchema.parse(input);
    const payload = {
      ...values,
      user_id: context.userId,
    };

    if (values.id) {
      const { data, error } = await context.supabase
        .from("outreach_rules")
        .update(payload)
        .eq("id", values.id)
        .eq("user_id", context.userId)
        .select("*")
        .single();

      if (error || !data) {
        throw new Error(error?.message ?? "Could not save outreach rules.");
      }

      return data;
    }

    const { data, error } = await context.supabase
      .from("outreach_rules")
      .insert(payload)
      .select("*")
      .single();

    if (error || !data) {
      throw new Error(error?.message ?? "Could not save outreach rules.");
    }

    return data;
  });
}

export async function disconnectGmail(): Promise<ActionResult<null>> {
  return runSettingsAction("Gmail disconnected.", async (context) => {
    const { data: credential, error } = await context.supabase
      .from("gmail_credentials")
      .select("*")
      .eq("user_id", context.userId)
      .is("revoked_at", null)
      .order("created_at", {
        ascending: false,
      })
      .limit(1)
      .maybeSingle();

    if (error) {
      throw new Error(error.message);
    }

    if (!credential) {
      return null;
    }

    try {
      const oauth = createGoogleOAuthClient();
      await oauth.revokeToken(
        decryptRefreshToken(credential.refresh_token_encrypted),
      );
    } catch {
      // Keep local revocation even if Google already revoked the token.
    }

    const { error: updateError } = await context.supabase
      .from("gmail_credentials")
      .update({
        revoked_at: new Date().toISOString(),
      })
      .eq("id", credential.id)
      .eq("user_id", context.userId);

    if (updateError) {
      throw new Error(updateError.message);
    }

    return null;
  });
}

async function runSettingsAction<T>(
  message: string,
  callback: (context: SettingsContext) => Promise<T>,
): Promise<ActionResult<T>> {
  try {
    const context = await getSettingsContext();
    const data = await callback(context);
    revalidatePath("/settings");
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
          : "Mira could not save those settings.",
    };
  }
}

async function getSettingsContext(): Promise<SettingsContext> {
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
    email: user.email ?? "zhengathenahuo@gmail.com",
  };
}
