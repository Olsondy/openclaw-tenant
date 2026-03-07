import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { getContainerId, getContainerName, runProvisionScript } from "./scriptRunner";

const originalSpawn = Bun.spawn;
const tempDirs: string[] = [];

afterEach(async () => {
  (Bun as any).spawn = originalSpawn;
  for (const dir of tempDirs.splice(0)) {
    try {
      await rm(dir, { recursive: true, force: true });
    } catch {
      // Best-effort cleanup for transient Windows file locks.
    }
  }
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

async function createRunnerFixture(scriptBody: string) {
  const runtimeDir = await mkdtemp(join(tmpdir(), "openclaw-script-runner-"));
  tempDirs.push(runtimeDir);
  const configDir = join(runtimeDir, "cfg");
  const workspaceDir = join(runtimeDir, "ws");
  const scriptPath = join(runtimeDir, "setup.sh");
  await mkdir(configDir, { recursive: true });
  await mkdir(workspaceDir, { recursive: true });
  await writeFile(scriptPath, scriptBody, "utf8");
  return { runtimeDir, configDir, workspaceDir, scriptPath };
}

describe("runProvisionScript", () => {
  test("resolves when script exits 0", async () => {
    const fixture = await createRunnerFixture("#!/usr/bin/env bash\nexit 0\n");
    await expect(
      runProvisionScript({
        runtimeDir: fixture.runtimeDir,
        configDir: fixture.configDir,
        workspaceDir: fixture.workspaceDir,
        composeProject: "openclaw-test-1",
        gatewayPort: 18789,
        bridgePort: 28789,
        gatewayToken: "tok",
        provisionScript: fixture.scriptPath,
      }),
    ).resolves.toBeUndefined();
  });

  test("throws when script exits non-zero", async () => {
    const fixture = await createRunnerFixture(
      "#!/usr/bin/env bash\necho 'docker error' >&2\nexit 1\n",
    );
    await expect(
      runProvisionScript({
        runtimeDir: fixture.runtimeDir,
        configDir: fixture.configDir,
        workspaceDir: fixture.workspaceDir,
        composeProject: "openclaw-test-1",
        gatewayPort: 18789,
        bridgePort: 28789,
        gatewayToken: "tok",
        provisionScript: fixture.scriptPath,
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
