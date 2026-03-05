# OpenClaw Auth Service — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a Bun.js + Hono authorization service with SQLite and a Svelte + Tailwind admin dashboard.

**Architecture:** Bun monorepo with `packages/api` (Hono + bun:sqlite) and `packages/ui` (Svelte 5 + Vite + Tailwind v4). Svelte builds to static files served by Hono at `/`. All API routes live under `/api/*`. Single process, single port.

**Tech Stack:** Bun runtime, Hono 4, bun:sqlite, bcryptjs, hono/jwt, Svelte 5, Vite, Tailwind CSS v4, @tailwindcss/forms

---

## Task 1: Root Workspace Setup

**Files:**
- Create: `package.json`
- Create: `.env.example`
- Create: `.gitignore`

**Step 1: Create root package.json**

```json
{
  "name": "easy-openclaw-auth",
  "private": true,
  "workspaces": ["packages/*"],
  "scripts": {
    "dev:api": "bun run --cwd packages/api dev",
    "dev:ui": "bun run --cwd packages/ui dev",
    "build:ui": "bun run --cwd packages/ui build",
    "start": "bun run --cwd packages/api start"
  }
}
```

**Step 2: Create .env.example**

```env
PORT=3000
JWT_SECRET=change-me-in-production
ADMIN_USER=admin
ADMIN_PASS=change-me
DB_PATH=openclaw.db
OPENCLAW_CONFIG_PATH=/path/to/openclaw.json
DOCKER_APPROVE_CMD=docker exec openclaw-gateway curl -X POST http://localhost:8080/approve
UI_DIST_PATH=../ui/dist
```

**Step 3: Create .gitignore**

```
node_modules/
*.db
.env
packages/ui/dist/
```

**Step 4: Commit**

```bash
git init
git add package.json .env.example .gitignore
git commit -m "chore: init monorepo workspace"
```

---

## Task 2: API Package Setup

**Files:**
- Create: `packages/api/package.json`
- Create: `packages/api/tsconfig.json`

**Step 1: Create packages/api/package.json**

```json
{
  "name": "@openclaw/api",
  "private": true,
  "scripts": {
    "dev": "bun run --watch src/index.ts",
    "start": "bun run src/index.ts",
    "test": "bun test"
  },
  "dependencies": {
    "hono": "^4.7.0",
    "bcryptjs": "^2.4.3"
  },
  "devDependencies": {
    "@types/bcryptjs": "^2.4.6"
  }
}
```

**Step 2: Create packages/api/tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "skipLibCheck": true
  }
}
```

**Step 3: Install dependencies**

```bash
cd packages/api && bun install
```

Expected: `node_modules` created with hono and bcryptjs.

**Step 4: Commit**

```bash
git add packages/api/
git commit -m "chore: add api package setup"
```

---

## Task 3: Database Schema

**Files:**
- Create: `packages/api/src/db/schema.ts`
- Create: `packages/api/src/db/schema.test.ts`

**Step 1: Write failing test**

```typescript
// packages/api/src/db/schema.test.ts
import { describe, test, expect } from "bun:test";
import { Database } from "bun:sqlite";
import { SCHEMA_SQL } from "./schema";

describe("SCHEMA_SQL", () => {
  test("creates licenses table", () => {
    const db = new Database(":memory:");
    db.run(SCHEMA_SQL);
    const row = db
      .query("SELECT name FROM sqlite_master WHERE type='table' AND name='licenses'")
      .get();
    expect(row).toBeTruthy();
  });

  test("creates admin_users table", () => {
    const db = new Database(":memory:");
    db.run(SCHEMA_SQL);
    const row = db
      .query("SELECT name FROM sqlite_master WHERE type='table' AND name='admin_users'")
      .get();
    expect(row).toBeTruthy();
  });

  test("licenses table has required columns", () => {
    const db = new Database(":memory:");
    db.run(SCHEMA_SQL);
    db.run(
      `INSERT INTO licenses (license_key, gateway_token, gateway_url)
       VALUES ('TEST-KEY-000', 'tok', 'ws://x')`
    );
    const row = db.query("SELECT * FROM licenses").get() as Record<string, unknown>;
    expect(row.status).toBe("unbound");
    expect(row.hwid).toBeNull();
  });
});
```

**Step 2: Run to verify failure**

```bash
cd packages/api && bun test src/db/schema.test.ts
```

Expected: FAIL — `Cannot find module './schema'`

**Step 3: Implement schema.ts**

```typescript
// packages/api/src/db/schema.ts
export const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS licenses (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    license_key   TEXT UNIQUE NOT NULL,
    hwid          TEXT,
    device_name   TEXT,
    agent_id      TEXT,
    gateway_token TEXT NOT NULL,
    gateway_url   TEXT NOT NULL,
    status        TEXT DEFAULT 'unbound',
    expiry_date   TEXT,
    note          TEXT,
    created_at    TEXT DEFAULT (datetime('now')),
    bound_at      TEXT
  );

  CREATE TABLE IF NOT EXISTS admin_users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL
  );
`;
```

**Step 4: Run tests to verify passing**

```bash
cd packages/api && bun test src/db/schema.test.ts
```

Expected: 3 tests PASS

**Step 5: Commit**

```bash
git add packages/api/src/db/schema.ts packages/api/src/db/schema.test.ts
git commit -m "feat: add database schema"
```

---

## Task 4: Database Client

**Files:**
- Create: `packages/api/src/db/client.ts`
- Create: `packages/api/src/db/client.test.ts`

**Step 1: Write failing test**

