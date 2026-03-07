import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { getDb, resetDb } from "../../db/client";
import { deriveDeviceId, writePairedJson, writePairingIfReady } from "./pairingWriter";

// ─── 辅助函数 ──────────────────────────────────────────────────────────────────

/** 已知输入 → 已知 deviceId，用于验证算法一致性 */
const KNOWN_PUBLIC_KEY_BASE64URL =
  // ed25519 原始公钥 32 字节，以 base64url 编码
  "MCowBQYDK2VdAyEA";
// 注：此处使用一个固定测试密钥，在实际断言中以动态生成替代

const TEST_DIR = join(tmpdir(), `pairingWriter-test-${Date.now()}`);

function seedLicense(
  db: ReturnType<typeof getDb>,
  opts: {
    provisionStatus?: string;
    execPublicKey?: string | null;
    composeProject?: string;
    dataDir?: string;
  } = {},
) {
  const {
    provisionStatus = "ready",
    execPublicKey = "dGVzdHB1YmxpY2tleXJhdw",
    composeProject = "openclaw-test-1",
    dataDir = TEST_DIR,
  } = opts;
  db.run(
    `INSERT INTO licenses
       (license_key, gateway_token, gateway_url, status, provision_status, exec_public_key, compose_project, data_dir)
     VALUES ('TEST-KEY-001', 'tok', 'ws://gw:18789', 'unbound', ?, ?, ?, ?)`,
    [provisionStatus, execPublicKey, composeProject, dataDir],
  );
  const row = db
    .query<{ id: number }, string>("SELECT id FROM licenses WHERE license_key = ?")
    .get("TEST-KEY-001")!;
  return { id: row.id, composeProject };
}

// ─── 测试 ──────────────────────────────────────────────────────────────────────

beforeEach(() => {
  resetDb();
  process.env.DB_PATH = ":memory:";
  process.env.ADMIN_USER = "admin";
  process.env.ADMIN_PASS = "x";
  process.env.OPENCLAW_DATA_DIR = "/wrong/openclaw/data-dir";
  mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
  try {
    rmSync(TEST_DIR, { recursive: true, force: true });
  } catch {
    // best-effort cleanup
  }
});

describe("deriveDeviceId", () => {
  test("对相同公钥返回相同 deviceId（幂等）", () => {
    const pubkey = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"; // 32 字节 base64url
    const id1 = deriveDeviceId(pubkey);
    const id2 = deriveDeviceId(pubkey);
    expect(id1).toBe(id2);
  });

  test("返回 64 字节 hex 字符串（SHA-256 输出）", () => {
    const pubkey = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
    const id = deriveDeviceId(pubkey);
    expect(id).not.toBeNull();
    expect(id).toMatch(/^[0-9a-f]{64}$/);
  });

  test("对不同公钥返回不同 deviceId", () => {
    const id1 = deriveDeviceId("AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA");
    const id2 = deriveDeviceId("BAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA");
    expect(id1).not.toBe(id2);
  });

  test("无效输入返回 null", () => {
    expect(deriveDeviceId("!@#$")).toBeNull();
  });
});

describe("writePairedJson", () => {
  test("写入正确格式的 paired.json", async () => {
    const configDir = join(TEST_DIR, "1");
    const deviceId = "a".repeat(64);
    const publicKey = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

    await writePairedJson(configDir, deviceId, publicKey);

    const pairedPath = join(configDir, "devices", "paired.json");
    expect(existsSync(pairedPath)).toBe(true);

    const parsed = JSON.parse(readFileSync(pairedPath, "utf8"));
    expect(parsed[deviceId]).toBeDefined();
    expect(parsed[deviceId].deviceId).toBe(deviceId);
    expect(parsed[deviceId].publicKey).toBe(publicKey);
    expect(parsed[deviceId].role).toBe("node");
    expect(parsed[deviceId].createdAtMs).toBeGreaterThan(0);
  });

  test("已存在相同 deviceId 时幂等跳过（不覆盖）", async () => {
    const configDir = join(TEST_DIR, "2");
    const deviceId = "b".repeat(64);
    const publicKey = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

    await writePairedJson(configDir, deviceId, publicKey);
    const before = JSON.parse(readFileSync(join(configDir, "devices", "paired.json"), "utf8"));
    const ts = before[deviceId].createdAtMs;

    await new Promise((r) => setTimeout(r, 10));
    await writePairedJson(configDir, deviceId, publicKey);
    const after = JSON.parse(readFileSync(join(configDir, "devices", "paired.json"), "utf8"));

    // 时间戳应保持不变（幂等）
    expect(after[deviceId].createdAtMs).toBe(ts);
  });
});

describe("writePairingIfReady", () => {
  test("exec_public_key 为空时 no-op（不创建文件）", async () => {
    const db = getDb();
    const { id, composeProject } = seedLicense(db, { execPublicKey: null });

    await writePairingIfReady(id);

    const pairedPath = join(TEST_DIR, composeProject, ".openclaw", "devices", "paired.json");
    expect(existsSync(pairedPath)).toBe(false);
  });

  test("provision_status 非 ready 时 no-op", async () => {
    const db = getDb();
    const { id, composeProject } = seedLicense(db, { provisionStatus: "pending" });

    await writePairingIfReady(id);

    const pairedPath = join(TEST_DIR, composeProject, ".openclaw", "devices", "paired.json");
    expect(existsSync(pairedPath)).toBe(false);
  });

  test("满足条件时写出 paired.json", async () => {
    const db = getDb();
    const { id, composeProject } = seedLicense(db, {
      provisionStatus: "ready",
      execPublicKey: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      composeProject: "openclaw-acme-1",
    });

    await writePairingIfReady(id);

    const pairedPath = join(TEST_DIR, composeProject, ".openclaw", "devices", "paired.json");
    expect(existsSync(pairedPath)).toBe(true);

    const parsed = JSON.parse(readFileSync(pairedPath, "utf8"));
    const entries = Object.values(parsed) as Array<{ role: string; publicKey: string }>;
    expect(entries.length).toBe(1);
    expect(entries[0].role).toBe("node");
    expect(entries[0].publicKey).toBe("AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA");
  });

  test("license 不存在时 no-op", async () => {
    await writePairingIfReady(9999);
    // 不应抛出异常
    expect(true).toBe(true);
  });
});
