# License Provision Workflow Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** `POST /api/licenses` 创建 license 后立即触发异步容器编排（provision-docker.sh），provision 完成后 `verify` 才允许激活，approve 改为按容器名定位。

**Architecture:** 在现有 Hono API 上扩展：创建时生成 gateway_token + 分配端口 + 落库（provision_status=pending），异步 worker 执行 shell 脚本、回写容器信息；verify 增加 provisioning 状态门禁；Nginx 可选域名模式。数据库通过 `ensureLicenseColumns()` 兼容旧库。

**Tech Stack:** Bun + Hono + bun:sqlite + Bun.spawn（Docker/Nginx） + Svelte 5

---

## 目录结构（新增/修改文件）

```
packages/api/src/
  db/
    schema.ts                         ← 修改：新增列
    client.ts                         ← 修改：ensureLicenseColumns()
    schema.test.ts                    ← 修改：断言新列
  services/
    dockerService.ts                  ← 修改：支持 {{container}}
    dockerService.test.ts             ← 修改：新测试
    provisioning/
      portAllocator.ts                ← 新建
      portAllocator.test.ts           ← 新建
      nameBuilder.ts                  ← 新建
      nameBuilder.test.ts             ← 新建
      scriptRunner.ts                 ← 新建
      scriptRunner.test.ts            ← 新建
      nginxService.ts                 ← 新建
      nginxService.test.ts            ← 新建
      licenseProvisioningService.ts   ← 新建
      licenseProvisioningService.test.ts ← 新建
  routes/
    licenses.ts                       ← 修改：新建流程
    licenses.test.ts                  ← 修改：新测试
    verify.ts                         ← 修改：状态门禁
    verify.test.ts                    ← 修改：新测试
  index.ts                            ← 修改：resumePendingProvisioning()
packages/ui/src/lib/
  api.ts                              ← 修改：License 类型
  LicenseList.svelte                  ← 修改：provision 状态展示
.env.example                          ← 修改：新增变量
```

---

## 环境变量（新增）

```env
OPENCLAW_DATA_DIR=/data/openclaw
OPENCLAW_RUNTIME_DIR=/opt/openclaw
OPENCLAW_PROVISION_SCRIPT=          # 默认 ${OPENCLAW_RUNTIME_DIR}/provision-docker.sh
OPENCLAW_HOST_IP=192.168.1.100
OPENCLAW_GATEWAY_PORT_START=18789
OPENCLAW_GATEWAY_PORT_END=18999
OPENCLAW_BRIDGE_PORT_START=28789
OPENCLAW_BRIDGE_PORT_END=28999
OPENCLAW_BASE_DOMAIN=               # 空=无域名模式; 非空=启用 Nginx+wss
NGINX_SITE_DIR=/etc/nginx/conf.d/openclaw
NGINX_RELOAD_CMD=nginx -s reload
```

---

### Task 1: DB Schema & Migration

**Files:**
- Modify: `packages/api/src/db/schema.ts`
- Modify: `packages/api/src/db/client.ts`
- Modify: `packages/api/src/db/schema.test.ts`

**Step 1: 更新 schema.ts，在 licenses 表新增 12 列**

```typescript
// packages/api/src/db/schema.ts
export const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS licenses (
    id                   INTEGER PRIMARY KEY AUTOINCREMENT,
    license_key          TEXT UNIQUE NOT NULL,
    hwid                 TEXT,
    device_name          TEXT,
    agent_id             TEXT,
    gateway_token        TEXT NOT NULL DEFAULT '',
    gateway_url          TEXT NOT NULL DEFAULT '',
    status               TEXT DEFAULT 'unbound',
    expiry_date          TEXT,
    note                 TEXT,
    created_at           TEXT DEFAULT (datetime('now')),
    bound_at             TEXT,
    owner_tag            TEXT,
    compose_project      TEXT,
    container_id         TEXT,
    container_name       TEXT,
    gateway_port         INTEGER,
    bridge_port          INTEGER,
    webui_url            TEXT,
    provision_status     TEXT DEFAULT 'pending',
    provision_error      TEXT,
    provision_started_at TEXT,
    provision_completed_at TEXT,
    nginx_host           TEXT
  );

  CREATE TABLE IF NOT EXISTS admin_users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL
  );
`;
```

**Step 2: 在 client.ts 添加 `ensureLicenseColumns()`，在 `getDb()` 中调用**

```typescript
// packages/api/src/db/client.ts
import { Database } from "bun:sqlite";
import bcrypt from "bcryptjs";
import { SCHEMA_SQL } from "./schema";

let _db: Database | null = null;

export function getDb(): Database {
  if (_db) return _db;
  const dbPath = process.env.DB_PATH ?? "openclaw.db";
  _db = new Database(dbPath, { create: true });
  _db.run("PRAGMA journal_mode=WAL");
  _db.run(SCHEMA_SQL);
  ensureLicenseColumns(_db);
  seedAdmin(_db);
  return _db;
}

export function resetDb(): void {
  _db?.close();
  _db = null;
}

function ensureLicenseColumns(db: Database): void {
  const existing = db
    .query<{ name: string }, []>("PRAGMA table_info(licenses)")
    .all();
  const names = new Set(existing.map((r) => r.name));

  const columns: Array<[string, string]> = [
    ["owner_tag", "TEXT"],
    ["compose_project", "TEXT"],
    ["container_id", "TEXT"],
    ["container_name", "TEXT"],
    ["gateway_port", "INTEGER"],
    ["bridge_port", "INTEGER"],
    ["webui_url", "TEXT"],
    ["provision_status", "TEXT DEFAULT 'pending'"],
    ["provision_error", "TEXT"],
    ["provision_started_at", "TEXT"],
    ["provision_completed_at", "TEXT"],
    ["nginx_host", "TEXT"],
  ];

  for (const [col, type] of columns) {
    if (!names.has(col)) {
      db.run(`ALTER TABLE licenses ADD COLUMN ${col} ${type}`);
    }
  }

  // 已存在的旧 license（迁移前创建）视为 ready，不阻塞 verify
  db.run(
    "UPDATE licenses SET provision_status = 'ready' WHERE provision_status IS NULL"
  );
}

