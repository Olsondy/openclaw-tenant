import { mkdir } from "fs/promises";
import { join } from "path";

export function buildNginxConfig(host: string, gatewayPort: number): string {
  return `server {
    listen 80;
    server_name ${host};

    location / {
        proxy_pass http://127.0.0.1:${gatewayPort};
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
`;
}

export async function writeNginxConfig(
  siteDir: string,
  composeProject: string,
  host: string,
  gatewayPort: number,
  reloadCmd: string
): Promise<void> {
  await mkdir(siteDir, { recursive: true });
  const configPath = join(siteDir, `${composeProject}.conf`);
  await Bun.write(configPath, buildNginxConfig(host, gatewayPort));

  const testProc = Bun.spawn(["nginx", "-t"], { stdout: "pipe", stderr: "pipe" });
  const testExit = await testProc.exited;
  if (testExit !== 0) {
    const err = await new Response(testProc.stderr).text();
    throw new Error(`nginx -t failed: ${err.slice(0, 500)}`);
  }

  const reloadArgs = reloadCmd.trim().split(/\s+/);
  const reloadProc = Bun.spawn(reloadArgs, { stdout: "pipe", stderr: "pipe" });
  const reloadExit = await reloadProc.exited;
  if (reloadExit !== 0) throw new Error("nginx reload failed");
}
