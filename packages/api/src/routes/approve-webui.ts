import { readFile, writeFile } from "fs/promises";
import { Hono } from "hono";
import { join, resolve } from "path";
import { getDb } from "../db/client";
import { buildConfigDir } from "../services/provisioning/nameBuilder";

const WEBUI_CLIENT_ID = "openclaw-control-ui";
const POLL_INTERVAL_MS = 1000;
const MAX_POLL_ATTEMPTS = 10;

interface PendingEntry {
  requestId: string;
  deviceId: string;
  publicKey: string;
  platform?: string;
  clientId?: string;
  clientMode?: string;
  role?: string;
  roles?: string[];
  scopes?: string[];
  remoteIp?: string;
  ts?: number;
}

interface PairedEntry {
  deviceId: string;
  publicKey: string;
  role?: string;
  roles?: string[];
  scopes?: string[];
  approvedScopes?: string[];
  createdAtMs: number;
  approvedAtMs: number;
}

type PendingJson = Record<string, PendingEntry>;
type PairedJson = Record<string, PairedEntry>;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function readJsonFile<T>(path: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch {
    return null;
  }
}

/**
 * 从 pending.json 中找到 webui 设备（clientId = openclaw-control-ui），
 * 写入 paired.json 并从 pending.json 中移除。
 * 返回 approved 的 requestId 列表。
 */
async function approveWebuiDevices(configDir: string): Promise<string[]> {
  const devicesDir = join(configDir, "devices");
  const pendingPath = join(devicesDir, "pending.json");
  const pairedPath = join(devicesDir, "paired.json");

  const pending = (await readJsonFile<PendingJson>(pendingPath)) ?? {};
  const paired = (await readJsonFile<PairedJson>(pairedPath)) ?? {};

  const approved: string[] = [];
  const now = Date.now();

  for (const [reqId, entry] of Object.entries(pending)) {
    if (entry.clientId !== WEBUI_CLIENT_ID) continue;
    if (paired[entry.deviceId]) continue;

    paired[entry.deviceId] = {
      deviceId: entry.deviceId,
      publicKey: entry.publicKey,
      role: entry.role ?? "operator",
      roles: entry.roles ?? ["operator"],
      scopes: entry.scopes ?? [],
      approvedScopes: entry.scopes ?? [],
      createdAtMs: entry.ts ?? now,
      approvedAtMs: now,
    };

    delete pending[reqId];
    approved.push(reqId);
  }

  if (approved.length > 0) {
    await writeFile(pairedPath, JSON.stringify(paired, null, 2) + "\n");
    await writeFile(pendingPath, JSON.stringify(pending, null, 2) + "\n");
  }

  return approved;
}

const router = new Hono();

/**
 * POST /api/licenses/:id/approve-webui
 * Auth: licenseKey + hwid（同 bootstrap-config）
 * 轮询 pending.json，找到 webui 设备后自动 approve。
 */
router.post("/:id/approve-webui", async (c) => {
  const id = Number(c.req.param("id"));
  if (Number.isNaN(id)) return c.json({ success: false, error: "INVALID_ID" }, 400);

  let body: { licenseKey?: string; hwid?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ success: false, error: "INVALID_JSON" }, 400);
  }

  if (!body.licenseKey || !body.hwid) {
    return c.json({ success: false, error: "MISSING_CREDENTIALS" }, 400);
  }

  const db = getDb();
  const license = db
    .query<
      {
        license_key: string;
        hwid: string | null;
        compose_project: string | null;
        data_dir: string | null;
      },
      number
    >(
      "SELECT license_key, hwid, compose_project, data_dir FROM licenses WHERE id=? AND status='active'",
    )
    .get(id);

  if (!license) return c.json({ success: false, error: "NOT_FOUND" }, 404);
  if (body.licenseKey !== license.license_key || body.hwid !== license.hwid) {
    return c.json({ success: false, error: "UNAUTHORIZED" }, 403);
  }
  if (!license.compose_project || !license.data_dir) {
    return c.json({ success: false, error: "NOT_PROVISIONED" }, 409);
  }

  const configDir = buildConfigDir(resolve(license.data_dir), license.compose_project);

  // 轮询 pending.json，等待 webui 设备出现
  for (let i = 0; i < MAX_POLL_ATTEMPTS; i++) {
    const approved = await approveWebuiDevices(configDir);
    if (approved.length > 0) {
      return c.json({ success: true, data: { approved } });
    }
    await sleep(POLL_INTERVAL_MS);
  }

  return c.json({ success: false, error: "NO_PENDING_WEBUI_DEVICE" }, 408);
});

export default router;
