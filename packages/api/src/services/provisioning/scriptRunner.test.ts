import { afterEach, describe, expect, test } from "bun:test";
import { getContainerId, getContainerName, runProvisionScript } from "./scriptRunner";

const originalSpawn = Bun.spawn;

afterEach(() => {
  (Bun as any).spawn = originalSpawn;
});

function makeSpawnStub(
  exitCode: number,
  stdout = "",
  stderr = "",
  onCall?: (args: string[]) => void,
) {
  return (args: string[]) => {
    onCall?.(args);
    return {
      exited: Promise.resolve(exitCode),
      stdout,
      stderr,
    } as any;
  };
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
      }),
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
      }),
    ).rejects.toThrow("Provision script exited 1");
  });
});

describe("getContainerId", () => {
  test("returns trimmed container ID", async () => {
    (Bun as any).spawn = makeSpawnStub(0, "abc123\n");
    expect(await getContainerId("openclaw-test-1", "docker")).toBe("abc123");
  });

  test("throws when container not found", async () => {
    (Bun as any).spawn = makeSpawnStub(0, "");
    await expect(getContainerId("openclaw-test-1", "docker")).rejects.toThrow(
      "Container not found",
    );
  });

  test("uses podman compose when runtime_provider=podman", async () => {
    let calledArgs: string[] = [];
    (Bun as any).spawn = makeSpawnStub(0, "abc123\n", "", (args) => {
      calledArgs = args;
    });

    expect(await getContainerId("openclaw-test-1", "podman")).toBe("abc123");
    expect(calledArgs).toEqual([
      "podman",
      "compose",
      "-p",
      "openclaw-test-1",
      "ps",
      "-q",
      "openclaw-gateway",
    ]);
  });
});

describe("getContainerName", () => {
  test("strips leading slash from container name", async () => {
    (Bun as any).spawn = makeSpawnStub(0, "/openclaw-alice-1-gateway\n");
    expect(await getContainerName("abc123", "docker")).toBe("openclaw-alice-1-gateway");
  });

  test("uses podman inspect when runtime_provider=podman", async () => {
    let calledArgs: string[] = [];
    (Bun as any).spawn = makeSpawnStub(0, "/openclaw-alice-1-gateway\n", "", (args) => {
      calledArgs = args;
    });

    expect(await getContainerName("abc123", "podman")).toBe("openclaw-alice-1-gateway");
    expect(calledArgs).toEqual(["podman", "inspect", "--format", "{{.Name}}", "abc123"]);
  });
});
