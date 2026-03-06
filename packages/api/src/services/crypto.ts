import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";

function deriveKey(secret: string): Buffer {
  if (secret.length < 32) {
    throw new Error("JWT_SECRET must be at least 32 characters for AES-256-GCM encryption");
  }
  return createHash("sha256").update(secret).digest();
}

export function encryptApiKey(plaintext: string, secret: string): string {
  const key = deriveKey(secret);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted.toString("hex")}`;
}

export function decryptApiKey(encoded: string, secret: string): string {
  const key = deriveKey(secret);
  const parts = encoded.split(":");
  if (parts.length !== 3) throw new Error("Invalid encrypted format");
  const [ivHex, authTagHex, ciphertextHex] = parts;
  const iv = Buffer.from(ivHex, "hex");
  const authTag = Buffer.from(authTagHex, "hex");
  const ciphertext = Buffer.from(ciphertextHex, "hex");
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}
