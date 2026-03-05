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

## Verify/Approve Integration

| Variable | Default | Required | Purpose |
|---|---|---|---|
| `DOCKER_APPROVE_CMD` | - | No | Command executed after successful verify |

Notes:
- If unset, no approve command is executed.
- Supports `{{container}}` placeholder for per-license container targeting.

## Provisioning Variables

| Variable | Default | Required | Purpose |
|---|---|---|---|
| `OPENCLAW_DATA_DIR` | `/data/openclaw` | Yes for provisioning | Host data root for per-license dirs |
| `OPENCLAW_RUNTIME_DIR` | `/opt/openclaw` | Yes for provisioning | Directory where setup script runs |
| `OPENCLAW_PROVISION_SCRIPT` | `${OPENCLAW_RUNTIME_DIR}/docker-setup.sh` | No | Script path override |
| `OPENCLAW_HOST_IP` | `192.168.1.100` | No | Non-domain gateway/web URL host |
| `OPENCLAW_GATEWAY_PORT_START` | `18789` | No | Gateway port range start |
| `OPENCLAW_GATEWAY_PORT_END` | `18999` | No | Gateway port range end |
| `OPENCLAW_BRIDGE_PORT_START` | `28789` | No | Bridge port range start |
| `OPENCLAW_BRIDGE_PORT_END` | `28999` | No | Bridge port range end |
| `OPENCLAW_BASE_DOMAIN` | empty | No | Enable domain mode when set |
| `NGINX_SITE_DIR` | `/etc/nginx/conf.d/openclaw` | Domain mode | Where generated nginx conf is written |
| `NGINX_RELOAD_CMD` | `nginx -s reload` | Domain mode | Nginx reload command |

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
