# DeepTutor Vue 3 frontend

`web-vue3/` is the production Vue 3 + Vite frontend for DeepTutor. It talks to
the same FastAPI/WebSocket backend as the legacy `web/` application and contains
no React, React DOM, Next.js, iframe forwarding, or embedded React components.
The default launcher and Docker image now use this directory; `web/` is kept
only as the legacy reference implementation during the migration review.

## Run locally

Start the DeepTutor backend on port 8001, then:

```bash
cd web-vue3
npm ci
npm run dev
```

Open <http://127.0.0.1:3783>. Vite resolves the backend with the same contract
as the launcher and React frontend: `DEEPTUTOR_API_ORIGIN`,
`DEEPTUTOR_API_BASE_URL`, `BACKEND_PORT`, `NEXT_PUBLIC_API_BASE`, then the shared
`data/user/settings/system.json`. A manual `npm run dev` therefore follows the
configured DeepTutor backend port automatically. To launch the backend and Vue
production server together, run `deeptutor start` from the repository root;
`deeptutor start --dev` selects Vite HMR instead.

`npm run build` typechecks and produces static assets in `dist/`. `server.mjs`
serves those assets with SPA fallback and proxies `/api`, `/files`, and `/ws`
without runtime npm dependencies:

```bash
npm run build
FRONTEND_PORT=3782 DEEPTUTOR_API_ORIGIN=http://127.0.0.1:8001 node server.mjs
```

## Verification

```bash
npm ci
npm run test:unit
npx playwright install chromium  # first browser-test run only
npm run test:e2e
npm run test:server
npm run typecheck
npm run build
npm run routes:status
```

Current automated coverage:

- 65/65 tracked routes complete;
- 141 Vitest component/helper tests;
- 156 Playwright Chromium workflows with deterministic API/WebSocket fixtures;
- shared backend-origin, proxy-failure and production static-server tests;
- production typecheck and Vite build;
- separate real PostgreSQL role acceptance, including a real model turn and
  note upload/export, via `npm run test:acceptance`.

The acceptance configuration expects the isolated backend described in
`docs-for-dev/WEB_VUE3_DEPLOYMENT-zh.md` on port 8011. It is intentionally not
part of `test:e2e`, so fixture runs never require a database or provider. Set
`VUE3_ACCEPTANCE_REAL_LLM=1` only for an isolated runtime with a configured,
authorized test model; that opt-in performs one small real model request.

Whisper has deterministic coverage for visitor/trainee isolation, room IDs,
crisis lockout, reset, and the unavailable-plugin state. The external Whisper
plugin itself was not installed locally, so its provider-specific live output
still needs a plugin-equipped deployment check.

See `docs-for-dev/WEB_VUE3_MIGRATION_GOAL-zh.md` and
`docs-for-dev/WEB_VUE3_DEPLOYMENT-zh.md` for the route inventory and deployment
requirements.
