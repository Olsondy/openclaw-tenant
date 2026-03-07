import { createHash } from "crypto";
import { mkdir, readFile, writeFile } from "fs/promises";
import { join } from "path";
import { getDb } from "../../db/client";
import { buildConfigDir } from "./nameBuilder";

// ─── deviceId 推导（与 openclaw/src/infra/device-identity.ts 保持一致）────────
// ed25519 SPKI 前缀（DER 格式中公钥原始字节前的固定头）
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

function base64UrlDecode(input: string): Buffer {
  const normalized = input.replaceAll("-", "+").replaceAll("_", "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  return Buffer.from(padded, "base64");
}

/**
 * 从 base64url 编码的 ed25519 公钥推导出 deviceId。
 * 算法：SHA-256(原始公钥 32 字节).hex()
 * 与 openclaw 源码 deriveDeviceIdFromPublicKey 保持一致。
 */
export function deriveDeviceId(publicKeyBase64Url: string): string | null {
  try {
    const raw = base64UrlDecode(publicKeyBase64Url);
    // 若传入的是完整 SPKI DER（44 字节），剥离前缀后取原始 32 字节
    const keyBytes =
      raw.length === ED25519_SPKI_PREFIX.length + 32 &&
      raw.subarray(0, ED25519_SPKI_PREFIX.length).equals(ED25519_SPKI_PREFIX)
        ? raw.subarray(ED25519_SPKI_PREFIX.length)
        : raw;
    // ed25519 原始公钥必须为 32 字节，否则视为无效输入
    if (keyBytes.length !== 32) return null;
    return createHash("sha256").update(keyBytes).digest("hex");
  } catch {
    return null;
  }
}

// ─── PairedDevice 格式（与 openclaw device-pairing.ts 结构一致）──────────────
interface DeviceAuthToken {
  token: string;
  role: string;
  scopes: string[];
  createdAtMs: number;
}

interface PairedDevice {
  deviceId: string;
  publicKey: string;
  role?: string;
  roles?: string[];
  scopes?: string[];
  approvedScopes?: string[];
  tokens?: Record<string, DeviceAuthToken>;
  createdAtMs: number;
  approvedAtMs: number;
}

type PairedJsonFile = Record<string, PairedDevice>;

/**
 * 将 exec 设备预写入 Gateway 的 devices/paired.json。
 * 相当于"代替管理员执行 approve"，使 exec 首次连接时无需手动 pairing。
 *
 * @param configDir  对应 openclaw 实例的 config 目录（非 data 目录）
 * @param deviceId   SHA-256(publicKey raw bytes).hex()
 * @param publicKey  base64url 编码的 ed25519 公钥（Gateway 验签时使用）
 */
export async function writePairedJson(
  configDir: string,
  deviceId: string,
  publicKey: string,
): Promise<void> {
  const devicesDir = join(configDir, "devices");
  const pairedPath = join(devicesDir, "paired.json");

  await mkdir(devicesDir, { recursive: true });

  // 读取现有文件（若已有其他设备记录，保持不覆盖）
  let existing: PairedJsonFile = {};
  try {
    const raw = await readFile(pairedPath, "utf8");
    existing = JSON.parse(raw) as PairedJsonFile;
  } catch {
    // 文件不存在或解析失败，视为空对象
  }

  // 若 deviceId 已存在则幂等跳过，避免覆盖 Gateway 运行时写入的 token
  if (existing[deviceId]) {
    return;
  }

  const now = Date.now();
  const entry: PairedDevice = {
    deviceId,
    publicKey,
    role: "node",
    roles: ["node"],
    scopes: [],
    approvedScopes: [],
    createdAtMs: now,
    approvedAtMs: now,
  };

  existing[deviceId] = entry;
  await writeFile(pairedPath, JSON.stringify(existing, null, 2) + "\n", {
    mode: 0o600,
  });
}

/**
 * 查询 license，满足条件时自动写入 pairing 文件：
 *  - exec_public_key IS NOT NULL（exec 已激活并上报公钥）
 *  - provision_status = 'ready'（Docker 容器已启动完成）
 *
 * 任意一个条件不满足则 no-op，等待另一时机（provision 完成 or verify 成功）再触发。
 */
export async function writePairingIfReady(licenseId: number): Promise<void> {
  const db = getDb();
  const row = db
    .query<
      {
        exec_public_key: string | null;
        provision_status: string | null;
        compose_project: string | null;
        data_dir: string | null;
      },
      number
    >(
      "SELECT exec_public_key, provision_status, compose_project, data_dir FROM licenses WHERE id = ?",
    )
    .get(licenseId);

  if (!row) return;
  if (!row.exec_public_key) return;
  if (row.provision_status !== "ready") return;
  if (!row.compose_project) return;
  if (!row.data_dir) return;

  const deviceId = deriveDeviceId(row.exec_public_key);
  if (!deviceId) return;

  const configDir = buildConfigDir(row.data_dir, row.compose_project);
  await writePairedJson(configDir, deviceId, row.exec_public_key);
}
