import { afterEach, describe, expect, test } from "bun:test";
import { unlinkSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { readOpenclawConfig } from "./openclawConfig";

const tmpFile = join(tmpdir(), "test-openclaw.json");

afterEach(() => {
  try {
    unlinkSync(tmpFile);
  } catch {}
  delete process.env.OPENCLAW_CONFIG_PATH;
});

describe("readOpenclawConfig", () => {
  test("throws if OPENCLAW_CONFIG_PATH not set", async () => {
    delete process.env.OPENCLAW_CONFIG_PATH;
    await expect(readOpenclawConfig()).rejects.toThrow("OPENCLAW_CONFIG_PATH");
  });

  test("throws if file does not exist", async () => {
    process.env.OPENCLAW_CONFIG_PATH = "/nonexistent/openclaw.json";
    await expect(readOpenclawConfig()).rejects.toThrow("not found");
  });

  test("throws if token or gatewayUrl missing", async () => {
    writeFileSync(tmpFile, JSON.stringify({ token: "abc" }));
    process.env.OPENCLAW_CONFIG_PATH = tmpFile;
    await expect(readOpenclawConfig()).rejects.toThrow("token");
  });

  test("returns token and gatewayUrl from valid file", async () => {
    writeFileSync(tmpFile, JSON.stringify({ token: "my-token", gatewayUrl: "ws://x:18789" }));
    process.env.OPENCLAW_CONFIG_PATH = tmpFile;
    const config = await readOpenclawConfig();
    expect(config.token).toBe("my-token");
    expect(config.gatewayUrl).toBe("ws://x:18789");
  });
});
