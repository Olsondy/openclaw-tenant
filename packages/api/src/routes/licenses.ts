import { randomBytes } from "crypto";
import { Hono } from "hono";
import { getDb } from "../db/client";
import { jwtMiddleware } from "../middleware/jwt";
import { encryptApiKey } from "../services/crypto";
import { generateLicenseKey } from "../services/licenseService";
import { enqueueLicenseProvisioning } from "../services/provisioning/licenseProvisioningService";
import {
  buildComposeProject,
  buildNginxHost,
  sanitizeOwnerTag,
} from "../services/provisioning/nameBuilder";
import { allocatePortPair } from "../services/provisioning/portAllocator";
import { getSettingsRow } from "../services/settingsService";

interface CreateLicenseBody {
  ownerTag?: string;
  expiryDate?: string;
  tokenTtlDays?: number;
  hostIp?: string;
  baseDomain?: string;

  providerId?: string;
  providerLabel?: string;
  baseUrl?: string;
  api?: string;
  modelId?: string;
  modelName?: string;
  apiKey?: string;
  apiKeySource?: "preset" | "custom";
}

interface ModelPresetRow {
  provider_id: string;
  label: string;
  base_url: string;
  api: string;
  model_id: string;
  model_name: string;
  api_key_enc: string | null;
  enabled: number;
}

interface ModelSnapshot {
  providerId: string;
  providerLabel: string;
  baseUrl: string;
  api: string;
  modelId: string;
  modelName: string;
  apiKeyEnc: string;
}

function normalizeText(input: string | undefined): string {
  return (input ?? "").trim();
}

function isManualSnapshotReady(body: CreateLicenseBody): boolean {
  return Boolean(
    normalizeText(body.providerId) &&
      normalizeText(body.providerLabel) &&
      normalizeText(body.baseUrl) &&
      normalizeText(body.api) &&
      normalizeText(body.modelId) &&
      normalizeText(body.modelName) &&
      normalizeText(body.apiKey),
  );
}

function normalizeBaseUrl(raw: string): string {
  return raw.trim().replace(/\/+$/, "");
}

function validateSnapshot(snapshot: ModelSnapshot): ModelSnapshot {
  const normalized: ModelSnapshot = {
    providerId: normalizeText(snapshot.providerId),
    providerLabel: normalizeText(snapshot.providerLabel),
    baseUrl: normalizeBaseUrl(snapshot.baseUrl),
    api: normalizeText(snapshot.api),
    modelId: normalizeText(snapshot.modelId),
    modelName: normalizeText(snapshot.modelName),
    apiKeyEnc: normalizeText(snapshot.apiKeyEnc),
  };

  if (
    !normalized.providerId ||
    !normalized.providerLabel ||
    !normalized.baseUrl ||
    !normalized.api ||
    !normalized.modelId ||
    !normalized.modelName ||
    !normalized.apiKeyEnc
  ) {
    throw new Error("MODEL_SNAPSHOT_REQUIRED");
  }

  return normalized;
}

function buildManualSnapshot(body: CreateLicenseBody, secret: string): ModelSnapshot {
  const apiKey = normalizeText(body.apiKey);
  if (!apiKey) throw new Error("API_KEY_REQUIRED");
  return validateSnapshot({
    providerId: normalizeText(body.providerId),
    providerLabel: normalizeText(body.providerLabel),
    baseUrl: normalizeBaseUrl(normalizeText(body.baseUrl)),
    api: normalizeText(body.api),
    modelId: normalizeText(body.modelId),
    modelName: normalizeText(body.modelName),
    apiKeyEnc: encryptApiKey(apiKey, secret),
  });
}

function buildPresetSnapshot(
  body: CreateLicenseBody,
  preset: ModelPresetRow,
  secret: string,
): ModelSnapshot {
  const apiKeyInput = normalizeText(body.apiKey);
  const source = body.apiKeySource;

  let apiKeyEnc = preset.api_key_enc ?? "";
  if (source === "custom") {
    if (!apiKeyInput) throw new Error("API_KEY_REQUIRED");
    apiKeyEnc = encryptApiKey(apiKeyInput, secret);
  } else if (source === "preset") {
    if (!preset.api_key_enc) throw new Error("PRESET_API_KEY_MISSING");
    apiKeyEnc = preset.api_key_enc;
  } else if (apiKeyInput) {
    apiKeyEnc = encryptApiKey(apiKeyInput, secret);
  } else if (!apiKeyEnc) {
    throw new Error("API_KEY_REQUIRED");
  }

  return validateSnapshot({
    providerId: preset.provider_id,
    providerLabel: preset.label,
    baseUrl: preset.base_url,
    api: preset.api,
    modelId: preset.model_id,
    modelName: preset.model_name || preset.model_id,
    apiKeyEnc,
  });
}

