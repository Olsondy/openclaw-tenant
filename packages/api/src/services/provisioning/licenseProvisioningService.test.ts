import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmod, mkdtemp, readFile, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { getDb, resetDb } from "../../db/client";
import { encryptApiKey } from "../crypto";
import { enqueueLicenseProvisioning } from "./licenseProvisioningService";

const tempDirs: string[] = [];

afterEach(async () => {
  delete process.env.OPENCLAW_RUNTIME_CMD;
  delete process.env.NGINX_CMD;
  delete process.env.OPENCLAW_FAIL_RESTART;
  for (const dir of tempDirs.splice(0)) {
    try {
      await rm(dir, { recursive: true, force: true });
    } catch {
      // Best-effort cleanup for transient Windows file locks.
    }
  }
});

async function createProvisionFixture(scriptBody: string) {
  const runtimeDir = await mkdtemp(join(tmpdir(), "openclaw-runtime-"));
  const dataDir = await mkdtemp(join(tmpdir(), "openclaw-data-"));
  tempDirs.push(runtimeDir, dataDir);
  await writeFile(join(runtimeDir, "provision-docker.sh"), scriptBody, "utf8");
  return { runtimeDir, dataDir };
}

async function createMockRuntimeCommand(options: { failRestart?: boolean } = {}): Promise<string> {
  const { failRestart = false } = options;
  const binDir = await mkdtemp(join(tmpdir(), "openclaw-runtime-cmd-"));
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
if "%1"=="compose" (
  if "%6"=="openclaw-gateway" (
    echo abc123
    exit /b 0
  )
)
if "%1"=="inspect" (
  echo /openclaw-test-1-gateway
  exit /b 0
)
if "%1"=="exec" (
  exit /b 0
)
${restartBlock}
echo unsupported runtime args %* 1>&2
exit /b 1
`,
      "utf8",
    );
    return runtimeCmd;
  } else {
    const runtimeCmd = join(binDir, "runtime");
    await writeFile(
      runtimeCmd,
      `#!/usr/bin/env bash
set -euo pipefail
if [[ "\${1:-}" == "compose" ]]; then
  echo "abc123"
  exit 0
fi
if [[ "\${1:-}" == "inspect" ]]; then
  echo "/openclaw-test-1-gateway"
  exit 0
fi
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
}

async function createMockNginxCommand(): Promise<string> {
  const binDir = await mkdtemp(join(tmpdir(), "openclaw-nginx-cmd-"));
  tempDirs.push(binDir);

  if (process.platform === "win32") {
    const nginxCmd = join(binDir, "nginx.cmd");
    await writeFile(
      nginxCmd,
      `@echo off
if "%1"=="-t" exit /b 0
if "%1"=="-s" if "%2"=="reload" exit /b 0
echo unsupported nginx args %* 1>&2
exit /b 1
`,
      "utf8",
    );
    return nginxCmd;
  }

  const nginxCmd = join(binDir, "nginx");
  await writeFile(
    nginxCmd,
    `#!/usr/bin/env bash
set -euo pipefail
if [[ "\${1:-}" == "-t" ]]; then
  exit 0
fi
if [[ "\${1:-}" == "-s" && "\${2:-}" == "reload" ]]; then
  exit 0
fi
echo "unsupported nginx args: $*" >&2
exit 1
`,
    "utf8",
  );
  await chmod(nginxCmd, 0o755);
  return nginxCmd;
}

function seedLicense(db: ReturnType<typeof getDb>, runtimeDir: string, dataDir: string) {
  const apiKeyEnc = encryptApiKey("sk-provision", process.env.JWT_SECRET ?? "");
  db.run(
    `INSERT INTO licenses
       (license_key, gateway_token, gateway_url, status, owner_tag,
        compose_project, gateway_port, bridge_port, provision_status, webui_url,
        runtime_provider, runtime_dir, data_dir, nginx_host,
        provider_id, provider_label, base_url, api, model_id, model_name, api_key_enc)
     VALUES ('PROV-KEY-001', 'tok123', 'ws://127.0.0.1:18789', 'unbound',
             'test', 'openclaw-test-1', 18789, 28789, 'pending', 'http://127.0.0.1:18789',
             'docker', ?, ?, NULL, 'zai', 'Zhipu AI', 'https://open.bigmodel.cn/api/paas/v4',
             'openai-completions', 'glm-4.7-flash', 'GLM-4.7 Flash', ?)`,
    [runtimeDir, dataDir, apiKeyEnc],
  );
  return db
    .query<{ id: number }, string>("SELECT id FROM licenses WHERE license_key = ?")
    .get("PROV-KEY-001")!;
}

async function waitForProvisionTerminalState(
  db: ReturnType<typeof getDb>,
  id: number,
): Promise<
  | {
      provision_status: string;
      container_name?: string;
      provision_error?: string;
      gateway_url?: string;
      webui_url?: string | null;
    }
  | undefined
