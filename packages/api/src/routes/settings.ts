import { Hono } from "hono";
import { getDb } from "../db/client";
import { getSettingsRow, isRuntimeProvider } from "../services/settingsService";

interface SettingsBody {
  runtime_provider: string;
  runtime_dir: string;
  data_dir: string;
  host_ip: string;
  base_domain?: string | null;
  gateway_port_start: number;
  gateway_port_end: number;
  bridge_port_start: number;
  bridge_port_end: number;
}

function isValidPort(n: number): boolean {
  return Number.isInteger(n) && n > 0 && n <= 65535;
}

const settings = new Hono();

settings.get("/", (c) => {
  const db = getDb();
  const row = getSettingsRow(db);
  return c.json({ success: true, data: row });
});

settings.put("/", async (c) => {
  let body: Partial<SettingsBody>;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ success: false, error: "INVALID_JSON" }, 400);
  }

  if (!body.runtime_provider || !isRuntimeProvider(body.runtime_provider)) {
    return c.json({ success: false, error: "INVALID_RUNTIME_PROVIDER" }, 400);
  }

  const runtimeDir = body.runtime_dir?.trim();
  const dataDir = body.data_dir?.trim();
  const hostIp = body.host_ip?.trim();
  if (!runtimeDir || !dataDir || !hostIp) {
    return c.json({ success: false, error: "INVALID_SETTINGS" }, 400);
  }

  const gatewayPortStart = Number(body.gateway_port_start);
  const gatewayPortEnd = Number(body.gateway_port_end);
  const bridgePortStart = Number(body.bridge_port_start);
  const bridgePortEnd = Number(body.bridge_port_end);

  if (
    !isValidPort(gatewayPortStart) ||
    !isValidPort(gatewayPortEnd) ||
    !isValidPort(bridgePortStart) ||
    !isValidPort(bridgePortEnd) ||
    gatewayPortStart > gatewayPortEnd ||
    bridgePortStart > bridgePortEnd
  ) {
    return c.json({ success: false, error: "INVALID_PORT_RANGE" }, 400);
  }

  const baseDomain = body.base_domain?.trim() || null;
  const db = getDb();
  db.run(
    `UPDATE settings SET
       runtime_provider=?,
       runtime_dir=?,
       data_dir=?,
       host_ip=?,
       base_domain=?,
       gateway_port_start=?,
       gateway_port_end=?,
       bridge_port_start=?,
       bridge_port_end=?,
       updated_at=datetime('now')
     WHERE id=1`,
    [
      body.runtime_provider,
      runtimeDir,
      dataDir,
      hostIp,
      baseDomain,
      gatewayPortStart,
      gatewayPortEnd,
      bridgePortStart,
      bridgePortEnd,
    ],
  );

  return c.json({ success: true, data: getSettingsRow(db) });
});

export default settings;