function seedAdmin(db: Database): void {
  const username = process.env.ADMIN_USER ?? "admin";
  const password = process.env.ADMIN_PASS ?? "admin123";
  const existing = db
    .query("SELECT id FROM admin_users WHERE username = ?")
    .get(username);
  if (!existing) {
    const hash = bcrypt.hashSync(password, 10);
    db.run("INSERT INTO admin_users (username, password_hash) VALUES (?, ?)", [
      username,
      hash,
    ]);
  }
}
```

**Step 3: 更新 schema.test.ts，断言新列存在且 provision_status 默认值正确**

在 `packages/api/src/db/schema.test.ts` 现有测试末尾追加：

```typescript
test("licenses table has provision columns", () => {
  const db = getDb();
  const cols = db
    .query<{ name: string; dflt_value: string | null }, []>(
      "PRAGMA table_info(licenses)"
    )
    .all();
  const colMap = Object.fromEntries(cols.map((c) => [c.name, c.dflt_value]));

  expect(colMap).toHaveProperty("owner_tag");
  expect(colMap).toHaveProperty("compose_project");
  expect(colMap).toHaveProperty("container_id");
  expect(colMap).toHaveProperty("container_name");
  expect(colMap).toHaveProperty("gateway_port");
  expect(colMap).toHaveProperty("bridge_port");
  expect(colMap).toHaveProperty("webui_url");
  expect(colMap).toHaveProperty("provision_status");
  expect(colMap).toHaveProperty("provision_error");
  expect(colMap).toHaveProperty("provision_started_at");
  expect(colMap).toHaveProperty("provision_completed_at");
  expect(colMap).toHaveProperty("nginx_host");
});

test("ensureLicenseColumns sets NULL provision_status to ready on existing rows", () => {
  const db = getDb();
  // 模拟旧数据（直接跳过 provision_status，使其为 NULL）
  db.run(
    `INSERT INTO licenses (license_key, gateway_token, gateway_url, provision_status)
     VALUES ('OLD-KEY-001', 'tok', 'ws://x:1', NULL)`
  );
  // 重新初始化触发 ensureLicenseColumns
  resetDb();
  const db2 = getDb();
  const row = db2
    .query<{ provision_status: string }, string>(
      "SELECT provision_status FROM licenses WHERE license_key = ?"
    )
    .get("OLD-KEY-001");
  expect(row?.provision_status).toBe("ready");
});
```

**Step 4: 运行测试**

```bash
bun test --cwd packages/api src/db/schema.test.ts
```
Expected: 全部 PASS

**Step 5: 提交**

```bash
git -C "packages/api" add src/db/schema.ts src/db/client.ts src/db/schema.test.ts
git commit -m "feat: add provision columns to licenses schema with migration guard"
```

---

### Task 2: Port Allocator & Name Builder

**Files:**
- Create: `packages/api/src/services/provisioning/portAllocator.ts`
- Create: `packages/api/src/services/provisioning/portAllocator.test.ts`
- Create: `packages/api/src/services/provisioning/nameBuilder.ts`
- Create: `packages/api/src/services/provisioning/nameBuilder.test.ts`

**Step 1: 创建 portAllocator.ts**

```typescript
// packages/api/src/services/provisioning/portAllocator.ts
import { Database } from "bun:sqlite";

export interface PortPair {
  gatewayPort: number;
  bridgePort: number;
}

export function allocatePortPair(
  db: Database,
  gatewayStart: number,
  gatewayEnd: number,
  bridgeStart: number,
  bridgeEnd: number
): PortPair {
  const usedGateway = new Set(
    db
      .query<{ gateway_port: number }, []>(
        "SELECT gateway_port FROM licenses WHERE gateway_port IS NOT NULL"
      )
      .all()
      .map((r) => r.gateway_port)
  );

  const usedBridge = new Set(
    db
      .query<{ bridge_port: number }, []>(
        "SELECT bridge_port FROM licenses WHERE bridge_port IS NOT NULL"
      )
      .all()
      .map((r) => r.bridge_port)
  );

  let gatewayPort: number | null = null;
  for (let p = gatewayStart; p <= gatewayEnd; p++) {
    if (!usedGateway.has(p)) {
      gatewayPort = p;
      break;
    }
  }

  let bridgePort: number | null = null;
  for (let p = bridgeStart; p <= bridgeEnd; p++) {
    if (!usedBridge.has(p)) {
      bridgePort = p;
      break;
    }
  }

  if (gatewayPort === null || bridgePort === null) {
    throw new Error("NO_AVAILABLE_PORT");
  }

  return { gatewayPort, bridgePort };
}
```

**Step 2: 创建 portAllocator.test.ts**

```typescript
// packages/api/src/services/provisioning/portAllocator.test.ts
import { describe, test, expect, beforeEach } from "bun:test";
import { resetDb, getDb } from "../../db/client";
import { allocatePortPair } from "./portAllocator";

beforeEach(() => {
  resetDb();
  process.env.DB_PATH = ":memory:";
  process.env.ADMIN_USER = "admin";
  process.env.ADMIN_PASS = "x";
});

describe("allocatePortPair", () => {
  test("returns first available port pair", () => {
    const db = getDb();
    const pair = allocatePortPair(db, 18789, 18799, 28789, 28799);
    expect(pair.gatewayPort).toBe(18789);
    expect(pair.bridgePort).toBe(28789);
  });

  test("skips already used ports", () => {
    const db = getDb();
    db.run(
      `INSERT INTO licenses (license_key, gateway_token, gateway_url, gateway_port, bridge_port)
       VALUES ('K1', 't', 'ws://x', 18789, 28789)`
    );
    const pair = allocatePortPair(db, 18789, 18799, 28789, 28799);
    expect(pair.gatewayPort).toBe(18790);
    expect(pair.bridgePort).toBe(28790);
  });

  test("throws NO_AVAILABLE_PORT when pool exhausted", () => {
    const db = getDb();
    // Only one port in range, already used
    db.run(
      `INSERT INTO licenses (license_key, gateway_token, gateway_url, gateway_port, bridge_port)
       VALUES ('K1', 't', 'ws://x', 18789, 28789)`
    );
    expect(() => allocatePortPair(db, 18789, 18789, 28789, 28789)).toThrow(
      "NO_AVAILABLE_PORT"
    );
  });
});
```

**Step 3: 创建 nameBuilder.ts**

```typescript
// packages/api/src/services/provisioning/nameBuilder.ts

export function sanitizeOwnerTag(raw: string): string {
  const slug = raw
    .toLowerCase()
    .replace(/@.*$/, "")           // 去掉邮箱域名部分
    .replace(/[^a-z0-9-]/g, "-")  // 非法字符替换为 -
    .replace(/-+/g, "-")           // 合并连续 -
    .replace(/^-|-$/g, "")         // 去头尾 -
    .slice(0, 24);

  if (!slug) throw new Error("INVALID_OWNER_TAG");
  return slug;
}

export function buildComposeProject(ownerTag: string, licenseId: number): string {
  return `openclaw-${ownerTag}-${licenseId}`;
}

export function buildConfigDir(dataDir: string, composeProject: string): string {
  return `${dataDir}/${composeProject}/.openclaw`;
}

export function buildWorkspaceDir(dataDir: string, composeProject: string): string {
  return `${dataDir}/${composeProject}/workspace`;
}

