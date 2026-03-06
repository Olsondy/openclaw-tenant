import { randomBytes } from "crypto";
import { Hono } from "hono";
import { getDb } from "../db/client";
import { generateLicenseKey } from "../services/licenseService";
import { enqueueLicenseProvisioning } from "../services/provisioning/licenseProvisioningService";
import {
  buildComposeProject,
  buildNginxHost,
  sanitizeOwnerTag,
} from "../services/provisioning/nameBuilder";
import { allocatePortPair } from "../services/provisioning/portAllocator";
import { getSettingsRow } from "../services/settingsService";

const licenses = new Hono();

licenses.get("/", (c) => {
  const db = getDb();
  const rows = db.query("SELECT * FROM licenses ORDER BY created_at DESC").all();
  return c.json({ success: true, data: rows });
});

licenses.post("/", async (c) => {
  const db = getDb();
  const settings = getSettingsRow(db);

  // Parse optional fields from body
  const jwtPayload = c.get("jwtPayload") as { sub?: string; username?: string } | undefined;
  let rawOwnerTag = jwtPayload?.username ?? "user";
  let expiryDate: string | null = null;
  let tokenTtlDays = 30;
  let hostIp = settings.host_ip;
  let baseDomain = settings.base_domain;
  try {
    const body = await c.req.json<{
      ownerTag?: string;
      expiryDate?: string;
      tokenTtlDays?: number;
      hostIp?: string;
      baseDomain?: string;
    }>();
    if (body.ownerTag) rawOwnerTag = body.ownerTag;
    if (body.expiryDate) expiryDate = body.expiryDate;
    if (body.tokenTtlDays && body.tokenTtlDays > 0) tokenTtlDays = body.tokenTtlDays;
    if (body.hostIp) hostIp = body.hostIp;
    if (body.baseDomain) baseDomain = body.baseDomain;
  } catch {
    // body is optional
  }

  let ownerTag: string;
  try {
    ownerTag = sanitizeOwnerTag(rawOwnerTag);
  } catch {
    return c.json({ success: false, error: "INVALID_OWNER_TAG" }, 400);
  }

  // Allocate port pair
  let portPair: { gatewayPort: number; bridgePort: number };
  try {
    portPair = allocatePortPair(
      db,
      settings.gateway_port_start,
      settings.gateway_port_end,
      settings.bridge_port_start,
      settings.bridge_port_end,
    );
  } catch {
    return c.json({ success: false, error: "NO_AVAILABLE_PORT" }, 503);
  }

  const licenseKey = generateLicenseKey();
  const gatewayToken = randomBytes(32).toString("hex");
  const authToken = randomBytes(32).toString("hex");
  const tokenExpiresAt = new Date(Date.now() + tokenTtlDays * 24 * 60 * 60 * 1000).toISOString();
  const initialGatewayUrl = `ws://${hostIp}:${portPair.gatewayPort}`;
  const initialWebuiUrl = `http://${hostIp}:${portPair.gatewayPort}`;

  db.run(
    `INSERT INTO licenses
       (license_key, gateway_token, gateway_url, status,
         owner_tag, gateway_port, bridge_port, provision_status, webui_url,
         expiry_date, auth_token, token_expires_at, token_ttl_days,
         runtime_provider, runtime_dir, data_dir)
     VALUES (?, ?, ?, 'unbound', ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      licenseKey,
      gatewayToken,
      initialGatewayUrl,
      ownerTag,
      portPair.gatewayPort,
      portPair.bridgePort,
      initialWebuiUrl,
      expiryDate,
      authToken,
      tokenExpiresAt,
      tokenTtlDays,
      settings.runtime_provider,
      settings.runtime_dir,
      settings.data_dir,
    ],
  );

  const row = db
    .query<{ id: number }, string>("SELECT * FROM licenses WHERE license_key = ?")
    .get(licenseKey) as any;

  const composeProject = buildComposeProject(ownerTag, row.id);
  let gatewayUrl = initialGatewayUrl;
  let webuiUrl = initialWebuiUrl;
  let nginxHost: string | null = null;

  if (baseDomain) {
    nginxHost = buildNginxHost(ownerTag, row.id, baseDomain);
    gatewayUrl = `wss://${nginxHost}`;
    webuiUrl = `https://${nginxHost}`;
  }

  db.run(
    "UPDATE licenses SET compose_project=?, gateway_url=?, webui_url=?, nginx_host=? WHERE id=?",
    [composeProject, gatewayUrl, webuiUrl, nginxHost, row.id],
  );

  const finalRow = db.query("SELECT * FROM licenses WHERE id=?").get(row.id);

  // Fire-and-forget async provisioning
  enqueueLicenseProvisioning(row.id);

  return c.json({ success: true, data: finalRow }, 201);
});

licenses.patch("/:id", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json<{ status?: string; note?: string }>();
  const db = getDb();

  const existing = db.query("SELECT id FROM licenses WHERE id = ?").get(id);
  if (!existing) return c.json({ success: false, error: "NOT_FOUND" }, 404);

  const updates: string[] = [];
  const values: any[] = [];
  if (body.status) {
    updates.push("status = ?");
    values.push(body.status);
  }
  if (body.note !== undefined) {
    updates.push("note = ?");
    values.push(body.note);
  }

  if (updates.length === 0) {
    return c.json({ success: false, error: "NO_FIELDS_TO_UPDATE" }, 400);
  }

  values.push(id);
  db.run(`UPDATE licenses SET ${updates.join(", ")} WHERE id = ?`, values);
  const row = db.query("SELECT * FROM licenses WHERE id = ?").get(id);
  return c.json({ success: true, data: row });
});

export default licenses;
