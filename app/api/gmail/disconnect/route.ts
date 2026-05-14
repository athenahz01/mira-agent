import { NextResponse } from "next/server";

import { decryptRefreshToken } from "@/lib/gmail/encryption";
import { createGoogleOAuthClient } from "@/lib/gmail/oauth";
import { createClient } from "@/lib/supabase/server";

export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Please sign in first." }, { status: 401 });
  }

  const { data: credential, error } = await supabase
    .from("gmail_credentials")
    .select("*")
    .eq("user_id", user.id)
    .is("revoked_at", null)
    .order("created_at", {
      ascending: false,
    })
    .limit(1)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!credential) {
    return NextResponse.json({ ok: true });
  }

  try {
    const oauth = createGoogleOAuthClient();
    await oauth.revokeToken(
      decryptRefreshToken(credential.refresh_token_encrypted),
    );
  } catch {
    // Keep local revocation even if Google already revoked the token.
  }

  const { error: updateError } = await supabase
    .from("gmail_credentials")
    .update({
      revoked_at: new Date().toISOString(),
    })
    .eq("id", credential.id)
    .eq("user_id", user.id);

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
