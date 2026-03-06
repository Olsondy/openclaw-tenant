import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { resolveProvisionScriptPath } from "./settingsService";

const tempDirs: string[] = [];

async function createTempRuntimeDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "openclaw-settings-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  for (const dir of tempDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

describe("resolveProvisionScriptPath", () => {
  test("docker prefers provision-docker.sh", async () => {
    const runtimeDir = await createTempRuntimeDir();
    const scriptPath = join(runtimeDir, "provision-docker.sh");
    await writeFile(scriptPath, "#!/usr/bin/env bash\n");

    const resolved = resolveProvisionScriptPath("docker", runtimeDir);
    expect(resolved).toBe(scriptPath);
  });

  test("docker falls back to legacy provision-instance.sh", async () => {
    const runtimeDir = await createTempRuntimeDir();
    const legacyPath = join(runtimeDir, "provision-instance.sh");
    await writeFile(legacyPath, "#!/usr/bin/env bash\n");

    const resolved = resolveProvisionScriptPath("docker", runtimeDir);
    expect(resolved).toBe(legacyPath);
  });

  test("podman prefers provision-podman.sh and falls back to setup-podman.sh", async () => {
    const runtimeDir = await createTempRuntimeDir();
    const fallback = join(runtimeDir, "setup-podman.sh");
    const preferred = join(runtimeDir, "provision-podman.sh");

    const resolvedFallback = resolveProvisionScriptPath("podman", runtimeDir);
    expect(resolvedFallback).toBe(fallback);

    await writeFile(preferred, "#!/usr/bin/env bash\n");
    const resolvedPreferred = resolveProvisionScriptPath("podman", runtimeDir);
    expect(resolvedPreferred).toBe(preferred);
  });
});