```typescript
// packages/api/src/db/client.test.ts
import { describe, test, expect, beforeEach } from "bun:test";
import { getDb, resetDb } from "./client";

describe("getDb", () => {
  beforeEach(() => resetDb());

  test("returns a database instance", () => {
    process.env.DB_PATH = ":memory:";
    process.env.ADMIN_USER = "testadmin";
    process.env.ADMIN_PASS = "testpass";
    const db = getDb();
    expect(db).toBeTruthy();
  });

  test("seeds admin user on first call", () => {
    process.env.DB_PATH = ":memory:";
    process.env.ADMIN_USER = "admin";
    process.env.ADMIN_PASS = "secret";
    const db = getDb();
    const user = db.query("SELECT username FROM admin_users").get() as { username: string } | null;
    expect(user?.username).toBe("admin");
  });

  test("does not duplicate admin user on repeated calls", () => {
    process.env.DB_PATH = ":memory:";
    getDb();
    getDb();
    const db = getDb();
    const count = db.query("SELECT COUNT(*) as n FROM admin_users").get() as { n: number };
    expect(count.n).toBe(1);
  });
});
```

**Step 2: Run to verify failure**

```bash
cd packages/api && bun test src/db/client.test.ts
```

Expected: FAIL — `Cannot find module './client'`

**Step 3: Implement client.ts**

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
  seedAdmin(_db);
  return _db;
}

