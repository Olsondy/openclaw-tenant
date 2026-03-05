# License 创建即完成容器编排与绑定 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 在 `POST /api/licenses` 流程中完成「license key + 容器实例 + token + URL」绑定，客户端拿到 key 后只做 `/api/verify` 激活与 approve 闭环。  
**Architecture:** API 在创建 license 后立即落库并异步触发 provision worker；worker 执行 OpenClaw Docker 脚本、读取实例配置、可选写入 Nginx 转发并回写 DB；`verify` 只允许 `provision_status=ready` 的 license 进入激活与 approve。  
**Tech Stack:** Bun + Hono + SQLite + Docker Compose + Nginx（可选域名模式）+ Svelte UI。

---

## Summary
1. 把“建容器/绑 token/生成 URL”的入口从现有 verify 旁路移到 `POST /api/licenses` 的异步后处理。  
2. 增加 license 的 provision 状态与容器元数据字段，确保失败可观测、可回显。  
3. 支持两种 URL 模式：无域名时 `ws/http + IP:port`；有域名时自动写 Nginx，回写 `wss/https`。  
4. `verify` 增加 `PROVISIONING_PENDING/PROVISIONING_FAILED` 保护，ready 后才走现有 HWID + approve。  
5. 前端 License 列表显示 provision 状态、容器名、连接地址，便于运维与发放。

## Public API / Interface Changes
| 接口/类型 | 变更 |
|---|---|
| `POST /api/licenses` | 新增请求体 `ownerTag?: string`，用于容器命名与子域名前缀。 |
| `POST /api/licenses` 响应 | 新增字段：`provision_status`, `provision_error`, `container_id`, `container_name`, `gateway_port`, `bridge_port`, `webui_url`。 |
| `GET /api/licenses` | 返回上述新增字段。 |
| `POST /api/verify` | 新增错误码：`PROVISIONING_PENDING`、`PROVISIONING_FAILED`（HTTP 409）。 |
| `packages/ui/src/lib/api.ts` 的 `License` 接口 | 同步新增字段与状态类型。 |

## Data Model Changes
在 `licenses` 表新增字段（保留现有 `gateway_token/gateway_url` 字段，不改非空约束）：

```sql
ALTER TABLE licenses ADD COLUMN owner_tag TEXT;
ALTER TABLE licenses ADD COLUMN compose_project TEXT;
ALTER TABLE licenses ADD COLUMN container_id TEXT;
ALTER TABLE licenses ADD COLUMN container_name TEXT;
ALTER TABLE licenses ADD COLUMN gateway_port INTEGER;
ALTER TABLE licenses ADD COLUMN bridge_port INTEGER;
ALTER TABLE licenses ADD COLUMN webui_url TEXT;
ALTER TABLE licenses ADD COLUMN provision_status TEXT DEFAULT 'pending';
ALTER TABLE licenses ADD COLUMN provision_error TEXT;
ALTER TABLE licenses ADD COLUMN provision_started_at TEXT;
ALTER TABLE licenses ADD COLUMN provision_completed_at TEXT;
ALTER TABLE licenses ADD COLUMN nginx_host TEXT;
```

实现方式：
1. 保持 `SCHEMA_SQL` 为新库默认结构。  
2. 在 `getDb()` 启动阶段增加 `ensureLicenseColumns()`，通过 `PRAGMA table_info(licenses)` 检查缺失列并执行 `ALTER TABLE`，兼容已有 SQLite 文件。  

## Env & Ops Contract
新增/使用以下环境变量（全部在 API 进程读取）：

| 变量 | 默认值 | 说明 |
|---|---|---|
| `OPENCLAW_RUNTIME_DIR` | 必填 | 包含 `docker-setup.sh` 与 compose 文件的目录。 |
| `OPENCLAW_PROVISION_SCRIPT` | `${OPENCLAW_RUNTIME_DIR}/docker-setup.sh` | provision 执行脚本路径。 |
| `OPENCLAW_HOST_IP` | 必填 | 回写 URL 使用的宿主机 IP。 |
| `OPENCLAW_GATEWAY_PORT_START` | `18789` | gateway 宿主机端口起始。 |
| `OPENCLAW_GATEWAY_PORT_END` | `18999` | gateway 宿主机端口结束。 |
| `OPENCLAW_BRIDGE_PORT_START` | `28789` | bridge 宿主机端口起始。 |
| `OPENCLAW_BRIDGE_PORT_END` | `28999` | bridge 宿主机端口结束。 |
| `OPENCLAW_BASE_DOMAIN` | 空 | 非空时启用 Nginx 域名模式。 |
| `NGINX_SITE_DIR` | `/etc/nginx/conf.d/openclaw` | Nginx 站点文件目录。 |
| `NGINX_RELOAD_CMD` | `nginx -s reload` | 写完配置后重载命令。 |
| `DOCKER_APPROVE_CMD` | 现有值 | 改为支持 `{{container}}` 占位符。 |

