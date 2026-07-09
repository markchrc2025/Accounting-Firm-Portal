#!/bin/sh
# API container entrypoint. Order matters for a fast, health-check-passing boot:
#   1. Apply migrations (BLOCKING — the schema must exist before the app boots).
#   2. Start the HTTP server as the foreground process so it binds the port ASAP.
#   3. Seed the RBAC catalog + bootstrap admin in the BACKGROUND — it is idempotent
#      and best-effort, so it must not delay the server behind a second slow ts-node
#      cold start (that delay is what made Sliplane health checks time out).
# Requires DATABASE_URL, JWT_SECRET (and optionally REDIS_URL) in the environment.
set -e

# Surface WHICH database we're about to hit — host/port/db only, never the
# password — so a connection failure is diagnosable straight from the logs.
if [ -n "$DATABASE_URL" ]; then
  DB_TARGET=$(printf '%s' "$DATABASE_URL" | sed -E 's#^[a-zA-Z]+://[^@]*@#//#')
  echo "==> DATABASE_URL target: ${DB_TARGET}"
else
  echo "!!! DATABASE_URL is NOT set — the API cannot reach a database. Set it in Sliplane env vars."
fi

echo "==> Applying database migrations (prisma migrate deploy)"
if ! pnpm --filter api prisma:deploy; then
  echo "!!! Migration step failed. This almost always means DATABASE_URL is wrong or"
  echo "!!! the database is unreachable. Check: correct host/port, the user owns the"
  echo "!!! database, the db name exists, and SSL is enabled (append ?sslmode=require"
  echo "!!! for a managed Postgres). See the target printed above."
  exit 1
fi

# Seed in the background so the server can bind port ${API_PORT:-3000} and pass the
# health check without waiting on the seed's ts-node cold start. Give the server a
# short head start first (both run on ts-node and share CPU on small hosts).
(
  sleep 20
  echo "==> Seeding RBAC catalog + bootstrap admin (idempotent, background)"
  pnpm --filter api db:seed || echo "WARN: seed step failed; continuing"
) &

echo "==> Starting API on :${API_PORT:-3000}"
exec pnpm --filter api start
