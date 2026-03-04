import { describe, test, expect } from "bun:test";
import {
  sanitizeOwnerTag,
  buildComposeProject,
  buildConfigDir,
  buildWorkspaceDir,
  buildNginxHost,
} from "./nameBuilder";

describe("sanitizeOwnerTag", () => {
  test("lowercases and strips illegal chars", () => {
    expect(sanitizeOwnerTag("Alice_Bob")).toBe("alice-bob");
  });

  test("strips email domain", () => {
    expect(sanitizeOwnerTag("user@example.com")).toBe("user");
  });

  test("collapses consecutive dashes", () => {
    expect(sanitizeOwnerTag("a--b---c")).toBe("a-b-c");
  });

  test("truncates to 24 chars", () => {
    expect(sanitizeOwnerTag("a".repeat(30))).toHaveLength(24);
  });

  test("throws INVALID_OWNER_TAG for empty result", () => {
    expect(() => sanitizeOwnerTag("---")).toThrow("INVALID_OWNER_TAG");
  });
});

describe("buildComposeProject", () => {
  test("returns expected project name", () => {
    expect(buildComposeProject("alice", 42)).toBe("openclaw-alice-42");
  });
});

describe("buildConfigDir / buildWorkspaceDir", () => {
  test("builds correct host paths", () => {
    expect(buildConfigDir("/data/openclaw", "openclaw-alice-1")).toBe(
      "/data/openclaw/openclaw-alice-1/.openclaw"
    );
    expect(buildWorkspaceDir("/data/openclaw", "openclaw-alice-1")).toBe(
      "/data/openclaw/openclaw-alice-1/workspace"
    );
  });
});

describe("buildNginxHost", () => {
  test("builds subdomain from ownerTag and licenseId", () => {
    expect(buildNginxHost("alice", 1, "example.com")).toBe("alice-1.example.com");
  });
});