export function buildNginxHost(
  ownerTag: string,
  licenseId: number,
  baseDomain: string
): string {
  return `${ownerTag}-${licenseId}.${baseDomain}`;
}
```

**Step 4: 创建 nameBuilder.test.ts**

```typescript
// packages/api/src/services/provisioning/nameBuilder.test.ts
import { describe, test, expect } from "bun:test";
import {
  sanitizeOwnerTag,
  buildComposeProject,
  buildConfigDir,
  buildWorkspaceDir,
  buildNginxHost,
} from "./nameBuilder";

describe("sanitizeOwnerTag", () => {
  test("lowercases and strips illegal chars", () => {
    expect(sanitizeOwnerTag("Alice_Bob")).toBe("alice-bob");
  });

  test("strips email domain", () => {
    expect(sanitizeOwnerTag("user@example.com")).toBe("user");
  });

  test("collapses consecutive dashes", () => {
    expect(sanitizeOwnerTag("a--b---c")).toBe("a-b-c");
  });

  test("truncates to 24 chars", () => {
    expect(sanitizeOwnerTag("a".repeat(30))).toHaveLength(24);
  });

  test("throws INVALID_OWNER_TAG for empty result", () => {
    expect(() => sanitizeOwnerTag("---")).toThrow("INVALID_OWNER_TAG");
  });
});

describe("buildComposeProject", () => {
  test("returns expected project name", () => {
    expect(buildComposeProject("alice", 42)).toBe("openclaw-alice-42");
  });
});

describe("buildConfigDir / buildWorkspaceDir", () => {
  test("builds correct host paths", () => {
    expect(buildConfigDir("/data/openclaw", "openclaw-alice-1")).toBe(
      "/data/openclaw/openclaw-alice-1/.openclaw"
    );
    expect(buildWorkspaceDir("/data/openclaw", "openclaw-alice-1")).toBe(
      "/data/openclaw/openclaw-alice-1/workspace"
    );
  });
});

describe("buildNginxHost", () => {
  test("builds subdomain from ownerTag and licenseId", () => {
    expect(buildNginxHost("alice", 1, "example.com")).toBe("alice-1.example.com");
  });
});
```

**Step 5: 运行测试**

```bash
bun test --cwd packages/api src/services/provisioning/portAllocator.test.ts src/services/provisioning/nameBuilder.test.ts
```
Expected: 全部 PASS

**Step 6: 提交**

```bash
git add packages/api/src/services/provisioning/
git commit -m "feat: add portAllocator and nameBuilder provisioning services"
```

---

### Task 3: Script Runner & Nginx Service

**Files:**
- Create: `packages/api/src/services/provisioning/scriptRunner.ts`
- Create: `packages/api/src/services/provisioning/scriptRunner.test.ts`
- Create: `packages/api/src/services/provisioning/nginxService.ts`
- Create: `packages/api/src/services/provisioning/nginxService.test.ts`

**Step 1: 创建 scriptRunner.ts**

```typescript
// packages/api/src/services/provisioning/scriptRunner.ts

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
    throw new Error(
      `Provision script exited ${exitCode}: ${stderr.slice(0, 500)}`
    );
  }
}

export async function getContainerId(composeProject: string): Promise<string> {
  const proc = Bun.spawn(
    ["docker", "compose", "-p", composeProject, "ps", "-q", "openclaw-gateway"],
    { stdout: "pipe", stderr: "pipe" }
  );
  const exitCode = await proc.exited;
  if (exitCode !== 0) throw new Error("docker compose ps failed");
  const id = (await new Response(proc.stdout).text()).trim();
  if (!id) throw new Error("Container not found after provisioning");
  return id;
}