/** Only used in tests to reset singleton */
export function resetDb(): void {
  _db = null;
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

**Step 4: Run tests to verify passing**

```bash
cd packages/api && bun test src/db/client.test.ts
```

Expected: 3 tests PASS

**Step 5: Commit**

```bash
git add packages/api/src/db/client.ts packages/api/src/db/client.test.ts
git commit -m "feat: add database client with auto-migrate and admin seeding"
```

---

## Task 5: License Service (Pure Functions)

**Files:**
- Create: `packages/api/src/services/licenseService.ts`
- Create: `packages/api/src/services/licenseService.test.ts`

**Step 1: Write failing tests**

```typescript
// packages/api/src/services/licenseService.test.ts
import { describe, test, expect } from "bun:test";
import { generateLicenseKey, generateAgentId, isExpired } from "./licenseService";

describe("generateLicenseKey", () => {
  test("matches XXXXX-XXXXX-XXXXX-XXXXX format", () => {
    const key = generateLicenseKey();
    expect(key).toMatch(/^[A-Z0-9]{5}-[A-Z0-9]{5}-[A-Z0-9]{5}-[A-Z0-9]{5}$/);
  });

  test("generates unique keys", () => {
    const keys = new Set(Array.from({ length: 200 }, generateLicenseKey));
    expect(keys.size).toBe(200);
  });
});

describe("generateAgentId", () => {
  test("returns 16-char hex string", () => {
    const id = generateAgentId("hwid-abc");
    expect(id).toMatch(/^[0-9a-f]{16}$/);
  });

  test("is deterministic for same HWID", () => {
    expect(generateAgentId("same")).toBe(generateAgentId("same"));
  });

  test("different HWIDs produce different IDs", () => {
    expect(generateAgentId("hwid-1")).not.toBe(generateAgentId("hwid-2"));
  });
});

describe("isExpired", () => {
  test("null means permanent — not expired", () => {
    expect(isExpired(null)).toBe(false);
  });

  test("past date is expired", () => {
    expect(isExpired("2020-01-01")).toBe(true);
  });

  test("future date is not expired", () => {
    expect(isExpired("2099-12-31")).toBe(false);
  });
});
```

**Step 2: Run to verify failure**

```bash
cd packages/api && bun test src/services/licenseService.test.ts
```

Expected: FAIL — `Cannot find module './licenseService'`

**Step 3: Implement licenseService.ts**

```typescript
// packages/api/src/services/licenseService.ts
import { createHash, randomBytes } from "crypto";

const CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

function randomSegment(): string {
  return Array.from({ length: 5 }, () => {
    const byte = randomBytes(1)[0];
    return CHARS[byte % CHARS.length];
  }).join("");
}

export function generateLicenseKey(): string {
  return [randomSegment(), randomSegment(), randomSegment(), randomSegment()].join("-");
}

export function generateAgentId(hwid: string): string {
  return createHash("sha256").update(hwid).digest("hex").slice(0, 16);
}

export function isExpired(expiryDate: string | null): boolean {
  if (!expiryDate) return false;
  return new Date(expiryDate) < new Date();
}
```

**Step 4: Run tests to verify passing**

```bash
cd packages/api && bun test src/services/licenseService.test.ts
```

Expected: 7 tests PASS

**Step 5: Commit**

```bash
git add packages/api/src/services/licenseService.ts packages/api/src/services/licenseService.test.ts
git commit -m "feat: add license key generation and agent ID services"
```

---

## Task 6: OpenClaw Config Service

**Files:**
- Create: `packages/api/src/services/openclawConfig.ts`
- Create: `packages/api/src/services/openclawConfig.test.ts`

**Step 1: Write failing tests**

```typescript
// packages/api/src/services/openclawConfig.test.ts
import { describe, test, expect, afterEach } from "bun:test";
import { readOpenclawConfig } from "./openclawConfig";
import { join } from "path";
import { tmpdir } from "os";
import { writeFileSync, unlinkSync } from "fs";

const tmpFile = join(tmpdir(), "test-openclaw.json");

afterEach(() => {
  try { unlinkSync(tmpFile); } catch {}
  delete process.env.OPENCLAW_CONFIG_PATH;
});

describe("readOpenclawConfig", () => {
  test("throws if OPENCLAW_CONFIG_PATH not set", async () => {
    delete process.env.OPENCLAW_CONFIG_PATH;
    await expect(readOpenclawConfig()).rejects.toThrow("OPENCLAW_CONFIG_PATH");
  });

  test("throws if file does not exist", async () => {
    process.env.OPENCLAW_CONFIG_PATH = "/nonexistent/openclaw.json";
    await expect(readOpenclawConfig()).rejects.toThrow("not found");
  });

  test("throws if token or gatewayUrl missing", async () => {
    writeFileSync(tmpFile, JSON.stringify({ token: "abc" }));
    process.env.OPENCLAW_CONFIG_PATH = tmpFile;
    await expect(readOpenclawConfig()).rejects.toThrow("token");
  });

  test("returns token and gatewayUrl from valid file", async () => {
    writeFileSync(tmpFile, JSON.stringify({ token: "my-token", gatewayUrl: "ws://x:18789" }));
    process.env.OPENCLAW_CONFIG_PATH = tmpFile;
    const config = await readOpenclawConfig();
    expect(config.token).toBe("my-token");
    expect(config.gatewayUrl).toBe("ws://x:18789");
  });
});
```

**Step 2: Run to verify failure**

```bash
cd packages/api && bun test src/services/openclawConfig.test.ts
```

Expected: FAIL — `Cannot find module './openclawConfig'`

**Step 3: Implement openclawConfig.ts**

```typescript
// packages/api/src/services/openclawConfig.ts
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
```

**Step 4: Run tests to verify passing**

```bash
cd packages/api && bun test src/services/openclawConfig.test.ts
```

Expected: 4 tests PASS

**Step 5: Commit**

```bash
git add packages/api/src/services/openclawConfig.ts packages/api/src/services/openclawConfig.test.ts
git commit -m "feat: add openclaw.json config reader"
```

---

## Task 7: Docker Service

**Files:**
- Create: `packages/api/src/services/dockerService.ts`
- Create: `packages/api/src/services/dockerService.test.ts`

**Step 1: Write failing tests**

```typescript
// packages/api/src/services/dockerService.test.ts
import { describe, test, expect } from "bun:test";
import { buildDockerArgs } from "./dockerService";

describe("buildDockerArgs", () => {
  test("returns null when DOCKER_APPROVE_CMD not set", () => {
    delete process.env.DOCKER_APPROVE_CMD;
    expect(buildDockerArgs()).toBeNull();
  });

  test("returns split command array", () => {
    process.env.DOCKER_APPROVE_CMD = "docker exec mycontainer echo hello";
    const args = buildDockerArgs();
    expect(args).toEqual(["docker", "exec", "mycontainer", "echo", "hello"]);
  });
});
```

**Step 2: Run to verify failure**

```bash
cd packages/api && bun test src/services/dockerService.test.ts
```

Expected: FAIL — `Cannot find module './dockerService'`

**Step 3: Implement dockerService.ts**

```typescript
// packages/api/src/services/dockerService.ts
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
```

**Step 4: Run tests to verify passing**

```bash
cd packages/api && bun test src/services/dockerService.test.ts
```

Expected: 2 tests PASS

**Step 5: Commit**

```bash
git add packages/api/src/services/dockerService.ts packages/api/src/services/dockerService.test.ts
git commit -m "feat: add docker exec fire-and-forget service"
```

---

## Task 8: JWT Middleware

**Files:**
- Create: `packages/api/src/middleware/jwt.ts`
- Create: `packages/api/src/middleware/jwt.test.ts`

**Step 1: Write failing tests**

```typescript
// packages/api/src/middleware/jwt.test.ts
import { describe, test, expect } from "bun:test";
import { Hono } from "hono";
import { sign } from "hono/jwt";
import { jwtMiddleware } from "./jwt";

async function makeToken(secret = "test-secret") {
  return sign({ sub: "1", exp: Math.floor(Date.now() / 1000) + 3600 }, secret);
}

describe("jwtMiddleware", () => {
  const app = new Hono();
  app.use("/protected/*", jwtMiddleware);
  app.get("/protected/data", (c) => c.json({ ok: true }));

  test("rejects request with no Authorization header", async () => {
    process.env.JWT_SECRET = "test-secret";
    const res = await app.request("/protected/data");
    expect(res.status).toBe(401);
  });

  test("rejects invalid token", async () => {
    process.env.JWT_SECRET = "test-secret";
    const res = await app.request("/protected/data", {
      headers: { Authorization: "Bearer invalid.token.here" },
    });
    expect(res.status).toBe(401);
  });

  test("allows valid token", async () => {
    process.env.JWT_SECRET = "test-secret";
    const token = await makeToken("test-secret");
    const res = await app.request("/protected/data", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
  });
});
```

**Step 2: Run to verify failure**

```bash
cd packages/api && bun test src/middleware/jwt.test.ts
```

Expected: FAIL — `Cannot find module './jwt'`

**Step 3: Implement jwt.ts**

```typescript
// packages/api/src/middleware/jwt.ts
import { createMiddleware } from "hono/factory";
import { verify } from "hono/jwt";

export const jwtMiddleware = createMiddleware(async (c, next) => {
  const authHeader = c.req.header("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return c.json({ success: false, error: "UNAUTHORIZED" }, 401);
  }

  const token = authHeader.slice(7);
  const secret = process.env.JWT_SECRET ?? "dev-secret";

  try {
    const payload = await verify(token, secret);
    c.set("jwtPayload", payload);
    await next();
  } catch {
    return c.json({ success: false, error: "INVALID_TOKEN" }, 401);
  }
});
```

**Step 4: Run tests to verify passing**

```bash
cd packages/api && bun test src/middleware/jwt.test.ts
```

Expected: 3 tests PASS

**Step 5: Commit**

```bash
git add packages/api/src/middleware/jwt.ts packages/api/src/middleware/jwt.test.ts
git commit -m "feat: add JWT middleware"
```

---

## Task 9: Auth Route

**Files:**
- Create: `packages/api/src/routes/auth.ts`
- Create: `packages/api/src/routes/auth.test.ts`

**Step 1: Write failing tests**

```typescript
// packages/api/src/routes/auth.test.ts
import { describe, test, expect, beforeEach } from "bun:test";
import { Hono } from "hono";
import { resetDb } from "../db/client";
import authRoutes from "./auth";

const app = new Hono();
app.route("/auth", authRoutes);

beforeEach(() => {
  resetDb();
  process.env.DB_PATH = ":memory:";
  process.env.ADMIN_USER = "admin";
  process.env.ADMIN_PASS = "secret123";
  process.env.JWT_SECRET = "test-jwt-secret";
});

describe("POST /auth/login", () => {
  test("returns 400 when fields missing", async () => {
    const res = await app.request("/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  test("returns 401 for wrong password", async () => {
    const res = await app.request("/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "admin", password: "wrong" }),
    });
    expect(res.status).toBe(401);
  });

  test("returns token for correct credentials", async () => {
    const res = await app.request("/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "admin", password: "secret123" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { success: boolean; data: { token: string } };
    expect(body.success).toBe(true);
    expect(typeof body.data.token).toBe("string");
  });
});
```

**Step 2: Run to verify failure**

```bash
cd packages/api && bun test src/routes/auth.test.ts
```

Expected: FAIL — `Cannot find module './auth'`

**Step 3: Implement auth.ts**

```typescript
// packages/api/src/routes/auth.ts
import { Hono } from "hono";
import { sign } from "hono/jwt";
import bcrypt from "bcryptjs";
import { getDb } from "../db/client";

const auth = new Hono();

auth.post("/login", async (c) => {
  const body = await c.req.json<{ username?: string; password?: string }>();
  const { username, password } = body;

  if (!username || !password) {
    return c.json({ success: false, error: "MISSING_CREDENTIALS" }, 400);
  }

  const db = getDb();
  const user = db
    .query<{ id: number; password_hash: string }, string>(
      "SELECT id, password_hash FROM admin_users WHERE username = ?"
    )
    .get(username);

  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return c.json({ success: false, error: "INVALID_CREDENTIALS" }, 401);
  }

  const secret = process.env.JWT_SECRET ?? "dev-secret";
  const token = await sign(
    { sub: String(user.id), username, exp: Math.floor(Date.now() / 1000) + 86400 },
    secret
  );

  return c.json({ success: true, data: { token } });
});

export default auth;
```

**Step 4: Run tests to verify passing**

```bash
cd packages/api && bun test src/routes/auth.test.ts
```

Expected: 3 tests PASS

**Step 5: Commit**

```bash
git add packages/api/src/routes/auth.ts packages/api/src/routes/auth.test.ts
git commit -m "feat: add admin auth login route"
```

---

## Task 10: Licenses Route

**Files:**
- Create: `packages/api/src/routes/licenses.ts`
- Create: `packages/api/src/routes/licenses.test.ts`

**Step 1: Write failing tests**

```typescript
// packages/api/src/routes/licenses.test.ts
import { describe, test, expect, beforeEach } from "bun:test";
import { Hono } from "hono";
import { sign } from "hono/jwt";
import { resetDb } from "../db/client";
import { jwtMiddleware } from "../middleware/jwt";
import licensesRoutes from "./licenses";
import { join } from "path";
import { tmpdir } from "os";
import { writeFileSync } from "fs";

// Write a temp openclaw.json for the test
const tmpConfig = join(tmpdir(), "test-openclaw-lic.json");
writeFileSync(tmpConfig, JSON.stringify({ token: "tok123", gatewayUrl: "ws://test:18789" }));

const app = new Hono();
app.use("/licenses/*", jwtMiddleware);
app.route("/licenses", licensesRoutes);

async function authHeader() {
  const token = await sign(
    { sub: "1", exp: Math.floor(Date.now() / 1000) + 3600 },
    "test-secret"
  );
  return { Authorization: `Bearer ${token}` };
}

beforeEach(() => {
  resetDb();
  process.env.DB_PATH = ":memory:";
  process.env.ADMIN_USER = "admin";
  process.env.ADMIN_PASS = "x";
  process.env.JWT_SECRET = "test-secret";
  process.env.OPENCLAW_CONFIG_PATH = tmpConfig;
});

describe("GET /licenses", () => {
  test("returns 401 without token", async () => {
    const res = await app.request("/licenses");
    expect(res.status).toBe(401);
  });

  test("returns empty array initially", async () => {
    const res = await app.request("/licenses", { headers: await authHeader() });
    const body = await res.json() as { data: unknown[] };
    expect(res.status).toBe(200);
    expect(body.data).toEqual([]);
  });
});

describe("POST /licenses", () => {
  test("generates a license and returns it", async () => {
    const res = await app.request("/licenses", {
      method: "POST",
      headers: await authHeader(),
    });
    expect(res.status).toBe(201);
    const body = await res.json() as { data: { license_key: string; status: string } };
    expect(body.data.license_key).toMatch(/^[A-Z0-9]{5}-[A-Z0-9]{5}-[A-Z0-9]{5}-[A-Z0-9]{5}$/);
    expect(body.data.status).toBe("unbound");
  });
});

describe("PATCH /licenses/:id", () => {
  test("revokes a license", async () => {
    // First generate one
    const genRes = await app.request("/licenses", {
      method: "POST",
      headers: await authHeader(),
    });
    const { data: license } = await genRes.json() as { data: { id: number } };

    const res = await app.request(`/licenses/${license.id}`, {
      method: "PATCH",
      headers: { ...(await authHeader()), "Content-Type": "application/json" },
      body: JSON.stringify({ status: "revoked" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { status: string } };
    expect(body.data.status).toBe("revoked");
  });

  test("returns 404 for nonexistent license", async () => {
    const res = await app.request("/licenses/9999", {
      method: "PATCH",
      headers: { ...(await authHeader()), "Content-Type": "application/json" },
      body: JSON.stringify({ status: "revoked" }),
    });
    expect(res.status).toBe(404);
  });
});
```

**Step 2: Run to verify failure**

```bash
cd packages/api && bun test src/routes/licenses.test.ts
```

Expected: FAIL — `Cannot find module './licenses'`

**Step 3: Implement licenses.ts**

```typescript
// packages/api/src/routes/licenses.ts
import { Hono } from "hono";
import { getDb } from "../db/client";
import { generateLicenseKey } from "../services/licenseService";
import { readOpenclawConfig } from "../services/openclawConfig";

const licenses = new Hono();

licenses.get("/", (c) => {
  const db = getDb();
  const rows = db.query("SELECT * FROM licenses ORDER BY created_at DESC").all();
  return c.json({ success: true, data: rows });
});

licenses.post("/", async (c) => {
  const config = await readOpenclawConfig();
  const licenseKey = generateLicenseKey();
  const db = getDb();

  db.run(
    "INSERT INTO licenses (license_key, gateway_token, gateway_url) VALUES (?, ?, ?)",
    [licenseKey, config.token, config.gatewayUrl]
  );

  const row = db.query("SELECT * FROM licenses WHERE license_key = ?").get(licenseKey);
  return c.json({ success: true, data: row }, 201);
});

licenses.patch("/:id", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json<{ status?: string; note?: string }>();
  const db = getDb();

  const existing = db.query("SELECT id FROM licenses WHERE id = ?").get(id);
  if (!existing) {
    return c.json({ success: false, error: "NOT_FOUND" }, 404);
  }

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

**Step 4: Run tests to verify passing**

```bash
cd packages/api && bun test src/routes/licenses.test.ts
```

Expected: 5 tests PASS

**Step 5: Commit**

```bash
git add packages/api/src/routes/licenses.ts packages/api/src/routes/licenses.test.ts
git commit -m "feat: add licenses CRUD routes"
```

---

## Task 11: Verify Route

**Files:**
- Create: `packages/api/src/routes/verify.ts`
- Create: `packages/api/src/routes/verify.test.ts`

**Step 1: Write failing tests**

```typescript
// packages/api/src/routes/verify.test.ts
import { describe, test, expect, beforeEach } from "bun:test";
import { Hono } from "hono";
import { resetDb, getDb } from "../db/client";
import verifyRoutes from "./verify";

const app = new Hono();
app.route("/verify", verifyRoutes);

function post(body: object) {
  return app.request("/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function seedLicense(status = "unbound", hwid: string | null = null) {
  const db = getDb();
  db.run(
    `INSERT INTO licenses (license_key, gateway_token, gateway_url, status, hwid, agent_id)
     VALUES ('AAAAA-BBBBB-CCCCC-DDDDD', 'tok', 'ws://gw:18789', ?, ?, ?)`,
    [status, hwid, hwid ? "abcdef1234567890" : null]
  );
}

beforeEach(() => {
  resetDb();
  process.env.DB_PATH = ":memory:";
  process.env.ADMIN_USER = "admin";
  process.env.ADMIN_PASS = "x";
  delete process.env.DOCKER_APPROVE_CMD;
});

describe("POST /verify", () => {
  test("returns 400 when fields missing", async () => {
    const res = await post({ hwid: "abc" });
    expect(res.status).toBe(400);
  });

  test("returns 403 for unknown licenseKey", async () => {
    const res = await post({ hwid: "hw1", licenseKey: "XXXXX-XXXXX-XXXXX-XXXXX", deviceName: "PC" });
    expect(res.status).toBe(403);
    const body = await res.json() as { error: string };
    expect(body.error).toBe("INVALID_LICENSE");
  });

  test("binds unbound license on first verify", async () => {
    seedLicense("unbound");
    const res = await post({ hwid: "my-hwid-001", licenseKey: "AAAAA-BBBBB-CCCCC-DDDDD", deviceName: "MyPC" });
    expect(res.status).toBe(200);
    const body = await res.json() as { success: boolean; data: { nodeConfig: { gatewayToken: string; agentId: string } } };
    expect(body.success).toBe(true);
    expect(body.data.nodeConfig.gatewayToken).toBe("tok");
    expect(body.data.nodeConfig.agentId).toMatch(/^[0-9a-f]{16}$/);
  });

  test("allows same HWID on subsequent verify", async () => {
    seedLicense("active", "my-hwid-001");
    const res = await post({ hwid: "my-hwid-001", licenseKey: "AAAAA-BBBBB-CCCCC-DDDDD", deviceName: "MyPC" });
    expect(res.status).toBe(200);
  });

  test("rejects different HWID on active license", async () => {
    seedLicense("active", "original-hwid");
    const res = await post({ hwid: "other-hwid", licenseKey: "AAAAA-BBBBB-CCCCC-DDDDD", deviceName: "PC" });
    expect(res.status).toBe(403);
    const body = await res.json() as { error: string };
    expect(body.error).toBe("HWID_MISMATCH");
  });

  test("rejects revoked license", async () => {
    seedLicense("revoked", "some-hwid");
    const res = await post({ hwid: "some-hwid", licenseKey: "AAAAA-BBBBB-CCCCC-DDDDD", deviceName: "PC" });
    expect(res.status).toBe(403);
    const body = await res.json() as { error: string };
    expect(body.error).toBe("LICENSE_REVOKED");
  });
});
```

**Step 2: Run to verify failure**

```bash
cd packages/api && bun test src/routes/verify.test.ts
```

Expected: FAIL — `Cannot find module './verify'`

**Step 3: Implement verify.ts**

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
}

const verify = new Hono();

verify.post("/", async (c) => {
  const body = await c.req.json<Partial<VerifyBody>>();
  const { hwid, licenseKey, deviceName } = body;

  if (!hwid || !licenseKey || !deviceName) {
    return c.json({ success: false, error: "MISSING_FIELDS" }, 400);
  }

  const db = getDb();
  const license = db
    .query<LicenseRow, string>("SELECT * FROM licenses WHERE license_key = ?")
    .get(licenseKey);

  if (!license) return c.json({ success: false, error: "INVALID_LICENSE" }, 403);
  if (license.status === "revoked") return c.json({ success: false, error: "LICENSE_REVOKED" }, 403);
  if (isExpired(license.expiry_date)) return c.json({ success: false, error: "LICENSE_EXPIRED" }, 403);

  let agentId: string;

  if (license.status === "unbound") {
    agentId = generateAgentId(hwid);
    db.run(
      `UPDATE licenses
       SET hwid = ?, device_name = ?, agent_id = ?, status = 'active', bound_at = datetime('now')
       WHERE license_key = ?`,
      [hwid, deviceName, agentId, licenseKey]
    );
  } else {
    if (license.hwid !== hwid) return c.json({ success: false, error: "HWID_MISMATCH" }, 403);
    agentId = license.agent_id!;
  }

  spawnDockerApprove(hwid, licenseKey);

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

**Step 4: Run tests to verify passing**

```bash
cd packages/api && bun test src/routes/verify.test.ts
```

Expected: 6 tests PASS

**Step 5: Run all API tests**

```bash
cd packages/api && bun test
```

Expected: All tests PASS

**Step 6: Commit**

```bash
git add packages/api/src/routes/verify.ts packages/api/src/routes/verify.test.ts
git commit -m "feat: add /verify route with HWID binding logic"
```

---

## Task 12: API Entry Point

**Files:**
- Create: `packages/api/src/index.ts`

**Step 1: Implement index.ts**

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

getDb(); // Initialize DB and run migrations on startup

const app = new Hono();

app.use("*", cors());

// Public routes
app.route("/api/auth", authRoutes);
app.route("/api/verify", verifyRoutes);

// Protected routes
app.use("/api/licenses/*", jwtMiddleware);
app.route("/api/licenses", licensesRoutes);

// Serve static UI (built Svelte)
const uiDist = process.env.UI_DIST_PATH ?? "../ui/dist";
app.use("/*", serveStatic({ root: uiDist }));
app.get("*", (c) => {
  return serveStatic({ path: `${uiDist}/index.html` })(c, async () => {});
});

const port = Number(process.env.PORT ?? 3000);
console.log(`🚀 OpenClaw Auth running on http://localhost:${port}`);

export default { port, fetch: app.fetch };
```

**Step 2: Smoke test the API boots**

```bash
cd packages/api
DB_PATH=:memory: ADMIN_USER=admin ADMIN_PASS=admin JWT_SECRET=test OPENCLAW_CONFIG_PATH=/dev/null bun run src/index.ts &
sleep 1
curl -s -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin"}' | cat
kill %1
```

Expected: JSON response with `"success":true` and a token.

**Step 3: Commit**

```bash
git add packages/api/src/index.ts
git commit -m "feat: add hono entry point with static serving and route mounting"
```

---

## Task 13: UI Package Setup

**Files:**
- Create: `packages/ui/package.json`
- Create: `packages/ui/vite.config.ts`
- Create: `packages/ui/index.html`
- Create: `packages/ui/src/app.css`
- Create: `packages/ui/src/main.ts`

**Step 1: Create packages/ui/package.json**

```json
{
  "name": "@openclaw/ui",
  "private": true,
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview"
  },
  "devDependencies": {
    "svelte": "^5.0.0",
    "@sveltejs/vite-plugin-svelte": "^4.0.0",
    "vite": "^6.0.0",
    "tailwindcss": "^4.0.0",
    "@tailwindcss/vite": "^4.0.0",
    "@tailwindcss/forms": "^0.5.0"
  }
}
```

**Step 2: Install dependencies**

```bash
cd packages/ui && bun install
```

**Step 3: Create vite.config.ts**

```typescript
// packages/ui/vite.config.ts
import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [tailwindcss(), svelte()],
  build: { outDir: "dist" },
});
```

**Step 4: Create index.html**

```html
<!doctype html>
<html lang="zh">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>OpenClaw Auth Manager</title>
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link
      href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap"
      rel="stylesheet"
    />
  </head>
  <body class="font-['Inter',sans-serif]">
    <div id="app"></div>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
