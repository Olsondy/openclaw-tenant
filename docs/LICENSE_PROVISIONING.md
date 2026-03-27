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

## Directory Structure & Path Resolution

### Project Root Detection
`.env` 中的 `OPENCLAW_RUNTIME_DIR` 和 `OPENCLAW_DATA_DIR` 支持相对路径（如 `./openclaw`）。
API 启动时通过 `findProjectRoot()` 向上查找包含 `.env` 的目录作为项目根，所有相对路径基于此目录 `resolve()`。

File: `packages/api/src/services/settingsService.ts`

### Per-Instance Host Directory Layout
每个 license 实例在 `OPENCLAW_DATA_DIR` 下创建独立子目录。

File: `packages/api/src/services/provisioning/nameBuilder.ts`

命名规则：`openclaw-{ownerTag}-{licenseId}`

示例（`OPENCLAW_DATA_DIR=../openclaw-data`, ownerTag=`alice`, licenseId=`1`）:

```
openclaw-data/                              ← OPENCLAW_DATA_DIR (宿主机)
└── openclaw-alice-1/                       ← composeProject
    └── .openclaw/                          ← configDir
        ├── openclaw.json                   ← 核心配置文件
        ├── identity/                       ← 设备身份
        ├── workspace/                      ← workspaceDir
        └── agents/main/
            ├── agent/
            └── sessions/
```

### Container Bind-Mount Mapping
Provision 脚本将宿主机目录挂载到容器内：

| 宿主机路径 | 容器路径 | 说明 |
|---|---|---|
| `{dataDir}/{composeProject}/.openclaw` | `/home/node/.openclaw` | 配置 + workspace |

容器内 workspace 路径由 `openclaw.json` 中 `agents.defaults.workspace` 决定（默认 `/home/node/.openclaw/workspace`）。
修改此值只影响容器内部行为，不影响 tenant API。

### Path Resolution in Provisioning
`licenseProvisioningService.ts` 从 license 行读取 `runtime_dir` / `data_dir` 后，
通过 `resolve()` 确保相对路径（历史数据）也能正确解析为绝对路径。

### Script Runner (Cross-Platform)
File: `packages/api/src/services/provisioning/scriptRunner.ts`

- Linux/macOS: 直接 `bash <script>`
- Windows (Git Bash/MSYS2): 使用 `child_process.spawn` + `shell: true`，
  通过系统 shell 解析 PATH 中的 bash，避免 Bun/libuv 直接 spawn MSYS2 可执行文件的兼容性问题。
- spawn 前会验证 `cwd` 和脚本路径是否存在，POSIX 路径自动通过 `cygpath` 转换为 Windows 路径。

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
   - Script pre-seeds `openclaw.json` with baseline config (gateway, tools.exec, models, agents, messages, commands, session).
   - Script installs feishu plugin into the config dir before gateway starts.
4. **`patchModelApiKey(configDir, jwtSecret)`** — reads enabled `model_presets` rows, decrypts each `api_key_enc`, writes `models.providers.<id>.apiKey` and `auth.profiles.<id>:default` into `openclaw.json`.
5. Read container id/name via corresponding runtime command.
6. Try reading generated `openclaw.json` token override from config dir.
7. Optional domain mode:
   - Use `licenses.nginx_host` directly
   - Write nginx conf and reload nginx
   - Promote URL to `wss://` and `https://`
8. Update row to `ready` with container metadata and final urls/token.
9. On error, set `failed` and write `provision_error`.

## Bootstrap Config Flow

After provisioning completes, the openclaw.json has a baseline config but is missing the messaging channel credentials (Feishu appId/appSecret). The bootstrap wizard in exec fills this gap.

### needsBootstrap Response (`POST /api/verify`)

`verify.ts` returns a `needsBootstrap` object alongside `nodeConfig`:

```json
{
  "needsBootstrap": { "feishu": true }
}
```

`feishu: true` when `licenses.wizard_feishu_done = 0` (not yet configured).
The field is per-step, allowing future wizard steps to be added independently.

### Bootstrap Config Endpoint (`POST /api/licenses/:id/bootstrap-config`)

File: `packages/api/src/routes/bootstrap-config.ts`

