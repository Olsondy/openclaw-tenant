import type { Database } from "bun:sqlite";
import { existsSync } from "fs";
import { join } from "path";

export type RuntimeProvider = "docker" | "podman";

/**
 * 通过检测 socket 文件自动识别当前宿主机的容器运行时。
 * 优先判断 Podman（rootless → root），找不到则回退 Docker。
 * 不执行任何子进程，纯文件系统检测，无副作用。
 */
export function detectRuntimeProvider(): RuntimeProvider {
  // rootless podman：socket 在当前用户的 XDG_RUNTIME_DIR 下
  const uid = typeof process.getuid === "function" ? process.getuid() : null;
  if (uid !== null && existsSync(`/run/user/${uid}/podman/podman.sock`)) return "podman";
  // root podman 或 system-wide podman
  if (existsSync("/run/podman/podman.sock")) return "podman";
  // podman machine（macOS/Windows WSL 场景）
  if (existsSync("/var/run/podman/podman.sock")) return "podman";
  // 默认回退 Docker
  return "docker";
}

export interface SettingsRow {
  id: number;
  runtime_provider: RuntimeProvider;
  runtime_dir: string;
  data_dir: string;
  host_ip: string;
  base_domain: string | null;
  gateway_port_start: number;
  gateway_port_end: number;
  bridge_port_start: number;
  bridge_port_end: number;
  updated_at: string;
}

function parsePort(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  if (!Number.isInteger(n) || n <= 0 || n > 65535) return fallback;
  return n;
}

export function resolveDefaultSettingsFromEnv(env: NodeJS.ProcessEnv = process.env) {
  return {
    runtime_provider:
      // env 显式指定优先，否则自动检测
      (env.OPENCLAW_RUNTIME_PROVIDER === "podman" || env.OPENCLAW_RUNTIME_PROVIDER === "docker")
        ? (env.OPENCLAW_RUNTIME_PROVIDER as RuntimeProvider)
        : detectRuntimeProvider(),
    runtime_dir: (env.OPENCLAW_RUNTIME_DIR ?? "/opt/openclaw").trim() || "/opt/openclaw",
    data_dir: (env.OPENCLAW_DATA_DIR ?? "/data/openclaw").trim() || "/data/openclaw",
    host_ip: (env.OPENCLAW_HOST_IP ?? "127.0.0.1").trim() || "127.0.0.1",
    base_domain: env.OPENCLAW_BASE_DOMAIN?.trim() || null,
    gateway_port_start: parsePort(env.OPENCLAW_GATEWAY_PORT_START, 18789),
    gateway_port_end: parsePort(env.OPENCLAW_GATEWAY_PORT_END, 18999),
    bridge_port_start: parsePort(env.OPENCLAW_BRIDGE_PORT_START, 28789),
    bridge_port_end: parsePort(env.OPENCLAW_BRIDGE_PORT_END, 28999),
  };
}

export function ensureSettingsRow(db: Database): void {
  const existing = db.query("SELECT id FROM settings WHERE id = 1").get();
  if (existing) return;

  const defaults = resolveDefaultSettingsFromEnv();
  db.run(
    `INSERT INTO settings
       (id, runtime_provider, runtime_dir, data_dir, host_ip, base_domain,
        gateway_port_start, gateway_port_end, bridge_port_start, bridge_port_end, updated_at)
     VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
    [
      defaults.runtime_provider,
      defaults.runtime_dir,
      defaults.data_dir,
      defaults.host_ip,
      defaults.base_domain,
      defaults.gateway_port_start,
      defaults.gateway_port_end,
      defaults.bridge_port_start,
      defaults.bridge_port_end,
    ],
  );
}

export function getSettingsRow(db: Database): SettingsRow {
  ensureSettingsRow(db);
  return db
    .query<SettingsRow, number>("SELECT * FROM settings WHERE id = ?")
    .get(1) as SettingsRow;
}

export function isRuntimeProvider(value: string): value is RuntimeProvider {
  return value === "docker" || value === "podman";
}

export function resolveProvisionScriptPath(provider: RuntimeProvider, runtimeDir: string): string {
  const preferred = join(
    runtimeDir,
    provider === "docker" ? "provision-docker.sh" : "provision-podman.sh",
  );
  if (existsSync(preferred)) {
    return preferred;
  }

  // Backward compatibility: old Docker script name before rename.
  if (provider === "docker") {
    const legacyDocker = join(runtimeDir, "provision-instance.sh");
    if (existsSync(legacyDocker)) return legacyDocker;
  }

  return join(runtimeDir, provider === "docker" ? "docker-setup.sh" : "setup-podman.sh");
}

export function resolveRuntimeCommand(provider: RuntimeProvider): "docker" | "podman" {
  return provider === "podman" ? "podman" : "docker";
}
