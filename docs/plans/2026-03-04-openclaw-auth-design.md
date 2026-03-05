# OpenClaw Auth Service — 设计文档

**日期**: 2026-03-04
**项目**: easy-openclaw-auth
**技术栈**: Bun.js + Hono + bun:sqlite + Svelte + Tailwind CSS

---

## 1. 项目概述

为 Tauri v2 客户端工具提供授权验证服务，验证用户是否有权限访问 openclaw gateway。核心目标：用户验证 + HWID 绑定 + 管理后台。

---

## 2. 架构方案

**选型：Bun Monorepo — Hono 服务托管静态 Svelte**

- Bun workspace 管理 `packages/api` 和 `packages/ui` 两个子包
- Svelte + Vite 构建为静态文件，由 Hono 在根路径 `/` 托管
- API 路由统一在 `/api/*`
- 单进程单端口部署，零 CORS 配置

---

## 3. 工程目录结构

```
easy-openclaw-auth/
├── package.json                    # Bun workspace 根
├── .env.example
├── docs/plans/
└── packages/
    ├── api/
    │   ├── package.json
    │   └── src/
    │       ├── index.ts                # 入口：Hono 挂载 + 静态文件托管
    │       ├── db/
    │       │   ├── client.ts           # bun:sqlite 初始化 + 自动迁移
    │       │   └── schema.ts           # 建表 SQL 常量
    │       ├── routes/
    │       │   ├── verify.ts           # POST /api/verify
    │       │   ├── licenses.ts         # GET/POST/PATCH /api/licenses
    │       │   └── auth.ts             # POST /api/auth/login
    │       ├── middleware/
    │       │   └── jwt.ts              # Admin JWT 验证中间件
    │       └── services/
    │           ├── licenseService.ts   # License 业务逻辑
    │           ├── dockerService.ts    # Bun.spawn docker exec
    │           └── openclawConfig.ts   # Bun.file 读取 openclaw.json
    └── ui/
        ├── package.json
        ├── vite.config.ts
        ├── tailwind.config.js
        └── src/
            ├── App.svelte              # 根组件（状态机：登录/已登录）
            ├── main.ts
            └── lib/
                ├── api.ts              # fetch 封装（带 JWT header）
                ├── Login.svelte        # 登录表单组件
                └── LicenseList.svelte  # License 列表 + 生成按钮
```

---

## 4. 数据模型

### 4.1 licenses 表

```sql
CREATE TABLE licenses (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  license_key   TEXT UNIQUE NOT NULL,   -- 格式: XXXXX-XXXXX-XXXXX-XXXXX
  hwid          TEXT,                   -- NULL 直到首次绑定
  device_name   TEXT,                   -- 客户端上报的机器名，首次绑定时存入
  agent_id      TEXT,                   -- SHA256(hwid) 前16位，首次绑定时生成
  gateway_token TEXT NOT NULL,          -- 生成 License 时从 openclaw.json 读入
  gateway_url   TEXT NOT NULL,          -- 生成 License 时从 openclaw.json 读入
  status        TEXT DEFAULT 'unbound', -- unbound | active | revoked
  expiry_date   TEXT,                   -- NULL = 永久有效，否则 "YYYY-MM-DD"
  note          TEXT,
  created_at    TEXT DEFAULT (datetime('now')),
  bound_at      TEXT                    -- 首次绑定时间戳
);
```

### 4.2 admin_users 表

```sql
CREATE TABLE admin_users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL           -- bcryptjs hash
);
```

### 4.3 License 生命周期

```
unbound → (首次 /verify 绑定 hwid) → active → (管理员撤销) → revoked
```

---

## 5. API 路由设计

### 5.1 公开路由

#### `POST /api/verify`

**请求体：**
```json
{ "hwid": "string", "licenseKey": "XXXXX-XXXXX-XXXXX-XXXXX", "deviceName": "string" }
```

