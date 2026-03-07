# Easy OpenClaw Auth (openclaw-tenant)

![OpenClaw Auth Manager](https://img.shields.io/badge/OpenClaw-Auth%20Manager-blue)
![Bun](https://img.shields.io/badge/Runtime-Bun-black?logo=bun)
![Svelte 5](https://img.shields.io/badge/UI-Svelte%205-ff3e00?logo=svelte)
![Hono](https://img.shields.io/badge/API-Hono-orange)
![SQLite](https://img.shields.io/badge/DB-SQLite-blue)

**English** | [简体中文](./README.zh-CN.md)

`openclaw-tenant` is a lightweight authentication and license management control plane for OpenClaw.
It handles license lifecycle, HWID binding, verify flow, and async instance provisioning.

For full multi-module deployment and interaction architecture, see parent repo README:
- [easy-openclaw/README.md](../README.md)

---

## ✨ Features

- **Centralized License Manager**: Create, revoke, and manage license lifecycle with runtime binding state.
- **Global Settings + License Snapshot**: Keep global runtime defaults while snapshotting effective values per created license.
- **Dynamic Token Rotation**: Rotate gateway token on verify when expired and sync to instance config.
- **Hardware Binding (HWID)**: Bind license to a physical device on first successful verify.
- **Async Container Provisioning Queue**: Track instance provisioning with `pending | running | ready | failed`.
- **Fast & Modern Stack**:
  - Backend: Hono + SQLite (`bun:sqlite`)
  - Frontend: Svelte 5 (Runes) + TailwindCSS v4

---

## 🚀 Quick Start

### 1. Prerequisites

Ensure Bun is installed:

```bash
curl -fsSL https://bun.sh/install | bash
```

### 2. Clone & Install

```bash
git clone https://github.com/Olsondy/openclaw-tenant.git
cd openclaw-tenant
bun install
```

### 3. Environment Configuration

```bash
cp .env.example .env
```

Set at least:
- `JWT_SECRET`
- `ADMIN_USER`
- `ADMIN_PASS`

### 4. Run (Development)

```bash
# Terminal 1 - API
bun run dev:api

# Terminal 2 - UI
bun run dev:ui
```

---

## 📖 Project Structure

```text
openclaw-tenant/
├── packages/
│   ├── api/            # Hono API backend (SQLite + provisioning logic)
│   └── ui/             # Svelte 5 admin SPA
├── docs/               # API and implementation docs
├── .env.example
└── package.json
```

---

## 🛠 Documentation References

- [Authentication & Flow](./docs/AUTHENTICATION.md)
- [Backend API Contract](./docs/BACKEND_API.md)
- [License Provisioning Engine](./docs/LICENSE_PROVISIONING.md)
- [UI Layout Architecture](./docs/UI_DESIGN.md)
- [Environment Specifics](./docs/ENVIRONMENT.md)
- [Internationalization Notes](./docs/INTERNATIONALIZATION.md)

---

## 🤝 Contributing

We warmly welcome contributions. Before submitting PRs related to core infrastructure,
please read [AGENTS.md](./AGENTS.md) in the repository root to follow the default project conventions.

## 📝 License

Distributed under the [MIT License](./LICENSE).