## End-to-End Workflow (Decision Complete)
### 1) Admin 创建 license（`POST /api/licenses`）
1. 校验 JWT，读取 `jwtPayload.username`。  
2. 解析 `ownerTag`：优先请求体；为空时取 `username`；如是邮箱仅取 `@` 前缀。  
3. 规范化 `ownerTag`：小写、仅 `[a-z0-9-]`、连续 `-` 折叠、长度上限 24。  
4. 分配可用端口对：`gateway_port` 和 `bridge_port`。  
5. 生成 `license_key`、`compose_project`、`gateway_token`（随机 32-byte hex）。  
6. 生成初始 URL：  
   - 无域名：`gateway_url=ws://<OPENCLAW_HOST_IP>:<gateway_port>`，`webui_url=http://<OPENCLAW_HOST_IP>:<gateway_port>`  
   - 有域名（先生成 host）：`gateway_url=wss://<host>`，`webui_url=https://<host>`  
7. 插入 DB：`provision_status='pending'`，并写入 token/url/端口/ownerTag。  
8. 入队异步 provision job，HTTP 201 立即返回记录（不阻塞）。

### 2) 异步 provision worker
1. 将记录置为 `provision_status='running'`，写 `provision_started_at`。  
2. 在 `OPENCLAW_RUNTIME_DIR` 执行脚本：`bash <OPENCLAW_PROVISION_SCRIPT>`。  
3. 脚本执行时注入 env：  
   - `COMPOSE_PROJECT_NAME=<compose_project>`  
   - `OPENCLAW_CONFIG_DIR=<runtime-data>/<compose_project>/config`  
   - `OPENCLAW_WORKSPACE_DIR=<runtime-data>/<compose_project>/workspace`  
   - `OPENCLAW_GATEWAY_PORT=<gateway_port>`  
   - `OPENCLAW_BRIDGE_PORT=<bridge_port>`  
   - `OPENCLAW_GATEWAY_BIND=lan`  
   - `OPENCLAW_GATEWAY_TOKEN=<gateway_token>`  
4. 执行成功后获取容器信息：  
   - `container_id`: `docker compose -p <compose_project> ps -q openclaw-gateway`  
   - `container_name`: `docker inspect --format '{{.Name}}' <container_id>`（去掉首 `/`）  
5. 读取实例配置文件 `<OPENCLAW_CONFIG_DIR>/openclaw.json`，校验 token：  
   - 优先 `gateway.auth.token`  
   - 兼容回退 `token`  
   - 不一致则以文件值覆盖 DB（记录 warning 日志）。  
6. 若 `OPENCLAW_BASE_DOMAIN` 非空：  
   - 写入 `NGINX_SITE_DIR/<compose_project>.conf`，server_name=`<ownerTag>-<licenseId>.<domain>`，反代到 `127.0.0.1:<gateway_port>`，开启 websocket upgrade 头。  
   - 执行 `nginx -t` 和 `NGINX_RELOAD_CMD`。  
7. 全部成功后回写：`provision_status='ready'`、容器信息、`provision_completed_at`、清空 `provision_error`。  
8. 任一步失败则回写：`provision_status='failed'`、`provision_error`（截断 1000 字符）、`provision_completed_at`。

### 3) 客户端 verify（`POST /api/verify`）
1. 查 license 后先检查 `provision_status`：  
   - `pending|running` -> `409 PROVISIONING_PENDING`  
   - `failed` -> `409 PROVISIONING_FAILED`  
   - `ready` 才继续。  
2. 继续现有逻辑：revoked/expired/HWID 校验，首次绑定写 `agent_id`。  
3. approve 改为按 license 容器执行：  
   - `DOCKER_APPROVE_CMD` 支持 `{{container}}`，运行前替换为 `container_name`。  
4. 返回 `nodeConfig` 使用 DB 中已绑定的 `gateway_url` 和 `gateway_token`。

## File-Level Task Plan
### Task 1: DB 字段与迁移保障
1. 修改 `packages/api/src/db/schema.ts`：补齐新列定义。  
2. 修改 `packages/api/src/db/client.ts`：新增 `ensureLicenseColumns()`，在 `getDb()` 中调用。  
3. 修改 `packages/api/src/db/schema.test.ts`：断言新增列存在、默认值正确。  
4. 运行 `bun run --cwd packages/api test -- src/db/schema.test.ts`。

### Task 2: Provisioning 核心服务
1. 新建 `packages/api/src/services/provisioning/portAllocator.ts`。  
2. 新建 `packages/api/src/services/provisioning/nameBuilder.ts`（ownerTag/composeProject/host 规则）。  
3. 新建 `packages/api/src/services/provisioning/scriptRunner.ts`（执行 `docker-setup.sh`）。  
4. 新建 `packages/api/src/services/provisioning/nginxService.ts`（模板渲染、`nginx -t`、reload）。  
5. 新建 `packages/api/src/services/provisioning/licenseProvisioningService.ts`（队列 + 状态更新）。  
6. 为以上服务增加对应 `*.test.ts`，用 stub runner 避免真 docker/nginx 依赖。  
7. 运行 `bun run --cwd packages/api test -- src/services/provisioning`.

