# LICENSE_PROVISIONING

## Scope
This document describes the async provisioning pipeline triggered by `POST /api/licenses`.

## State Machine
`provision_status` values in `licenses` table:
- `pending`: created, waiting to run
- `running`: worker is executing script/docker steps
- `ready`: provisioning succeeded, license can pass verify gate
- `failed`: provisioning failed, `provision_error` contains summary

## Trigger Points

### On License Creation
File: `packages/api/src/routes/licenses.ts`

1. Sanitize owner tag (`sanitizeOwnerTag`).
2. Allocate `(gateway_port, bridge_port)` from configured ranges.
3. Generate `license_key` and random `gateway_token`.
4. Insert license row with `provision_status='pending'`.
5. Build `compose_project`, urls, optional `nginx_host`.
6. Enqueue async job via `enqueueLicenseProvisioning(id)`.

### On API Startup Recovery
File: `packages/api/src/index.ts`

- `resumePendingProvisioning()` re-enqueues rows where status is `pending` or `running`.

## Worker Flow
File: `packages/api/src/services/provisioning/licenseProvisioningService.ts`

1. Mark row `running` and set `provision_started_at`.
2. Build runtime paths from `OPENCLAW_RUNTIME_DIR` and `OPENCLAW_DATA_DIR`.
3. Run setup script (`runProvisionScript`) with injected env vars.
4. Read container id/name (`docker compose ps`, `docker inspect`).
5. Try reading generated `openclaw.json` token override from config dir.
6. Optional domain mode:
   - Build host `<owner>-<licenseId>.<OPENCLAW_BASE_DOMAIN>`
   - Write nginx conf and reload nginx
   - Promote URL to `wss://` and `https://`
7. Update row to `ready` with container metadata and final urls/token.
8. On error, set `failed` and write `provision_error`.

## Verify Gate Dependency
File: `packages/api/src/routes/verify.ts`

- `pending|running` => `409 PROVISIONING_PENDING`
- `failed` => `409 PROVISIONING_FAILED`
- `ready` or legacy `null` => continue normal verify/bind flow

## Operations Notes
- Provisioning is fire-and-forget from request thread; request returns before docker setup finishes.
- Worker jobs are tracked in-memory (`activeJobs`) to avoid duplicate active promises in one process.
- Failures are persisted, so UI can display status and error details.

## Critical Env Variables
- `OPENCLAW_RUNTIME_DIR`
- `OPENCLAW_DATA_DIR`
- `OPENCLAW_PROVISION_SCRIPT` (optional override)
- `OPENCLAW_HOST_IP`
- `OPENCLAW_GATEWAY_PORT_START`, `OPENCLAW_GATEWAY_PORT_END`
- `OPENCLAW_BRIDGE_PORT_START`, `OPENCLAW_BRIDGE_PORT_END`
- `OPENCLAW_BASE_DOMAIN` (optional domain mode)
- `NGINX_SITE_DIR`, `NGINX_RELOAD_CMD` (when domain mode enabled)

## Related Source Files
- `packages/api/src/routes/licenses.ts`
- `packages/api/src/routes/verify.ts`
- `packages/api/src/services/provisioning/licenseProvisioningService.ts`
- `packages/api/src/services/provisioning/scriptRunner.ts`
- `packages/api/src/services/provisioning/nginxService.ts`
- `packages/api/src/services/provisioning/nameBuilder.ts`
- `packages/api/src/services/provisioning/portAllocator.ts`
