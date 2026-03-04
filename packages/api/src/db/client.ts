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
  _db?.close();
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