> {
  for (let i = 0; i < 60; i++) {
    const row = db
      .query<
        {
          provision_status: string;
          container_name: string | null;
          provision_error: string | null;
          gateway_url: string;
          webui_url: string | null;
        },
        number
      >(
        "SELECT provision_status, container_name, provision_error, gateway_url, webui_url FROM licenses WHERE id=?",
      )
      .get(id);
    if (row && (row.provision_status === "ready" || row.provision_status === "failed")) {
      return row;
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  return db
    .query<
      {
        provision_status: string;
        container_name: string | null;
        provision_error: string | null;
        gateway_url: string;
        webui_url: string | null;
      },
      number
    >(
      "SELECT provision_status, container_name, provision_error, gateway_url, webui_url FROM licenses WHERE id=?",
    )
    .get(id);
}

beforeEach(() => {
  resetDb();
  process.env.DB_PATH = ":memory:";
  process.env.ADMIN_USER = "admin";
  process.env.ADMIN_PASS = "x";
  process.env.JWT_SECRET = "test-secret-test-secret-test-secret-32";
  delete process.env.OPENCLAW_RUNTIME_CMD;
  delete process.env.OPENCLAW_BASE_DOMAIN;
  delete process.env.NGINX_CMD;
  delete process.env.NGINX_SITE_DIR;
  delete process.env.NGINX_RELOAD_CMD;
  delete process.env.OPENCLAW_FAIL_RESTART;
});

describe("enqueueLicenseProvisioning", () => {
  test("sets provision_status to ready on success", async () => {
    const db = getDb();
    const { runtimeDir, dataDir } = await createProvisionFixture("#!/usr/bin/env bash\nexit 0\n");
    process.env.OPENCLAW_RUNTIME_CMD = await createMockRuntimeCommand();
    const { id } = seedLicense(db, runtimeDir, dataDir);

    enqueueLicenseProvisioning(id);
    const row = await waitForProvisionTerminalState(db, id);
    expect(row?.provision_status).toBe("ready");
    expect(row?.container_name).toBe("openclaw-test-1-gateway");

    const configDir = join(dataDir, "openclaw-test-1", ".openclaw");
    const openclawJson = JSON.parse(
      await readFile(join(configDir, "openclaw.json"), "utf8"),
    ) as any;
    const authProfiles = JSON.parse(
      await readFile(join(configDir, "agents", "main", "agent", "auth-profiles.json"), "utf8"),
    ) as any;
    const modelsJson = JSON.parse(
      await readFile(join(configDir, "agents", "main", "agent", "models.json"), "utf8"),
    ) as any;

    expect(openclawJson.agents.defaults.model.primary).toBe("zai/glm-4.7-flash");
    expect(authProfiles["zai:default"]?.apiKey).toBe("sk-provision");
    expect(modelsJson.providers.zai.apiKey).toBe("sk-provision");
  });

  test("sets provision_status to failed when script fails", async () => {
    const db = getDb();
    const { runtimeDir, dataDir } = await createProvisionFixture(
      "#!/usr/bin/env bash\necho 'docker error' >&2\nexit 1\n",
    );
    const { id } = seedLicense(db, runtimeDir, dataDir);

    enqueueLicenseProvisioning(id);
    const row = await waitForProvisionTerminalState(db, id);
    expect(row?.provision_status).toBe("failed");
    expect(row?.provision_error).toContain("Provision script exited 1");
  });

  test("uses license nginx_host for nginx config and final URLs", async () => {
    const db = getDb();
    const { runtimeDir, dataDir } = await createProvisionFixture("#!/usr/bin/env bash\nexit 0\n");
    process.env.OPENCLAW_RUNTIME_CMD = await createMockRuntimeCommand();
    const { id } = seedLicense(db, runtimeDir, dataDir);
    db.run("UPDATE licenses SET nginx_host=? WHERE id=?", ["demo-1.example.com", id]);

    const siteDir = join(tmpdir(), `nginx-site-${Date.now()}`);
    tempDirs.push(siteDir);
    const nginxCmd = await createMockNginxCommand();
    process.env.NGINX_CMD = nginxCmd;
    process.env.NGINX_SITE_DIR = siteDir;
    process.env.NGINX_RELOAD_CMD = `${nginxCmd} -s reload`;

    enqueueLicenseProvisioning(id);
    const row = await waitForProvisionTerminalState(db, id);
    expect(row?.provision_status).toBe("ready");
    expect(row?.gateway_url).toBe("wss://demo-1.example.com");
    expect(row?.webui_url).toBe("https://demo-1.example.com");

    const nginxConf = await Bun.file(join(siteDir, "openclaw-test-1.conf")).text();
    expect(nginxConf).toContain("server_name demo-1.example.com;");
    expect(nginxConf).toContain("proxy_pass http://127.0.0.1:18789;");
  });

  test("sets provision_status to failed when restart fails", async () => {
    const db = getDb();
    const { runtimeDir, dataDir } = await createProvisionFixture("#!/usr/bin/env bash\nexit 0\n");
    process.env.OPENCLAW_RUNTIME_CMD = await createMockRuntimeCommand({ failRestart: true });
    const { id } = seedLicense(db, runtimeDir, dataDir);

    enqueueLicenseProvisioning(id);
    const row = await waitForProvisionTerminalState(db, id);
    expect(row?.provision_status).toBe("failed");
    expect(row?.provision_error).toContain("CONTAINER_RESTART_FAILED");
  });
});