```

**Step 5: Create src/app.css**

```css
@import "tailwindcss";
@plugin "@tailwindcss/forms";
```

**Step 6: Create src/main.ts**

```typescript
// packages/ui/src/main.ts
import "./app.css";
import App from "./App.svelte";
import { mount } from "svelte";

const app = mount(App, { target: document.getElementById("app")! });
export default app;
```

**Step 7: Commit**

```bash
git add packages/ui/
git commit -m "chore: add ui package with Svelte 5 + Tailwind v4 setup"
```

---

## Task 14: UI — API Client

**Files:**
- Create: `packages/ui/src/lib/api.ts`

**Step 1: Implement api.ts**

```typescript
// packages/ui/src/lib/api.ts
const BASE = "/api";

function getToken(): string | null {
  return localStorage.getItem("jwt");
}

export function saveToken(token: string): void {
  localStorage.setItem("jwt", token);
}

export function clearToken(): void {
  localStorage.removeItem("jwt");
}

export function isLoggedIn(): boolean {
  return !!getToken();
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(init.headers as Record<string, string>),
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(`${BASE}${path}`, { ...init, headers });
  const data = (await res.json()) as { error?: string } & T;
  if (!res.ok) throw new Error((data as { error?: string }).error ?? "Request failed");
  return data;
}

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
}

