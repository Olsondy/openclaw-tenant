import { beforeEach, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { getDb, resetDb } from "../db/client";
import verifyRoutes from "./verify";

const app = new Hono();
app.route("/verify", verifyRoutes);

function post(body: object) {
  return app.request("/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function seedLicense(status = "unbound", hwid: string | null = null) {
  const db = getDb();
  const tokenExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  db.run(
    `INSERT INTO licenses
       (license_key, gateway_token, gateway_url, status, hwid, agent_id, provision_status, token_expires_at)
     VALUES ('AAAAA-BBBBB-CCCCC-DDDDD', 'tok', 'ws://gw:18789', ?, ?, ?, 'ready', ?)`,
    [status, hwid, hwid ? "abcdef1234567890" : null, tokenExpiresAt],
  );
}

beforeEach(() => {
  resetDb();
  process.env.DB_PATH = ":memory:";
  process.env.ADMIN_USER = "admin";
  process.env.ADMIN_PASS = "x";
  delete process.env.DOCKER_APPROVE_CMD;
});

describe("POST /verify", () => {
  test("returns 400 when fields missing", async () => {
    const res = await post({ hwid: "abc" });
    expect(res.status).toBe(400);
  });

  test("returns 403 for unknown licenseKey", async () => {
    const res = await post({
      hwid: "hw1",
      licenseKey: "XXXXX-XXXXX-XXXXX-XXXXX",
      deviceName: "PC",
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("INVALID_LICENSE");
  });

  test("binds unbound license on first verify", async () => {
    seedLicense("unbound");
    const res = await post({
      hwid: "my-hwid-001",
      licenseKey: "AAAAA-BBBBB-CCCCC-DDDDD",
      deviceName: "MyPC",
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      success: boolean;
      data: { nodeConfig: { gatewayToken: string; agentId: string } };
    };
    expect(body.success).toBe(true);
    expect(body.data.nodeConfig.gatewayToken).toBe("tok");
    expect(body.data.nodeConfig.agentId).toMatch(/^[0-9a-f]{16}$/);
  });

  test("allows same HWID on subsequent verify", async () => {
    seedLicense("active", "my-hwid-001");
    const res = await post({
      hwid: "my-hwid-001",
      licenseKey: "AAAAA-BBBBB-CCCCC-DDDDD",
      deviceName: "MyPC",
    });
    expect(res.status).toBe(200);
  });

  test("rejects different HWID on active license", async () => {
    seedLicense("active", "original-hwid");
    const res = await post({
      hwid: "other-hwid",
      licenseKey: "AAAAA-BBBBB-CCCCC-DDDDD",
      deviceName: "PC",
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("HWID_MISMATCH");
  });

  test("rejects revoked license", async () => {
    seedLicense("revoked", "some-hwid");
    const res = await post({
      hwid: "some-hwid",
      licenseKey: "AAAAA-BBBBB-CCCCC-DDDDD",
      deviceName: "PC",
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("LICENSE_REVOKED");
  });

  test("rejects expired license", async () => {
    const db = getDb();
    db.run(
      `INSERT INTO licenses
         (license_key, gateway_token, gateway_url, status, expiry_date, provision_status)
       VALUES ('AAAAA-BBBBB-CCCCC-DDDDD', 'tok', 'ws://gw:18789', 'active', '2020-01-01', 'ready')`,
    );
    const res = await post({
      hwid: "hw1",
      licenseKey: "AAAAA-BBBBB-CCCCC-DDDDD",
      deviceName: "PC",
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("LICENSE_EXPIRED");
  });
});

function seedLicenseWithProvision(
  provisionStatus: string | null,
  status = "unbound",
  hwid: string | null = null,
) {
  const db = getDb();
  db.run(
    `INSERT INTO licenses
       (license_key, gateway_token, gateway_url, status, hwid, provision_status)
     VALUES ('PROV-AAAAA-BBBBB-CCCCC', 'tok', 'ws://gw:18789', ?, ?, ?)`,
    [status, hwid, provisionStatus],
  );
}

describe("POST /verify – provisioning gate", () => {
  test("returns 409 PROVISIONING_PENDING when status is pending", async () => {
    seedLicenseWithProvision("pending");
    const res = await post({
      hwid: "hw1",
      licenseKey: "PROV-AAAAA-BBBBB-CCCCC",
      deviceName: "PC",
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("PROVISIONING_PENDING");
  });

  test("returns 409 PROVISIONING_PENDING when status is running", async () => {
    seedLicenseWithProvision("running");
    const res = await post({
      hwid: "hw1",
      licenseKey: "PROV-AAAAA-BBBBB-CCCCC",
      deviceName: "PC",
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("PROVISIONING_PENDING");
  });

  test("returns 409 PROVISIONING_FAILED when status is failed", async () => {
    seedLicenseWithProvision("failed");
    const res = await post({
      hwid: "hw1",
      licenseKey: "PROV-AAAAA-BBBBB-CCCCC",
      deviceName: "PC",
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("PROVISIONING_FAILED");
  });

  test("allows verify when provision_status is ready", async () => {
    seedLicenseWithProvision("ready", "unbound");
    const res = await post({
      hwid: "hw-new",
      licenseKey: "PROV-AAAAA-BBBBB-CCCCC",
      deviceName: "PC",
    });
    expect(res.status).toBe(200);
  });

  test("allows verify when provision_status is null (legacy license)", async () => {
    const db = getDb();
    db.run(
      `INSERT INTO licenses
         (license_key, gateway_token, gateway_url, status, provision_status)
       VALUES ('NULL-STATUS-LICENSE', 'tok', 'ws://gw:18789', 'unbound', NULL)`,
    );
    const res = await post({
      hwid: "hw-legacy",
      licenseKey: "NULL-STATUS-LICENSE",
      deviceName: "PC",
    });
    expect(res.status).toBe(200);
  });
});
