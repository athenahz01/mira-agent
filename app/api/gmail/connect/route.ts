import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import {
  createGoogleOAuthClient,
  createSignedState,
  gmailScopes,
  hashState,
} from "@/lib/gmail/oauth";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.redirect(new URL("/login", getBaseUrl()));
  }

  const state = createSignedState();
  const { error } = await supabase.from("oauth_states").insert({
    user_id: user.id,
    state_hash: hashState(state),
    expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    redirect_to: "/settings",
  });

  if (error) {
    return NextResponse.redirect(new URL("/settings?gmail=state_error", getBaseUrl()));
  }

  const oauth = createGoogleOAuthClient();
  const url = oauth.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: [...gmailScopes],
    state,
  });

  return NextResponse.redirect(url);
}

function getBaseUrl() {
  return process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
}
