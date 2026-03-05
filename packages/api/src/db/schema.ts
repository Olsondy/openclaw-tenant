export const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS licenses (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    license_key   TEXT UNIQUE NOT NULL,
    hwid          TEXT,
    device_name   TEXT,
    agent_id      TEXT,
    gateway_token TEXT NOT NULL DEFAULT '',
    gateway_url   TEXT NOT NULL DEFAULT '',
    status        TEXT DEFAULT 'unbound',
    expiry_date   TEXT,
    note          TEXT,
    created_at    TEXT DEFAULT (datetime('now')),
    bound_at      TEXT,
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
    nginx_host           TEXT,
    auth_token           TEXT,
    token_expires_at     TEXT,
    token_ttl_days       INTEGER DEFAULT 30
  );

  CREATE TABLE IF NOT EXISTS admin_users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL
  );
`;
