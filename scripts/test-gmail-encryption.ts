import { randomBytes } from "node:crypto";

import {
  decryptRefreshToken,
  encryptRefreshToken,
} from "../lib/gmail/encryption.ts";

process.env.GMAIL_TOKEN_ENCRYPTION_KEY ??= randomBytes(32).toString("hex");

const token = "refresh-token-for-mira-test";
const encryptedA = encryptRefreshToken(token);
const encryptedB = encryptRefreshToken(token);

if (encryptedA === encryptedB) {
  throw new Error("Expected different ciphertexts for different IVs.");
}

if (decryptRefreshToken(encryptedA) !== token) {
  throw new Error("Encrypted token did not roundtrip.");
}

const tampered = `${encryptedA.slice(0, -4)}AAAA`;

try {
  decryptRefreshToken(tampered);
  throw new Error("Tampered ciphertext should not decrypt.");
} catch (error) {
  if (
    error instanceof Error &&
    error.message === "Tampered ciphertext should not decrypt."
  ) {
    throw error;
  }
}

console.log("Gmail encryption test passed.");
