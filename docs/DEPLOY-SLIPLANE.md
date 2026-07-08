# Deploying to Sliplane

Sliplane runs Docker containers from a connected GitHub repo. This app deploys as
**four services** on one Sliplane server:

| Service | Image source | Purpose | Port |
|---|---|---|---|
| `postgres` | Sliplane Postgres template | Database | 5432 (internal) |
| `redis` | Sliplane Redis template | Queue/cache (BullMQ later) | 6379 (internal) |
| `api` | `apps/api/Dockerfile` | NestJS REST API `/api/v1` | 3000 |
| `web` | `apps/web/Dockerfile` | React SPA (nginx) | 80 |

Both app images are built from the **repo root** (this is a pnpm monorepo), so each
service's **build context is the repository root** and the **Dockerfile path** is
`apps/api/Dockerfile` / `apps/web/Dockerfile`.

The API container runs migrations (`prisma migrate deploy`) and an idempotent seed on
startup, then serves. The web container injects the API URL at runtime (no rebuild to
repoint it).

---

## 1. Connect the repo

1. In Sliplane, create (or pick) a **Server**.
2. **Connect GitHub** and grant access to `markchrc2025/Accounting-Firm-Portal`.

## 2. Postgres + Redis

1. **New Service → Postgres** (template). Set a strong password; note the values.
   Services on the same server reach each other by **service name** as hostname, so
   the connection string is:

   ```
   postgresql://<user>:<password>@postgres:5432/<db>?schema=public
   ```

2. **New Service → Redis** (template). Its URL is:

   ```
   redis://redis:6379
   ```

   (Use the exact service names you gave them in place of `postgres` / `redis`.)

## 3. API service

- **New Service → from GitHub repo**, this repository.
- **Build context:** `/` (repo root)  ·  **Dockerfile:** `apps/api/Dockerfile`
- **Exposed port:** `3000`
- **Health check path:** `/api/v1/health`
- **Environment variables:**

  | Key | Value |
  |---|---|
  | `NODE_ENV` | `production` |
  | `API_PORT` | `3000` |
  | `DATABASE_URL` | `postgresql://<user>:<password>@postgres:5432/<db>?schema=public` |
  | `REDIS_URL` | `redis://redis:6379` |
  | `JWT_SECRET` | a long random string (e.g. `openssl rand -hex 32`) |
  | `JWT_ACCESS_TTL` | `1h` (optional) |
  | `JWT_MFA_TTL` | `5m` (optional) |
  | `INVITE_TTL_HOURS` | `168` (optional) |
  | `SEED_ADMIN_EMAIL` | your bootstrap admin email |
  | `SEED_ADMIN_PASSWORD` | a strong password (change after first login) |
  | `SEED_FIRM_NAME` | your firm's name (optional) |

- Deploy. First boot applies migrations + seeds the RBAC catalog and Super Admin.
- Note the service's public URL, e.g. `https://api-xxxx.sliplane.app`. Swagger is at
  `…/api/v1/docs`.

## 4. Web service

- **New Service → from GitHub repo**, same repository.
- **Build context:** `/`  ·  **Dockerfile:** `apps/web/Dockerfile`
- **Exposed port:** `80`
- **Environment variable:**

  | Key | Value |
  |---|---|
  | `API_BASE_URL` | `https://api-xxxx.sliplane.app/api/v1` (the API's public URL + `/api/v1`) |

- Deploy. Open the web service's URL and sign in with `SEED_ADMIN_EMAIL` /
  `SEED_ADMIN_PASSWORD`.

## 5. Order & redeploys

Deploy `postgres` and `redis` first, then `api`, then `web`. On every push to the
default branch, redeploy `api` and `web` (Sliplane can auto-deploy on push). Because
the API self-migrates on startup, new migrations apply automatically.

---

## Notes & hardening

- **Secrets:** `JWT_SECRET` and DB credentials live only in Sliplane env vars — never
  in the repo. The seed's default password is for bootstrap only; change it immediately.
- **CORS:** the API currently allows all origins (`app.enableCors()`). To lock it to
  the web origin, add a `WEB_ORIGIN` env var and pass it to `enableCors({ origin })`
  in `apps/api/src/main.ts` (small follow-up).
- **TLS:** Sliplane terminates HTTPS on the `*.sliplane.app` subdomains automatically;
  add a custom domain per service if desired.
- **Runtime model:** the API runs on `ts-node` (because `@portal/shared` is consumed as
  TS source). It works in production; a future optimization is to publish `@portal/shared`
  as compiled JS and run the API from a compiled bundle for faster cold starts.
- **Persistence:** keep the Postgres (and Redis, if used for durable queues) template
  **volumes** enabled so data survives redeploys.
