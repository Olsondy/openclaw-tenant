import { Hono } from "hono";
import { getDb } from "../db/client";
import { jwtMiddleware } from "../middleware/jwt";
import { encryptApiKey } from "../services/crypto";

interface PresetRow {
  id: number;
  provider_id: string;
  label: string;
  base_url: string;
  api: string;
  model_id: string;
  model_name: string;
  api_key_enc: string | null;
  enabled: number;
  updated_at: string;
}

interface CreatePresetBody {
  providerId?: string;
  label?: string;
  baseUrl?: string;
  api?: string;
  modelId?: string;
  modelName?: string;
  apiKey?: string;
  enabled?: boolean;
}

interface UpdatePresetBody {
  provider_id?: string;
  providerId?: string;
  label?: string;
  baseUrl?: string;
  api?: string;
  modelId?: string;
  modelName?: string;
  apiKey?: string;
  enabled?: boolean;
}

const router = new Hono();
router.use("/*", jwtMiddleware);

function normalizeText(v: string | undefined): string {
  return (v ?? "").trim();
}

function normalizeBaseUrl(v: string | undefined): string {
  return normalizeText(v).replace(/\/+$/, "");
}

function toResponseRow(row: PresetRow) {
  return {
    id: row.id,
    provider_id: row.provider_id,
    label: row.label,
    base_url: row.base_url,
    api: row.api,
    model_id: row.model_id,
    model_name: row.model_name,
    api_key_masked: row.api_key_enc !== null,
    enabled: row.enabled === 1,
    updated_at: row.updated_at,
  };
}

function getPresetByProviderId(providerId: string): PresetRow | null {
  const db = getDb();
  return (
    db
      .query<PresetRow, string>(
        `SELECT id, provider_id, label, base_url, api, model_id, model_name, api_key_enc, enabled, updated_at
           FROM model_presets WHERE provider_id=?`,
      )
      .get(providerId) ?? null
  );
}

router.get("/", (c) => {
  const db = getDb();
  const rows = db
    .query<PresetRow, []>(
      `SELECT id, provider_id, label, base_url, api, model_id, model_name, api_key_enc, enabled, updated_at
         FROM model_presets ORDER BY id ASC`,
    )
    .all();

  return c.json({ success: true, data: rows.map(toResponseRow) });
});

router.post("/", async (c) => {
  let body: CreatePresetBody;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ success: false, error: "INVALID_JSON" }, 400);
  }

  const providerId = normalizeText(body.providerId);
  const label = normalizeText(body.label);
  const baseUrl = normalizeBaseUrl(body.baseUrl);
  const api = normalizeText(body.api);
  const modelId = normalizeText(body.modelId);
  const modelName = normalizeText(body.modelName);
  const apiKey = normalizeText(body.apiKey);
  const enabled = body.enabled ?? true;

  if (!providerId || !label || !baseUrl || !api || !modelId || !modelName) {
    return c.json({ success: false, error: "MISSING_REQUIRED_FIELDS" }, 400);
  }
  if (!apiKey) {
    return c.json({ success: false, error: "API_KEY_REQUIRED" }, 400);
  }

  const db = getDb();
  const exists = db.query("SELECT id FROM model_presets WHERE provider_id = ?").get(providerId);
  if (exists) {
    return c.json({ success: false, error: "PROVIDER_ALREADY_EXISTS" }, 409);
  }

  const secret = process.env.JWT_SECRET ?? "";
  const apiKeyEnc = encryptApiKey(apiKey, secret);
  db.run(
    `INSERT INTO model_presets
      (provider_id, label, base_url, api, model_id, model_name, api_key_enc, enabled, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
    [providerId, label, baseUrl, api, modelId, modelName, apiKeyEnc, enabled ? 1 : 0],
  );

  const row = getPresetByProviderId(providerId);
  return c.json({ success: true, data: row ? toResponseRow(row) : null }, 201);
});

router.put("/:provider_id", async (c) => {
  const providerId = c.req.param("provider_id");
  let body: UpdatePresetBody;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ success: false, error: "INVALID_JSON" }, 400);
  }

  const immutableProvider = normalizeText(body.provider_id ?? body.providerId);
  if (immutableProvider && immutableProvider !== providerId) {
    return c.json({ success: false, error: "PROVIDER_ID_IMMUTABLE" }, 400);
  }

  const existing = getPresetByProviderId(providerId);
  if (!existing) {
    return c.json({ success: false, error: "NOT_FOUND" }, 404);
  }

  const db = getDb();
  const updates: string[] = [];
  const values: unknown[] = [];

  if (body.label !== undefined) {
    const label = normalizeText(body.label);
    if (!label) return c.json({ success: false, error: "LABEL_REQUIRED" }, 400);
    updates.push("label=?");
    values.push(label);
  }
  if (body.baseUrl !== undefined) {
    const baseUrl = normalizeBaseUrl(body.baseUrl);
    if (!baseUrl) return c.json({ success: false, error: "BASE_URL_REQUIRED" }, 400);
    updates.push("base_url=?");
    values.push(baseUrl);
  }
  if (body.api !== undefined) {
    const api = normalizeText(body.api);
    if (!api) return c.json({ success: false, error: "API_REQUIRED" }, 400);
    updates.push("api=?");
    values.push(api);
  }
  if (body.modelId !== undefined) {
    const modelId = normalizeText(body.modelId);
    if (!modelId) return c.json({ success: false, error: "MODEL_ID_REQUIRED" }, 400);
    updates.push("model_id=?");
    values.push(modelId);
  }
  if (body.modelName !== undefined) {
    const modelName = normalizeText(body.modelName);
    if (!modelName) return c.json({ success: false, error: "MODEL_NAME_REQUIRED" }, 400);
    updates.push("model_name=?");
    values.push(modelName);
  }
  if (body.enabled !== undefined) {
    updates.push("enabled=?");
    values.push(body.enabled ? 1 : 0);
  }

  if (body.apiKey !== undefined) {
    const apiKey = normalizeText(body.apiKey);
    if (apiKey) {
      const secret = process.env.JWT_SECRET ?? "";
      updates.push("api_key_enc=?");
      values.push(encryptApiKey(apiKey, secret));
    }
  }

  if (updates.length === 0) {
    return c.json({ success: true, data: toResponseRow(existing) });
  }

  updates.push("updated_at=datetime('now')");
  values.push(providerId);
  db.run(`UPDATE model_presets SET ${updates.join(", ")} WHERE provider_id=?`, values);

  const row = getPresetByProviderId(providerId);
  return c.json({ success: true, data: row ? toResponseRow(row) : null });
});

router.delete("/:provider_id", (c) => {
  const providerId = c.req.param("provider_id");
  const db = getDb();
  const existing = db.query("SELECT id FROM model_presets WHERE provider_id = ?").get(providerId);
  if (!existing) {
    return c.json({ success: false, error: "NOT_FOUND" }, 404);
  }

  db.run("DELETE FROM model_presets WHERE provider_id = ?", [providerId]);
  return c.json({ success: true });
});

export default router;