const licenses = new Hono();
licenses.use("/*", jwtMiddleware);

licenses.get("/", (c) => {
  const db = getDb();
  const rows = db.query("SELECT * FROM licenses ORDER BY created_at DESC").all();
  return c.json({ success: true, data: rows });
});

licenses.post("/", async (c) => {
  const db = getDb();
  const settings = getSettingsRow(db);
  const jwtSecret = process.env.JWT_SECRET ?? "";
  const jwtPayload = c.get("jwtPayload") as { sub?: string; username?: string } | undefined;

  let rawOwnerTag = jwtPayload?.username ?? "user";
  let expiryDate: string | null = null;
  let tokenTtlDays = 30;
  let hostIp = settings.host_ip;
  let baseDomain = settings.base_domain;
  let body: CreateLicenseBody = {};
  try {
    body = await c.req.json<CreateLicenseBody>();
    if (body.ownerTag) rawOwnerTag = body.ownerTag;
    if (body.expiryDate) expiryDate = body.expiryDate;
    if (body.tokenTtlDays && body.tokenTtlDays > 0) tokenTtlDays = body.tokenTtlDays;
    if (body.hostIp) hostIp = body.hostIp;
    if (body.baseDomain) baseDomain = body.baseDomain;
  } catch {
    // keep defaults when body omitted
  }

  let ownerTag: string;
  try {
    ownerTag = sanitizeOwnerTag(rawOwnerTag);
  } catch {
    return c.json({ success: false, error: "INVALID_OWNER_TAG" }, 400);
  }

  let modelSnapshot: ModelSnapshot;
  try {
    const providerId = normalizeText(body.providerId);
    const preset = providerId
      ? db
          .query<ModelPresetRow, string>(
            `SELECT provider_id, label, base_url, api, model_id, model_name, api_key_enc, enabled
               FROM model_presets WHERE provider_id=? AND enabled=1`,
          )
          .get(providerId)
      : null;

    const hasEnabledPreset = Boolean(
      db
        .query<{ count: number }, []>("SELECT COUNT(1) AS count FROM model_presets WHERE enabled=1")
        .get()?.count,
    );

    if (preset) {
      modelSnapshot = buildPresetSnapshot(body, preset, jwtSecret);
    } else if (!hasEnabledPreset || isManualSnapshotReady(body)) {
      modelSnapshot = buildManualSnapshot(body, jwtSecret);
    } else if (providerId) {
      return c.json({ success: false, error: "PRESET_NOT_FOUND" }, 404);
    } else {
      return c.json({ success: false, error: "MODEL_PROVIDER_REQUIRED" }, 400);
    }
  } catch (err) {
    const code = err instanceof Error ? err.message : "MODEL_SNAPSHOT_REQUIRED";
    const status = code === "PRESET_API_KEY_MISSING" || code === "PRESET_NOT_FOUND" ? 404 : 400;
    return c.json({ success: false, error: code }, status);
  }

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
  const tokenExpiresAt = new Date(Date.now() + tokenTtlDays * 24 * 60 * 60 * 1000).toISOString();
  const initialGatewayUrl = `ws://${hostIp}:${portPair.gatewayPort}`;
  const initialWebuiUrl = `http://${hostIp}:${portPair.gatewayPort}`;

  db.run(
    `INSERT INTO licenses
       (license_key, gateway_token, gateway_url, status,
         owner_tag, gateway_port, bridge_port, provision_status, webui_url,
         expiry_date, token_expires_at, token_ttl_days,
         runtime_provider, runtime_dir, data_dir,
         provider_id, provider_label, base_url, api, model_id, model_name, api_key_enc)
     VALUES (?, ?, ?, 'unbound', ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      licenseKey,
      gatewayToken,
      initialGatewayUrl,
      ownerTag,
      portPair.gatewayPort,
      portPair.bridgePort,
      initialWebuiUrl,
      expiryDate,
      tokenExpiresAt,
      tokenTtlDays,
      settings.runtime_provider,
      settings.runtime_dir,
      settings.data_dir,
      modelSnapshot.providerId,
      modelSnapshot.providerLabel,
      modelSnapshot.baseUrl,
      modelSnapshot.api,
      modelSnapshot.modelId,
      modelSnapshot.modelName,
      modelSnapshot.apiKeyEnc,
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
