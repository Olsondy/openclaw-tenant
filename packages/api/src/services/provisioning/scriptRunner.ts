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

export async function runProvisionScript(opts: ScriptRunnerOptions): Promise<void> {
  const proc = Bun.spawn(["bash", opts.provisionScript], {
    cwd: opts.runtimeDir,
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
    stdout: "pipe",
    stderr: "pipe",
  });

  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text();
    throw new Error(`Provision script exited ${exitCode}: ${stderr.slice(0, 500)}`);
  }
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
