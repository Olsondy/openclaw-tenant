import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "fs/promises";
import { Hono } from "hono";
import { tmpdir } from "os";
import { join } from "path";
import { getDb, resetDb } from "../db/client";
import bootstrapConfigRoutes from "./bootstrap-config";

const app = new Hono();
app.route("/licenses", bootstrapConfigRoutes);

const tempDirs: string[] = [];

async function createMockRuntimeCommand(options: { failRestart?: boolean } = {}): Promise<string> {
  const { failRestart = false } = options;
  const binDir = await mkdtemp(join(tmpdir(), "openclaw-bootstrap-runtime-"));
  tempDirs.push(binDir);

  if (process.platform === "win32") {
    const runtimeCmd = join(binDir, "runtime.cmd");
    const restartBlock = failRestart
      ? `if "%1"=="restart" (
  echo restart failed 1>&2
  exit /b 2
)`
      : `if "%1"=="restart" exit /b 0`;
    await writeFile(
      runtimeCmd,
      `@echo off
if "%1"=="exec" exit /b 0
${restartBlock}
echo unsupported runtime args %* 1>&2
exit /b 1
`,
      "utf8",
    );
    return runtimeCmd;
  }

  const runtimeCmd = join(binDir, "runtime");
  await writeFile(
    runtimeCmd,
    `#!/usr/bin/env bash
set -euo pipefail
if [[ "\${1:-}" == "exec" ]]; then
  exit 0
fi
if [[ "\${1:-}" == "restart" ]]; then
  if [[ "${failRestart ? "1" : "0"}" == "1" ]]; then
    echo "restart failed" >&2
    exit 2
  fi
  exit 0
fi
echo "unsupported runtime args: $*" >&2
exit 1
`,
    "utf8",
  );
  await chmod(runtimeCmd, 0o755);
  return runtimeCmd;
}

async function seedLicenseFixture() {
  const dataDir = await mkdtemp(join(tmpdir(), "openclaw-bootstrap-data-"));
  tempDirs.push(dataDir);
  const composeProject = "openclaw-bootstrap-1";
  const configDir = join(dataDir, composeProject, ".openclaw");
  const agentDir = join(configDir, "agents", "main", "agent");
  await mkdir(agentDir, { recursive: true });

  await writeFile(
    join(agentDir, "models.json"),
    JSON.stringify(
      {
        mode: "merge",
        providers: {
          zai: {
            baseUrl: "https://old.zai/v1",
            api: "openai-completions",
            apiKey: "old-key",
            models: [
              { id: "glm-4.7-flash", name: "old name" },
              { id: "glm-4.6v", name: "keep me" },
            ],
          },
          openai: {
            baseUrl: "https://api.openai.com/v1",
            api: "openai-completions",
            apiKey: "openai-key",
            models: [{ id: "gpt-4o-mini", name: "gpt-4o-mini" }],
          },
        },
      },
      null,
      2,
    ),
  );

  await writeFile(
    join(configDir, "openclaw.json"),
    JSON.stringify(
      {
        models: {
          mode: "merge",
          providers: {
            zai: {
              baseUrl: "https://old.zai/v1",
              api: "openai-completions",
              apiKey: "old-key",
              models: [{ id: "glm-4.7-flash", name: "old name" }],
            },
          },
        },
        agents: {
          defaults: {
            model: {
              primary: "zai/glm-4.7-flash",
            },
          },
        },
      },
      null,
      2,
    ),
  );

  const db = getDb();
  db.run(
    `INSERT INTO licenses
       (license_key, hwid, status, compose_project, data_dir, runtime_provider, container_name,
        gateway_token, gateway_url, provider_id, provider_label, base_url, api, model_id, model_name, api_key_enc)
     VALUES
       ('BOOT-KEY-001', 'hwid-001', 'active', ?, ?, 'docker', 'gateway-1',
        'tok', 'ws://127.0.0.1:18789', 'zai', 'ZAI', 'https://old.zai/v1', 'openai-completions', 'glm-4.7-flash', 'GLM old', 'enc')`,
    [composeProject, dataDir],
  );
  const row = db
    .query<{ id: number }, string>("SELECT id FROM licenses WHERE license_key=?")
    .get("BOOT-KEY-001");

  return { id: row!.id, configDir, agentDir };
}

beforeEach(() => {
  resetDb();
  process.env.DB_PATH = ":memory:";
  process.env.ADMIN_USER = "admin";
  process.env.ADMIN_PASS = "x";
  process.env.JWT_SECRET = "test-secret-test-secret-test-secret-32";
  delete process.env.OPENCLAW_FAIL_RESTART;
});

afterEach(async () => {
  delete process.env.OPENCLAW_RUNTIME_CMD;
  delete process.env.OPENCLAW_FAIL_RESTART;
  for (const dir of tempDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

describe("POST /licenses/:id/bootstrap-config modelAuth", () => {
  test("replaces same model.id and appends different ids without polluting other providers", async () => {
    process.env.OPENCLAW_RUNTIME_CMD = await createMockRuntimeCommand();
    const { id, configDir, agentDir } = await seedLicenseFixture();

    const res = await app.request(`/licenses/${id}/bootstrap-config`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        licenseKey: "BOOT-KEY-001",
        hwid: "hwid-001",
        modelAuth: {
          providerId: "zai",
          providerLabel: "Zhipu AI",
          baseUrl: "https://new.zai/v1",
          api: "openai-completions",
          modelId: "glm-4.7-flash",
          modelName: "GLM 4.7 Flash New",
          apiKey: "sk-new",
        },
      }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { applied: string[] } };
    expect(body.data.applied).toContain("modelAuth");

    const modelsDoc = JSON.parse(await readFile(join(agentDir, "models.json"), "utf8")) as {
      providers: Record<string, { baseUrl: string; models: Array<{ id: string; name: string }> }>;
    };
    expect(modelsDoc.providers.zai.baseUrl).toBe("https://new.zai/v1");
    const zaiModels = modelsDoc.providers.zai.models;
    const replaced = zaiModels.find((m) => m.id === "glm-4.7-flash");
    expect(replaced?.name).toBe("GLM 4.7 Flash New");
    expect(zaiModels.some((m) => m.id === "glm-4.6v")).toBe(true);
    expect(modelsDoc.providers.openai.models.some((m) => m.id === "gpt-4o-mini")).toBe(true);

    const openclawDoc = JSON.parse(await readFile(join(configDir, "openclaw.json"), "utf8")) as {
      agents: { defaults: { model: { primary: string } } };
      models: { providers: Record<string, { apiKey: string }> };
    };
    expect(openclawDoc.agents.defaults.model.primary).toBe("zai/glm-4.7-flash");
    expect(openclawDoc.models.providers.zai.apiKey).toBe("sk-new");
  });

  test("returns error when restart fails", async () => {
    process.env.OPENCLAW_RUNTIME_CMD = await createMockRuntimeCommand({ failRestart: true });
    const { id } = await seedLicenseFixture();

    const res = await app.request(`/licenses/${id}/bootstrap-config`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        licenseKey: "BOOT-KEY-001",
        hwid: "hwid-001",
        modelAuth: {
          providerId: "zai",
          providerLabel: "Zhipu AI",
          baseUrl: "https://new.zai/v1",
          api: "openai-completions",
          modelId: "glm-4.7-flash",
          modelName: "GLM 4.7 Flash New",
          apiKey: "sk-new",
        },
      }),
    });

    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("CONTAINER_RESTART_FAILED");
  });
});
