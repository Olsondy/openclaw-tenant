## Project Overview
<!-- section:project intro -->

`easy-openclaw-auth` is a Bun workspace monorepo for OpenClaw license operations.

- `packages/api`: Hono API + SQLite (`bun:sqlite`) for admin login, license lifecycle, verify flow, and async provisioning orchestration.
- `packages/ui`: Svelte 5 + Vite + Tailwind CSS admin console (login + license management table).
- Deployment model: single API process serves `/api/*` and static UI from `packages/ui/dist`.


## Key Technologies & Stack

- Runtime & package manager: `bun` (workspace root + per-package scripts)
- Backend framework: `hono`
- Database: SQLite via `bun:sqlite`
- Auth: `hono/jwt` (HS256) + `bcryptjs`
- Frontend: Svelte 5 (`$state`, `$props`, `$effect`) + Vite 6
- Styling: Tailwind CSS v4 + `@tailwindcss/forms`
- Infra integration: Docker CLI + optional Nginx config generation
- Testing: `bun test` (unit tests across routes/services/middleware)


## Development Commands

Run from repo root unless noted.

```bash
# Root workspace
bun run dev:api      # start API in watch mode (packages/api)
bun run dev:ui       # start Vite dev server (packages/ui)
bun run build:ui     # build UI to packages/ui/dist
bun run start        # run API once (serves built UI)

# API package
bun run --cwd packages/api test
bun run --cwd packages/api test -- src/routes/verify.test.ts

# UI package
bun run --cwd packages/ui dev
bun run --cwd packages/ui build
bun run --cwd packages/ui preview
```


## Code Standards

### Current Repo Baseline (Overrides)

If any example in this file conflicts with current implementation, this section wins.

- Monorepo uses Bun workspaces (`package.json` at root, package-level scripts in `packages/api` and `packages/ui`).
- Backend API base is `/api` and response envelope is `{ success, data? , error? }`.
- Protected routes are only under `/api/licenses/*` and guarded by `jwtMiddleware`.
- License provisioning is async and stateful (`pending|running|ready|failed`) with DB-backed recovery on server boot.
- Frontend auth state is token presence in `localStorage` key `jwt`.
- i18n framework is **not** installed yet; UI copy is currently hardcoded (mostly Chinese).

### Agent Interaction Protocol

Use these rules across IDE agents when executing tasks in this repository:

1. Keep responses concise and task-focused.
2. Prefer patch-level or changed-block outputs over full-file rewrites when presenting code.
3. Explain complex reasoning in Chinese when needed, while keeping code identifiers in English.
4. For simple UI/content fixes, skip over-formal reasoning blocks and focus on the edit.

### Documentation Updates

**CRITICAL**: Always update related documentation files after making code changes:

- After auth changes -> Update [docs/AUTHENTICATION.md](docs/AUTHENTICATION.md)
- After i18n changes -> Update [docs/INTERNATIONALIZATION.md](docs/INTERNATIONALIZATION.md)
- After adding or removing pages/routes -> Update the `## Project Structure` outline in [AGENTS.md](AGENTS.md)
- After UI component changes -> Update [docs/UI_DESIGN.md](docs/UI_DESIGN.md)
- After API route changes -> Update [docs/BACKEND_API.md](docs/BACKEND_API.md)
- After license provisioning workflow changes -> Update [docs/LICENSE_PROVISIONING.md](docs/LICENSE_PROVISIONING.md)
- After env/deployment contract changes -> Update [docs/ENVIRONMENT.md](docs/ENVIRONMENT.md)

Documentation should reflect the actual implementation, not intended behavior.

### Formatting & Linting

This project uses **Biome** (v2) as the unified formatter + linter, and **svelte-check** for Svelte type safety. A **Husky pre-commit hook** enforces both automatically on every commit.

#### Toolchain

| Tool | Scope | Purpose |
|------|-------|---------|
| `@biomejs/biome` | `*.ts`, `*.js`, `*.json` | Format + lint（替代 ESLint + Prettier）|
| `svelte-check` | `packages/ui/**/*.svelte` | Svelte 5 类型检查 + prop 校验 |
| `husky` | Git pre-commit | 提交前自动运行 biome + svelte-check |

#### Running Checks Manually

```bash
# Root: run Biome across all ts/js/json files
bunx biome check

# Root: apply Biome auto-fixes
bunx biome check --write

# UI package: run Svelte type check
bun run --cwd packages/ui check
```

#### Biome Configuration (`biome.json`)

Key decisions (do NOT override without discussion):

- **Indent style**: 2 spaces (`"indentStyle": "space", "indentWidth": 2`)
- **Quote style**: double quotes (`"quoteStyle": "double"`)
- **Semicolons**: always (`"semicolons": "always"`)
- **Line width**: 100 chars
- **Excluded from Biome**: `**/*.css` (Tailwind `@plugin` syntax unsupported), `biome.json` itself
- **Disabled rules (project-wide)**:
  - `suspicious.noExplicitAny` → existing codebase uses `any` in test mocks
  - `style.noNonNullAssertion` → intentional use in verified contexts
  - `style.useNodejsImportProtocol` → existing imports use bare specifiers (`"fs"`, `"path"`, etc.)
- **Svelte-specific override**: `correctness.noUnusedVariables` and `correctness.noUnusedImports` are **off** for `*.svelte` files — Biome cannot see template references, causing false positives.

#### Pre-commit Hook (`.husky/pre-commit`)

On every `git commit`, the following runs automatically:

```sh
bunx biome check              # 格式化 + lint 检查（只检查不修改，避免破坏 staged 状态）
bun run --cwd packages/ui check    # Svelte 类型检查（--fail-on-warnings false）
```

