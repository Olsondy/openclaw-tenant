# AUTHENTICATION

## Scope
This document covers admin authentication for the management UI and protected API calls.

## Current Implementation

### Login Endpoint
- Route: `POST /api/auth/login`
- File: `packages/api/src/routes/auth.ts`
- Request body:

```json
{ "username": "admin", "password": "admin123" }
```

- Behavior:
  - Validates JSON and required fields.
  - Reads user from `admin_users` table.
  - Verifies password with `bcrypt.compareSync`.
  - Signs JWT using `JWT_SECRET` (HS256, 24h expiry).
- Success response:

```json
{ "success": true, "data": { "token": "<jwt>" } }
```

### Protected Routes Middleware
- File: `packages/api/src/middleware/jwt.ts`
- Applied at: `/api/licenses/*` in `packages/api/src/index.ts`
- Requires header: `Authorization: Bearer <jwt>`
- Error responses:
  - `UNAUTHORIZED` (401): missing/invalid bearer header
  - `INVALID_TOKEN` (401): token verification failed
  - `SERVER_MISCONFIGURATION` (500): missing `JWT_SECRET`

## Admin User Source
- Table: `admin_users`
- Initialized in `packages/api/src/db/client.ts` via `seedAdmin()`.
- Credentials come from env:
  - `ADMIN_USER` (default `admin`)
  - `ADMIN_PASS` (default `admin123`)
- Password is stored as bcrypt hash, never plaintext.

## Frontend Auth Flow
- File: `packages/ui/src/lib/api.ts`
- Token storage key: `localStorage['jwt']`
- Helpers:
  - `saveToken(token)`
  - `clearToken()`
  - `isLoggedIn()`
- Request wrapper automatically injects `Authorization` header when token exists.

## Security Notes
- Production must set a strong `JWT_SECRET` and non-default admin credentials.
- JWT currently has no refresh token flow; re-login is required after token expiry.
- `localStorage` token strategy is simple but XSS-sensitive; avoid unsafe HTML injection.

## Related Files
- `packages/api/src/routes/auth.ts`
- `packages/api/src/middleware/jwt.ts`
- `packages/api/src/db/client.ts`
- `packages/ui/src/lib/api.ts`
- `packages/ui/src/lib/Login.svelte`

## Update Checklist (when auth changes)
1. Keep login response shape backward-compatible or update UI simultaneously.
2. Keep middleware error code contract synchronized with frontend error handling.
3. Update this document and `docs/BACKEND_API.md` together for route contract changes.
