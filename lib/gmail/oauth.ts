import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import { OAuth2Client } from "google-auth-library";

export const gmailScopes = [
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.modify",
  "openid",
  "email",
  "profile",
] as const;

export function createGoogleOAuthClient() {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_OAUTH_REDIRECT_URI;

  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error("Missing Google OAuth environment variables.");
  }

  return new OAuth2Client(clientId, clientSecret, redirectUri);
}

export function createSignedState() {
  const nonce = randomBytes(24).toString("base64url");
  const signature = signNonce(nonce);

  return `${nonce}.${signature}`;
}

export function verifySignedState(state: string) {
  const [nonce, signature] = state.split(".");

  if (!nonce || !signature) {
    return false;
  }

  const expected = signNonce(nonce);
  const expectedBuffer = Buffer.from(expected);
  const receivedBuffer = Buffer.from(signature);

  return (
    expectedBuffer.length === receivedBuffer.length &&
    timingSafeEqual(expectedBuffer, receivedBuffer)
  );
}

export function hashState(state: string) {
  return createHash("sha256").update(state).digest("hex");
}

function signNonce(nonce: string) {
  const secret =
    process.env.GOOGLE_OAUTH_CLIENT_SECRET ??
    process.env.GMAIL_TOKEN_ENCRYPTION_KEY;

  if (!secret) {
    throw new Error("Missing OAuth state signing secret.");
  }

  return createHmac("sha256", secret).update(nonce).digest("base64url");
}