- **Auth**: `licenseKey` + `hwid` in request body (matches `licenses` table — no JWT required, exec calls this directly)
- **Whitelist**: only `channels.feishu.appId` and `channels.feishu.appSecret` are written
- **Effect**: patches `openclaw.json` in the container's config dir, sets `wizard_feishu_done = 1`
- **Idempotent**: can be called again from exec Settings to reconfigure

### openclaw.json Write Stages

| Stage | Writer | Fields Written |
|-------|--------|---------------|
| Provision script | `provision-docker.sh` | `gateway`, `auth.profiles`, `tools`, `models`, `agents`, `messages`, `commands`, `session` |
| Model apiKey injection | `patchModelApiKey()` | `models.providers.<id>.apiKey`, `auth.profiles.<id>:default` |
| Token sync | `syncTokenToConfig()` in verify | `gateway.auth.token`, `gateway.remote.token` |
| Bootstrap wizard | `bootstrap-config` API | `channels.feishu.appId`, `channels.feishu.appSecret` |

### model_presets Table

Stores pre-configured AI provider presets with encrypted API keys.

| Column | Description |
|--------|-------------|
| `provider_id` | Provider key (e.g. `zai`) — used as key in `models.providers` |
| `label` | Display name |
| `base_url` | API base URL |
| `api` | API type (`openai-completions`) |
| `model_id` | Default model to register |
| `api_key_enc` | AES-256-GCM encrypted API key (`iv:authTag:ciphertext`) |
| `enabled` | Whether to inject during provision |

Default seed: `zai` / `glm-4.7-flash` (free tier, no key required on first boot — key can be set via admin API).

Encryption key is derived from `SHA-256(JWT_SECRET)`.

## Verify Gate Dependency
File: `packages/api/src/routes/verify.ts`

- `pending|running` => `409 PROVISIONING_PENDING`
- `failed` => `409 PROVISIONING_FAILED`
- `ready` or legacy `null` => continue normal verify/bind flow

## Operations Notes
- Provisioning is fire-and-forget from request thread; request returns before docker setup finishes.
- Worker jobs are tracked in-memory (`activeJobs`) to avoid duplicate active promises in one process.
- Failures are persisted, so UI can display status and error details.

### Image Cache + Build Args Caveat (Important)

`provision-docker.sh` only builds the image when `OPENCLAW_IMAGE` does **not** exist.
If `openclaw:local` already exists, provision will skip build and reuse the old image.

This matters for Docker build args:

- `OPENCLAW_EXTENSIONS` controls which extension manifests are injected before `pnpm install` in Docker build.
- If image was first built without `OPENCLAW_EXTENSIONS=feishu`, Feishu runtime dependency
  `@larksuiteoapi/node-sdk` may be missing at runtime and plugin load can fail:
  `Cannot find module '@larksuiteoapi/node-sdk'`.
- `OPENCLAW_INSTALL_BROWSER` controls whether Chromium + Xvfb are baked into image.
  If image was first built without it, browser automation may fail with:
  `No supported browser found (...)`.

Recommended practice:

1. First build (or rebuild) image explicitly with required extensions:
   - `docker build --build-arg OPENCLAW_EXTENSIONS=feishu --build-arg OPENCLAW_INSTALL_BROWSER=1 -t openclaw:local -f <runtime_dir>/Dockerfile <runtime_dir>`
2. Recreate gateway container for each existing `compose_project` (same project name, same ports) to apply new image.
3. Keep using per-license `runtime_dir/data_dir/gateway_port/bridge_port/gateway_token` from DB snapshot when recreating.

Do not rely on "provision rerun" alone to refresh extension dependencies if image tag already exists.

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
- `packages/api/src/routes/bootstrap-config.ts`
- `packages/api/src/routes/model-presets.ts`
- `packages/api/src/services/crypto.ts`
- `packages/api/src/services/settingsService.ts`
- `packages/api/src/services/provisioning/licenseProvisioningService.ts`
- `packages/api/src/services/provisioning/patchModelApiKey.ts`
- `packages/api/src/services/provisioning/scriptRunner.ts`
- `packages/api/src/services/provisioning/nginxService.ts`
- `packages/api/src/services/provisioning/nameBuilder.ts`
- `packages/api/src/services/provisioning/portAllocator.ts`
