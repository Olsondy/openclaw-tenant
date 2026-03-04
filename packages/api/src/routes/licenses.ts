import { Hono } from "hono";
import { getDb } from "../db/client";
import { generateLicenseKey } from "../services/licenseService";
import { readOpenclawConfig } from "../services/openclawConfig";

const licenses = new Hono();

licenses.get("/", (c) => {
  const db = getDb();
  const rows = db.query("SELECT * FROM licenses ORDER BY created_at DESC").all();
  return c.json({ success: true, data: rows });
});

licenses.post("/", async (c) => {
  const config = await readOpenclawConfig();
  const licenseKey = generateLicenseKey();
  const db = getDb();

  db.run(
    "INSERT INTO licenses (license_key, gateway_token, gateway_url) VALUES (?, ?, ?)",
    [licenseKey, config.token, config.gatewayUrl]
  );

  const row = db.query("SELECT * FROM licenses WHERE license_key = ?").get(licenseKey);
  return c.json({ success: true, data: row }, 201);
});

licenses.patch("/:id", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json<{ status?: string; note?: string }>();
  const db = getDb();

  const existing = db.query("SELECT id FROM licenses WHERE id = ?").get(id);
  if (!existing) {
    return c.json({ success: false, error: "NOT_FOUND" }, 404);
  }

  const updates: string[] = [];
  const values: unknown[] = [];

  if (body.status) { updates.push("status = ?"); values.push(body.status); }
  if (body.note !== undefined) { updates.push("note = ?"); values.push(body.note); }

  if (updates.length === 0) {
    return c.json({ success: false, error: "NO_FIELDS_TO_UPDATE" }, 400);
  }

  values.push(id);
  db.run(`UPDATE licenses SET ${updates.join(", ")} WHERE id = ?`, values);

  const row = db.query("SELECT * FROM licenses WHERE id = ?").get(id);
  return c.json({ success: true, data: row });
});

export default licenses;