**验证流程：**
1. 查 DB：licenseKey 存在且 status != 'revoked'
2. 检查 expiry_date（NULL 或未过期）
3. `unbound` → 绑定 hwid/device_name，生成 agent_id，status = 'active'
4. `active` → 校验 hwid 是否匹配（防止盗用）
5. 异步 `Bun.spawn` 执行 docker exec 审批命令（不阻塞响应）
6. 返回 nodeConfig + userProfile

**成功响应：**
```json
{
  "success": true,
  "data": {
    "nodeConfig": {
      "gatewayUrl": "ws://your-cloud-api.com:18789",
      "gatewayToken": "from_db",
      "agentId": "sha256_hwid_prefix_16",
      "deviceName": "DESKTOP-ABC123"
    },
    "userProfile": {
      "licenseStatus": "Valid",
      "expiryDate": "2027-01-01"
    }
  }
}
```

**失败响应：**
```json
{ "success": false, "error": "INVALID_LICENSE | HWID_MISMATCH | LICENSE_EXPIRED | LICENSE_REVOKED" }
```

#### `POST /api/auth/login`

返回 24h 有效的 HS256 JWT。

### 5.2 受保护路由（需 Bearer JWT）

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/licenses` | 列出所有 License |
| `POST` | `/api/licenses` | 生成新 License（读 openclaw.json，写 DB） |
| `PATCH` | `/api/licenses/:id` | 撤销（revoke）或更新备注 |

---

## 6. 关键服务实现

### 6.1 `openclawConfig.ts` — 实时读取

每次调用时用 `Bun.file` 读取 `OPENCLAW_CONFIG_PATH`，解析 JSON 提取 `token` 和 `gatewayUrl`。

### 6.2 `dockerService.ts` — 异步审批

使用 `Bun.spawn` 执行环境变量 `DOCKER_APPROVE_CMD` 配置的命令，不等待结果（fire-and-forget）。

### 6.3 License Key 生成

格式：`XXXXX-XXXXX-XXXXX-XXXXX`，每段5位随机大写字母+数字，使用 `crypto.randomBytes`。

### 6.4 `agentId` 生成

`SHA256(hwid)` 取前 16 位十六进制字符，确定性（相同 HWID 永远相同 agentId）。

---

## 7. UI 设计

### 7.1 技术栈

- Svelte 5 + Vite
- Tailwind CSS + `@tailwindcss/forms`
- 字体：Inter（CDN）

### 7.2 视觉规范（Google Material 风格）

| 元素 | 样式 |
|------|------|
| 主色 | `#1a73e8`（Google Blue） |
| 背景 | `#f8f9fa` |
| 卡片 | `bg-white rounded-xl shadow-sm border border-gray-100` |
| 主按钮 | `bg-blue-600 hover:bg-blue-700 text-white rounded-lg` |
| 状态徽章 | `active` 绿色、`unbound` 灰色、`revoked` 红色 chip |
| 输入框 | outlined 风格，focus 蓝色边框 |

### 7.3 页面结构（单页状态机）

```
未登录 → Login 组件（居中卡片）
已登录 → Dashboard
  ├── 顶部导航栏（蓝色，标题 + 登出）
  └── 主体内容卡片
        ├── 标题 + [+ 生成 License] 按钮
        └── License 表格
              列：Key | 状态 | 设备名 | HWID | 到期日 | 创建时间 | 操作[撤销]
```

---

## 8. 环境变量

```env
PORT=3000
JWT_SECRET=change-me-in-production
ADMIN_USER=admin
ADMIN_PASS=change-me
OPENCLAW_CONFIG_PATH=/path/to/openclaw.json
DOCKER_CONTAINER_NAME=openclaw-gateway
DOCKER_APPROVE_CMD=docker exec openclaw-gateway curl -X POST http://localhost:8080/approve
```

---

## 9. 性能说明

- SQLite 通过 `bun:sqlite` 原生调用，无 ORM 开销
- `/verify` 关键路径：DB 查询 + 条件判断，预计 < 5ms
- `docker exec` 异步执行，不影响响应延迟
- `Bun.file` 读取 openclaw.json 约 < 1ms
