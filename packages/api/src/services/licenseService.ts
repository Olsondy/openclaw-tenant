import { createHash, randomBytes } from "crypto";

const CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

function randomSegment(): string {
  return Array.from({ length: 5 }, () => {
    const byte = randomBytes(1)[0];
    return CHARS[byte % CHARS.length];
  }).join("");
}

export function generateLicenseKey(): string {
  return [randomSegment(), randomSegment(), randomSegment(), randomSegment()].join("-");
}

export function generateAgentId(hwid: string): string {
  return createHash("sha256").update(hwid).digest("hex").slice(0, 16);
}

export function isExpired(expiryDate: string | null): boolean {
  if (!expiryDate) return false;
  return new Date(expiryDate) < new Date();
}
