import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import type { PublicProviderConnection, StoredProviderConnection } from "@/lib/providers/types";

const VERSION = "v1";

function decodeKey(encodedKey: string): Buffer {
  const key = Buffer.from(encodedKey, "base64");
  if (key.byteLength !== 32) throw new Error("PROVIDER_SECRET_KEY must be a base64-encoded 32-byte key.");
  return key;
}

export function encryptSecret(secret: string, encodedKey: string): string {
  if (!secret) throw new Error("Provider secret is required.");
  const key = decodeKey(encodedKey);
  const initializationVector = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, initializationVector);
  const encrypted = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  return [
    VERSION,
    initializationVector.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    encrypted.toString("base64url"),
  ].join(".");
}

export function decryptSecret(ciphertext: string, encodedKey: string): string {
  const key = decodeKey(encodedKey);
  const parts = ciphertext.split(".");
  if (parts.length !== 4 || parts[0] !== VERSION) throw new Error("Invalid provider ciphertext envelope.");

  try {
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(parts[1], "base64url"));
    decipher.setAuthTag(Buffer.from(parts[2], "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(parts[3], "base64url")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    throw new Error("Invalid provider ciphertext envelope.");
  }
}

export function maskSecret(secret: string): string {
  if (secret.length < 9) return "••••••••";
  return `${secret.slice(0, 4)}…${secret.slice(-4)}`;
}

export function redactProviderConnection(connection: StoredProviderConnection): PublicProviderConnection {
  return {
    provider: connection.provider,
    status: connection.status,
    credentialConfigured: Boolean(connection.encryptedSecret || connection.externalSecretRef),
    accountLabel: connection.accountLabel,
    lastErrorCode: connection.lastErrorCode,
  };
}
