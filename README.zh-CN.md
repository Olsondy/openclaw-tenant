# Easy OpenClaw Auth

![OpenClaw Auth Manager](https://img.shields.io/badge/OpenClaw-Auth%20Manager-blue)
![Bun](https://img.shields.io/badge/Runtime-Bun-black?logo=bun)
![Svelte 5](https://img.shields.io/badge/UI-Svelte%205-ff3e00?logo=svelte)
![Hono](https://img.shields.io/badge/API-Hono-orange)
![SQLite](https://img.shields.io/badge/DB-SQLite-blue)

[English](./README.md) | **简体中文**

**Easy OpenClaw Auth** 是一个专为 OpenClaw 打造的轻量级、全功能的认证与 License 管理系统。它旨在协调用户的开通流程、Token 验证循环、硬件 (HWID) 绑定，并负责自动配置实例节点（容器编排）的核心逻辑。

---

## ✨ 核心特性

- **集中式 License 管理**：轻松生成和管理用户 License，支持配置独立的过期时间、自定义域名以及追踪容器绑定状态。
- **动态 Token 缓存轮换**：支持为不同的租户安全地生成独立的 Auth Token，并在客户端每次重新验证 (Verify) 且 Token 过期时，自动为您同步更新底层实例中 `openclaw.json` 的配置。
- **硬件设备绑定 (HWID)**：客户端首次成功使用 License 验证后，自动锚定匹配物理设备的唯一识别码 (HWID)，防止授权被滥用。
- **异步安全容器部署队列**：在后台独立管理本地或远程的 Docker 容器初始化状态，全程可视化追踪 `pending` | `running` | `ready` | `failed` 四种生命周期。
- **极速现代技术栈**：
  - **后端**: Hono + SQLite (由极速的 `bun:sqlite` 引擎驱动)。
  - **前端**: Svelte 5 (利用了最新的 Runes 响应式状态管理) + TailwindCSS v4。
  - **无冗余抽象层**：代码所见即所得，适合二次深度定制。

## 🚀 快速启动

### 1. 环境依赖
请确保您的机器上已经安装了 [Bun](https://bun.sh/) 运行时：
```bash
curl -fsSL https://bun.sh/install | bash
```

### 2. 克隆与安装
本项目基于 Bun Workspaces 构建，请克隆仓库并在根目录直接安装所有工作区的依赖：
```bash
git clone https://github.com/your-repo/easy-openclaw-auth.git
cd easy-openclaw-auth

bun install
```

### 3. 配置环境变量
复制根目录下的示例环境变量文件并重命名。由于包含 Bun Workspaces，环境变量需统一配置在项目**根目录**：
```bash
cp .env.example .env
```
（重点：修改您的 `JWT_SECRET`，并初始化登录后台的 `ADMIN_USER` 和 `ADMIN_PASS` 账号密码）。

### 4. 运行服务

#### 开发模式 (Development)
通过 `bun run` 启动时，Bun 会原生自动读取并注入您根目录下的 `.env` 变量。

```bash
# 终端 1 - 启动后端 API (Hono 监听 3000 端口)
bun run dev:api

# 终端 2 - 启动前端 UI 管理后台 (Vite Dev Server)
bun run dev:ui
```

*(⚠️ 注意：请**不要**直接使用 `npm` 或 `pnpm` 启动开发服务器。这往往会导致 `.env` 变量丢失并引发 `SERVER_MISCONFIGURATION` 或数据库路径加载错误。必须使用 `bun run`！)*

## 📖 目录架构

项目采用 Monorepo 架构组织：

```text
easy-openclaw-auth/
├── packages/
│   ├── api/            # 后端: 负责 DB 读写、Hono 路由和异步容器分配脚本
│   └── ui/             # 前端: Svelte 5 管理大屏 SPA 单页应用
├── docs/               # 技术文档集：记录了所有 API 和设计契约
├── openclaw.db         # 本地 SQLite 状态库 (自动生成)
├── .env                # 包含网络层、网关端口号的全局环境配置
└── package.json        # 工作区主文件与启动脚本定义
```

## 🛠 开发文档指引
如果需要深度定制和二次开发，请务必在修改前查阅各自领域的技术文档：

- 🔐 [认证与安全流 (Authentication)](./docs/AUTHENTICATION.md)
- 🔌 [后端 API 接口契约](./docs/BACKEND_API.md)
- 🐳 [License 分配与 Docker 引擎交互](./docs/LICENSE_PROVISIONING.md)
- 🎨 [UI 组件与状态规范](./docs/UI_DESIGN.md)
- ⚙️ [系统环境变量说明](./docs/ENVIRONMENT.md)

## 🤝 参与贡献

我们非常欢迎您的贡献！在提交针对核心基础设施的 PR 之前，请确保阅读根目录的 `AGENTS.md` 以了解默认约定的代码实施规范。

## 📝 许可证

基于 [MIT License](./LICENSE) 协议开源分发。
