import { describe, test, expect, beforeEach } from "bun:test";
import { Hono } from "hono";
import { sign } from "hono/jwt";
import { resetDb } from "../db/client";
import { jwtMiddleware } from "../middleware/jwt";
import licensesRoutes from "./licenses";
import { join } from "path";
import { tmpdir } from "os";
import { writeFileSync } from "fs";

const tmpConfig = join(tmpdir(), "test-openclaw-lic.json");
writeFileSync(tmpConfig, JSON.stringify({ token: "tok123", gatewayUrl: "ws://test:18789" }));

const app = new Hono();
app.use("/licenses/*", jwtMiddleware);
app.route("/licenses", licensesRoutes);

async function authHeader() {
  const token = await sign(
    { sub: "1", exp: Math.floor(Date.now() / 1000) + 3600 },
    "test-secret",
    "HS256"
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
    const body = await res.json() as { data: unknown[] };
    expect(res.status).toBe(200);
    expect(body.data).toEqual([]);
  });
});

describe("POST /licenses", () => {
  test("generates a license and returns it", async () => {
    const res = await app.request("/licenses", {
      method: "POST",
      headers: await authHeader(),
    });
    expect(res.status).toBe(201);
    const body = await res.json() as { data: { license_key: string; status: string } };
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
    const { data: license } = await genRes.json() as { data: { id: number } };

    const res = await app.request(`/licenses/${license.id}`, {
      method: "PATCH",
      headers: { ...(await authHeader()), "Content-Type": "application/json" },
      body: JSON.stringify({ status: "revoked" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { status: string } };
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
