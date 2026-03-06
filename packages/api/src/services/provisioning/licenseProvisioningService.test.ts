import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { rm } from "fs/promises";
import { tmpdir } from "os";
import { getDb, resetDb } from "../../db/client";
import { enqueueLicenseProvisioning } from "./licenseProvisioningService";

const originalSpawn = Bun.spawn;

afterEach(() => {
  (Bun as any).spawn = originalSpawn;
});

function seedLicense(db: ReturnType<typeof getDb>) {
  db.run(
    `INSERT INTO licenses
       (license_key, gateway_token, gateway_url, status, owner_tag,
        compose_project, gateway_port, bridge_port, provision_status, webui_url,
        runtime_provider, runtime_dir, data_dir, nginx_host)
     VALUES ('PROV-KEY-001', 'tok123', 'ws://127.0.0.1:18789', 'unbound',
             'test', 'openclaw-test-1', 18789, 28789, 'pending', 'http://127.0.0.1:18789',
             'docker', '/tmp/runtime', '/tmp/data', NULL)`,
  );
  return db
    .query<{ id: number }, string>("SELECT id FROM licenses WHERE license_key = ?")
    .get("PROV-KEY-001")!;
}

beforeEach(() => {
  resetDb();
  process.env.DB_PATH = ":memory:";
  process.env.ADMIN_USER = "admin";
  process.env.ADMIN_PASS = "x";
  delete process.env.OPENCLAW_BASE_DOMAIN;
  delete process.env.NGINX_SITE_DIR;
  delete process.env.NGINX_RELOAD_CMD;
});

describe("enqueueLicenseProvisioning", () => {
  test("sets provision_status to ready on success", async () => {
    const db = getDb();
    const { id } = seedLicense(db);

    let callIdx = 0;
    (Bun as any).spawn = () => {
      const outputs = ["", "abc123\n", "/openclaw-test-1-gateway\n"];
      const out = outputs[callIdx] ?? "";
      callIdx++;
      return {
        exited: Promise.resolve(0),
        stdout: out,
        stderr: "",
      };
    };

    enqueueLicenseProvisioning(id);
    await new Promise((r) => setTimeout(r, 100));

    const row = db
      .query<{ provision_status: string; container_name: string }, number>(
        "SELECT provision_status, container_name FROM licenses WHERE id=?",
      )
      .get(id);
    expect(row?.provision_status).toBe("ready");
    expect(row?.container_name).toBe("openclaw-test-1-gateway");
  });

  test("sets provision_status to failed when script fails", async () => {
    const db = getDb();
    const { id } = seedLicense(db);

    (Bun as any).spawn = () => ({
      exited: Promise.resolve(1),
      stdout: "",
      stderr: "docker error",
    });

    enqueueLicenseProvisioning(id);
    await new Promise((r) => setTimeout(r, 100));

    const row = db
      .query<{ provision_status: string; provision_error: string }, number>(
        "SELECT provision_status, provision_error FROM licenses WHERE id=?",
      )
      .get(id);
    expect(row?.provision_status).toBe("failed");
    expect(row?.provision_error).toContain("Provision script exited 1");
  });

  test("uses license nginx_host for nginx config and final URLs", async () => {
    const db = getDb();
    const { id } = seedLicense(db);
    db.run("UPDATE licenses SET nginx_host=? WHERE id=?", ["demo-1.example.com", id]);

    const siteDir = `${tmpdir()}/nginx-site-${Date.now()}`;
    process.env.NGINX_SITE_DIR = siteDir;
    process.env.NGINX_RELOAD_CMD = "nginx -s reload";

    let callIdx = 0;
    (Bun as any).spawn = () => {
      // 1: provision script, 2: docker compose ps, 3: docker inspect, 4: nginx -t, 5: nginx reload
      const outputs = ["", "abc123\n", "/openclaw-test-1-gateway\n", "", ""];
      const out = outputs[callIdx] ?? "";
      callIdx++;
      return {
        exited: Promise.resolve(0),
        stdout: out,
        stderr: "",
      };
    };

    enqueueLicenseProvisioning(id);
    await new Promise((r) => setTimeout(r, 120));

    const row = db
      .query<{ gateway_url: string; webui_url: string | null }, number>(
        "SELECT gateway_url, webui_url FROM licenses WHERE id=?",
      )
      .get(id);
    expect(row?.gateway_url).toBe("wss://demo-1.example.com");
    expect(row?.webui_url).toBe("https://demo-1.example.com");

    const nginxConf = await Bun.file(`${siteDir}/openclaw-test-1.conf`).text();
    expect(nginxConf).toContain("server_name demo-1.example.com;");
    expect(nginxConf).toContain("proxy_pass http://127.0.0.1:18789;");

    await rm(siteDir, { recursive: true, force: true });
  });
});
