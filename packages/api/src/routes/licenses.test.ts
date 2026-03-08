import { beforeEach, describe, expect, test } from "bun:test";
import { writeFileSync } from "fs";
import { Hono } from "hono";
import { sign } from "hono/jwt";
import { tmpdir } from "os";
import { join } from "path";
import { getDb, resetDb } from "../db/client";
import { jwtMiddleware } from "../middleware/jwt";
import { encryptApiKey } from "../services/crypto";
import licensesRoutes from "./licenses";

const tmpConfig = join(tmpdir(), "test-openclaw-lic.json");
writeFileSync(tmpConfig, JSON.stringify({ token: "tok123", gatewayUrl: "ws://test:18789" }));

const app = new Hono();
app.use("/licenses/*", jwtMiddleware);
app.route("/licenses", licensesRoutes);

async function authHeader() {
  const token = await sign(
    { sub: "1", username: "admin", exp: Math.floor(Date.now() / 1000) + 3600 },
    "test-secret-test-secret-test-secret-32",
    "HS256",
  );
  return { Authorization: `Bearer ${token}` };
}

async function createLicense(overrides: Record<string, unknown> = {}) {
  return app.request("/licenses", {
    method: "POST",
    headers: { ...(await authHeader()), "Content-Type": "application/json" },
    body: JSON.stringify({
      providerId: "zai",
      apiKeySource: "custom",
      apiKey: "sk-test-custom",
      ...overrides,
    }),
  });
}

beforeEach(() => {
  resetDb();
  process.env.DB_PATH = ":memory:";
  process.env.ADMIN_USER = "admin";
  process.env.ADMIN_PASS = "x";
  process.env.JWT_SECRET = "test-secret-test-secret-test-secret-32";
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

  test("creates license with model snapshot fields", async () => {
    const res = await createLicense();
    expect(res.status).toBe(201);

    const body = (await res.json()) as {
      data: {
        license_key: string;
        status: string;
        provider_id: string;
        provider_label: string;
        base_url: string;
        api: string;
        model_id: string;
        model_name: string;
        api_key_enc: string;
      };
    };
    expect(body.data.license_key).toMatch(/^[A-Z0-9]{5}-[A-Z0-9]{5}-[A-Z0-9]{5}-[A-Z0-9]{5}$/);
    expect(body.data.status).toBe("unbound");
    expect(body.data.provider_id).toBe("zai");
    expect(body.data.provider_label.length).toBeGreaterThan(0);
    expect(body.data.base_url.length).toBeGreaterThan(0);
    expect(body.data.api.length).toBeGreaterThan(0);
    expect(body.data.model_id.length).toBeGreaterThan(0);
    expect(body.data.model_name.length).toBeGreaterThan(0);
    expect(body.data.api_key_enc.length).toBeGreaterThan(0);
  });

  test("supports preset apiKeySource=preset", async () => {
    const db = getDb();
    const presetKeyEnc = encryptApiKey("sk-preset", process.env.JWT_SECRET!);
    db.run("UPDATE model_presets SET api_key_enc=? WHERE provider_id='zai'", [presetKeyEnc]);

    const res = await createLicense({ apiKeySource: "preset", apiKey: "" });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { data: { api_key_enc: string } };
    expect(body.data.api_key_enc).toBe(presetKeyEnc);
  });

  test("supports manual full-field mode when no enabled preset", async () => {
    const db = getDb();
    db.run("UPDATE model_presets SET enabled=0");

    const res = await createLicense({
      providerId: "openai",
      providerLabel: "OpenAI",
      baseUrl: "https://api.openai.com/v1",
      api: "openai-completions",
      modelId: "gpt-4o-mini",
      modelName: "GPT-4o mini",
      apiKey: "sk-manual",
      apiKeySource: "custom",
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { data: { provider_id: string; model_id: string } };
    expect(body.data.provider_id).toBe("openai");
    expect(body.data.model_id).toBe("gpt-4o-mini");
  });

  test("returns 400 when provider is missing while presets exist", async () => {
    const res = await app.request("/licenses", {
      method: "POST",
      headers: { ...(await authHeader()), "Content-Type": "application/json" },
      body: JSON.stringify({ apiKey: "sk-x" }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("MODEL_PROVIDER_REQUIRED");
  });
});

describe("PATCH /licenses/:id", () => {
  test("revokes a license", async () => {
    const genRes = await createLicense();
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
    const res = await createLicense();
    expect(res.status).toBe(201);
    const body = (await res.json()) as { data: { provision_status: string } };
    expect(body.data.provision_status).toBe("pending");
  });

  test("assigns gateway_port and compose_project", async () => {
    const res = await createLicense();
    const body = (await res.json()) as { data: { gateway_port: number; compose_project: string } };
    expect(body.data.gateway_port).toBe(18789);
    expect(body.data.compose_project).toMatch(/^openclaw-/);
  });

  test("gateway_url uses OPENCLAW_HOST_IP in no-domain mode", async () => {
    const res = await createLicense();
    const body = (await res.json()) as { data: { gateway_url: string } };
    expect(body.data.gateway_url).toContain("ws://10.0.0.1:");
  });

  test("uses settings base_domain when request does not override", async () => {
    const db = getDb();
    db.run("UPDATE settings SET base_domain=? WHERE id=1", ["tenant.example.com"]);

    const res = await createLicense({ ownerTag: "alice" });
    expect(res.status).toBe(201);

    const body = (await res.json()) as {
      data: { nginx_host: string; gateway_url: string; webui_url: string };
    };
    expect(body.data.nginx_host).toBe("alice-1.tenant.example.com");
    expect(body.data.gateway_url).toBe("wss://alice-1.tenant.example.com");
    expect(body.data.webui_url).toBe("https://alice-1.tenant.example.com");
  });

  test("request baseDomain override takes priority over settings", async () => {
    const db = getDb();
    db.run("UPDATE settings SET base_domain=? WHERE id=1", ["tenant.example.com"]);

    const res = await createLicense({ ownerTag: "alice", baseDomain: "custom.example.com" });
    expect(res.status).toBe(201);

    const body = (await res.json()) as {
      data: { nginx_host: string; gateway_url: string; webui_url: string };
    };
    expect(body.data.nginx_host).toBe("alice-1.custom.example.com");
    expect(body.data.gateway_url).toBe("wss://alice-1.custom.example.com");
    expect(body.data.webui_url).toBe("https://alice-1.custom.example.com");
  });

  test("returns 400 INVALID_OWNER_TAG for invalid ownerTag", async () => {
    const res = await createLicense({ ownerTag: "---" });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("INVALID_OWNER_TAG");
  });

  test("returns 503 NO_AVAILABLE_PORT when pool exhausted", async () => {
    process.env.OPENCLAW_GATEWAY_PORT_START = "18789";
    process.env.OPENCLAW_GATEWAY_PORT_END = "18789";
    process.env.OPENCLAW_BRIDGE_PORT_START = "28789";
    process.env.OPENCLAW_BRIDGE_PORT_END = "28789";

    await createLicense();
    const res = await createLicense();
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("NO_AVAILABLE_PORT");
  });
});
