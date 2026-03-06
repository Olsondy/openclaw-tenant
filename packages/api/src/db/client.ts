import { Database } from "bun:sqlite";
import bcrypt from "bcryptjs";
import { SCHEMA_SQL } from "./schema";
import { ensureSettingsRow } from "../services/settingsService";

let _db: Database | null = null;

export function getDb(): Database {
  if (_db) return _db;

  const dbPath = process.env.DB_PATH ?? "openclaw.db";
  _db = new Database(dbPath, { create: true });
  _db.run("PRAGMA journal_mode=WAL");
  _db.run(SCHEMA_SQL);
  ensureLicenseColumns(_db);
  ensureSettingsRow(_db);
  seedAdmin(_db);
  return _db;
}

/** Only used in tests to reset singleton */
export function resetDb(): void {
  _db?.close();
  _db = null;
}

function ensureLicenseColumns(db: Database): void {
  const rows = db.query("PRAGMA table_info(licenses)").all() as Array<{ name: string }>;
  const existingColumns = new Set(rows.map((r) => r.name));

  const newColumns: Array<[string, string]> = [
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
    ["runtime_provider", "TEXT"],
    ["runtime_dir", "TEXT"],
    ["data_dir", "TEXT"],
    ["auth_token", "TEXT"],
    ["token_expires_at", "TEXT"],
    ["token_ttl_days", "INTEGER DEFAULT 30"],
    ["exec_public_key", "TEXT"],
  ];

  for (const [colName, colDef] of newColumns) {
    if (!existingColumns.has(colName)) {
      db.run(`ALTER TABLE licenses ADD COLUMN ${colName} ${colDef}`);
    }
  }

  db.run("UPDATE licenses SET provision_status = 'ready' WHERE provision_status IS NULL");
}

function seedAdmin(db: Database): void {
  const username = process.env.ADMIN_USER ?? "admin";
  const password = process.env.ADMIN_PASS ?? "admin123";
  const existing = db.query("SELECT id FROM admin_users WHERE username = ?").get(username);
  if (!existing) {
    const hash = bcrypt.hashSync(password, 10);
    db.run("INSERT INTO admin_users (username, password_hash) VALUES (?, ?)", [username, hash]);
  }
}
