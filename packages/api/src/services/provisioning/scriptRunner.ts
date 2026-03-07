import { execSync, spawn as nodeSpawn } from "child_process";
import { existsSync } from "fs";
import { type RuntimeProvider, resolveRuntimeCommand } from "../settingsService";

export interface ScriptRunnerOptions {
  runtimeDir: string;
  configDir: string;
  workspaceDir: string;
  composeProject: string;
  gatewayPort: number;
  bridgePort: number;
  gatewayToken: string;
  provisionScript: string;
}

type BashPathMode = "native" | "wsl";
let cachedWindowsBashMode: BashPathMode | null = null;

/**
 * MSYS2 (Git Bash) 环境下 process.env 中的路径可能是 POSIX 格式（/d/foo），
 * 需要转换为 Windows 格式（D:\foo）供 libuv 使用。
 */
function toWindowsPath(p: string): string {
  if (process.platform !== "win32") return p;
  // 已经是 Windows 路径（含盘符或反斜杠）
  if (/^[A-Za-z]:/.test(p) || p.includes("\\")) return p;
  // 常见 MSYS2 风格路径：/d/foo/bar -> D:\foo\bar
  const msysPath = p.match(/^\/([A-Za-z])\/(.*)$/);
  if (msysPath) {
    return `${msysPath[1].toUpperCase()}:\\${msysPath[2].replace(/\//g, "\\")}`;
  }
  try {
    return execSync(`cygpath -w "${p}"`, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return p;
  }
}

function toBashPath(p: string, mode: BashPathMode): string {
  if (process.platform !== "win32") return p;
  const win = toWindowsPath(p).replace(/\\/g, "/");
  if (mode !== "wsl") return win;
  const drivePath = win.match(/^([A-Za-z]):\/(.*)$/);
  if (!drivePath) return win;
  return `/mnt/${drivePath[1].toLowerCase()}/${drivePath[2]}`;
}

function detectWindowsBashMode(): BashPathMode {
  if (process.platform !== "win32") return "native";
  if (cachedWindowsBashMode) return cachedWindowsBashMode;

  try {
    const uname = execSync('bash -lc "uname -s"', {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    })
      .trim()
      .toLowerCase();
    cachedWindowsBashMode = uname.includes("linux") ? "wsl" : "native";
  } catch {
    cachedWindowsBashMode = "native";
  }
  return cachedWindowsBashMode;
}

export function runProvisionScript(opts: ScriptRunnerOptions): Promise<void> {
  const cwd = toWindowsPath(opts.runtimeDir);
  const script = toWindowsPath(opts.provisionScript);

  if (!existsSync(cwd)) {
    return Promise.reject(new Error(`runtimeDir does not exist: ${cwd}`));
  }
  if (!existsSync(script)) {
    return Promise.reject(new Error(`provisionScript does not exist: ${script}`));
  }

  console.log(`[scriptRunner] cwd=${cwd} script=${script}`);

  const runWithMode = (mode: BashPathMode): Promise<void> =>
    new Promise((resolve, reject) => {
      const child = nodeSpawn("bash", [toBashPath(script, mode)], {
        cwd,
        shell: false,
        env: {
          ...process.env,
          COMPOSE_PROJECT_NAME: opts.composeProject,
          OPENCLAW_CONFIG_DIR: toBashPath(opts.configDir, mode),
          OPENCLAW_WORKSPACE_DIR: toBashPath(opts.workspaceDir, mode),
          OPENCLAW_GATEWAY_PORT: String(opts.gatewayPort),
          OPENCLAW_BRIDGE_PORT: String(opts.bridgePort),
          OPENCLAW_GATEWAY_BIND: "lan",
          OPENCLAW_GATEWAY_TOKEN: opts.gatewayToken,
        },
        stdio: ["ignore", "pipe", "pipe"],
      });

      let stderr = "";
      child.stdout!.on("data", (chunk: Buffer) => {
        process.stdout.write(chunk);
      });
      child.stderr!.on("data", (chunk: Buffer) => {
        const text = chunk.toString();
        stderr += text;
        process.stderr.write(chunk);
      });
      child.on("error", (err) => reject(err));
      child.on("close", (code) => {
        if (code !== 0) {
          reject(new Error(`Provision script exited ${code}: ${stderr.slice(0, 500)}`));
        } else {
          resolve();
        }
      });
    });

  const primaryMode = detectWindowsBashMode();
  const fallbackMode: BashPathMode = primaryMode === "native" ? "wsl" : "native";

  return runWithMode(primaryMode).catch((err) => {
    const msg = err instanceof Error ? err.message : String(err);
    if (
      process.platform === "win32" &&
      msg.includes("Provision script exited 127") &&
      msg.includes("No such file or directory")
    ) {
      return runWithMode(fallbackMode);
    }
    throw err;
  });
}

export async function getContainerId(
  composeProject: string,
  runtimeProvider: RuntimeProvider,
): Promise<string> {
  const runtimeCmd = resolveRuntimeCommand(runtimeProvider);
  const proc = Bun.spawn(
    [runtimeCmd, "compose", "-p", composeProject, "ps", "-q", "openclaw-gateway"],
    { stdout: "pipe", stderr: "pipe" },
  );
  const exitCode = await proc.exited;
  if (exitCode !== 0) throw new Error(`${runtimeCmd} compose ps failed`);
  const id = (await new Response(proc.stdout).text()).trim();
  if (!id) throw new Error("Container not found after provisioning");
  return id;
}

export async function getContainerName(
  containerId: string,
  runtimeProvider: RuntimeProvider,
): Promise<string> {
  const runtimeCmd = resolveRuntimeCommand(runtimeProvider);
  const proc = Bun.spawn([runtimeCmd, "inspect", "--format", "{{.Name}}", containerId], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const exitCode = await proc.exited;
  if (exitCode !== 0) throw new Error(`${runtimeCmd} inspect failed`);
  return (await new Response(proc.stdout).text()).trim().replace(/^\//, "");
}
