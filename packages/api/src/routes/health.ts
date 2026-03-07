import { Hono } from "hono";
import { getDb } from "../db/client.js";
import { jwtMiddleware } from "../middleware/jwt";
import { batchProbe } from "../services/healthProbe.js";

const router = new Hono();
// 页面接口：要求管理员 JWT 会话（防止 host_ip / gateway_port 信息泄露）
router.use("/*", jwtMiddleware);

/**
 * GET /api/licenses/health
 * Returns online status for all 'ready' licenses.
 * Response: { success: true, data: { [licenseId]: boolean } }
 */
router.get("/", async (c) => {
  const db = getDb();
  const rows = db
    .query<{ id: number; gateway_port: number; host_ip: string | null }, []>(
      `SELECT l.id, l.gateway_port, s.host_ip
       FROM licenses l
       LEFT JOIN settings s ON s.id = 1
       WHERE l.provision_status = 'ready'`,
    )
    .all();

  if (rows.length === 0) {
    return c.json({ success: true, data: {} });
  }

  const targets = rows
    .filter((r) => r.gateway_port && r.host_ip)
    .map((r) => ({
      id: r.id,
      host: r.host_ip!,
      port: r.gateway_port,
    }));

  const result = await batchProbe(targets);
  return c.json({ success: true, data: result });
});

export default router;