export async function getContainerName(containerId: string): Promise<string> {
  const proc = Bun.spawn(
    ["docker", "inspect", "--format", "{{.Name}}", containerId],
    { stdout: "pipe", stderr: "pipe" }
  );
  const exitCode = await proc.exited;
  if (exitCode !== 0) throw new Error("docker inspect failed");
  return (await new Response(proc.stdout).text()).trim().replace(/^\//, "");
}
```

**Step 2: 创建 scriptRunner.test.ts（stub Bun.spawn）**

```typescript
// packages/api/src/services/provisioning/scriptRunner.test.ts
import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";
import { runProvisionScript, getContainerId, getContainerName } from "./scriptRunner";

function makeSpawnStub(exitCode: number, stdout = "", stderr = "") {
  return () =>
    ({
      exited: Promise.resolve(exitCode),
      stdout: new Response(stdout),
      stderr: new Response(stderr),
    } as any);
}

const originalSpawn = Bun.spawn;

afterEach(() => {
  (Bun as any).spawn = originalSpawn;
});

describe("runProvisionScript", () => {
  test("resolves when script exits 0", async () => {
    (Bun as any).spawn = makeSpawnStub(0);
    await expect(
      runProvisionScript({
        runtimeDir: "/tmp",
        configDir: "/tmp/cfg",
        workspaceDir: "/tmp/ws",
        composeProject: "openclaw-test-1",
        gatewayPort: 18789,
        bridgePort: 28789,
        gatewayToken: "tok",
        provisionScript: "/tmp/setup.sh",
      })
    ).resolves.toBeUndefined();
  });

  test("throws when script exits non-zero", async () => {
    (Bun as any).spawn = makeSpawnStub(1, "", "docker error");
    await expect(
      runProvisionScript({
        runtimeDir: "/tmp",
        configDir: "/tmp/cfg",
        workspaceDir: "/tmp/ws",
        composeProject: "openclaw-test-1",
        gatewayPort: 18789,
        bridgePort: 28789,
        gatewayToken: "tok",
        provisionScript: "/tmp/setup.sh",
      })
    ).rejects.toThrow("Provision script exited 1");
  });
});

describe("getContainerId", () => {
  test("returns trimmed container ID", async () => {
    (Bun as any).spawn = makeSpawnStub(0, "abc123\n");
    expect(await getContainerId("openclaw-test-1")).toBe("abc123");
  });

  test("throws when container not found", async () => {
    (Bun as any).spawn = makeSpawnStub(0, "");
    await expect(getContainerId("openclaw-test-1")).rejects.toThrow(
      "Container not found"
    );
  });
});

describe("getContainerName", () => {
  test("strips leading slash from container name", async () => {
    (Bun as any).spawn = makeSpawnStub(0, "/openclaw-alice-1-gateway\n");
    expect(await getContainerName("abc123")).toBe("openclaw-alice-1-gateway");
  });
});
```

**Step 3: 创建 nginxService.ts**

```typescript
// packages/api/src/services/provisioning/nginxService.ts
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
```

**Step 4: 创建 nginxService.test.ts**

```typescript
// packages/api/src/services/provisioning/nginxService.test.ts
import { describe, test, expect, afterEach } from "bun:test";
import { buildNginxConfig, writeNginxConfig } from "./nginxService";
import { tmpdir } from "os";
import { join } from "path";
import { readFileSync } from "fs";

function makeSpawnStub(exitCode: number) {
  return () => ({
    exited: Promise.resolve(exitCode),
    stdout: new Response(""),
    stderr: new Response(""),
  } as any);
}

const originalSpawn = Bun.spawn;
afterEach(() => { (Bun as any).spawn = originalSpawn; });

describe("buildNginxConfig", () => {
  test("contains server_name and proxy_pass", () => {
    const cfg = buildNginxConfig("alice-1.example.com", 18789);
    expect(cfg).toContain("server_name alice-1.example.com");
    expect(cfg).toContain("proxy_pass http://127.0.0.1:18789");
    expect(cfg).toContain("proxy_set_header Upgrade");
  });
});

describe("writeNginxConfig", () => {
  test("writes config file and calls nginx reload", async () => {
    (Bun as any).spawn = makeSpawnStub(0);
    const siteDir = join(tmpdir(), "nginx-test-" + Date.now());
    await writeNginxConfig(siteDir, "openclaw-alice-1", "alice-1.test.com", 18789, "nginx -s reload");
    const content = readFileSync(join(siteDir, "openclaw-alice-1.conf"), "utf8");
    expect(content).toContain("server_name alice-1.test.com");
  });

  test("throws when nginx -t fails", async () => {
    (Bun as any).spawn = makeSpawnStub(1);
    const siteDir = join(tmpdir(), "nginx-test-fail-" + Date.now());
    await expect(
      writeNginxConfig(siteDir, "p", "h", 18789, "nginx -s reload")
    ).rejects.toThrow("nginx -t failed");
  });
});
```

**Step 5: 运行测试**

```bash
bun test --cwd packages/api src/services/provisioning/scriptRunner.test.ts src/services/provisioning/nginxService.test.ts
```
Expected: 全部 PASS

**Step 6: 提交**

```bash
git add packages/api/src/services/provisioning/
git commit -m "feat: add scriptRunner and nginxService for provisioning"
```

---

### Task 4: License Provisioning Service（Orchestrator）

**Files:**
- Create: `packages/api/src/services/provisioning/licenseProvisioningService.ts`
- Create: `packages/api/src/services/provisioning/licenseProvisioningService.test.ts`

**Step 1: 创建 licenseProvisioningService.ts**

```typescript
// packages/api/src/services/provisioning/licenseProvisioningService.ts
import { readFile } from "fs/promises";
import { join } from "path";
import { getDb } from "../../db/client";
import { buildConfigDir, buildWorkspaceDir, buildNginxHost } from "./nameBuilder";
import { runProvisionScript, getContainerId, getContainerName } from "./scriptRunner";
import { writeNginxConfig } from "./nginxService";

const activeJobs = new Map<number, Promise<void>>();

export function enqueueLicenseProvisioning(licenseId: number): void {
  const job = runProvisioning(licenseId).catch((err) => {
    console.error(`[provision] license=${licenseId} fatal: ${err.message}`);
  });
  activeJobs.set(licenseId, job);
  job.finally(() => activeJobs.delete(licenseId));
}

export function resumePendingProvisioning(): void {
  const db = getDb();
  const stale = db
    .query<{ id: number }, []>(
      "SELECT id FROM licenses WHERE provision_status IN ('pending', 'running')"
    )
    .all();
  if (stale.length > 0) {
    console.log(`[provision] resuming ${stale.length} pending job(s)`);
    for (const { id } of stale) enqueueLicenseProvisioning(id);
  }
}

async function runProvisioning(licenseId: number): Promise<void> {
  const db = getDb();
  db.run(
    "UPDATE licenses SET provision_status='running', provision_started_at=datetime('now') WHERE id=?",
    [licenseId]
  );

  try {
    const license = db
      .query<{
        compose_project: string;
        gateway_port: number;
        bridge_port: number;
        gateway_token: string;
        owner_tag: string;
        gateway_url: string;
        webui_url: string | null;
      }, number>(
        "SELECT compose_project, gateway_port, bridge_port, gateway_token, owner_tag, gateway_url, webui_url FROM licenses WHERE id=?"
      )
      .get(licenseId);

    if (!license) throw new Error("License not found");

    const runtimeDir = process.env.OPENCLAW_RUNTIME_DIR!;
    const dataDir = process.env.OPENCLAW_DATA_DIR!;
    const provisionScript =
      process.env.OPENCLAW_PROVISION_SCRIPT ?? `${runtimeDir}/provision-docker.sh`;
    const configDir = buildConfigDir(dataDir, license.compose_project);
    const workspaceDir = buildWorkspaceDir(dataDir, license.compose_project);

    await runProvisionScript({
      runtimeDir,
      configDir,
      workspaceDir,
      composeProject: license.compose_project,
      gatewayPort: license.gateway_port,
      bridgePort: license.bridge_port,
      gatewayToken: license.gateway_token,
      provisionScript,
    });

    const containerId = await getContainerId(license.compose_project);
    const containerName = await getContainerName(containerId);

    // 读取容器生成的 openclaw.json 校验 token
    let finalToken = license.gateway_token;
    try {
      const text = await readFile(join(configDir, "openclaw.json"), "utf8");
      const config = JSON.parse(text);
      const fileToken = config.gateway?.auth?.token ?? config.token ?? null;
      if (fileToken && fileToken !== license.gateway_token) {
        console.warn(`[provision] license=${licenseId} token overridden by config file`);
        finalToken = fileToken;
      }
    } catch {
      // 文件不存在或解析失败，保持生成的 token
    }

    // 可选 Nginx 域名模式
    const baseDomain = process.env.OPENCLAW_BASE_DOMAIN;
    let gatewayUrl = license.gateway_url;
    let webuiUrl = license.webui_url ?? "";
    let nginxHost: string | null = null;

    if (baseDomain) {
      nginxHost = buildNginxHost(license.owner_tag, licenseId, baseDomain);
      const siteDir = process.env.NGINX_SITE_DIR ?? "/etc/nginx/conf.d/openclaw";
      const reloadCmd = process.env.NGINX_RELOAD_CMD ?? "nginx -s reload";
      await writeNginxConfig(siteDir, license.compose_project, nginxHost, license.gateway_port, reloadCmd);
      gatewayUrl = `wss://${nginxHost}`;
      webuiUrl = `https://${nginxHost}`;
    }

    db.run(
      `UPDATE licenses SET
         provision_status='ready',
         provision_completed_at=datetime('now'),
         provision_error=NULL,
         container_id=?,
         container_name=?,
         gateway_token=?,
         gateway_url=?,
         webui_url=?,
         nginx_host=?
       WHERE id=?`,
      [containerId, containerName, finalToken, gatewayUrl, webuiUrl, nginxHost, licenseId]
    );

    console.log(
      `[provision] license=${licenseId} ready container=${containerName} url=${gatewayUrl}`
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    db.run(
      "UPDATE licenses SET provision_status='failed', provision_error=?, provision_completed_at=datetime('now') WHERE id=?",
      [msg.slice(0, 1000), licenseId]
    );
    throw err;
  }
}
```

**Step 2: 创建 licenseProvisioningService.test.ts**

```typescript
// packages/api/src/services/provisioning/licenseProvisioningService.test.ts
import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";
import { resetDb, getDb } from "../../db/client";
import { enqueueLicenseProvisioning } from "./licenseProvisioningService";

// stub 所有 Bun.spawn 调用为成功
const originalSpawn = Bun.spawn;

function setupSpawnStubs(exitCode = 0, stdout = "container123\n") {
  let callCount = 0;
  (Bun as any).spawn = () => {
    callCount++;
    return {
      exited: Promise.resolve(exitCode),
      stdout: new Response(stdout),
      stderr: new Response(""),
    };
  };
  return () => callCount;
}

afterEach(() => {
  (Bun as any).spawn = originalSpawn;
});

function seedLicense(db: ReturnType<typeof getDb>) {
  db.run(
    `INSERT INTO licenses
       (license_key, gateway_token, gateway_url, status, owner_tag,
        compose_project, gateway_port, bridge_port, provision_status)
     VALUES ('PROV-KEY-001', 'tok123', 'ws://127.0.0.1:18789', 'unbound',
             'test', 'openclaw-test-1', 18789, 28789, 'pending')`
  );
  return db.query<{ id: number }, string>(
    "SELECT id FROM licenses WHERE license_key = ?"
  ).get("PROV-KEY-001")!;
}

beforeEach(() => {
  resetDb();
  process.env.DB_PATH = ":memory:";
  process.env.ADMIN_USER = "admin";
  process.env.ADMIN_PASS = "x";
  process.env.OPENCLAW_RUNTIME_DIR = "/tmp/runtime";
  process.env.OPENCLAW_DATA_DIR = "/tmp/data";
  process.env.OPENCLAW_PROVISION_SCRIPT = "/tmp/setup.sh";
  delete process.env.OPENCLAW_BASE_DOMAIN;
});

describe("enqueueLicenseProvisioning", () => {
  test("sets provision_status to ready on success", async () => {
    const db = getDb();
    const { id } = seedLicense(db);

    // stub: script ok, container id, container name
    let callIdx = 0;
    (Bun as any).spawn = () => {
      const outputs = ["", "abc123\n", "/openclaw-test-1-gateway\n"];
      const out = outputs[callIdx] ?? "";
      callIdx++;
      return {
        exited: Promise.resolve(0),
        stdout: new Response(out),
        stderr: new Response(""),
      };
    };

    enqueueLicenseProvisioning(id);
    // Wait for async job to finish
    await new Promise((r) => setTimeout(r, 50));

    const row = db
      .query<{ provision_status: string; container_name: string }, number>(
        "SELECT provision_status, container_name FROM licenses WHERE id=?"
      )
      .get(id);
    expect(row?.provision_status).toBe("ready");
    expect(row?.container_name).toBe("openclaw-test-1-gateway");
  });

  test("sets provision_status to failed when script fails", async () => {
    const db = getDb();
    const { id } = seedLicense(db);

    (Bun as any).spawn = () => ({
      exited: Promise.resolve(1),
      stdout: new Response(""),
      stderr: new Response("docker error"),
    });

    enqueueLicenseProvisioning(id);
    await new Promise((r) => setTimeout(r, 50));

    const row = db
      .query<{ provision_status: string; provision_error: string }, number>(
        "SELECT provision_status, provision_error FROM licenses WHERE id=?"
      )
      .get(id);
    expect(row?.provision_status).toBe("failed");
    expect(row?.provision_error).toContain("Provision script exited 1");
  });
});
```

**Step 3: 运行测试**

```bash
bun test --cwd packages/api src/services/provisioning/licenseProvisioningService.test.ts
```
Expected: 全部 PASS

**Step 4: 提交**

```bash
git add packages/api/src/services/provisioning/licenseProvisioningService.ts packages/api/src/services/provisioning/licenseProvisioningService.test.ts
git commit -m "feat: add licenseProvisioningService orchestrator with async queue"
```

---

### Task 5: Licenses Route — 新建流程

**Files:**
- Modify: `packages/api/src/routes/licenses.ts`
- Modify: `packages/api/src/routes/licenses.test.ts`

**Step 1: 重写 licenses.ts 的 POST 处理器**

完整替换 `packages/api/src/routes/licenses.ts`：

```typescript
// packages/api/src/routes/licenses.ts
import { Hono } from "hono";
import { randomBytes } from "crypto";
import { getDb } from "../db/client";
import { generateLicenseKey } from "../services/licenseService";
import { allocatePortPair } from "../services/provisioning/portAllocator";
import {
  sanitizeOwnerTag,
  buildComposeProject,
  buildNginxHost,
} from "../services/provisioning/nameBuilder";
import { enqueueLicenseProvisioning } from "../services/provisioning/licenseProvisioningService";

const licenses = new Hono();

licenses.get("/", (c) => {
  const db = getDb();
  const rows = db.query("SELECT * FROM licenses ORDER BY created_at DESC").all();
  return c.json({ success: true, data: rows });
});

licenses.post("/", async (c) => {
  // Parse optional ownerTag from body; fall back to JWT username
  const jwtPayload = c.get("jwtPayload") as { sub?: string; username?: string } | undefined;
  let rawOwnerTag = jwtPayload?.username ?? "user";
  try {
    const body = await c.req.json<{ ownerTag?: string }>();
    if (body.ownerTag) rawOwnerTag = body.ownerTag;
  } catch {
    // body is optional
  }

  let ownerTag: string;
  try {
    ownerTag = sanitizeOwnerTag(rawOwnerTag);
  } catch {
    return c.json({ success: false, error: "INVALID_OWNER_TAG" }, 400);
  }

  const db = getDb();

  // Allocate port pair
  let portPair: { gatewayPort: number; bridgePort: number };
  try {
    portPair = allocatePortPair(
      db,
      Number(process.env.OPENCLAW_GATEWAY_PORT_START ?? 18789),
      Number(process.env.OPENCLAW_GATEWAY_PORT_END ?? 18999),
      Number(process.env.OPENCLAW_BRIDGE_PORT_START ?? 28789),
      Number(process.env.OPENCLAW_BRIDGE_PORT_END ?? 28999)
    );
  } catch {
    return c.json({ success: false, error: "NO_AVAILABLE_PORT" }, 503);
  }

  const licenseKey = generateLicenseKey();
  const gatewayToken = randomBytes(32).toString("hex");
  const hostIp = process.env.OPENCLAW_HOST_IP ?? "127.0.0.1";
  const baseDomain = process.env.OPENCLAW_BASE_DOMAIN;

  // Initial URLs (may be overridden to wss/https after nginx setup in worker)
  const initialGatewayUrl = `ws://${hostIp}:${portPair.gatewayPort}`;
  const initialWebuiUrl = `http://${hostIp}:${portPair.gatewayPort}`;

  db.run(
    `INSERT INTO licenses
       (license_key, gateway_token, gateway_url, status,
        owner_tag, gateway_port, bridge_port, provision_status, webui_url)
     VALUES (?, ?, ?, 'unbound', ?, ?, ?, 'pending', ?)`,
    [
      licenseKey,
      gatewayToken,
      initialGatewayUrl,
      ownerTag,
      portPair.gatewayPort,
      portPair.bridgePort,
      initialWebuiUrl,
    ]
  );

  const row = db
    .query<{ id: number }, string>("SELECT * FROM licenses WHERE license_key = ?")
    .get(licenseKey) as any;

  // Now have ID: build compose_project and update URLs if domain mode
  const composeProject = buildComposeProject(ownerTag, row.id);
  let gatewayUrl = initialGatewayUrl;
  let webuiUrl = initialWebuiUrl;
  let nginxHost: string | null = null;

  if (baseDomain) {
    nginxHost = buildNginxHost(ownerTag, row.id, baseDomain);
    gatewayUrl = `wss://${nginxHost}`;
    webuiUrl = `https://${nginxHost}`;
  }

  db.run(
    "UPDATE licenses SET compose_project=?, gateway_url=?, webui_url=?, nginx_host=? WHERE id=?",
    [composeProject, gatewayUrl, webuiUrl, nginxHost, row.id]
  );

  const finalRow = db.query("SELECT * FROM licenses WHERE id=?").get(row.id);

  // Fire-and-forget async provisioning
  enqueueLicenseProvisioning(row.id);

  return c.json({ success: true, data: finalRow }, 201);
});

licenses.patch("/:id", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json<{ status?: string; note?: string }>();
  const db = getDb();

  const existing = db.query("SELECT id FROM licenses WHERE id = ?").get(id);
  if (!existing) return c.json({ success: false, error: "NOT_FOUND" }, 404);

  const updates: string[] = [];
  const values: unknown[] = [];
  if (body.status) { updates.push("status = ?"); values.push(body.status); }
  if (body.note !== undefined) { updates.push("note = ?"); values.push(body.note); }

  if (updates.length === 0) {
    return c.json({ success: false, error: "NO_FIELDS_TO_UPDATE" }, 400);
  }

  values.push(id);
  db.run(`UPDATE licenses SET ${updates.join(", ")} WHERE id = ?`, values);
  const row = db.query("SELECT * FROM licenses WHERE id = ?").get(id);
  return c.json({ success: true, data: row });
});

export default licenses;
```

**Step 2: 更新 licenses.test.ts，新增 provision 相关测试**

在现有测试文件末尾追加以下 describe 块（保留现有测试不变）：

```typescript
// 在 licenses.test.ts 末尾追加

describe("POST /licenses – provision fields", () => {
  // stub enqueueLicenseProvisioning (不执行真实 docker)
  beforeEach(() => {
    process.env.OPENCLAW_HOST_IP = "10.0.0.1";
    process.env.OPENCLAW_GATEWAY_PORT_START = "18789";
    process.env.OPENCLAW_GATEWAY_PORT_END = "18999";
    process.env.OPENCLAW_BRIDGE_PORT_START = "28789";
    process.env.OPENCLAW_BRIDGE_PORT_END = "28999";
    delete process.env.OPENCLAW_BASE_DOMAIN;
  });

  test("returns provision_status=pending on creation", async () => {
    const res = await app.request("/licenses", {
      method: "POST",
      headers: await authHeader(),
    });
    expect(res.status).toBe(201);
    const body = await res.json() as any;
    expect(body.data.provision_status).toBe("pending");
  });

  test("assigns gateway_port and compose_project", async () => {
    const res = await app.request("/licenses", {
      method: "POST",
      headers: await authHeader(),
    });
    const body = await res.json() as any;
    expect(body.data.gateway_port).toBe(18789);
    expect(body.data.compose_project).toMatch(/^openclaw-/);
  });

  test("gateway_url uses OPENCLAW_HOST_IP in no-domain mode", async () => {
    const res = await app.request("/licenses", {
      method: "POST",
      headers: await authHeader(),
    });
    const body = await res.json() as any;
    expect(body.data.gateway_url).toContain("ws://10.0.0.1:");
  });

  test("returns 400 INVALID_OWNER_TAG for invalid ownerTag", async () => {
    const res = await app.request("/licenses", {
      method: "POST",
      headers: { ...(await authHeader()), "Content-Type": "application/json" },
      body: JSON.stringify({ ownerTag: "---" }),
    });
    expect(res.status).toBe(400);
    const body = await res.json() as any;
    expect(body.error).toBe("INVALID_OWNER_TAG");
  });

  test("returns 503 NO_AVAILABLE_PORT when pool exhausted", async () => {
    // Fill all ports in a 1-port range
    process.env.OPENCLAW_GATEWAY_PORT_START = "18789";
    process.env.OPENCLAW_GATEWAY_PORT_END = "18789";
    process.env.OPENCLAW_BRIDGE_PORT_START = "28789";
    process.env.OPENCLAW_BRIDGE_PORT_END = "28789";

    // Create first license to occupy the only port
    await app.request("/licenses", {
      method: "POST",
      headers: await authHeader(),
    });

    // Second attempt should fail
    const res = await app.request("/licenses", {
      method: "POST",
      headers: await authHeader(),
    });
    expect(res.status).toBe(503);
    const body = await res.json() as any;
    expect(body.error).toBe("NO_AVAILABLE_PORT");
  });
});
```

**Step 3: 运行测试**

```bash
bun test --cwd packages/api src/routes/licenses.test.ts
```
Expected: 全部 PASS（包括原有 5 个 + 新增 5 个）

**Step 4: 提交**

```bash
git add packages/api/src/routes/licenses.ts packages/api/src/routes/licenses.test.ts
git commit -m "feat: rewrite POST /licenses with port allocation, token gen, and async provisioning"
```

---

### Task 6: Docker Service + Verify Route 更新

**Files:**
- Modify: `packages/api/src/services/dockerService.ts`
- Modify: `packages/api/src/services/dockerService.test.ts`
- Modify: `packages/api/src/routes/verify.ts`
- Modify: `packages/api/src/routes/verify.test.ts`

**Step 1: 更新 dockerService.ts — 支持 `{{container}}` 占位符**

```typescript
// packages/api/src/services/dockerService.ts

export function buildDockerArgs(containerName?: string): string[] | null {
  const cmd = process.env.DOCKER_APPROVE_CMD;
  if (!cmd) return null;
  const resolved = containerName
    ? cmd.replace(/\{\{container\}\}/g, containerName)
    : cmd;
  return resolved.trim().split(/\s+/);
}

export function spawnDockerApprove(
  hwid: string,
  licenseKey: string,
  containerName?: string
): void {
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
```

**Step 2: 更新 dockerService.test.ts**

在现有测试文件末尾追加：

```typescript
describe("buildDockerArgs with {{container}}", () => {
  test("replaces {{container}} placeholder with container name", () => {
    process.env.DOCKER_APPROVE_CMD =
      "docker exec {{container}} curl http://localhost/approve";
    const args = buildDockerArgs("my-container");
    expect(args).toEqual([
      "docker", "exec", "my-container", "curl", "http://localhost/approve",
    ]);
  });

  test("leaves cmd unchanged when no placeholder and no containerName", () => {
    process.env.DOCKER_APPROVE_CMD = "docker exec openclaw curl http://x/approve";
    const args = buildDockerArgs();
    expect(args).toEqual([
      "docker", "exec", "openclaw", "curl", "http://x/approve",
    ]);
  });
});
```

**Step 3: 更新 verify.ts — 新增 provision 状态门禁**

在 `verify.ts` 中，修改 `LicenseRow` 接口并在状态检查前插入 provision 检查：

```typescript
// packages/api/src/routes/verify.ts
import { Hono } from "hono";
import { getDb } from "../db/client";
import { generateAgentId, isExpired } from "../services/licenseService";
import { spawnDockerApprove } from "../services/dockerService";

interface VerifyBody {
  hwid: string;
  licenseKey: string;
  deviceName: string;
}

interface LicenseRow {
  id: number;
  hwid: string | null;
  agent_id: string | null;
  gateway_token: string;
  gateway_url: string;
  status: string;
  expiry_date: string | null;
  provision_status: string | null;
  container_name: string | null;
}

const verify = new Hono();

verify.post("/", async (c) => {
  let body: Partial<VerifyBody>;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ success: false, error: "INVALID_JSON" }, 400);
  }
  const { hwid, licenseKey, deviceName } = body;

  if (!hwid || !licenseKey || !deviceName) {
    return c.json({ success: false, error: "MISSING_FIELDS" }, 400);
  }

  const db = getDb();
  const license = db
    .query<LicenseRow, string>("SELECT * FROM licenses WHERE license_key = ?")
    .get(licenseKey);

  if (!license) return c.json({ success: false, error: "INVALID_LICENSE" }, 403);

  // Provisioning gate
  const ps = license.provision_status;
  if (ps === "pending" || ps === "running") {
    return c.json({ success: false, error: "PROVISIONING_PENDING" }, 409);
  }
  if (ps === "failed") {
    return c.json({ success: false, error: "PROVISIONING_FAILED" }, 409);
  }

  if (license.status === "revoked") {
    return c.json({ success: false, error: "LICENSE_REVOKED" }, 403);
  }
  if (isExpired(license.expiry_date)) {
    return c.json({ success: false, error: "LICENSE_EXPIRED" }, 403);
  }

  let agentId: string;

  if (license.status === "unbound") {
    agentId = generateAgentId(hwid);
    db.run(
      `UPDATE licenses
       SET hwid=?, device_name=?, agent_id=?, status='active', bound_at=datetime('now')
       WHERE license_key=?`,
      [hwid, deviceName, agentId, licenseKey]
    );
  } else {
    if (license.hwid !== hwid) {
      return c.json({ success: false, error: "HWID_MISMATCH" }, 403);
    }
    agentId = license.agent_id!;
  }

  spawnDockerApprove(hwid, licenseKey, license.container_name ?? undefined);

  return c.json({
    success: true,
    data: {
      nodeConfig: {
        gatewayUrl: license.gateway_url,
        gatewayToken: license.gateway_token,
        agentId,
        deviceName,
      },
      userProfile: {
        licenseStatus: "Valid",
        expiryDate: license.expiry_date ?? "Permanent",
      },
    },
  });
});

