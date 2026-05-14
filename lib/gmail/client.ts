import { gmail } from "@googleapis/gmail";
import { createClient } from "@supabase/supabase-js";

import type { Database, Tables } from "../db/types";
import { decryptRefreshToken, encryptRefreshToken } from "./encryption.ts";
import { createGoogleOAuthClient } from "./oauth.ts";

export type GmailCredential = Tables<"gmail_credentials">;

export function createServiceSupabaseClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error("Missing Supabase service environment variables.");
  }

  return createClient<Database>(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

export async function getActiveCredential(userId: string) {
  const supabase = createServiceSupabaseClient();
  const { data, error } = await supabase
    .from("gmail_credentials")
    .select("*")
    .eq("user_id", userId)
    .is("revoked_at", null)
    .order("created_at", {
      ascending: false,
    })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return data;
}

export async function getAccessToken(userId: string) {
  const supabase = createServiceSupabaseClient();
  const credential = await getActiveCredential(userId);

  if (!credential) {
    throw new Error("No active Gmail credential.");
  }

  const oauth = createGoogleOAuthClient();
  oauth.setCredentials({
    refresh_token: decryptRefreshToken(credential.refresh_token_encrypted),
  });

  const refreshed = await oauth.refreshAccessToken();
  const { credentials } = refreshed;

  if (credentials.refresh_token) {
    const { error } = await supabase
      .from("gmail_credentials")
      .update({
        refresh_token_encrypted: encryptRefreshToken(credentials.refresh_token),
        last_refreshed_at: new Date().toISOString(),
      })
      .eq("id", credential.id);

    if (error) {
      throw new Error(error.message);
    }
  } else {
    const { error } = await supabase
      .from("gmail_credentials")
      .update({
        last_refreshed_at: new Date().toISOString(),
      })
      .eq("id", credential.id);

    if (error) {
      throw new Error(error.message);
    }
  }

  if (!credentials.access_token) {
    throw new Error("Google did not return an access token.");
  }

  return credentials.access_token;
}

export async function createGmailClient(userId: string) {
  const accessToken = await getAccessToken(userId);
  const oauth = createGoogleOAuthClient();
  oauth.setCredentials({
    access_token: accessToken,
  });

  return gmail({
    version: "v1",
    auth: oauth,
  });
}
