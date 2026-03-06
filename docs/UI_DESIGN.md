# UI_DESIGN

## Scope
This document describes the current Svelte admin UI design and component conventions.

## Stack
- Svelte 5 + Vite
- Tailwind CSS v4 + `@tailwindcss/forms`
- Entry: `packages/ui/src/main.ts`

## Visual Baseline
- Primary blue: `#1a73e8`
- App background: `#f8f9fa`
- Cards: white, soft border, light shadow
- Typography: Inter from Google Fonts (`packages/ui/index.html`)
- Tone: lightweight admin dashboard, Chinese copy focused

## Component Map
- `App.svelte`
  - Local auth gate via `isLoggedIn()`
  - `Login` when logged out
  - `LicenseList` when logged in
- `lib/Login.svelte`
  - Username/password form
  - Calls `api.login`, stores JWT
- `lib/LicenseList.svelte`
  - Loads license list on mount
  - Loads global settings on mount
  - Global settings modal (`runtime_provider/runtime_dir/data_dir/host_ip/base_domain/ports`)
  - Generate license (optional ownerTag)
  - Revoke license action
  - Shows provisioning state chips and gateway URL

## Interaction Patterns
- State uses Svelte runes:
  - `$state` for local mutable state
  - `$props` for callback props
  - `$effect` for load-on-mount
- API calls are centralized in `lib/api.ts`.
- Errors are shown inline in red alert blocks.

## Current UX States
- Login button: normal / loading / error
- License table: loading / empty / populated
- Settings modal: loading settings / editing / saving
- Provision state chips:
  - `Pending` (gray)
  - `Running` (blue, pulse)
  - `Ready` (green)
  - `Failed` (red, optional tooltip from `provision_error`)

## UI Guardrails
1. Keep route/API interactions through `lib/api.ts` only.
2. Preserve status color semantics unless updating all related screens/docs.
3. Keep mobile-safe overflow behavior (`overflow-x-auto`) for table.
4. Maintain Chinese-first copy unless i18n is intentionally introduced.

## Related Source Files
- `packages/ui/src/App.svelte`
- `packages/ui/src/lib/Login.svelte`
- `packages/ui/src/lib/LicenseList.svelte`
- `packages/ui/src/lib/api.ts`
- `packages/ui/src/app.css`
