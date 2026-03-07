# BACKEND_API

## Base
- Base path: `/api`
- Response envelope:
  - Success: `{ success: true, data: ... }`
  - Failure: `{ success: false, error: "ERROR_CODE" }`

## Routes

### `POST /api/auth/login`
- Public route.
- Request:

```json
{ "username": "string", "password": "string" }
```

- Success `200`:

```json
{ "success": true, "data": { "token": "<jwt>" } }
```

- Errors:
  - `400 INVALID_JSON`
  - `400 MISSING_CREDENTIALS`
  - `401 INVALID_CREDENTIALS`
  - `500 SERVER_MISCONFIGURATION`

### `GET /api/licenses`
- Protected route (`Authorization: Bearer <jwt>`).
- Returns all licenses ordered by `created_at DESC`.

### `POST /api/licenses`
- Protected route.
- Creates a new license and enqueues async provisioning.
- Optional request body (all fields optional):

```json
{
  "ownerTag": "optional-string",
  "expiryDate": "YYYY-MM-DD",
  "tokenTtlDays": 7,
  "hostIp": "192.168.1.100",
  "baseDomain": "openclaw.example.com"
}
```

- `expiryDate`: License 本身失效日期，留空 = 永久。
- `tokenTtlDays`: Auth Token 有效期（天），默认 7，每次 verify 过期后自动轮换。
- `hostIp`: 覆盖本次创建的宿主机 IP，留空取 `settings.host_ip`。
- `baseDomain`: 覆盖本次创建的域名基准，留空取 `settings.base_domain`；若最终存在域名，会写入并冻结到 `licenses.nginx_host`。

- Success `201`: returns inserted row with provision metadata.
- Errors:
  - `400 INVALID_OWNER_TAG`
  - `503 NO_AVAILABLE_PORT`

### `GET /api/settings`
- Protected route (`Authorization: Bearer <jwt>`).
- Returns current global defaults from `settings` table.

### `PUT /api/settings`
- Protected route.
- Updates global defaults in `settings` table.
- Required fields:
  - `runtime_provider`: `"docker"` or `"podman"`
  - `runtime_dir`, `data_dir`, `host_ip`
  - `gateway_port_start`, `gateway_port_end`, `bridge_port_start`, `bridge_port_end`
- Optional fields:
  - `base_domain` (nullable)
- Errors:
  - `400 INVALID_JSON`
  - `400 INVALID_RUNTIME_PROVIDER`
  - `400 INVALID_SETTINGS`
  - `400 INVALID_PORT_RANGE`

### `PATCH /api/licenses/:id`
- Protected route.
- Body supports:
  - `status?: string`
  - `note?: string`
- Success `200`: returns updated row.
- Errors:
  - `404 NOT_FOUND`
  - `400 NO_FIELDS_TO_UPDATE`

### `POST /api/verify`
- Public route for client verification/binding.
- Request:

```json
{ "hwid": "string", "licenseKey": "string", "deviceName": "string" }
```

- Behavior summary:
  - Validates license existence and status.
  - Blocks when provisioning not ready.
  - First successful verify binds HWID and activates license.

- Success `200`:

```json
{
  "success": true,
  "data": {
    "nodeConfig": {
      "gatewayUrl": "ws://... or wss://...",
      "gatewayToken": "64-char-hex",
      "agentId": "16-char-hex",
      "deviceName": "...",
      "licenseId": 1,
      "tenantUrl": "https://..."
    },
    "userProfile": {
      "licenseStatus": "Valid",
      "expiryDate": "Permanent or YYYY-MM-DD"
    },
    "needsBootstrap": {
      "feishu": true
    }
  }
}
```

- `gatewayToken`: 用于 wss 连接的 token（`wss://gateway?token=xxx`），每个 license 独立。当 `token_expires_at` 过期后，下次 verify 自动轮换并同步写入 `openclaw.json` 的 `gateway.auth.token` 和 `gateway.remote.token`。

- Errors:
  - `400 INVALID_JSON`
  - `400 MISSING_FIELDS`
  - `403 INVALID_LICENSE`
  - `403 LICENSE_REVOKED`
  - `403 LICENSE_EXPIRED`
  - `403 HWID_MISMATCH`
  - `409 PROVISIONING_PENDING`
  - `409 PROVISIONING_FAILED`

## DB Notes
- Main tables: `licenses`, `admin_users`, `settings`
- DB initialization and migration guard: `packages/api/src/db/client.ts`
- License includes provisioning fields:
  - `owner_tag`, `compose_project`, `container_id`, `container_name`
  - `gateway_port`, `bridge_port`, `webui_url`, `nginx_host`
  - `runtime_provider`, `runtime_dir`, `data_dir`
  - `provision_status`, `provision_error`, `provision_started_at`, `provision_completed_at`
- Gateway Token 轮换字段：
  - `gateway_token`: 用于 wss 连接的 token，verify 时自动轮换
  - `token_expires_at`: token 过期时间（ISO 8601）
  - `token_ttl_days`: token 轮换周期（天），创建 license 时指定，默认 7
- Settings stores global defaults for future licenses; each created license keeps its own effective snapshot.

## Middleware Contract
- JWT middleware applied to `/api/licenses/*` and `/api/settings/*`.
- If new protected routes are added, they must be explicitly mounted behind `jwtMiddleware`.

## Related Source Files
- `packages/api/src/index.ts`
- `packages/api/src/routes/auth.ts`
- `packages/api/src/routes/licenses.ts`
- `packages/api/src/routes/settings.ts`
- `packages/api/src/routes/verify.ts`
- `packages/api/src/middleware/jwt.ts`
