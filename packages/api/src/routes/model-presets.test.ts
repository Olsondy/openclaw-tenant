import { beforeEach, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { sign } from "hono/jwt";
import { getDb, resetDb } from "../db/client";
import { jwtMiddleware } from "../middleware/jwt";
import modelPresetsRoutes from "./model-presets";

const app = new Hono();
app.use("/settings/model-presets/*", jwtMiddleware);
app.route("/settings/model-presets", modelPresetsRoutes);

async function authHeader() {
  const token = await sign(
    { sub: "1", exp: Math.floor(Date.now() / 1000) + 3600 },
    "test-secret-test-secret-test-secret-32",
    "HS256",
  );
  return { Authorization: `Bearer ${token}` };
}

beforeEach(() => {
  resetDb();
  process.env.DB_PATH = ":memory:";
  process.env.ADMIN_USER = "admin";
  process.env.ADMIN_PASS = "x";
  process.env.JWT_SECRET = "test-secret-test-secret-test-secret-32";
});

describe("GET /settings/model-presets", () => {
  test("returns seeded preset list", async () => {
    const res = await app.request("/settings/model-presets", {
      headers: await authHeader(),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: Array<{ provider_id: string; model_name: string }> };
    expect(body.data.some((r) => r.provider_id === "zai")).toBe(true);
    expect(body.data.some((r) => r.model_name.length > 0)).toBe(true);
  });
});

describe("model preset CRUD", () => {
  test("create requires apiKey", async () => {
    const res = await app.request("/settings/model-presets", {
      method: "POST",
      headers: { ...(await authHeader()), "Content-Type": "application/json" },
      body: JSON.stringify({
        providerId: "openai",
        label: "OpenAI",
        baseUrl: "https://api.openai.com/v1",
        api: "openai-completions",
        modelId: "gpt-4o-mini",
        modelName: "GPT-4o mini",
      }),
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("API_KEY_REQUIRED");
  });

  test("create + update + delete flow", async () => {
    const create = await app.request("/settings/model-presets", {
      method: "POST",
      headers: { ...(await authHeader()), "Content-Type": "application/json" },
      body: JSON.stringify({
        providerId: "openai",
        label: "OpenAI",
        baseUrl: "https://api.openai.com/v1",
        api: "openai-completions",
        modelId: "gpt-4o-mini",
        modelName: "GPT-4o mini",
        apiKey: "sk-create",
        enabled: true,
      }),
    });
    expect(create.status).toBe(201);

    const db = getDb();
    const before = db
      .query<{ api_key_enc: string | null }, string>(
        "SELECT api_key_enc FROM model_presets WHERE provider_id=?",
      )
      .get("openai");
    expect(before?.api_key_enc).toBeTruthy();

    const update = await app.request("/settings/model-presets/openai", {
      method: "PUT",
      headers: { ...(await authHeader()), "Content-Type": "application/json" },
      body: JSON.stringify({
        label: "OpenAI Prod",
        modelName: "GPT-4o mini prod",
        apiKey: "",
      }),
    });
    expect(update.status).toBe(200);
    const updatedBody = (await update.json()) as { data: { label: string; model_name: string } };
    expect(updatedBody.data.label).toBe("OpenAI Prod");
    expect(updatedBody.data.model_name).toBe("GPT-4o mini prod");

    const after = db
      .query<{ api_key_enc: string | null }, string>(
        "SELECT api_key_enc FROM model_presets WHERE provider_id=?",
      )
      .get("openai");
    expect(after?.api_key_enc).toBe(before?.api_key_enc);

    const immutable = await app.request("/settings/model-presets/openai", {
      method: "PUT",
      headers: { ...(await authHeader()), "Content-Type": "application/json" },
      body: JSON.stringify({ providerId: "anthropic" }),
    });
    expect(immutable.status).toBe(400);
    const immutableBody = (await immutable.json()) as { error: string };
    expect(immutableBody.error).toBe("PROVIDER_ID_IMMUTABLE");

    const del = await app.request("/settings/model-presets/openai", {
      method: "DELETE",
      headers: await authHeader(),
    });
    expect(del.status).toBe(200);
    const deleted = db.query("SELECT id FROM model_presets WHERE provider_id='openai'").get();
    expect(deleted).toBeNull();
  });
});
