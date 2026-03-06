import { beforeEach, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { sign } from "hono/jwt";
import { resetDb } from "../db/client";
import { jwtMiddleware } from "../middleware/jwt";
import settingsRoutes from "./settings";

const app = new Hono();
app.use("/settings/*", jwtMiddleware);
app.route("/settings", settingsRoutes);

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
  process.env.OPENCLAW_RUNTIME_DIR = "/opt/openclaw-runtime";
  process.env.OPENCLAW_DATA_DIR = "/data/openclaw";
  process.env.OPENCLAW_HOST_IP = "10.0.0.9";
  process.env.OPENCLAW_BASE_DOMAIN = "default.example.com";
  process.env.OPENCLAW_GATEWAY_PORT_START = "19100";
  process.env.OPENCLAW_GATEWAY_PORT_END = "19199";
  process.env.OPENCLAW_BRIDGE_PORT_START = "29100";
  process.env.OPENCLAW_BRIDGE_PORT_END = "29199";
});

describe("GET /settings", () => {
  test("returns 401 without token", async () => {
    const res = await app.request("/settings");
    expect(res.status).toBe(401);
  });

  test("returns initialized settings", async () => {
    const res = await app.request("/settings", { headers: await authHeader() });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      success: boolean;
      data: {
        runtime_provider: string;
        runtime_dir: string;
        data_dir: string;
        host_ip: string;
        base_domain: string | null;
        gateway_port_start: number;
        gateway_port_end: number;
        bridge_port_start: number;
        bridge_port_end: number;
      };
    };

    expect(body.success).toBe(true);
    expect(body.data.runtime_provider).toBe("docker");
    expect(body.data.runtime_dir).toBe("/opt/openclaw-runtime");
    expect(body.data.data_dir).toBe("/data/openclaw");
    expect(body.data.host_ip).toBe("10.0.0.9");
    expect(body.data.base_domain).toBe("default.example.com");
    expect(body.data.gateway_port_start).toBe(19100);
    expect(body.data.gateway_port_end).toBe(19199);
    expect(body.data.bridge_port_start).toBe(29100);
    expect(body.data.bridge_port_end).toBe(29199);
  });
});

describe("PUT /settings", () => {
  test("updates settings and persists", async () => {
    const res = await app.request("/settings", {
      method: "PUT",
      headers: { ...(await authHeader()), "Content-Type": "application/json" },
      body: JSON.stringify({
        runtime_provider: "podman",
        runtime_dir: "/srv/openclaw",
        data_dir: "/srv/openclaw-data",
        host_ip: "172.16.1.15",
        base_domain: "tenant.example.com",
        gateway_port_start: 18000,
        gateway_port_end: 18099,
        bridge_port_start: 28000,
        bridge_port_end: 28099,
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.data.runtime_provider).toBe("podman");
    expect(body.data.runtime_dir).toBe("/srv/openclaw");
    expect(body.data.data_dir).toBe("/srv/openclaw-data");
    expect(body.data.host_ip).toBe("172.16.1.15");
    expect(body.data.base_domain).toBe("tenant.example.com");

    const res2 = await app.request("/settings", { headers: await authHeader() });
    const body2 = (await res2.json()) as any;
    expect(body2.data.runtime_provider).toBe("podman");
    expect(body2.data.runtime_dir).toBe("/srv/openclaw");
    expect(body2.data.base_domain).toBe("tenant.example.com");
  });

  test("rejects invalid port range", async () => {
    const res = await app.request("/settings", {
      method: "PUT",
      headers: { ...(await authHeader()), "Content-Type": "application/json" },
      body: JSON.stringify({
        runtime_provider: "docker",
        runtime_dir: "/opt/openclaw",
        data_dir: "/data/openclaw",
        host_ip: "127.0.0.1",
        base_domain: "",
        gateway_port_start: 19000,
        gateway_port_end: 18000,
        bridge_port_start: 29000,
        bridge_port_end: 28000,
      }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("INVALID_PORT_RANGE");
  });
});

