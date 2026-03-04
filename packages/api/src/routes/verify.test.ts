import { describe, test, expect, beforeEach } from "bun:test";
import { Hono } from "hono";
import { resetDb, getDb } from "../db/client";
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
  db.run(
    `INSERT INTO licenses (license_key, gateway_token, gateway_url, status, hwid, agent_id)
     VALUES ('AAAAA-BBBBB-CCCCC-DDDDD', 'tok', 'ws://gw:18789', ?, ?, ?)`,
    [status, hwid, hwid ? "abcdef1234567890" : null]
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
    const res = await post({ hwid: "hw1", licenseKey: "XXXXX-XXXXX-XXXXX-XXXXX", deviceName: "PC" });
    expect(res.status).toBe(403);
    const body = await res.json() as { error: string };
    expect(body.error).toBe("INVALID_LICENSE");
  });

  test("binds unbound license on first verify", async () => {
    seedLicense("unbound");
    const res = await post({ hwid: "my-hwid-001", licenseKey: "AAAAA-BBBBB-CCCCC-DDDDD", deviceName: "MyPC" });
    expect(res.status).toBe(200);
    const body = await res.json() as { success: boolean; data: { nodeConfig: { gatewayToken: string; agentId: string } } };
    expect(body.success).toBe(true);
    expect(body.data.nodeConfig.gatewayToken).toBe("tok");
    expect(body.data.nodeConfig.agentId).toMatch(/^[0-9a-f]{16}$/);
  });

  test("allows same HWID on subsequent verify", async () => {
    seedLicense("active", "my-hwid-001");
    const res = await post({ hwid: "my-hwid-001", licenseKey: "AAAAA-BBBBB-CCCCC-DDDDD", deviceName: "MyPC" });
    expect(res.status).toBe(200);
  });

  test("rejects different HWID on active license", async () => {
    seedLicense("active", "original-hwid");
    const res = await post({ hwid: "other-hwid", licenseKey: "AAAAA-BBBBB-CCCCC-DDDDD", deviceName: "PC" });
    expect(res.status).toBe(403);
    const body = await res.json() as { error: string };
    expect(body.error).toBe("HWID_MISMATCH");
  });

  test("rejects revoked license", async () => {
    seedLicense("revoked", "some-hwid");
    const res = await post({ hwid: "some-hwid", licenseKey: "AAAAA-BBBBB-CCCCC-DDDDD", deviceName: "PC" });
    expect(res.status).toBe(403);
    const body = await res.json() as { error: string };
    expect(body.error).toBe("LICENSE_REVOKED");
  });
});