> `lint-staged` 已移除。Biome 全量检查速度极快（< 1s），无需增量机制。
> Hook 中只做检查（不带 `--write`），如需修复格式请手动运行 `bunx biome check --write`。

#### Agent Rules

- Always run `bunx biome check` after touching `.ts`/`.js`/`.json` files in the API or root.
- Always run `bun run --cwd packages/ui check` after touching `.svelte` files.
- Do **not** introduce ESLint, Prettier, or other formatters — Biome is the single source of truth.
- Do **not** disable Biome rules inline with `// biome-ignore` without a comment explaining why.
- When adding new Node.js built-in imports (e.g. `"path"`, `"fs"`), keep them as bare specifiers (no `node:` prefix) to stay consistent with existing code.
- API TypeScript uses strict mode (`packages/api/tsconfig.json`). Keep type safety and explicit null handling.
- Use `bun test` for regression checks on touched backend areas.


### API & Frontend Guardrails

- Keep API path prefix `/api` unchanged unless a coordinated frontend update is included.
- Do not change existing error code strings without updating UI handling and docs.
- `/api/verify` must keep provisioning gates:
  - `pending|running` -> `PROVISIONING_PENDING` (409)
  - `failed` -> `PROVISIONING_FAILED` (409)
- `/api/licenses` creation must remain non-blocking for provisioning (enqueue async job, return 201 immediately).
- Frontend network calls should go through `packages/ui/src/lib/api.ts` to keep auth header and error behavior consistent.

### UI Component Pattern

- Svelte 5 runes pattern in use:
  - local reactive state with `$state`
  - prop callbacks via `$props`
  - side-effect initialization via `$effect`
- App-level auth switch stays in `src/App.svelte`:
  - logged out -> `Login.svelte`
  - logged in -> `LicenseList.svelte`
- Keep feature API calls centralized in `src/lib/api.ts`; avoid raw `fetch` inside multiple components.

### Adding New Components
**IMPORTANT**: NEVER manually add components to `src/components/ui`.

Current repo baseline note: this project does not currently use a `src/components/ui` directory; UI components live in `packages/ui/src/lib`.


## Project Structure

```text
easy-openclaw-auth/
├── AGENTS.md
├── package.json
├── .env.example
├── openclaw.json
├── docs/
│   ├── AUTHENTICATION.md
│   ├── BACKEND_API.md
│   ├── ENVIRONMENT.md
│   ├── INTERNATIONALIZATION.md
│   ├── LICENSE_PROVISIONING.md
│   ├── UI_DESIGN.md
│   └── plans/
├── packages/
│   ├── api/
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── index.ts
│   │       ├── db/
│   │       ├── middleware/
│   │       ├── routes/
│   │       └── services/
│   │           └── provisioning/
│   └── ui/
│       ├── package.json
│       ├── vite.config.ts
│       ├── index.html
│       └── src/
│           ├── App.svelte
│           ├── app.css
│           ├── main.ts
│           └── lib/
│               ├── api.ts
│               ├── LicenseList.svelte
│               └── Login.svelte
└── bun.lock
```

## Domain-Specific Documentation

The project has detailed documentation for each domain. **ALWAYS read the relevant documentation files before working on related features.**

### ALWAYS Read These Files Before:

- **[docs/AUTHENTICATION.md](docs/AUTHENTICATION.md)**
  - When working with admin login, JWT issuance/verification, or token handling
  - Covers: `/api/auth/login`, `jwtMiddleware`, frontend `localStorage` auth flow
  - Current repo baseline: HS256 JWT + SQLite `admin_users`

- **[docs/BACKEND_API.md](docs/BACKEND_API.md)**
  - When changing API request/response fields, status codes, or route behavior
  - Covers: `/api/auth`, `/api/licenses`, `/api/verify`, error code contract
  - Current repo baseline: Hono routes + SQLite-backed license lifecycle

- **[docs/LICENSE_PROVISIONING.md](docs/LICENSE_PROVISIONING.md)**
  - When touching license create/provision state machine or Docker/Nginx integration
  - Covers: async provisioning queue, state transitions, recovery behavior, ops expectations
  - Current repo baseline: `enqueueLicenseProvisioning()` + startup `resumePendingProvisioning()`

### Read When Relevant:

- **[docs/UI_DESIGN.md](docs/UI_DESIGN.md)**
  - When creating/modifying Svelte UI components
  - Covers: current visual style, component responsibilities, state UX conventions

- **[docs/INTERNATIONALIZATION.md](docs/INTERNATIONALIZATION.md)**
  - When introducing locale support or changing displayed copy strategy
  - Covers: current non-i18n baseline and recommended migration path

- **[docs/ENVIRONMENT.md](docs/ENVIRONMENT.md)**
  - When changing `.env` keys, runtime assumptions, or deployment wiring
  - Covers: environment variable contract and startup requirements


## Quick Reference

### Authentication Usage

```typescript
import { api, saveToken } from "./lib/api";

const loginRes = await api.login("admin", "admin123");
saveToken(loginRes.data.token);

// All api.* requests now include Authorization: Bearer <jwt>
const licensesRes = await api.getLicenses();
console.log(licensesRes.data.length);
```

### Navigation with i18n

```typescript
// Current baseline: no locale routing.
// Single-page admin entry is always '/'.
const currentPath = window.location.pathname; // '/'
```

### Translations

```typescript
// Current baseline: UI text is inline hardcoded strings.
// Example in current components:
const labels = {
  login: "登录",
  generate: "生成 License",
  logout: "登出",
};
```