### Task 3: License 路由接入异步编排
1. 修改 `packages/api/src/routes/licenses.ts`：接收 `ownerTag`，分配端口，生成 token/url，落库并触发异步任务。  
2. 修改 `packages/api/src/routes/licenses.test.ts`：  
   - 新增 `ownerTag` 合法/非法测试。  
   - 新增 `provision_status` 初始值断言。  
   - 新增 “task enqueue called” 断言（通过依赖注入 mock）。  
3. 运行 `bun run --cwd packages/api test -- src/routes/licenses.test.ts`。

### Task 4: Verify 与 approve 容器化绑定
1. 修改 `packages/api/src/routes/verify.ts`：增加 provisioning 状态门禁错误码。  
2. 修改 `packages/api/src/services/dockerService.ts`：支持 `{{container}}` 占位符替换与安全参数化。  
3. 修改 `packages/api/src/routes/verify.test.ts`：覆盖 pending/failed/ready 三类。  
4. 运行 `bun run --cwd packages/api test -- src/routes/verify.test.ts`。

### Task 5: API 类型与 UI 展示
1. 修改 `packages/ui/src/lib/api.ts` 的 `License` 类型和 `generateLicense(ownerTag?)`。  
2. 修改 `packages/ui/src/lib/LicenseList.svelte`：  
   - 增加 ownerTag 输入。  
   - 增加 `provision_status` 展示（pending/running/ready/failed）。  
   - 展示 `container_name`、`gateway_url`、`webui_url`、失败原因。  
3. 运行 `bun run --cwd packages/ui build` 确认类型与构建通过。

### Task 6: 启动恢复与可观测性
1. 修改 `packages/api/src/index.ts`：服务启动时调用 `resumePendingProvisioning()`，重跑 `pending|running`。  
2. 为日志统一结构化字段：`license_id`, `license_key`, `compose_project`, `phase`, `duration_ms`, `error_code`。  
3. 增加恢复行为测试（service-level）。

### Task 7: 文档更新（按 AGENTS 约束）
1. 新建或更新 `docs/BACKEND_API.md`：新增请求/响应字段、错误码、状态机。  
2. 新建或更新 `docs/UI_DESIGN.md`：新增 UI 状态与字段说明。  
3. 若新增 API 路由路径，更新 `AGENTS.md` 的 `## Project Structure`；本方案默认不新增路径。  

## Test Cases & Acceptance Scenarios
1. `POST /api/licenses` 在 200ms 内返回 201，记录为 `pending`。  
2. worker 成功后记录变为 `ready`，`container_id/container_name/gateway_token/gateway_url/webui_url` 全部非空。  
3. 无域名模式下 URL 为 `ws/http + IP:port`。  
4. 域名模式下 URL 为 `wss/https + subdomain`，且 Nginx reload 成功。  
5. worker 失败时状态变 `failed`，`provision_error` 有值。  
6. `verify` 对 `pending|running|failed` 返回 409 与正确错误码。  
7. `verify` 对 `ready` + 首次 unbound 正常激活并触发 approve。  
8. `verify` 对 `ready` + HWID mismatch 仍返回 `HWID_MISMATCH`。  
9. 端口池耗尽时 `POST /licenses` 返回 503 `NO_AVAILABLE_PORT`。  
10. 输入非法 `ownerTag`（空白、超长、非法字符）返回 400 `INVALID_OWNER_TAG`。

## Rollout Plan
1. 先在测试机启用无域名模式（`OPENCLAW_BASE_DOMAIN` 为空）验证容器创建与 verify 闭环。  
2. 再启用域名模式与 Nginx 自动写入，验证 `wss/https`。  
3. 生产开启前先跑全量 API 测试与 UI build。  
4. 回滚策略：停用 provision worker 并退回旧 `licenses.post` 逻辑，保留新增列不影响旧读写。

## Assumptions & Defaults
1. API 服务运行在可执行 `bash/docker/docker compose/nginx` 的 Linux 主机。  
2. `docker-setup.sh` 在你环境里可非交互执行；若实际阻塞，立刻改为专用非交互脚本并替换 `OPENCLAW_PROVISION_SCRIPT`。  
3. 一条 license 对应一个 openclaw-gateway 容器实例。  
4. approve 仍在 verify 成功后触发，且必须按该 license 的 `container_name` 定位容器。  
5. 当前不新增 retry API；失败后通过后台恢复机制和后续运维工具处理（可在下一迭代补 `retry` 接口）。  