export default verify;
```

**Step 4: 在 verify.test.ts 中新增 provisioning 状态测试**

在现有测试文件末尾追加：

```typescript
// 在 verify.test.ts 末尾追加

function seedLicenseWithProvision(
  provisionStatus: string,
  status = "unbound",
  hwid: string | null = null
) {
  const db = getDb();
  db.run(
    `INSERT INTO licenses
       (license_key, gateway_token, gateway_url, status, hwid, provision_status)
     VALUES ('PROV-AAAAA-BBBBB-CCCCC', 'tok', 'ws://gw:18789', ?, ?, ?)`,
    [status, hwid, provisionStatus]
  );
}

describe("POST /verify – provisioning gate", () => {
  test("returns 409 PROVISIONING_PENDING when status is pending", async () => {
    seedLicenseWithProvision("pending");
    const res = await post({
      hwid: "hw1",
      licenseKey: "PROV-AAAAA-BBBBB-CCCCC",
      deviceName: "PC",
    });
    expect(res.status).toBe(409);
    const body = await res.json() as { error: string };
    expect(body.error).toBe("PROVISIONING_PENDING");
  });

  test("returns 409 PROVISIONING_PENDING when status is running", async () => {
    seedLicenseWithProvision("running");
    const res = await post({
      hwid: "hw1",
      licenseKey: "PROV-AAAAA-BBBBB-CCCCC",
      deviceName: "PC",
    });
    expect(res.status).toBe(409);
    const body = await res.json() as { error: string };
    expect(body.error).toBe("PROVISIONING_PENDING");
  });

  test("returns 409 PROVISIONING_FAILED when status is failed", async () => {
    seedLicenseWithProvision("failed");
    const res = await post({
      hwid: "hw1",
      licenseKey: "PROV-AAAAA-BBBBB-CCCCC",
      deviceName: "PC",
    });
    expect(res.status).toBe(409);
    const body = await res.json() as { error: string };
    expect(body.error).toBe("PROVISIONING_FAILED");
  });

  test("allows verify when provision_status is ready", async () => {
    seedLicenseWithProvision("ready", "unbound");
    const res = await post({
      hwid: "hw-new",
      licenseKey: "PROV-AAAAA-BBBBB-CCCCC",
      deviceName: "PC",
    });
    expect(res.status).toBe(200);
  });

  test("allows verify when provision_status is null (legacy license)", async () => {
    const db = getDb();
    db.run(
      `INSERT INTO licenses
         (license_key, gateway_token, gateway_url, status, provision_status)
       VALUES ('NULL-STATUS-LICENSE', 'tok', 'ws://gw:18789', 'unbound', NULL)`
    );
    const res = await post({
      hwid: "hw-legacy",
      licenseKey: "NULL-STATUS-LICENSE",
      deviceName: "PC",
    });
    expect(res.status).toBe(200);
  });
});
```

**Step 5: 运行测试**

```bash
bun test --cwd packages/api src/services/dockerService.test.ts src/routes/verify.test.ts
```
Expected: 全部 PASS

**Step 6: 提交**

```bash
git add packages/api/src/services/dockerService.ts packages/api/src/services/dockerService.test.ts packages/api/src/routes/verify.ts packages/api/src/routes/verify.test.ts
git commit -m "feat: add provision gates to verify and container support to dockerService"
```

---

### Task 7: Startup Recovery + 全量测试

**Files:**
- Modify: `packages/api/src/index.ts`

**Step 1: 在 index.ts 启动时调用 `resumePendingProvisioning()`**

```typescript
// packages/api/src/index.ts
import { Hono } from "hono";
import { cors } from "hono/cors";
import { serveStatic } from "hono/bun";
import authRoutes from "./routes/auth";
import licensesRoutes from "./routes/licenses";
import verifyRoutes from "./routes/verify";
import { jwtMiddleware } from "./middleware/jwt";
import { getDb } from "./db/client";
import { resumePendingProvisioning } from "./services/provisioning/licenseProvisioningService";

