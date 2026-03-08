import { readFile, writeFile } from "fs/promises";
import { Hono } from "hono";
import { join } from "path";
import { getDb } from "../db/client";
import { buildConfigDir } from "../services/provisioning/nameBuilder";
import {
  applyModelConfigAndRestart,
  type ModelAuthPayload,
} from "../services/provisioning/writeAgentApiKey";
import type { RuntimeProvider } from "../services/settingsService";

interface BootstrapBody {
  licenseKey?: string;
  hwid?: string;
  feishu?: {
    appId?: string;
    appSecret?: string;
  };
  modelAuth?: {
    providerId?: string;
    providerLabel?: string;
    baseUrl?: string;
    api?: string;
    modelId?: string;
    modelName?: string;
    apiKey?: string;
  };
}

interface LicenseRow {
  license_key: string;
  hwid: string | null;
  compose_project: string | null;
  data_dir: string | null;
  container_name: string | null;
  runtime_provider: string | null;
}

function normalizeText(input: string | undefined): string {
  return (input ?? "").trim();
}

function toModelAuthPayload(input: BootstrapBody["modelAuth"]): ModelAuthPayload {
  return {
    providerId: normalizeText(input?.providerId),
    providerLabel: normalizeText(input?.providerLabel),
    baseUrl: normalizeText(input?.baseUrl),
    api: normalizeText(input?.api),
    modelId: normalizeText(input?.modelId),
    modelName: normalizeText(input?.modelName),
    apiKey: normalizeText(input?.apiKey),
  };
}

function runtimeProviderFromDb(raw: string | null): RuntimeProvider {
  return raw === "podman" ? "podman" : "docker";
}

const router = new Hono();

router.post("/:id/bootstrap-config", async (c) => {
  const id = Number(c.req.param("id"));
  if (Number.isNaN(id)) return c.json({ success: false, error: "INVALID_ID" }, 400);

  let body: BootstrapBody;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ success: false, error: "INVALID_JSON" }, 400);
  }

  if (!body.licenseKey || !body.hwid) {
    return c.json({ success: false, error: "MISSING_CREDENTIALS" }, 400);
  }
  if (!body.feishu && !body.modelAuth) {
    return c.json({ success: false, error: "NO_CONFIG_TO_APPLY" }, 400);
  }

  const db = getDb();
  const license = db
    .query<LicenseRow, number>(
      `SELECT license_key, hwid, compose_project, data_dir, container_name, runtime_provider
         FROM licenses WHERE id=? AND status='active'`,
    )
    .get(id);

  if (!license) return c.json({ success: false, error: "NOT_FOUND" }, 404);
  if (body.licenseKey !== license.license_key || body.hwid !== license.hwid) {
    return c.json({ success: false, error: "UNAUTHORIZED" }, 403);
  }
  if (!license.compose_project || !license.data_dir) {
    return c.json({ success: false, error: "NOT_PROVISIONED" }, 409);
  }

  const configDir = buildConfigDir(license.data_dir, license.compose_project);
  const applied: string[] = [];

  if (body.feishu) {
    const appId = normalizeText(body.feishu.appId);
    const appSecret = normalizeText(body.feishu.appSecret);
    if (!appId || !appSecret) {
      return c.json({ success: false, error: "FEISHU_FIELDS_REQUIRED" }, 400);
    }

    const configPath = join(configDir, "openclaw.json");
    let cfg: Record<string, unknown>;
    try {
      cfg = JSON.parse(await readFile(configPath, "utf8"));
    } catch {
      return c.json({ success: false, error: "CONFIG_NOT_FOUND" }, 500);
    }

    if (!cfg.channels || typeof cfg.channels !== "object") cfg.channels = {};
    const channels = cfg.channels as Record<string, unknown>;
    channels.feishu = {
      ...(typeof channels.feishu === "object" && channels.feishu !== null ? channels.feishu : {}),
      appId,
      appSecret,
    };

    await writeFile(configPath, `${JSON.stringify(cfg, null, 2)}\n`);
    db.run("UPDATE licenses SET wizard_feishu_done=1 WHERE id=?", [id]);
    applied.push("feishu");
  }

  if (body.modelAuth) {
    if (!license.container_name) {
      return c.json({ success: false, error: "NOT_PROVISIONED" }, 409);
    }

    const modelAuth = toModelAuthPayload(body.modelAuth);
    try {
      await applyModelConfigAndRestart({
        configDir,
        containerName: license.container_name,
        runtimeProvider: runtimeProviderFromDb(license.runtime_provider),
        modelAuth,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "MODEL_AUTH_APPLY_FAILED";
      return c.json({ success: false, error: message }, 500);
    }

    applied.push("modelAuth");
  }

  return c.json({ success: true, data: { applied } });
});

export default router;
