import { mkdir, readFile, writeFile } from "fs/promises";
import { join } from "path";
import { type RuntimeProvider, resolveRuntimeCommand } from "../settingsService";

export interface ModelAuthPayload {
  providerId: string;
  providerLabel: string;
  baseUrl: string;
  api: string;
  modelId: string;
  modelName: string;
  apiKey: string;
}

export interface ApplyModelConfigOptions {
  configDir: string;
  containerName: string;
  runtimeProvider: RuntimeProvider;
  modelAuth: ModelAuthPayload;
}

type JsonObject = Record<string, unknown>;

function normalizeBaseUrl(raw: string): string {
  return raw.trim().replace(/\/+$/, "");
}

function normalizeModelAuth(input: ModelAuthPayload): ModelAuthPayload {
  return {
    providerId: input.providerId.trim(),
    providerLabel: input.providerLabel.trim(),
    baseUrl: normalizeBaseUrl(input.baseUrl),
    api: input.api.trim(),
    modelId: input.modelId.trim(),
    modelName: input.modelName.trim(),
    apiKey: input.apiKey.trim(),
  };
}

function assertModelAuth(input: ModelAuthPayload): void {
  if (!input.providerId) throw new Error("MODEL_PROVIDER_REQUIRED");
  if (!input.providerLabel) throw new Error("MODEL_PROVIDER_LABEL_REQUIRED");
  if (!input.baseUrl) throw new Error("MODEL_BASE_URL_REQUIRED");
  if (!input.api) throw new Error("MODEL_API_REQUIRED");
  if (!input.modelId) throw new Error("MODEL_ID_REQUIRED");
  if (!input.modelName) throw new Error("MODEL_NAME_REQUIRED");
  if (!input.apiKey) throw new Error("MODEL_API_KEY_REQUIRED");
}

async function loadJson<T extends JsonObject>(filePath: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as T;
  } catch {
    return fallback;
  }
}

async function writeJson(filePath: string, data: JsonObject): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function ensureObject(parent: Record<string, unknown>, key: string): Record<string, unknown> {
  const current = parent[key];
  if (typeof current === "object" && current !== null && !Array.isArray(current)) {
    return current as Record<string, unknown>;
  }
  const next: Record<string, unknown> = {};
  parent[key] = next;
  return next;
}

function asObject(value: unknown): Record<string, unknown> {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function mergeProviderModel(providers: Record<string, unknown>, payload: ModelAuthPayload): void {
  const provider = asObject(providers[payload.providerId]);
  provider.baseUrl = payload.baseUrl;
  provider.api = payload.api;
  provider.apiKey = payload.apiKey;
  provider.label = payload.providerLabel;

  const oldModels = Array.isArray(provider.models) ? provider.models : [];
  const nextModels: Array<Record<string, unknown>> = [];
  let replaced = false;
  for (const raw of oldModels) {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) continue;
    const model = { ...(raw as Record<string, unknown>) };
    if (String(model.id ?? "") === payload.modelId) {
      nextModels.push({
        ...model,
        id: payload.modelId,
        name: payload.modelName,
      });
      replaced = true;
    } else {
      nextModels.push(model);
    }
  }
  if (!replaced) {
    nextModels.push({
      id: payload.modelId,
      name: payload.modelName,
    });
  }
  provider.models = nextModels;
  providers[payload.providerId] = provider;
}

async function writeModelsJson(configDir: string, payload: ModelAuthPayload): Promise<void> {
  const agentDir = join(configDir, "agents", "main", "agent");
  const modelsPath = join(agentDir, "models.json");
  const doc = await loadJson<JsonObject>(modelsPath, { mode: "merge", providers: {} });

  doc.mode = "merge";
  const providers = ensureObject(doc, "providers");
  mergeProviderModel(providers, payload);

  await writeJson(modelsPath, doc);
}

async function writeAuthProfilesJson(configDir: string, payload: ModelAuthPayload): Promise<void> {
  const agentDir = join(configDir, "agents", "main", "agent");
  const authPath = join(agentDir, "auth-profiles.json");
  const doc = await loadJson<JsonObject>(authPath, {});

  doc[`${payload.providerId}:default`] = {
    provider: payload.providerId,
    label: payload.providerLabel,
    mode: "api_key",
    apiKey: payload.apiKey,
  };

  await writeJson(authPath, doc);
}

async function writeOpenclawJson(configDir: string, payload: ModelAuthPayload): Promise<void> {
  const openclawPath = join(configDir, "openclaw.json");
  const doc = await loadJson<JsonObject>(openclawPath, {});

  const auth = ensureObject(doc, "auth");
  const profiles = ensureObject(auth, "profiles");
  profiles[`${payload.providerId}:default`] = {
    provider: payload.providerId,
    label: payload.providerLabel,
    mode: "api_key",
    apiKey: payload.apiKey,
  };

  const models = ensureObject(doc, "models");
  models.mode = "merge";
  const providers = ensureObject(models, "providers");
  mergeProviderModel(providers, payload);

  const agents = ensureObject(doc, "agents");
  const defaults = ensureObject(agents, "defaults");
  const model = ensureObject(defaults, "model");
  model.primary = `${payload.providerId}/${payload.modelId}`;

  await writeJson(openclawPath, doc);
}

async function fixAgentDirOwnership(
  containerName: string,
  runtimeProvider: RuntimeProvider,
): Promise<void> {
  const runtimeCmd = resolveRuntimeCommand(runtimeProvider);
  const proc = Bun.spawn(
    [
      runtimeCmd,
      "exec",
      "--user",
      "root",
      containerName,
      "chown",
      "-R",
      "node:node",
      "/home/node/.openclaw/agents/main/agent",
    ],
    { stdout: "pipe", stderr: "pipe" },
  );
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text();
    throw new Error(`MODEL_CHOWN_FAILED: ${stderr.slice(0, 300)}`);
  }
}

async function restartContainer(
  containerName: string,
  runtimeProvider: RuntimeProvider,
): Promise<void> {
  const runtimeCmd = resolveRuntimeCommand(runtimeProvider);
  const proc = Bun.spawn([runtimeCmd, "restart", containerName], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text();
    throw new Error(`CONTAINER_RESTART_FAILED: ${stderr.slice(0, 300)}`);
  }
}

export async function applyModelConfigAndRestart(opts: ApplyModelConfigOptions): Promise<void> {
  const payload = normalizeModelAuth(opts.modelAuth);
  assertModelAuth(payload);

  const agentDir = join(opts.configDir, "agents", "main", "agent");
  await mkdir(agentDir, { recursive: true });

  await writeOpenclawJson(opts.configDir, payload);
  await writeAuthProfilesJson(opts.configDir, payload);
  await writeModelsJson(opts.configDir, payload);
  await fixAgentDirOwnership(opts.containerName, opts.runtimeProvider);
  await restartContainer(opts.containerName, opts.runtimeProvider);
}
