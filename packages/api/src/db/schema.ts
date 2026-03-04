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
