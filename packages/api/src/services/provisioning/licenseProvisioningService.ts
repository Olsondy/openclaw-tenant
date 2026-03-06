import { readFile } from "fs/promises";
import { join } from "path";
import { getDb } from "../../db/client";
import { buildConfigDir, buildWorkspaceDir } from "./nameBuilder";
import { writeNginxConfig } from "./nginxService";
import { writePairingIfReady } from "./pairingWriter";
import { getContainerId, getContainerName, runProvisionScript } from "./scriptRunner";
import { resolveProvisionScriptPath, type RuntimeProvider } from "../settingsService";

const activeJobs = new Map<number, Promise<void>>();

export function enqueueLicenseProvisioning(licenseId: number): void {
  const job = runProvisioning(licenseId).catch((err) => {
    console.error(`[provision] license=${licenseId} fatal: ${err.message}`);
  });
  activeJobs.set(licenseId, job);
  job.finally(() => activeJobs.delete(licenseId));
}

export function resumePendingProvisioning(): void {
  const db = getDb();
  const stale = db
    .query<{ id: number }, []>(
      "SELECT id FROM licenses WHERE provision_status IN ('pending', 'running')",
    )
    .all();
  if (stale.length > 0) {
    console.log(`[provision] resuming ${stale.length} pending job(s)`);
    for (const { id } of stale) enqueueLicenseProvisioning(id);
  }
}

async function runProvisioning(licenseId: number): Promise<void> {
  const db = getDb();
  db.run(
    "UPDATE licenses SET provision_status='running', provision_started_at=datetime('now') WHERE id=?",
    [licenseId],
  );

  try {
    const license = db
      .query<
        {
          compose_project: string;
          gateway_port: number;
          bridge_port: number;
          gateway_token: string;
          owner_tag: string;
          gateway_url: string;
          webui_url: string | null;
          runtime_provider: string | null;
          runtime_dir: string | null;
          data_dir: string | null;
          nginx_host: string | null;
        },
        number
      >(
        `SELECT compose_project, gateway_port, bridge_port, gateway_token, owner_tag,
                gateway_url, webui_url, runtime_provider, runtime_dir, data_dir, nginx_host
           FROM licenses WHERE id=?`,
      )
      .get(licenseId);

    if (!license) throw new Error("License not found");

    const runtimeProvider: RuntimeProvider =
      license.runtime_provider === "podman" ? "podman" : "docker";
    const runtimeDir = license.runtime_dir ?? process.env.OPENCLAW_RUNTIME_DIR ?? null;
    const dataDir = license.data_dir ?? process.env.OPENCLAW_DATA_DIR ?? null;
    if (!runtimeDir || !dataDir) {
      throw new Error("License runtime configuration missing: runtime_dir/data_dir");
    }
    const provisionScript = resolveProvisionScriptPath(runtimeProvider, runtimeDir);
    const configDir = buildConfigDir(dataDir, license.compose_project);
    const workspaceDir = buildWorkspaceDir(dataDir, license.compose_project);

    await runProvisionScript({
      runtimeDir,
      configDir,
      workspaceDir,
      composeProject: license.compose_project,
      gatewayPort: license.gateway_port,
      bridgePort: license.bridge_port,
      gatewayToken: license.gateway_token,
      provisionScript,
    });

    const containerId = await getContainerId(license.compose_project, runtimeProvider);
    const containerName = await getContainerName(containerId, runtimeProvider);

    // 读取容器生成的 openclaw.json 校验 token
    let finalToken = license.gateway_token;
    try {
      const text = await readFile(join(configDir, "openclaw.json"), "utf8");
      const config = JSON.parse(text);
      const fileToken = config.gateway?.auth?.token ?? config.token ?? null;
      if (fileToken && fileToken !== license.gateway_token) {
        console.warn(`[provision] license=${licenseId} token overridden by config file`);
        finalToken = fileToken;
      }
    } catch {
      // 文件不存在或解析失败，保持生成的 token
    }

    // 可选 Nginx 域名模式
    let gatewayUrl = license.gateway_url;
    let webuiUrl = license.webui_url ?? "";
    const nginxHost = license.nginx_host;

    if (nginxHost) {
      const siteDir = process.env.NGINX_SITE_DIR ?? "/etc/nginx/conf.d/openclaw";
      const reloadCmd = process.env.NGINX_RELOAD_CMD ?? "nginx -s reload";
      await writeNginxConfig(
        siteDir,
        license.compose_project,
        nginxHost,
        license.gateway_port,
        reloadCmd,
      );
      gatewayUrl = `wss://${nginxHost}`;
      webuiUrl = `https://${nginxHost}`;
    }

    db.run(
      `UPDATE licenses SET
         provision_status='ready',
         provision_completed_at=datetime('now'),
         provision_error=NULL,
         container_id=?,
         container_name=?,
         gateway_token=?,
         gateway_url=?,
         webui_url=?,
         nginx_host=?
       WHERE id=?`,
      [containerId, containerName, finalToken, gatewayUrl, webuiUrl, nginxHost, licenseId],
    );

    console.log(
      `[provision] license=${licenseId} ready container=${containerName} url=${gatewayUrl}`,
    );

    // 双时机触发：provision 完成时尝试写入 Gateway pairing 文件
    // （若 exec 尚未 verify 上报 publicKey，函数内部检查后 no-op；等 verify 时再补写）
    writePairingIfReady(licenseId).catch((err) => {
      console.warn(`[provision] writePairingIfReady license=${licenseId} failed: ${err.message}`);
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    db.run(
      "UPDATE licenses SET provision_status='failed', provision_error=?, provision_completed_at=datetime('now') WHERE id=?",
      [msg.slice(0, 1000), licenseId],
    );
    throw err;
  }
}
