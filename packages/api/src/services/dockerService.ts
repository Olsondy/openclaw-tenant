export function buildDockerArgs(containerName?: string): string[] | null {
  const cmd = process.env.DOCKER_APPROVE_CMD;
  if (!cmd) return null;
  const resolved = containerName ? cmd.replace(/\{\{container\}\}/g, containerName) : cmd;
  return resolved.trim().split(/\s+/);
}

export function spawnDockerApprove(hwid: string, licenseKey: string, containerName?: string): void {
  const args = buildDockerArgs(containerName);
  if (!args) return;

  Bun.spawn(args, {
    env: {
      ...process.env,
      APPROVE_HWID: hwid,
      APPROVE_LICENSE: licenseKey,
    },
    stdout: "ignore",
    stderr: "ignore",
  });
}
