# ENVIRONMENT

## Scope
Runtime environment contract for API/UI startup and provisioning operations.

## Core Variables

| Variable | Default | Required | Purpose |
|---|---|---|---|
| `PORT` | `3000` | No | API server port |
| `JWT_SECRET` | - | Yes (prod) | JWT sign/verify secret |
| `ADMIN_USER` | `admin` | No | Seeded admin username |
| `ADMIN_PASS` | `admin123` | No | Seeded admin password |
| `DB_PATH` | `openclaw.db` | No | SQLite file path |
| `UI_DIST_PATH` | `../ui/dist` | No | Static UI output directory |

## Provisioning / Settings Seed Variables

| Variable | Default | Required | Purpose |
|---|---|---|---|
| `OPENCLAW_DATA_DIR` | - | **Yes** | Instance data root dir (per-license config/workspace parent) |
| `OPENCLAW_RUNTIME_DIR` | - | **Yes** | Directory containing docker-compose.yml and provision scripts |
| `OPENCLAW_RUNTIME_PROVIDER` | auto-detect | No | `docker` or `podman` (auto-detected via socket if omitted) |
| `OPENCLAW_EXTENSIONS` | `feishu` | No | Docker build arg passthrough for extension preinstall |
| `OPENCLAW_INSTALL_BROWSER` | empty | No | Docker build arg passthrough; non-empty installs Chromium + Xvfb into image |
| `OPENCLAW_HOST_IP` | `127.0.0.1` | No | Host IP for gateway URL generation |
| `OPENCLAW_GATEWAY_PORT_START` | `18789` | No | Gateway port range start |
| `OPENCLAW_GATEWAY_PORT_END` | `18999` | No | Gateway port range end |
| `OPENCLAW_BRIDGE_PORT_START` | `28789` | No | Bridge port range start |
| `OPENCLAW_BRIDGE_PORT_END` | `28999` | No | Bridge port range end |
| `OPENCLAW_BASE_DOMAIN` | empty | No | Base domain for per-instance subdomain routing |
| `NGINX_SITE_DIR` | `/etc/nginx/conf.d/openclaw` | Domain mode | Where generated nginx conf is written |
| `NGINX_RELOAD_CMD` | `nginx -s reload` | Domain mode | Nginx reload command |
| `TENANT_PUBLIC_URL` | empty | No | Externally-reachable tenant API URL (used by exec bootstrap) |

### Path Resolution
`OPENCLAW_RUNTIME_DIR` 和 `OPENCLAW_DATA_DIR` 支持相对路径（如 `./openclaw`、`./openclaw-data`）。
API 启动时通过向上查找 `.env` 文件定位项目根目录，所有相对路径基于项目根 `resolve()`。

示例（项目根 = `/opt/openclaw-tenant`）：
- `../openclaw` → `/opt/openclaw`
- `../openclaw-data` → `/opt/openclaw-data`

绝对路径不受影响，直接使用。

### Deprecated Variables
以下变量已不再使用，可从 `.env` 中移除：
- `OPENCLAW_PROVISION_SCRIPT` — 已由 `resolveProvisionScriptPath()` 自动按 runtime provider 查找
- `OPENCLAW_IMAGE` — 未被代码引用

## Precedence Notes
- `OPENCLAW_*` values are used to seed `settings` row when it does not exist.
- After `settings` row is created, global config is managed by DB/UI (`/api/settings`).
- On `POST /api/licenses`, effective runtime/domain values are copied into license row as snapshot.
- Provisioning should execute against values stored on each license (`runtime_provider/runtime_dir/data_dir/nginx_host`).
- `runtime_dir`/`data_dir` 从 license 行读取后会再次 `resolve()`，确保历史存入的相对路径也能正确解析。

## Local Development Baseline
1. Copy `.env.example` to `.env`.
2. Start API: `bun run dev:api`.
3. Start UI: `bun run dev:ui`.
4. For production-style serving, build UI then run API:
   - `bun run build:ui`
   - `bun run start`

## Validation Tips
- If login fails with 500, verify `JWT_SECRET` exists.
- If license creation returns `NO_AVAILABLE_PORT`, expand port ranges.
- If verify returns provisioning errors, inspect API logs and `provision_error` column in `licenses` table.
