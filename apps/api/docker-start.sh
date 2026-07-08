#!/bin/sh
# API container entrypoint: apply committed migrations, seed the RBAC catalog +
# bootstrap admin (idempotent), then start the server. Requires DATABASE_URL,
# REDIS_URL, and JWT_SECRET in the environment (set these in Sliplane).
set -e

echo "==> Applying database migrations (prisma migrate deploy)"
pnpm --filter api prisma:deploy

echo "==> Seeding RBAC catalog + bootstrap admin (idempotent)"
# Best-effort: a healthy API must not be blocked by a seed hiccup.
pnpm --filter api db:seed || echo "WARN: seed step failed; continuing"

echo "==> Starting API on :${API_PORT:-3000}"
exec pnpm --filter api start
