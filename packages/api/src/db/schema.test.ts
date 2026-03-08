import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { getDb, resetDb } from "./client";
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

  test("creates settings table", () => {
    const db = new Database(":memory:");
    db.run(SCHEMA_SQL);
    const row = db
      .query("SELECT name FROM sqlite_master WHERE type='table' AND name='settings'")
      .get();
    expect(row).toBeTruthy();
  });

  test("licenses table has required columns", () => {
    const db = new Database(":memory:");
    db.run(SCHEMA_SQL);
    db.run(
      `INSERT INTO licenses (license_key, gateway_token, gateway_url)
       VALUES ('TEST-KEY-000', 'tok', 'ws://x')`,
    );
    const row = db.query("SELECT * FROM licenses").get() as Record<string, unknown>;
    expect(row.status).toBe("unbound");
    expect(row.hwid).toBeNull();
  });
});

describe("ensureLicenseColumns", () => {
  beforeEach(() => {
    process.env.DB_PATH = ":memory:";
    resetDb();
  });

  afterEach(() => {
    resetDb();
    delete process.env.DB_PATH;
  });

  test("licenses table has provision columns", () => {
    const db = getDb();
    const rows = db.query("PRAGMA table_info(licenses)").all() as Array<{ name: string }>;
    const columnNames = rows.map((r) => r.name);

    const expectedColumns = [
      "owner_tag",
      "compose_project",
      "container_id",
      "container_name",
      "gateway_port",
      "bridge_port",
      "webui_url",
      "provision_status",
      "provision_error",
      "provision_started_at",
      "provision_completed_at",
      "nginx_host",
      "exec_public_key",
      "runtime_provider",
      "runtime_dir",
      "data_dir",
      "provider_id",
      "provider_label",
      "base_url",
      "api",
      "model_id",
      "model_name",
      "api_key_enc",
    ];

    for (const col of expectedColumns) {
      expect(columnNames).toContain(col);
    }
  });

  test("model_presets table has model_name column", () => {
    const db = getDb();
    const rows = db.query("PRAGMA table_info(model_presets)").all() as Array<{ name: string }>;
    const columnNames = rows.map((r) => r.name);
    expect(columnNames).toContain("model_name");
  });

  test("initializes default settings row", () => {
    const db = getDb();
    const row = db.query("SELECT id FROM settings WHERE id = 1").get() as Record<string, unknown>;
    expect(row.id).toBe(1);
  });

  test("ensureLicenseColumns sets NULL provision_status to ready on existing rows", () => {
    const dbFile = join(tmpdir(), `openclaw-schema-migration-${Date.now()}.db`);
    process.env.DB_PATH = dbFile;
    resetDb();

    const db = getDb();
    db.run(
      `INSERT INTO licenses (license_key, gateway_token, gateway_url, provision_status)
       VALUES ('MIGRATION-TEST-001', 'tok', 'ws://x', NULL)`,
    );

    resetDb();
    const db2 = getDb();

    const row = db2
      .query("SELECT provision_status FROM licenses WHERE license_key = 'MIGRATION-TEST-001'")
      .get() as Record<string, unknown>;
    expect(row.provision_status).toBe("ready");

    resetDb();
    rmSync(dbFile, { force: true });
  });
});
