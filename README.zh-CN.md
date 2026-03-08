# Easy OpenClaw Auth（openclaw-tenant）

![OpenClaw Auth Manager](https://img.shields.io/badge/OpenClaw-Auth%20Manager-blue)
![Bun](https://img.shields.io/badge/Runtime-Bun-black?logo=bun)
![Svelte 5](https://img.shields.io/badge/UI-Svelte%205-ff3e00?logo=svelte)
![Hono](https://img.shields.io/badge/API-Hono-orange)
![SQLite](https://img.shields.io/badge/DB-SQLite-blue)

[English](./README.md) | **简体中文**

`openclaw-tenant` 是 OpenClaw 的轻量级认证与 License 管理控制平面，
负责 License 生命周期、HWID 绑定、verify 鉴权流程以及异步实例编排。

跨模块部署架构与完整交互流程请查看父仓库 README：
- [easy-openclaw/README.md](../README.md)

---

## ✨ 核心特性

- **集中式 License 管理**：创建、吊销与管理 License，全流程可追踪运行时绑定状态。
- **全局设置 + License 快照**：统一维护默认运行时配置，并在创建 License 时固化生效快照。
- **动态 Token 轮换**：verify 时如 token 过期，自动轮换并同步到实例配置文件。
- **硬件设备绑定 (HWID)**：首次 verify 成功后绑定物理设备，减少授权滥用风险。
- **异步容器编排队列**：实例编排状态可视化追踪 `pending | running | ready | failed`。
- **现代技术栈**：
  - 后端：Hono + SQLite（`bun:sqlite`）
  - 前端：Svelte 5（Runes）+ TailwindCSS v4

---

## 🆕 最新补充（模型快照 + Bootstrap 合并）

- **License 创建改为模型快照驱动**：
  - `licenses` 固化字段：`provider_id/provider_label/base_url/api/model_id/model_name/api_key_enc`
  - provision 与后续写文件都基于 license 快照，不再运行时读取 `model_presets`
- **model_presets 完整 CRUD**：
  - 支持新增/编辑/删除
  - `provider_id` 新建后不可修改
  - 新增必须提供 key
  - 编辑时 key 为空字符串则保留原值
- **provision 统一写三处模型配置**：
  - `.openclaw/openclaw.json`
  - `.openclaw/agents/main/agent/auth-profiles.json`
  - `.openclaw/agents/main/agent/models.json`
  - 写入后执行 `exec --user root` 修权限并重启容器，重启失败即 `provision_status=failed`
- **`POST /api/licenses/:id/bootstrap-config` 扩展 `modelAuth`**：
  - 可与 `feishu` 同请求
  - `models.json` 规则：同 `model.id` 替换，不同 `id` 合并追加，其他 provider 保留
  - 同步更新 provider 的 `baseUrl/api/apiKey`，并同步 `openclaw.json` 默认主模型
  - 写入后执行 `chown + restart`，重启失败接口返回错误

---

## 🚀 快速启动

### 1. 环境依赖

请先安装 Bun：

```bash
curl -fsSL https://bun.sh/install | bash
```

### 2. 克隆与安装

```bash
git clone https://github.com/Olsondy/openclaw-tenant.git
cd openclaw-tenant
bun install
```

### 3. 配置环境变量

```bash
cp .env.example .env
```

至少配置：
- `JWT_SECRET`
- `ADMIN_USER`
- `ADMIN_PASS`

### 4. 开发模式运行

```bash
# 终端 1 - API
bun run dev:api

# 终端 2 - UI
bun run dev:ui
```

---

## 📖 目录结构

```text
openclaw-tenant/
├── packages/
│   ├── api/            # Hono API 后端（SQLite + 编排逻辑）
│   └── ui/             # Svelte 5 管理后台 SPA
├── docs/               # API 与实现文档
├── .env.example
└── package.json
```

---

## 🛠 开发文档指引

- [认证与安全流 (Authentication)](./docs/AUTHENTICATION.md)
- [后端 API 接口契约](./docs/BACKEND_API.md)
- [License 分配与 Docker 引擎交互](./docs/LICENSE_PROVISIONING.md)
- [系统环境变量说明](./docs/ENVIRONMENT.md)
- [UI 组件与状态规范](./docs/UI_DESIGN.md)
- [国际化说明](./docs/INTERNATIONALIZATION.md)

---

## 🤝 参与贡献

我们非常欢迎您的贡献！在提交针对核心基础设施的 PR 之前，请确保阅读根目录的 `AGENTS.md` 以了解默认约定的代码实施规范。

## 📝 许可证

基于 [MIT License](./LICENSE) 协议开源分发。
