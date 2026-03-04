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
