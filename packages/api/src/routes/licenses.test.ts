import { beforeEach, describe, expect, test } from "bun:test";
import { writeFileSync } from "fs";
import { Hono } from "hono";
import { sign } from "hono/jwt";
import { tmpdir } from "os";
import { join } from "path";
import { resetDb } from "../db/client";
import { jwtMiddleware } from "../middleware/jwt";
import licensesRoutes from "./licenses";

const tmpConfig = join(tmpdir(), "test-openclaw-lic.json");
writeFileSync(tmpConfig, JSON.stringify({ token: "tok123", gatewayUrl: "ws://test:18789" }));

const app = new Hono();
app.use("/licenses/*", jwtMiddleware);
app.route("/licenses", licensesRoutes);

async function authHeader() {
  const token = await sign(
    { sub: "1", exp: Math.floor(Date.now() / 1000) + 3600 },
    "test-secret",
    "HS256",
  );
  return { Authorization: `Bearer ${token}` };
}

beforeEach(() => {
  resetDb();
  process.env.DB_PATH = ":memory:";
  process.env.ADMIN_USER = "admin";
  process.env.ADMIN_PASS = "x";
  process.env.JWT_SECRET = "test-secret";
  process.env.OPENCLAW_CONFIG_PATH = tmpConfig;
});

describe("GET /licenses", () => {
  test("returns 401 without token", async () => {
    const res = await app.request("/licenses");
    expect(res.status).toBe(401);
  });

  test("returns empty array initially", async () => {
    const res = await app.request("/licenses", { headers: await authHeader() });
    const body = (await res.json()) as { data: unknown[] };
    expect(res.status).toBe(200);
    expect(body.data).toEqual([]);
  });
});

describe("POST /licenses", () => {
  test("returns 401 without token", async () => {
    const res = await app.request("/licenses", { method: "POST" });
    expect(res.status).toBe(401);
  });

  test("generates a license and returns it", async () => {
    const res = await app.request("/licenses", {
      method: "POST",
      headers: await authHeader(),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { data: { license_key: string; status: string } };
    expect(body.data.license_key).toMatch(/^[A-Z0-9]{5}-[A-Z0-9]{5}-[A-Z0-9]{5}-[A-Z0-9]{5}$/);
    expect(body.data.status).toBe("unbound");
  });
});

describe("PATCH /licenses/:id", () => {
  test("revokes a license", async () => {
    const genRes = await app.request("/licenses", {
      method: "POST",
      headers: await authHeader(),
    });
    const { data: license } = (await genRes.json()) as { data: { id: number } };

    const res = await app.request(`/licenses/${license.id}`, {
      method: "PATCH",
      headers: { ...(await authHeader()), "Content-Type": "application/json" },
      body: JSON.stringify({ status: "revoked" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { status: string } };
    expect(body.data.status).toBe("revoked");
  });

  test("returns 404 for nonexistent license", async () => {
    const res = await app.request("/licenses/9999", {
      method: "PATCH",
      headers: { ...(await authHeader()), "Content-Type": "application/json" },
      body: JSON.stringify({ status: "revoked" }),
    });
    expect(res.status).toBe(404);
  });
});

describe("POST /licenses – provision fields", () => {
  beforeEach(() => {
    process.env.OPENCLAW_HOST_IP = "10.0.0.1";
    process.env.OPENCLAW_GATEWAY_PORT_START = "18789";
    process.env.OPENCLAW_GATEWAY_PORT_END = "18999";
    process.env.OPENCLAW_BRIDGE_PORT_START = "28789";
    process.env.OPENCLAW_BRIDGE_PORT_END = "28999";
    delete process.env.OPENCLAW_BASE_DOMAIN;
  });

  test("returns provision_status=pending on creation", async () => {
    const res = await app.request("/licenses", {
      method: "POST",
      headers: await authHeader(),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as any;
    expect(body.data.provision_status).toBe("pending");
  });

  test("assigns gateway_port and compose_project", async () => {
    const res = await app.request("/licenses", {
      method: "POST",
      headers: await authHeader(),
    });
    const body = (await res.json()) as any;
    expect(body.data.gateway_port).toBe(18789);
    expect(body.data.compose_project).toMatch(/^openclaw-/);
  });

  test("gateway_url uses OPENCLAW_HOST_IP in no-domain mode", async () => {
    const res = await app.request("/licenses", {
      method: "POST",
      headers: await authHeader(),
    });
    const body = (await res.json()) as any;
    expect(body.data.gateway_url).toContain("ws://10.0.0.1:");
  });

  test("returns 400 INVALID_OWNER_TAG for invalid ownerTag", async () => {
    const res = await app.request("/licenses", {
      method: "POST",
      headers: { ...(await authHeader()), "Content-Type": "application/json" },
      body: JSON.stringify({ ownerTag: "---" }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as any;
    expect(body.error).toBe("INVALID_OWNER_TAG");
  });

  test("returns 503 NO_AVAILABLE_PORT when pool exhausted", async () => {
    process.env.OPENCLAW_GATEWAY_PORT_START = "18789";
    process.env.OPENCLAW_GATEWAY_PORT_END = "18789";
    process.env.OPENCLAW_BRIDGE_PORT_START = "28789";
    process.env.OPENCLAW_BRIDGE_PORT_END = "28789";

    await app.request("/licenses", {
      method: "POST",
      headers: await authHeader(),
    });

    const res = await app.request("/licenses", {
      method: "POST",
      headers: await authHeader(),
    });
    expect(res.status).toBe(503);
    const body = (await res.json()) as any;
    expect(body.error).toBe("NO_AVAILABLE_PORT");
  });
});
