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
