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
    runtime_provider     TEXT,
    runtime_dir          TEXT,
    data_dir             TEXT,
    token_expires_at     TEXT,
    token_ttl_days       INTEGER DEFAULT 7,
    exec_public_key      TEXT,
    wizard_feishu_done   INTEGER NOT NULL DEFAULT 0,
    provider_id          TEXT,
    provider_label       TEXT,
    base_url             TEXT,
    api                  TEXT,
    model_id             TEXT,
    model_name           TEXT,
    api_key_enc          TEXT
  );

  CREATE TABLE IF NOT EXISTS admin_users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS settings (
    id                  INTEGER PRIMARY KEY CHECK (id = 1),
    runtime_provider    TEXT NOT NULL DEFAULT 'docker',
    runtime_dir         TEXT NOT NULL,
    data_dir            TEXT NOT NULL,
    host_ip             TEXT NOT NULL DEFAULT '127.0.0.1',
    base_domain         TEXT,
    gateway_port_start  INTEGER NOT NULL DEFAULT 18789,
    gateway_port_end    INTEGER NOT NULL DEFAULT 18999,
    bridge_port_start   INTEGER NOT NULL DEFAULT 28789,
    bridge_port_end     INTEGER NOT NULL DEFAULT 28999,
    updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS model_presets (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    provider_id  TEXT NOT NULL UNIQUE,
    label        TEXT NOT NULL,
    base_url     TEXT NOT NULL,
    api          TEXT NOT NULL,
    model_id     TEXT NOT NULL,
    model_name   TEXT NOT NULL DEFAULT '',
    api_key_enc  TEXT,
    enabled      INTEGER NOT NULL DEFAULT 1,
    updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
  );

  INSERT OR IGNORE INTO model_presets
    (provider_id, label, base_url, api, model_id, model_name, enabled)
  VALUES
    ('zai', 'GLM-4.7 Flash (智谱AI)',
     'https://open.bigmodel.cn/api/paas/v4/',
     'openai-completions', 'glm-4.7-flash', 'GLM-4.7 Flash', 1);
`;
