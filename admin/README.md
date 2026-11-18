# BDREN AI admin panel

The platform superadmin console, served at `/admin/` on the platform domain. It talks to the Django
backend's `/api/v1/superadmin/` API (contract: `docs/SUPERADMIN_API.md`) with the same session cookie as
the website, so it only works on the same origin as the backend (through the dev proxy or nginx).

Stack: Vite, React 19, TypeScript (strict), TanStack Router and Query, Tailwind CSS 4, Radix Dialog,
cmdk, lucide-react. Versions are pinned exactly in `package.json`.

## Develop

```sh
cd admin
npm install
npm run dev          # http://localhost:5174/admin/
```

The dev server proxies `/api` to the Django backend on `http://localhost:8000` and keeps the browser's
`Host` header (`changeOrigin: false`) so Django's CSRF origin check passes. Start the backend first.

Signing in: when `GET /api/v1/superadmin/session/` answers 401 the app sends the browser to
`/api/v1/auth/login/?next=<current URL>`. The backend must list the admin origin (for example
`http://localhost:5174`) in `OIDC_ALLOWED_REDIRECT_ORIGINS`, and your account needs the superadmin role:

```sh
python manage.py grant_platform_role --email you@example.org
```

A signed-in account without the role sees an access-denied page with a sign-out button.

## Build

```sh
npm run build        # tsc --noEmit, then vite build into dist/
npm run preview      # serve dist/ locally
```

Docker: `docker build -t bdrenai-admin admin/` builds the app and serves `dist/` with nginx under
`/admin/`, falling back to `/admin/index.html` for client-side routes (`nginx.conf`). Health check:
`/healthz`.

## Test

```sh
npm test             # vitest run
npm run typecheck    # tsc --noEmit
```

Tests render the whole app (router, queries, shell) and answer `fetch` at the network boundary
(`src/test/api.ts`); nothing in our own code is mocked.

## Layout

```
src/
  api/          types.ts (contract shapes), client.ts (fetch, CSRF, 401/403), queries.ts (React Query hooks)
  components/   ui/ (primitives: Button, Dialog, Drawer, Tabs, Table, Combobox, ConfirmDialog, ...), layout/ (shell, sidebar, ⌘K)
  features/     institution form and dialogs, invitation picker and table, member actions, audit table
  pages/        one file or folder per route
  lib/          theme (light/dark/system), formatting, CSV parsing, labels
```

Theme tokens live in `src/styles.css` as CSS variables with light and dark values; `data-theme` on
`<html>` is `light`, `dark` or `system` and is remembered in `localStorage`.
