import { Hono } from "hono";
import { randomBytes } from "crypto";
import { getDb } from "../db/client";
import { generateLicenseKey } from "../services/licenseService";
import { allocatePortPair } from "../services/provisioning/portAllocator";
import {
  sanitizeOwnerTag,
  buildComposeProject,
  buildNginxHost,
} from "../services/provisioning/nameBuilder";
import { enqueueLicenseProvisioning } from "../services/provisioning/licenseProvisioningService";

const licenses = new Hono();

licenses.get("/", (c) => {
  const db = getDb();
  const rows = db.query("SELECT * FROM licenses ORDER BY created_at DESC").all();
  return c.json({ success: true, data: rows });
});

licenses.post("/", async (c) => {
  // Parse optional ownerTag from body; fall back to JWT username
  const jwtPayload = c.get("jwtPayload") as { sub?: string; username?: string } | undefined;
  let rawOwnerTag = jwtPayload?.username ?? "user";
  try {
    const body = await c.req.json<{ ownerTag?: string }>();
    if (body.ownerTag) rawOwnerTag = body.ownerTag;
  } catch {
    // body is optional
  }

  let ownerTag: string;
  try {
    ownerTag = sanitizeOwnerTag(rawOwnerTag);
  } catch {
    return c.json({ success: false, error: "INVALID_OWNER_TAG" }, 400);
  }

  const db = getDb();

  // Allocate port pair
  let portPair: { gatewayPort: number; bridgePort: number };
  try {
    portPair = allocatePortPair(
      db,
      Number(process.env.OPENCLAW_GATEWAY_PORT_START ?? 18789),
      Number(process.env.OPENCLAW_GATEWAY_PORT_END ?? 18999),
      Number(process.env.OPENCLAW_BRIDGE_PORT_START ?? 28789),
      Number(process.env.OPENCLAW_BRIDGE_PORT_END ?? 28999)
    );
  } catch {
    return c.json({ success: false, error: "NO_AVAILABLE_PORT" }, 503);
  }

  const licenseKey = generateLicenseKey();
  const gatewayToken = randomBytes(32).toString("hex");
  const hostIp = process.env.OPENCLAW_HOST_IP ?? "127.0.0.1";
  const baseDomain = process.env.OPENCLAW_BASE_DOMAIN;

  const initialGatewayUrl = `ws://${hostIp}:${portPair.gatewayPort}`;
  const initialWebuiUrl = `http://${hostIp}:${portPair.gatewayPort}`;

  db.run(
    `INSERT INTO licenses
       (license_key, gateway_token, gateway_url, status,
        owner_tag, gateway_port, bridge_port, provision_status, webui_url)
     VALUES (?, ?, ?, 'unbound', ?, ?, ?, 'pending', ?)`,
    [
      licenseKey,
      gatewayToken,
      initialGatewayUrl,
      ownerTag,
      portPair.gatewayPort,
      portPair.bridgePort,
      initialWebuiUrl,
    ]
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
    [composeProject, gatewayUrl, webuiUrl, nginxHost, row.id]
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
