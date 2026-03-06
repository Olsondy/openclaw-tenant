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
| `OPENCLAW_DATA_DIR` | `/data/openclaw` | No | Initial default for `settings.data_dir` |
| `OPENCLAW_RUNTIME_DIR` | `/opt/openclaw` | No | Initial default for `settings.runtime_dir` |
| `OPENCLAW_HOST_IP` | `127.0.0.1` | No | Initial default for `settings.host_ip` |
| `OPENCLAW_GATEWAY_PORT_START` | `18789` | No | Initial default for `settings.gateway_port_start` |
| `OPENCLAW_GATEWAY_PORT_END` | `18999` | No | Initial default for `settings.gateway_port_end` |
| `OPENCLAW_BRIDGE_PORT_START` | `28789` | No | Initial default for `settings.bridge_port_start` |
| `OPENCLAW_BRIDGE_PORT_END` | `28999` | No | Initial default for `settings.bridge_port_end` |
| `OPENCLAW_BASE_DOMAIN` | empty | No | Initial default for `settings.base_domain` |
| `NGINX_SITE_DIR` | `/etc/nginx/conf.d/openclaw` | Domain mode | Where generated nginx conf is written |
| `NGINX_RELOAD_CMD` | `nginx -s reload` | Domain mode | Nginx reload command |

## Precedence Notes
- `OPENCLAW_*` values are used to seed `settings` row when it does not exist.
- After `settings` row is created, global config is managed by DB/UI (`/api/settings`).
- On `POST /api/licenses`, effective runtime/domain values are copied into license row as snapshot.
- Provisioning should execute against values stored on each license (`runtime_provider/runtime_dir/data_dir/nginx_host`).

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
