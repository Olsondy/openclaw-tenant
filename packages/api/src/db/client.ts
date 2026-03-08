import { Database } from "bun:sqlite";
import bcrypt from "bcryptjs";
import { ensureSettingsRow } from "../services/settingsService";
import { SCHEMA_SQL } from "./schema";

let _db: Database | null = null;

export function getDb(): Database {
  if (_db) return _db;

  const dbPath = process.env.DB_PATH ?? "openclaw.db";
  _db = new Database(dbPath, { create: true });
  _db.run("PRAGMA journal_mode=WAL");
  _db.run(SCHEMA_SQL);
  ensureLicenseColumns(_db);
  ensureModelPresetColumns(_db);
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
    ["token_expires_at", "TEXT"],
    ["token_ttl_days", "INTEGER DEFAULT 7"],
    ["exec_public_key", "TEXT"],
    ["provider_id", "TEXT"],
    ["provider_label", "TEXT"],
    ["base_url", "TEXT"],
    ["api", "TEXT"],
    ["model_id", "TEXT"],
    ["model_name", "TEXT"],
    ["api_key_enc", "TEXT"],
  ];

  for (const [colName, colDef] of newColumns) {
    if (!existingColumns.has(colName)) {
      db.run(`ALTER TABLE licenses ADD COLUMN ${colName} ${colDef}`);
    }
  }

  db.run("UPDATE licenses SET provision_status = 'ready' WHERE provision_status IS NULL");
}

function ensureModelPresetColumns(db: Database): void {
  const rows = db.query("PRAGMA table_info(model_presets)").all() as Array<{ name: string }>;
  const existingColumns = new Set(rows.map((r) => r.name));

  const newColumns: Array<[string, string]> = [
    ["model_name", "TEXT NOT NULL DEFAULT ''"],
    ["api_key_enc", "TEXT"],
  ];

  for (const [colName, colDef] of newColumns) {
    if (!existingColumns.has(colName)) {
      db.run(`ALTER TABLE model_presets ADD COLUMN ${colName} ${colDef}`);
    }
  }

  db.run("UPDATE model_presets SET model_name=model_id WHERE model_name IS NULL OR model_name=''");
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
