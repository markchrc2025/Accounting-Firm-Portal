#!/bin/sh
# API container entrypoint: apply committed migrations, seed the RBAC catalog +
# bootstrap admin (idempotent), then start the server. Requires DATABASE_URL,
# REDIS_URL, and JWT_SECRET in the environment (set these in Sliplane).
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

echo "==> Seeding RBAC catalog + bootstrap admin (idempotent)"
# Best-effort: a healthy API must not be blocked by a seed hiccup.
pnpm --filter api db:seed || echo "WARN: seed step failed; continuing"

echo "==> Starting API on :${API_PORT:-3000}"
exec pnpm --filter api start
