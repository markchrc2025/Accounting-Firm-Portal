#!/bin/sh
# API container entrypoint. Boot order is tuned so the HTTP server binds its port as
# fast as possible (Sliplane fails a deploy if the health check doesn't pass in time):
#   1. Apply migrations (BLOCKING — the schema must exist before the app boots).
#   2. Start the server in the background and give it the WHOLE CPU to cold-start
#      (ts-node compilation is slow on small hosts).
#   3. Only once /api/v1/health responds do we run the idempotent RBAC/admin seed, so
#      the seed's own ts-node cold start never competes with the server during boot.
# Requires DATABASE_URL and JWT_SECRET (REDIS_URL optional) in the environment.
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

PORT="${API_PORT:-3000}"

echo "==> Starting API on :${PORT}"
pnpm --filter api start &
SERVER_PID=$!

# Wait for the server to accept connections before seeding, so the seed does not steal
# CPU from the server while it is still compiling (that contention is what pushed the
# health check past its deadline). Poll with node's built-in http — no extra deps.
echo "==> Waiting for the API to answer on :${PORT} before seeding"
i=0
while [ "$i" -lt 120 ]; do
  if node -e "require('http').get({host:'127.0.0.1',port:process.env.API_PORT||3000,path:'/api/v1/health',timeout:2000},function(){process.exit(0)}).on('error',function(){process.exit(1)}).on('timeout',function(){this.destroy();process.exit(1)})" 2>/dev/null; then
    echo "==> API is answering; running seed"
    break
  fi
  # If the server process died, stop waiting and fail loudly.
  if ! kill -0 "$SERVER_PID" 2>/dev/null; then
    echo "!!! API process exited before it became reachable"
    wait "$SERVER_PID"
    exit 1
  fi
  i=$((i + 1))
  sleep 2
done

echo "==> Seeding RBAC catalog + bootstrap admin (idempotent)"
if ! pnpm --filter api db:seed; then
  echo "!!! =========================================================="
  echo "!!! SEED FAILED — see the error above (convention violations"
  echo "!!! name the offending account codes). Steps seeded BEFORE the"
  echo "!!! failure remain in place; later steps were skipped. Fix the"
  echo "!!! data file and redeploy. The API keeps serving meanwhile."
  echo "!!! =========================================================="
fi

# Forward termination to the server and keep the container tied to its lifetime.
trap 'kill -TERM "$SERVER_PID" 2>/dev/null' TERM INT
wait "$SERVER_PID"
