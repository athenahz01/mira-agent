import { NextRequest, NextResponse } from "next/server";

import { encryptRefreshToken } from "@/lib/gmail/encryption";
import {
  createGoogleOAuthClient,
  hashState,
  verifySignedState,
} from "@/lib/gmail/oauth";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const redirectBase = getBaseUrl();
  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state");
  const oauthError = request.nextUrl.searchParams.get("error");

  if (oauthError) {
    return NextResponse.redirect(
      new URL(`/settings?gmail=${encodeURIComponent(oauthError)}`, redirectBase),
    );
  }

  if (!code || !state || !verifySignedState(state)) {
    return NextResponse.redirect(new URL("/settings?gmail=invalid_state", redirectBase));
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.redirect(new URL("/login", redirectBase));
  }

  const stateHash = hashState(state);
  const { data: storedState, error: stateError } = await supabase
    .from("oauth_states")
    .select("*")
    .eq("user_id", user.id)
    .eq("state_hash", stateHash)
    .is("consumed_at", null)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();

  if (stateError || !storedState) {
    return NextResponse.redirect(new URL("/settings?gmail=state_expired", redirectBase));
  }

  const oauth = createGoogleOAuthClient();
  const { tokens } = await oauth.getToken(code);

  if (!tokens.access_token || !tokens.refresh_token) {
    return NextResponse.redirect(new URL("/settings?gmail=no_refresh_token", redirectBase));
  }

  const googleEmail = await fetchGoogleEmail(tokens.access_token);

  if (!googleEmail) {
    return NextResponse.redirect(new URL("/settings?gmail=email_missing", redirectBase));
  }

  const scopes = tokens.scope?.split(" ").filter(Boolean) ?? [];
  const { error: credentialError } = await supabase
    .from("gmail_credentials")
    .upsert(
      {
        user_id: user.id,
        google_email: googleEmail,
        refresh_token_encrypted: encryptRefreshToken(tokens.refresh_token),
        scopes,
        revoked_at: null,
        last_refreshed_at: new Date().toISOString(),
      },
      {
        onConflict: "user_id,google_email",
      },
    );

  if (credentialError) {
    return NextResponse.redirect(new URL("/settings?gmail=credential_error", redirectBase));
  }

  await supabase
    .from("oauth_states")
    .update({
      consumed_at: new Date().toISOString(),
    })
    .eq("id", storedState.id);

  return NextResponse.redirect(new URL("/settings?gmail=connected", redirectBase));
}

async function fetchGoogleEmail(accessToken: string) {
  const response = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    return null;
  }

  const data = (await response.json()) as { email?: string };

  return data.email ?? null;
}

function getBaseUrl() {
  return process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
}