getDb(); // Initialize DB and run migrations on startup
resumePendingProvisioning(); // Resume any interrupted jobs

const app = new Hono();
app.use("*", cors());
app.route("/api/auth", authRoutes);
app.route("/api/verify", verifyRoutes);
app.use("/api/licenses/*", jwtMiddleware);
app.route("/api/licenses", licensesRoutes);

const uiDist = process.env.UI_DIST_PATH ?? "../ui/dist";
app.use("/*", serveStatic({ root: uiDist }));
app.get("*", serveStatic({ path: `${uiDist}/index.html` }));

const port = Number(process.env.PORT ?? 3000);
console.log(`🚀 OpenClaw Auth running on http://localhost:${port}`);

export default { port, fetch: app.fetch };
```

**Step 2: 运行全量 API 测试**

```bash
bun test --cwd packages/api
```
Expected: 全部 PASS（包含原有 39 个 + 新增约 20 个）

**Step 3: 提交**

```bash
git add packages/api/src/index.ts
git commit -m "feat: resume pending provisioning jobs on API startup"
```

---

### Task 8: UI 类型 & 展示更新

**Files:**
- Modify: `packages/ui/src/lib/api.ts`
- Modify: `packages/ui/src/lib/LicenseList.svelte`

**Step 1: 更新 api.ts 的 License 接口与 generateLicense**

```typescript
// packages/ui/src/lib/api.ts — License 接口替换为：

