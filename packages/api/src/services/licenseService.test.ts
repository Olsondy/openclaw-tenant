import { describe, test, expect } from "bun:test";
import { generateLicenseKey, generateAgentId, isExpired } from "./licenseService";

describe("generateLicenseKey", () => {
  test("matches XXXXX-XXXXX-XXXXX-XXXXX format", () => {
    const key = generateLicenseKey();
    expect(key).toMatch(/^[A-Z0-9]{5}-[A-Z0-9]{5}-[A-Z0-9]{5}-[A-Z0-9]{5}$/);
  });

  test("generates unique keys", () => {
    const keys = new Set(Array.from({ length: 200 }, generateLicenseKey));
    expect(keys.size).toBe(200);
  });
});

describe("generateAgentId", () => {
  test("returns 16-char hex string", () => {
    const id = generateAgentId("hwid-abc");
    expect(id).toMatch(/^[0-9a-f]{16}$/);
  });

  test("is deterministic for same HWID", () => {
    expect(generateAgentId("same")).toBe(generateAgentId("same"));
  });

  test("different HWIDs produce different IDs", () => {
    expect(generateAgentId("hwid-1")).not.toBe(generateAgentId("hwid-2"));
  });
});

describe("isExpired", () => {
  test("null means permanent — not expired", () => {
    expect(isExpired(null)).toBe(false);
  });

  test("past date is expired", () => {
    expect(isExpired("2020-01-01")).toBe(true);
  });

  test("future date is not expired", () => {
    expect(isExpired("2099-12-31")).toBe(false);
  });
});
