export function buildDockerArgs(): string[] | null {
  const cmd = process.env.DOCKER_APPROVE_CMD;
  if (!cmd) return null;
  return cmd.split(" ");
}

export function spawnDockerApprove(hwid: string, licenseKey: string): void {
  const args = buildDockerArgs();
  if (!args) return;

  Bun.spawn(args, {
    env: { ...process.env, APPROVE_HWID: hwid, APPROVE_LICENSE: licenseKey },
    stdout: "ignore",
    stderr: "ignore",
  });
}
