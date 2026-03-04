import { describe, test, expect, afterEach } from "bun:test";
import { buildNginxConfig, writeNginxConfig } from "./nginxService";
import { tmpdir } from "os";
import { join } from "path";
import { readFileSync } from "fs";

const originalSpawn = Bun.spawn;
afterEach(() => { (Bun as any).spawn = originalSpawn; });

function makeSpawnStub(exitCode: number) {
  return () => ({
    exited: Promise.resolve(exitCode),
    stdout: new Response(""),
    stderr: new Response(""),
  } as any);
}

describe("buildNginxConfig", () => {
  test("contains server_name and proxy_pass", () => {
    const cfg = buildNginxConfig("alice-1.example.com", 18789);
    expect(cfg).toContain("server_name alice-1.example.com");
    expect(cfg).toContain("proxy_pass http://127.0.0.1:18789");
    expect(cfg).toContain("proxy_set_header Upgrade");
  });
});

describe("writeNginxConfig", () => {
  test("writes config file and calls nginx reload", async () => {
    (Bun as any).spawn = makeSpawnStub(0);
    const siteDir = join(tmpdir(), "nginx-test-" + Date.now());
    await writeNginxConfig(siteDir, "openclaw-alice-1", "alice-1.test.com", 18789, "nginx -s reload");
    const content = readFileSync(join(siteDir, "openclaw-alice-1.conf"), "utf8");
    expect(content).toContain("server_name alice-1.test.com");
  });

  test("throws when nginx -t fails", async () => {
    (Bun as any).spawn = makeSpawnStub(1);
    const siteDir = join(tmpdir(), "nginx-test-fail-" + Date.now());
    await expect(
      writeNginxConfig(siteDir, "p", "h", 18789, "nginx -s reload")
    ).rejects.toThrow("nginx -t failed");
  });
});
