# INTERNATIONALIZATION

## Current Baseline (Important)
This project currently has **no i18n framework** integrated.

- No locale-based routing
- No translation JSON dictionaries
- No `next-intl`, `@nuxtjs/i18n`, `i18next`, or equivalent package
- UI copy is inline in Svelte components (mostly Chinese)
- `index.html` uses `<html lang="zh">`

## Current Navigation Behavior
- Single admin page entry (`/`) rendered by Svelte app.
- API is always under `/api/*` and is locale-agnostic.

## If You Introduce i18n
When adding i18n, update this file and align these points:

1. Framework choice and package list.
2. Locale storage strategy (URL, localStorage, cookie, Accept-Language).
3. File conventions for translation resources.
4. Fallback locale behavior.
5. Migration of existing hardcoded UI strings.

## Suggested Minimal Migration Path
1. Introduce a single translation layer in `packages/ui/src/lib`.
2. Replace inline strings in `Login.svelte` and `LicenseList.svelte` with keyed lookups.
3. Keep API error code values stable, and map them to localized labels in UI.

## Related Source Files
- `packages/ui/index.html`
- `packages/ui/src/lib/Login.svelte`
- `packages/ui/src/lib/LicenseList.svelte`
- `packages/ui/src/App.svelte`
