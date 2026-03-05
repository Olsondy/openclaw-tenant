# Easy OpenClaw Auth

![OpenClaw Auth Manager](https://img.shields.io/badge/OpenClaw-Auth%20Manager-blue)
![Bun](https://img.shields.io/badge/Runtime-Bun-black?logo=bun)
![Svelte 5](https://img.shields.io/badge/UI-Svelte%205-ff3e00?logo=svelte)
![Hono](https://img.shields.io/badge/API-Hono-orange)
![SQLite](https://img.shields.io/badge/DB-SQLite-blue)

**Easy OpenClaw Auth** is a lightweight, all-in-one authentication and license provisioning manager tailored designed for OpenClaw. It orchestrates user provisioning, token validation loops, bounding HWID credentials, and manages automatic instance node configuration logic.

---

## ✨ Features

- **Centralized License Manager**: Generate and manage user licenses, expire controls, and specific container bindings with ease.
- **Dynamic Token Caching**: Generate distinct authorization tokens across multiple tenants securely. Tokens automatically rotate to instance `openclaw.json` config settings.
- **Hardware Binding (HWID)**: Automatically anchor the specific physical device instance matching upon first usage verification loop.
- **Async Container Provisioning Queue**: Manages local/remote docker container initializations independently tracking states `pending|running|ready|failed`.
- **Fast & Modern Stack**: 
  - Backend: Hono + SQLite (powered by ultra-fast `bun:sqlite` engine).
  - Frontend: Svelte 5 (Runes state methodology) + TailwindCSS v4.
  - Zero thick abstraction lines.

## 🚀 Quick Start

### 1. Prerequisites
Ensure you have [Bun](https://bun.sh/) installed:
```bash
curl -fsSL https://bun.sh/install | bash
```

### 2. Installation
Clone the repository and install dependency paths natively with bun workspaces.
```bash
git clone https://github.com/your-repo/easy-openclaw-auth.git
cd easy-openclaw-auth

bun install
```

### 3. Environment Configuration
Copy the `.env.example` configurations. It must sit at the root level alongside the workspaces router.
```bash
cp .env.example .env
```
Ensure you have declared `JWT_SECRET` and initialized your default `ADMIN_USER` & `ADMIN_PASS`.

### 4. Running the Project

#### Development Mode
You can easily spin up the dev routines via `bun run`. Environment variables inside `.env` are natively injected.

```bash
# Terminal 1 - Start the backend API (Hono)
bun run dev:api

# Terminal 2 - Start the frontend (Vite / Svelte)
bun run dev:ui
```

*(Note: Do not start routines with `npm` or `pnpm` directly unless you inject `.env` parameters explicitly with tools like `dotenv-cli`.)*

## 📖 Architecture & Directories

This is a Bun Workspace Monorepo structure.

```text
easy-openclaw-auth/
├── packages/
│   ├── api/            # Hono API Backend (SQLite Database logic)
│   └── ui/             # Svelte 5 Single Page Application Admin UI
├── docs/               # Technical specs and detailed API routing details
├── .env                # Global variables and provision settings
└── package.json        # Workspace declaration & root scripts
```

## 🛠 Documentation references
Dig deeper into specific infrastructure details handling internally:

- [Authentication & Flow](./docs/AUTHENTICATION.md)
- [Backend API Contract](./docs/BACKEND_API.md)
- [License Provisioning Engine](./docs/LICENSE_PROVISIONING.md)
- [UI Layout Architecture](./docs/UI_DESIGN.md)
- [Environment Specifics](./docs/ENVIRONMENT.md)

## 🤝 Contributing

Contributions are welcome! Please ensure that you check `AGENTS.md` and read the guidelines if submitting infrastructure patching formats. 

## 📝 License

Distributed under the MIT License.
