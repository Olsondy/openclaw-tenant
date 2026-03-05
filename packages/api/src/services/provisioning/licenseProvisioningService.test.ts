import { afterEach, beforeEach, describe, expect, test } from "bun:test";
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
        compose_project, gateway_port, bridge_port, provision_status)
     VALUES ('PROV-KEY-001', 'tok123', 'ws://127.0.0.1:18789', 'unbound',
             'test', 'openclaw-test-1', 18789, 28789, 'pending')`,
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
  process.env.OPENCLAW_RUNTIME_DIR = "/tmp/runtime";
  process.env.OPENCLAW_DATA_DIR = "/tmp/data";
  process.env.OPENCLAW_PROVISION_SCRIPT = "/tmp/setup.sh";
  delete process.env.OPENCLAW_BASE_DOMAIN;
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
        stdout: new Response(out),
        stderr: new Response(""),
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
      stdout: new Response(""),
      stderr: new Response("docker error"),
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
});