export const api = {
  login: (username: string, password: string) =>
    request<{ success: boolean; data: { token: string } }>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    }),

  getLicenses: () =>
    request<{ success: boolean; data: License[] }>("/licenses"),

  generateLicense: () =>
    request<{ success: boolean; data: License }>("/licenses", { method: "POST" }),

  revokeLicense: (id: number) =>
    request<{ success: boolean; data: License }>(`/licenses/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ status: "revoked" }),
    }),
};
```

**Step 2: Commit**

```bash
git add packages/ui/src/lib/api.ts
git commit -m "feat: add UI API client with JWT support"
```

---

## Task 15: UI — Login Component

**Files:**
- Create: `packages/ui/src/lib/Login.svelte`

**Step 1: Implement Login.svelte**

```svelte
<!-- packages/ui/src/lib/Login.svelte -->
<script lang="ts">
  import { api, saveToken } from "./api";

  let { onLogin }: { onLogin: () => void } = $props();

  let username = $state("");
  let password = $state("");
  let error = $state("");
  let loading = $state(false);

  async function handleSubmit(e: Event) {
    e.preventDefault();
    error = "";
    loading = true;
    try {
      const res = await api.login(username, password);
      saveToken(res.data.token);
      onLogin();
    } catch (err) {
      error = err instanceof Error ? err.message : "登录失败";
    } finally {
      loading = false;
    }
  }
</script>

<div class="min-h-screen bg-[#f8f9fa] flex items-center justify-center">
  <div class="bg-white rounded-2xl shadow-sm border border-gray-100 p-8 w-full max-w-sm">
    <!-- Logo -->
    <div class="text-center mb-8">
      <div class="w-12 h-12 bg-[#1a73e8] rounded-full flex items-center justify-center mx-auto mb-4">
        <svg class="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
            d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
        </svg>
      </div>
      <h1 class="text-2xl font-medium text-gray-900">OpenClaw Auth</h1>
      <p class="text-sm text-gray-500 mt-1">管理员登录</p>
    </div>

    <form onsubmit={handleSubmit} class="space-y-4">
      <div>
        <label class="block text-sm font-medium text-gray-700 mb-1">用户名</label>
        <input
          type="text"
          bind:value={username}
          placeholder="admin"
          required
          class="w-full rounded-lg border-gray-300 focus:border-[#1a73e8] focus:ring-[#1a73e8] text-sm"
        />
      </div>
      <div>
        <label class="block text-sm font-medium text-gray-700 mb-1">密码</label>
        <input
          type="password"
          bind:value={password}
          required
          class="w-full rounded-lg border-gray-300 focus:border-[#1a73e8] focus:ring-[#1a73e8] text-sm"
        />
      </div>

      {#if error}
        <p class="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>
      {/if}

      <button
        type="submit"
        disabled={loading}
        class="w-full bg-[#1a73e8] hover:bg-[#1557b0] disabled:bg-blue-300 text-white font-medium py-2.5 rounded-lg transition-colors text-sm mt-2"
      >
        {loading ? "登录中..." : "登录"}
      </button>
    </form>
  </div>
</div>
```

**Step 2: Commit**

```bash
git add packages/ui/src/lib/Login.svelte
git commit -m "feat: add Login component with Google Material style"
```

---

## Task 16: UI — License List Component

**Files:**
- Create: `packages/ui/src/lib/LicenseList.svelte`

**Step 1: Implement LicenseList.svelte**

```svelte
<!-- packages/ui/src/lib/LicenseList.svelte -->
<script lang="ts">
  import { api, clearToken, type License } from "./api";

  let { onLogout }: { onLogout: () => void } = $props();

  let licenses = $state<License[]>([]);
  let loading = $state(true);
  let generating = $state(false);
  let error = $state("");

  const STATUS = {
    unbound: { label: "未绑定", cls: "bg-gray-100 text-gray-600" },
    active:  { label: "已激活", cls: "bg-green-100 text-green-700" },
    revoked: { label: "已撤销", cls: "bg-red-100 text-red-600"   },
  } as const;

  async function load() {
    try {
      const res = await api.getLicenses();
      licenses = res.data;
    } catch (e) {
      error = e instanceof Error ? e.message : "加载失败";
    } finally {
      loading = false;
    }
  }

  async function generate() {
    generating = true;
    try {
      const res = await api.generateLicense();
      licenses = [res.data, ...licenses];
    } catch (e) {
      error = e instanceof Error ? e.message : "生成失败";
    } finally {
      generating = false;
    }
  }

  async function revoke(license: License) {
    if (!confirm(`确认撤销 ${license.license_key}？此操作不可恢复。`)) return;
    try {
      await api.revokeLicense(license.id);
      licenses = licenses.map((l) =>
        l.id === license.id ? { ...l, status: "revoked" as const } : l
      );
    } catch (e) {
      error = e instanceof Error ? e.message : "撤销失败";
    }
  }

  function logout() {
    clearToken();
    onLogout();
  }

  $effect(() => { load(); });
</script>

<div class="min-h-screen bg-[#f8f9fa]">
  <!-- Top nav -->
  <nav class="bg-[#1a73e8] shadow">
    <div class="max-w-7xl mx-auto px-6 h-14 flex items-center justify-between">
      <div class="flex items-center gap-2">
        <svg class="w-5 h-5 text-white" fill="currentColor" viewBox="0 0 20 20">
          <path fill-rule="evenodd" d="M18 8a6 6 0 01-7.743 5.743L10 14l-1 1-1 1H6v2H2v-4l4.257-4.257A6 6 0 1118 8zm-6-4a1 1 0 100 2 2 2 0 012 2 1 1 0 102 0 4 4 0 00-4-4z" clip-rule="evenodd" />
        </svg>
        <span class="text-white font-medium text-sm">OpenClaw Auth Manager</span>
      </div>
      <button
        onclick={logout}
        class="text-blue-100 hover:text-white text-sm transition-colors"
      >登出</button>
    </div>
  </nav>

  <!-- Main -->
  <main class="max-w-7xl mx-auto px-6 py-6">
    {#if error}
      <div class="mb-4 bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3 flex justify-between">
        {error}
        <button onclick={() => error = ""} class="text-red-400 hover:text-red-600">✕</button>
      </div>
    {/if}

    <div class="bg-white rounded-xl shadow-sm border border-gray-100">
      <!-- Card header -->
      <div class="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
        <h2 class="text-sm font-medium text-gray-900">License 管理</h2>
        <button
          onclick={generate}
          disabled={generating}
          class="bg-[#1a73e8] hover:bg-[#1557b0] disabled:bg-blue-300 text-white text-xs font-medium px-4 py-2 rounded-lg transition-colors flex items-center gap-1.5"
        >
          {#if generating}
            <span class="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
          {:else}
            <span class="text-base leading-none">+</span>
          {/if}
          生成 License
        </button>
      </div>

      <!-- Table -->
      {#if loading}
        <div class="py-20 text-center text-gray-400 text-sm">加载中...</div>
      {:else if licenses.length === 0}
        <div class="py-20 text-center text-gray-400 text-sm">
          暂无 License，点击右上角按钮生成第一个
        </div>
      {:else}
        <div class="overflow-x-auto">
          <table class="w-full text-sm">
            <thead>
              <tr class="border-b border-gray-100">
                {#each ["License Key", "状态", "设备名", "HWID", "到期日", "创建时间", "操作"] as col}
                  <th class="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wide whitespace-nowrap">
                    {col}
                  </th>
                {/each}
              </tr>
            </thead>
            <tbody class="divide-y divide-gray-50">
              {#each licenses as license (license.id)}
                <tr class="hover:bg-gray-50 transition-colors">
                  <td class="px-6 py-4 font-mono text-xs text-gray-800 whitespace-nowrap">
                    {license.license_key}
                  </td>
                  <td class="px-6 py-4">
                    <span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium {STATUS[license.status].cls}">
                      {STATUS[license.status].label}
                    </span>
                  </td>
                  <td class="px-6 py-4 text-gray-600">{license.device_name ?? "—"}</td>
                  <td class="px-6 py-4 font-mono text-xs text-gray-400">
                    {license.hwid ? license.hwid.slice(0, 12) + "…" : "—"}
                  </td>
                  <td class="px-6 py-4 text-gray-600">{license.expiry_date ?? "永久"}</td>
                  <td class="px-6 py-4 text-gray-400 text-xs whitespace-nowrap">
                    {license.created_at.slice(0, 10)}
                  </td>
                  <td class="px-6 py-4">
                    {#if license.status !== "revoked"}
                      <button
                        onclick={() => revoke(license)}
                        class="text-red-500 hover:text-red-700 text-xs font-medium transition-colors"
                      >撤销</button>
                    {:else}
                      <span class="text-gray-300 text-xs">—</span>
                    {/if}
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {/if}
    </div>
  </main>
</div>
```

**Step 2: Commit**

```bash
git add packages/ui/src/lib/LicenseList.svelte
git commit -m "feat: add LicenseList component with Google Material table"
```

---

## Task 17: UI — App Root

**Files:**
- Create: `packages/ui/src/App.svelte`

**Step 1: Implement App.svelte**

```svelte
<!-- packages/ui/src/App.svelte -->
<script lang="ts">
  import { isLoggedIn } from "./lib/api";
  import Login from "./lib/Login.svelte";
  import LicenseList from "./lib/LicenseList.svelte";

  let loggedIn = $state(isLoggedIn());
</script>

{#if loggedIn}
  <LicenseList onLogout={() => (loggedIn = false)} />
{:else}
  <Login onLogin={() => (loggedIn = true)} />
{/if}
```

**Step 2: Verify UI dev server starts**

```bash
cd packages/ui && bun run dev
```

Expected: Vite dev server at `http://localhost:5173`. Open in browser, see login form with Google-style UI.

**Step 3: Commit**

```bash
git add packages/ui/src/App.svelte
git commit -m "feat: add root App component with login/dashboard state machine"
```

---

## Task 18: Full Integration Build & Smoke Test

**Step 1: Build the UI**

```bash
cd packages/ui && bun run build
```

Expected: `packages/ui/dist/` directory created with `index.html` and assets.

**Step 2: Create .env from example**

```bash
cp .env.example .env
# Edit .env: set OPENCLAW_CONFIG_PATH to an actual json file for testing
echo '{"token":"test-token-123","gatewayUrl":"ws://localhost:18789"}' > /tmp/openclaw.json
```

**Step 3: Start the full stack**

```bash
UI_DIST_PATH=packages/ui/dist \
DB_PATH=test.db \
ADMIN_USER=admin \
ADMIN_PASS=admin123 \
JWT_SECRET=test-secret \
OPENCLAW_CONFIG_PATH=/tmp/openclaw.json \
bun run packages/api/src/index.ts
```

Expected: `🚀 OpenClaw Auth running on http://localhost:3000`

**Step 4: Test the admin UI**

Open `http://localhost:3000` in browser.
- Login with `admin` / `admin123` → dashboard loads
- Click "生成 License" → new row appears in table
- Click "撤销" → status badge turns red "已撤销"

**Step 5: Test /api/verify end-to-end**

```bash
# Get the license key from the UI, then:
curl -s -X POST http://localhost:3000/api/verify \
  -H "Content-Type: application/json" \
  -d '{"hwid":"TEST-HWID-001","licenseKey":"<KEY-FROM-UI>","deviceName":"TestPC"}' | cat
```

Expected:
```json
{
  "success": true,
  "data": {
    "nodeConfig": {
      "gatewayUrl": "ws://localhost:18789",
      "gatewayToken": "test-token-123",
      "agentId": "<16-char-hex>",
      "deviceName": "TestPC"
    },
    "userProfile": {
      "licenseStatus": "Valid",
      "expiryDate": "Permanent"
    }
  }
}
```

**Step 6: Final commit**

```bash
rm test.db 2>/dev/null; true
git add .
git commit -m "feat: complete openclaw auth service with Svelte admin dashboard"
```

---

## Summary

| Task | Description | Tests |
|------|-------------|-------|
| 1 | Root workspace | — |
| 2 | API package setup | — |
| 3 | DB schema | 3 |
| 4 | DB client | 3 |
| 5 | License service | 7 |
| 6 | OpenClaw config service | 4 |
| 7 | Docker service | 2 |
| 8 | JWT middleware | 3 |
| 9 | Auth route | 3 |
| 10 | Licenses route | 5 |
| 11 | Verify route | 6 |
| 12 | API entry point | smoke |
| 13 | UI package setup | — |
| 14 | UI API client | — |
| 15 | Login component | — |
| 16 | LicenseList component | — |
| 17 | App root | — |
| 18 | Integration smoke test | manual |

**Total unit tests: 36**
