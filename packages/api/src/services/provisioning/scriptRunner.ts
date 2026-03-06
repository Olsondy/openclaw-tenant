import { execSync, spawn as nodeSpawn } from "child_process";
import { existsSync } from "fs";
import { resolveRuntimeCommand, type RuntimeProvider } from "../settingsService";

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

/**
 * MSYS2 (Git Bash) 环境下 process.env 中的路径可能是 POSIX 格式（/d/foo），
 * 需要转换为 Windows 格式（D:\foo）供 libuv 使用。
 */
function toWindowsPath(p: string): string {
  if (process.platform !== "win32") return p;
  // 已经是 Windows 路径（含盘符或反斜杠）
  if (/^[A-Za-z]:/.test(p) || p.includes("\\")) return p;
  try {
    return execSync(`cygpath -w "${p}"`, { encoding: "utf8" }).trim();
  } catch {
    return p;
  }
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

  return new Promise((resolve, reject) => {
    const child = nodeSpawn("bash", [script], {
      cwd,
      shell: true,
      env: {
        ...process.env,
        COMPOSE_PROJECT_NAME: opts.composeProject,
        OPENCLAW_CONFIG_DIR: opts.configDir,
        OPENCLAW_WORKSPACE_DIR: opts.workspaceDir,
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
