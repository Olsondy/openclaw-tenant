import { Hono } from "hono";
import { getDb } from "../db/client";
import { jwtMiddleware } from "../middleware/jwt";
import { encryptApiKey } from "../services/crypto";

const router = new Hono();
router.use("/*", jwtMiddleware);

router.get("/", (c) => {
  const db = getDb();
  const rows = db
    .query<
      {
        id: number;
        provider_id: string;
        label: string;
        base_url: string;
        api: string;
        model_id: string;
        api_key_enc: string | null;
        enabled: number;
      },
      []
    >(
      "SELECT id, provider_id, label, base_url, api, model_id, api_key_enc, enabled FROM model_presets",
    )
    .all();

  const data = rows.map((r) => ({
    id: r.id,
    provider_id: r.provider_id,
    label: r.label,
    base_url: r.base_url,
    api: r.api,
    model_id: r.model_id,
    api_key_masked: r.api_key_enc !== null,
    enabled: r.enabled === 1,
  }));

  return c.json({ success: true, data });
});

router.put("/:provider_id", async (c) => {
  const providerId = c.req.param("provider_id");
  const secret = process.env.JWT_SECRET ?? "";

  let body: { apiKey?: string; enabled?: boolean };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ success: false, error: "INVALID_JSON" }, 400);
  }

  const db = getDb();
  const existing = db
    .query<{ id: number }, string>("SELECT id FROM model_presets WHERE provider_id = ?")
    .get(providerId);

  if (!existing) {
    return c.json({ success: false, error: "NOT_FOUND" }, 404);
  }

  if (body.apiKey !== undefined) {
    if (!body.apiKey.trim()) {
      return c.json({ success: false, error: "API_KEY_EMPTY" }, 400);
    }
    const encrypted = encryptApiKey(body.apiKey, secret);
    db.run(
      "UPDATE model_presets SET api_key_enc=?, updated_at=datetime('now') WHERE provider_id=?",
      [encrypted, providerId],
    );
  }

  if (body.enabled !== undefined) {
    db.run("UPDATE model_presets SET enabled=?, updated_at=datetime('now') WHERE provider_id=?", [
      body.enabled ? 1 : 0,
      providerId,
    ]);
  }

  return c.json({ success: true });
});

export default router;
