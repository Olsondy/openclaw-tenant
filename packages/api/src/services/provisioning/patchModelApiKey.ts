import { readFile, writeFile } from "fs/promises";
import { join } from "path";
import { getDb } from "../../db/client";
import { decryptApiKey } from "../crypto";

export async function patchModelApiKey(configDir: string, secret: string): Promise<void> {
  const db = getDb();
  const presets = db
    .query<{ provider_id: string; api_key_enc: string | null }, []>(
      "SELECT provider_id, api_key_enc FROM model_presets WHERE enabled=1",
    )
    .all();

  const enabledWithKey = presets.filter((p) => p.api_key_enc !== null);
  if (enabledWithKey.length === 0) return;

  const configPath = join(configDir, "openclaw.json");
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(await readFile(configPath, "utf8"));
  } catch {
    return;
  }

  if (!data.models || typeof data.models !== "object") {
    data.models = {};
  }
  const models = data.models as Record<string, unknown>;
  if (!models.providers || typeof models.providers !== "object") {
    models.providers = {};
  }
  const providers = models.providers as Record<string, Record<string, unknown>>;

  for (const { provider_id, api_key_enc } of enabledWithKey) {
    let apiKey: string;
    try {
      apiKey = decryptApiKey(api_key_enc!, secret);
    } catch {
      console.error(`[patchModelApiKey] failed to decrypt apiKey for provider=${provider_id}`);
      continue;
    }
    if (!providers[provider_id]) {
      providers[provider_id] = {};
    }
    providers[provider_id] = { ...providers[provider_id], apiKey };
  }

  await writeFile(configPath, JSON.stringify(data, null, 2));
}
