import { describe, test, expect, afterEach } from "bun:test";
import { runProvisionScript, getContainerId, getContainerName } from "./scriptRunner";

const originalSpawn = Bun.spawn;

afterEach(() => {
  (Bun as any).spawn = originalSpawn;
});

function makeSpawnStub(exitCode: number, stdout = "", stderr = "") {
  return () =>
    ({
      exited: Promise.resolve(exitCode),
      stdout: new Response(stdout),
      stderr: new Response(stderr),
    } as any);
}

describe("runProvisionScript", () => {
  test("resolves when script exits 0", async () => {
    (Bun as any).spawn = makeSpawnStub(0);
    await expect(
      runProvisionScript({
        runtimeDir: "/tmp",
        configDir: "/tmp/cfg",
        workspaceDir: "/tmp/ws",
        composeProject: "openclaw-test-1",
        gatewayPort: 18789,
        bridgePort: 28789,
        gatewayToken: "tok",
        provisionScript: "/tmp/setup.sh",
      })
    ).resolves.toBeUndefined();
  });

  test("throws when script exits non-zero", async () => {
    (Bun as any).spawn = makeSpawnStub(1, "", "docker error");
    await expect(
      runProvisionScript({
        runtimeDir: "/tmp",
        configDir: "/tmp/cfg",
        workspaceDir: "/tmp/ws",
        composeProject: "openclaw-test-1",
        gatewayPort: 18789,
        bridgePort: 28789,
        gatewayToken: "tok",
        provisionScript: "/tmp/setup.sh",
      })
    ).rejects.toThrow("Provision script exited 1");
  });
});

describe("getContainerId", () => {
  test("returns trimmed container ID", async () => {
    (Bun as any).spawn = makeSpawnStub(0, "abc123\n");
    expect(await getContainerId("openclaw-test-1")).toBe("abc123");
  });

  test("throws when container not found", async () => {
    (Bun as any).spawn = makeSpawnStub(0, "");
    await expect(getContainerId("openclaw-test-1")).rejects.toThrow(
      "Container not found"
    );
  });
});

describe("getContainerName", () => {
  test("strips leading slash from container name", async () => {
    (Bun as any).spawn = makeSpawnStub(0, "/openclaw-alice-1-gateway\n");
    expect(await getContainerName("abc123")).toBe("openclaw-alice-1-gateway");
  });
});
