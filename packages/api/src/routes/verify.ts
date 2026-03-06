import { randomBytes } from "crypto";
import { Hono } from "hono";
import { getDb } from "../db/client";
import { generateAgentId, isExpired } from "../services/licenseService";
import { buildConfigDir } from "../services/provisioning/nameBuilder";
import { writePairingIfReady } from "../services/provisioning/pairingWriter";

interface VerifyBody {
  hwid: string;
  licenseKey: string;
  deviceName: string;
  publicKey?: string; // exec 上报的 ed25519 公钥（base64url），可选，向后兼容
}

interface LicenseRow {
  id: number;
  hwid: string | null;
  agent_id: string | null;
  gateway_token: string;
  gateway_url: string;
  status: string;
  expiry_date: string | null;
  provision_status: string | null;
  container_name: string | null;
  auth_token: string | null;
  token_expires_at: string | null;
  token_ttl_days: number | null;
  exec_public_key: string | null;
  compose_project: string | null;
  data_dir: string | null;
}

const verify = new Hono();

/**
 * 将新的 auth token 同步写入对应实例的 openclaw.json。
 * 路径：{data_dir}/{compose_project}/.openclaw/openclaw.json
 * 若文件不存在（实例尚未完成 provision），则静默跳过。
 */
async function syncTokenToConfig(
  dataDir: string | null,
  composeProject: string | null,
  token: string,
): Promise<void> {
  if (!dataDir) return;
  if (!composeProject) return;

  const configPath = `${buildConfigDir(dataDir, composeProject)}/openclaw.json`;
  const file = Bun.file(configPath);
  const exists = await file.exists();
  if (!exists) return;

  const data = await file.json();

  // 确保嵌套路径存在
  if (!data.gateway) data.gateway = {};
  if (!data.gateway.auth) data.gateway.auth = {};
  if (!data.gateway.remote) data.gateway.remote = {};

  data.gateway.auth.token = token;
  data.gateway.remote.token = token;

  await Bun.write(configPath, JSON.stringify(data, null, 2));
}

verify.post("/", async (c) => {
  let body: Partial<VerifyBody>;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ success: false, error: "INVALID_JSON" }, 400);
  }
  const { hwid, licenseKey, deviceName, publicKey } = body;

  if (!hwid || !licenseKey || !deviceName) {
    return c.json({ success: false, error: "MISSING_FIELDS" }, 400);
  }

  const db = getDb();
  const license = db
    .query<LicenseRow, string>("SELECT * FROM licenses WHERE license_key = ?")
    .get(licenseKey);

  if (!license) return c.json({ success: false, error: "INVALID_LICENSE" }, 403);

  // Provisioning gate
  const ps = license.provision_status;
  if (ps === "pending" || ps === "running") {
    return c.json({ success: false, error: "PROVISIONING_PENDING" }, 409);
  }
  if (ps === "failed") {
    return c.json({ success: false, error: "PROVISIONING_FAILED" }, 409);
  }

  if (license.status === "revoked") {
    return c.json({ success: false, error: "LICENSE_REVOKED" }, 403);
  }
  if (isExpired(license.expiry_date)) {
    return c.json({ success: false, error: "LICENSE_EXPIRED" }, 403);
  }

  // HWID 绑定逻辑
  let agentId: string;

  if (license.status === "unbound") {
    agentId = generateAgentId(hwid);
    db.run(
      `UPDATE licenses
       SET hwid=?, device_name=?, agent_id=?, status='active', bound_at=datetime('now')
       WHERE license_key=?`,
      [hwid, deviceName, agentId, licenseKey],
    );
  } else {
    if (license.hwid !== hwid) {
      return c.json({ success: false, error: "HWID_MISMATCH" }, 403);
    }
    agentId = license.agent_id!;
  }

  // ─── 更新 exec_public_key（如果本次携带了新的，或首次上报）──────────────
  if (publicKey && publicKey !== license.exec_public_key) {
    db.run("UPDATE licenses SET exec_public_key=? WHERE id=?", [
      publicKey,
      license.id,
    ]);
  }
  // ─── Token 缓存逻辑 ───────────────────────────────────────────────
  const now = new Date();
  let authToken: string;

  const tokenStillValid =
    license.auth_token && license.token_expires_at && new Date(license.token_expires_at) > now;

  if (tokenStillValid) {
    // 未过期：直接复用，同步写入 json（确保实例 config 始终最新）
    authToken = license.auth_token!;
    await syncTokenToConfig(license.data_dir, license.compose_project, authToken);
  } else {
    // 已过期或首次：生成新 token
    authToken = randomBytes(32).toString("hex");
    const ttlDays = license.token_ttl_days ?? 30;
    const expiresAt = new Date(now.getTime() + ttlDays * 24 * 60 * 60 * 1000).toISOString();

    // 先写文件，再更新 DB（写文件失败不影响 DB 记录）
    await syncTokenToConfig(license.data_dir, license.compose_project, authToken);

    db.run("UPDATE licenses SET auth_token=?, token_expires_at=? WHERE id=?", [
      authToken,
      expiresAt,
      license.id,
    ]);
  }
  // ─────────────────────────────────────────────────────────────────

  // 双时机触发：verify 成功时补写 Gateway pairing 文件
  // （另一时机在 provision 完成时触发，互为补充，哪个先完成哪个生效）
  writePairingIfReady(license.id).catch(() => {
    // best-effort，不影响 verify 结果
  });

  return c.json({
    success: true,
    data: {
      nodeConfig: {
        gatewayUrl: license.gateway_url,
        gatewayToken: license.gateway_token,
        agentId,
        deviceName,
        authToken,
      },
      userProfile: {
        licenseStatus: "Valid",
        expiryDate: license.expiry_date ?? "Permanent",
      },
    },
  });
});

export default verify;
