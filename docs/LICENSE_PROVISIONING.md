# LICENSE_PROVISIONING

## Scope
This document describes the async provisioning pipeline triggered by `POST /api/licenses`.

## State Machine
`provision_status` values in `licenses` table:
- `pending`: created, waiting to run
- `running`: worker is executing script/docker steps
- `ready`: provisioning succeeded, license can pass verify gate
- `failed`: provisioning failed, `provision_error` contains summary

## Configuration Model
- `settings` table: global defaults edited from UI (`/api/settings`).
- `licenses` table: per-license effective snapshot used by provisioning.
- On `POST /api/licenses`, runtime fields are copied from settings into license:
  - `runtime_provider`, `runtime_dir`, `data_dir`
- Domain resolution priority when creating license:
  - request `baseDomain` > `settings.base_domain` > none (IP:port mode)
- `licenses.nginx_host` is written at creation and treated as authoritative in provisioning.

## Trigger Points

### On License Creation
File: `packages/api/src/routes/licenses.ts`

1. Read settings row from DB (`getSettingsRow`).
2. Sanitize owner tag (`sanitizeOwnerTag`).
3. Allocate `(gateway_port, bridge_port)` from settings ranges.
4. Generate `license_key` and random `gateway_token`.
5. Insert license row with `provision_status='pending'` + runtime snapshot fields.
6. Build `compose_project`, urls, optional `nginx_host`.
7. Enqueue async job via `enqueueLicenseProvisioning(id)`.

### On API Startup Recovery
File: `packages/api/src/index.ts`

- `resumePendingProvisioning()` re-enqueues rows where status is `pending` or `running`.

## Worker Flow
File: `packages/api/src/services/provisioning/licenseProvisioningService.ts`

1. Mark row `running` and set `provision_started_at`.
2. Read runtime config from license row (`runtime_provider/runtime_dir/data_dir/nginx_host`).
3. Resolve setup script by provider (`docker` or `podman`) and run `runProvisionScript`.
4. Read container id/name via corresponding runtime command.
5. Try reading generated `openclaw.json` token override from config dir.
6. Optional domain mode:
   - Use `licenses.nginx_host` directly
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
- `OPENCLAW_RUNTIME_DIR`, `OPENCLAW_DATA_DIR`, `OPENCLAW_HOST_IP`
- `OPENCLAW_GATEWAY_PORT_START`, `OPENCLAW_GATEWAY_PORT_END`
- `OPENCLAW_BRIDGE_PORT_START`, `OPENCLAW_BRIDGE_PORT_END`
- `OPENCLAW_BASE_DOMAIN`
- `NGINX_SITE_DIR`, `NGINX_RELOAD_CMD` (when domain mode enabled)

Note:
- `OPENCLAW_*` are used as initial defaults when seeding `settings` row.
- Provisioning execution should use effective values stored on each license row.

## Related Source Files
- `packages/api/src/routes/licenses.ts`
- `packages/api/src/routes/settings.ts`
- `packages/api/src/routes/verify.ts`
- `packages/api/src/services/settingsService.ts`
- `packages/api/src/services/provisioning/licenseProvisioningService.ts`
- `packages/api/src/services/provisioning/scriptRunner.ts`
- `packages/api/src/services/provisioning/nginxService.ts`
- `packages/api/src/services/provisioning/nameBuilder.ts`
- `packages/api/src/services/provisioning/portAllocator.ts`
