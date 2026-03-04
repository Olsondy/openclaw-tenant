export interface OpenclawConfig {
  token: string;
  gatewayUrl: string;
}

export async function readOpenclawConfig(): Promise<OpenclawConfig> {
  const configPath = process.env.OPENCLAW_CONFIG_PATH;
  if (!configPath) {
    throw new Error("OPENCLAW_CONFIG_PATH environment variable is not set");
  }

  const file = Bun.file(configPath);
  const exists = await file.exists();
  if (!exists) {
    throw new Error(`openclaw.json not found at: ${configPath}`);
  }

  const data = await file.json();

  if (!data.token || !data.gatewayUrl) {
    throw new Error("openclaw.json must contain 'token' and 'gatewayUrl' fields");
  }

  return { token: data.token as string, gatewayUrl: data.gatewayUrl as string };
}
