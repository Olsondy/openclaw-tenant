import { readFile, writeFile } from "fs/promises";
import { Hono } from "hono";
import { join } from "path";
import { getDb } from "../db/client";
import { buildConfigDir } from "../services/provisioning/nameBuilder";

const router = new Hono();

router.post("/:id/bootstrap-config", async (c) => {
  const id = Number(c.req.param("id"));
  if (Number.isNaN(id)) return c.json({ success: false, error: "INVALID_ID" }, 400);

  let body: { licenseKey?: string; hwid?: string; feishu?: { appId?: string; appSecret?: string } };
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

  const applied: string[] = [];

  if (body.feishu) {
    const { appId, appSecret } = body.feishu;
    if (!appId?.trim() || !appSecret?.trim()) {
      return c.json({ success: false, error: "FEISHU_FIELDS_REQUIRED" }, 400);
    }

    const configDir = buildConfigDir(license.data_dir, license.compose_project);
    const configPath = join(configDir, "openclaw.json");

    let cfg: Record<string, unknown>;
    try {
      cfg = JSON.parse(await readFile(configPath, "utf8"));
    } catch {
      return c.json({ success: false, error: "CONFIG_NOT_FOUND" }, 500);
    }

    // 白名单写入：只允许 channels.feishu.{appId,appSecret}
    if (!cfg.channels || typeof cfg.channels !== "object") cfg.channels = {};
    const channels = cfg.channels as Record<string, unknown>;
    channels.feishu = {
      ...(typeof channels.feishu === "object" && channels.feishu !== null ? channels.feishu : {}),
      appId: appId.trim(),
      appSecret: appSecret.trim(),
    };

    await writeFile(configPath, JSON.stringify(cfg, null, 2));

    db.run("UPDATE licenses SET wizard_feishu_done=1 WHERE id=?", [id]);
    applied.push("feishu");
  }

  return c.json({ success: true, data: { applied } });
});

export default router;
