import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const algorithm = "aes-256-gcm";
const ivLength = 12;

type StoredToken = {
  iv: string;
  authTag: string;
  ciphertext: string;
};

export function encryptRefreshToken(token: string) {
  const key = getEncryptionKey();
  const iv = randomBytes(ivLength);
  const cipher = createCipheriv(algorithm, key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(token, "utf8"),
    cipher.final(),
  ]);
  const payload: StoredToken = {
    iv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
    ciphertext: ciphertext.toString("base64"),
  };

  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64");
}

export function decryptRefreshToken(stored: string) {
  const key = getEncryptionKey();
  const payload = JSON.parse(
    Buffer.from(stored, "base64").toString("utf8"),
  ) as StoredToken;
  const decipher = createDecipheriv(
    algorithm,
    key,
    Buffer.from(payload.iv, "base64"),
  );

  decipher.setAuthTag(Buffer.from(payload.authTag, "base64"));

  return Buffer.concat([
    decipher.update(Buffer.from(payload.ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

function getEncryptionKey() {
  const rawKey = process.env.GMAIL_TOKEN_ENCRYPTION_KEY;

  if (!rawKey) {
    throw new Error("Missing GMAIL_TOKEN_ENCRYPTION_KEY.");
  }

  const key = Buffer.from(rawKey, "hex");

  if (key.length !== 32) {
    throw new Error("GMAIL_TOKEN_ENCRYPTION_KEY must be a 32-byte hex string.");
  }

  return key;
}
