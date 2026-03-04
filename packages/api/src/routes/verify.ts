import { Hono } from "hono";
import { getDb } from "../db/client";
import { generateAgentId, isExpired } from "../services/licenseService";
import { spawnDockerApprove } from "../services/dockerService";

interface VerifyBody {
  hwid: string;
  licenseKey: string;
  deviceName: string;
}

interface LicenseRow {
  id: number;
  hwid: string | null;
  agent_id: string | null;
  gateway_token: string;
  gateway_url: string;
  status: string;
  expiry_date: string | null;
}

const verify = new Hono();

verify.post("/", async (c) => {
  let body: Partial<VerifyBody>;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ success: false, error: "INVALID_JSON" }, 400);
  }
  const { hwid, licenseKey, deviceName } = body;

  if (!hwid || !licenseKey || !deviceName) {
    return c.json({ success: false, error: "MISSING_FIELDS" }, 400);
  }

  const db = getDb();
  const license = db
    .query<LicenseRow, string>("SELECT * FROM licenses WHERE license_key = ?")
    .get(licenseKey);

  if (!license) return c.json({ success: false, error: "INVALID_LICENSE" }, 403);
  if (license.status === "revoked") return c.json({ success: false, error: "LICENSE_REVOKED" }, 403);
  if (isExpired(license.expiry_date)) return c.json({ success: false, error: "LICENSE_EXPIRED" }, 403);

  let agentId: string;

  if (license.status === "unbound") {
    agentId = generateAgentId(hwid);
    db.run(
      `UPDATE licenses
       SET hwid = ?, device_name = ?, agent_id = ?, status = 'active', bound_at = datetime('now')
       WHERE license_key = ?`,
      [hwid, deviceName, agentId, licenseKey]
    );
  } else {
    if (license.hwid !== hwid) return c.json({ success: false, error: "HWID_MISMATCH" }, 403);
    agentId = license.agent_id!;
  }

  spawnDockerApprove(hwid, licenseKey);

  return c.json({
    success: true,
    data: {
      nodeConfig: {
        gatewayUrl: license.gateway_url,
        gatewayToken: license.gateway_token,
        agentId,
        deviceName,
      },
      userProfile: {
        licenseStatus: "Valid",
        expiryDate: license.expiry_date ?? "Permanent",
      },
    },
  });
});

export default verify;