export interface License {
  id: number;
  license_key: string;
  hwid: string | null;
  device_name: string | null;
  agent_id: string | null;
  status: "unbound" | "active" | "revoked";
  expiry_date: string | null;
  created_at: string;
  bound_at: string | null;
  // Provision fields
  owner_tag: string | null;
  compose_project: string | null;
  container_id: string | null;
  container_name: string | null;
  gateway_port: number | null;
  bridge_port: number | null;
  gateway_url: string;
  webui_url: string | null;
  provision_status: "pending" | "running" | "ready" | "failed" | null;
  provision_error: string | null;
  provision_started_at: string | null;
  provision_completed_at: string | null;
  nginx_host: string | null;
}

// generateLicense 改为接受可选 ownerTag：
generateLicense: (ownerTag?: string) =>
  request<{ success: boolean; data: License }>("/licenses", {
    method: "POST",
    body: ownerTag ? JSON.stringify({ ownerTag }) : "{}",
  }),
```

**Step 2: 更新 LicenseList.svelte，展示 provision 状态**

关键变更点（在现有 LicenseList.svelte 中修改）：

1. **生成对话框** 新增 ownerTag 输入框（可选）
2. **表格** 新增 Provision 状态列、Container 列、URL 列
3. **状态 chip** pending=灰、running=蓝旋转、ready=绿、failed=红

Provision 状态 chip 组件（内嵌在 LicenseList.svelte）：
```svelte
{#snippet provisionChip(status: string | null)}
  {#if status === 'ready'}
    <span class="px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">Ready</span>
  {:else if status === 'running'}
    <span class="px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800 animate-pulse">Running</span>
  {:else if status === 'failed'}
    <span class="px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800">Failed</span>
  {:else}
    <span class="px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600">Pending</span>
  {/if}
{/snippet}
```

**Step 3: 构建 UI**

```bash
bun run --cwd packages/ui build
```
Expected: 无错误输出，生成 `packages/ui/dist/`

**Step 4: 提交**

```bash
git add packages/ui/src/lib/api.ts packages/ui/src/lib/LicenseList.svelte
git commit -m "feat: update UI License type and add provision status display"
```

---

### Task 9: Env & Docs

**Files:**
- Modify: `.env.example`

**Step 1: 更新 .env.example**

在现有内容末尾追加：

```env
# Provisioning
OPENCLAW_DATA_DIR=/data/openclaw
OPENCLAW_RUNTIME_DIR=/opt/openclaw
OPENCLAW_PROVISION_SCRIPT=
OPENCLAW_HOST_IP=192.168.1.100
OPENCLAW_GATEWAY_PORT_START=18789
OPENCLAW_GATEWAY_PORT_END=18999
OPENCLAW_BRIDGE_PORT_START=28789
OPENCLAW_BRIDGE_PORT_END=28999
OPENCLAW_BASE_DOMAIN=
NGINX_SITE_DIR=/etc/nginx/conf.d/openclaw
NGINX_RELOAD_CMD=nginx -s reload
```

**Step 2: 提交**

```bash
git add .env.example
git commit -m "docs: add provisioning env vars to .env.example"
```

---

## Acceptance Checklist

- [ ] `POST /api/licenses` 在 200ms 内返回 201，`provision_status=pending`
- [ ] Worker 成功后 `provision_status=ready`，`container_name` 非空
- [ ] 无域名模式 URL 为 `ws://IP:port`
- [ ] 域名模式 URL 为 `wss://subdomain.domain`，nginx conf 写入成功
- [ ] Worker 失败后 `provision_status=failed`，`provision_error` 有值
- [ ] `verify` 对 `pending/running` 返回 409 `PROVISIONING_PENDING`
- [ ] `verify` 对 `failed` 返回 409 `PROVISIONING_FAILED`
- [ ] `verify` 对 `ready` 正常激活，触发 approve（按容器名）
- [ ] `verify` 对 `null` provision_status（旧数据）正常通过
- [ ] 端口池耗尽返回 503 `NO_AVAILABLE_PORT`
- [ ] 非法 `ownerTag` 返回 400 `INVALID_OWNER_TAG`
- [ ] 服务重启后 `pending/running` 任务自动恢复
- [ ] UI 展示 provision_status chip、container_name、gateway_url
- [ ] `bun run --cwd packages/ui build` 无报错
