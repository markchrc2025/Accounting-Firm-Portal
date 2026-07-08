# NestJS API image. BUILD CONTEXT MUST BE THE REPO ROOT (this is a pnpm
# monorepo — the build needs pnpm-workspace.yaml, the lockfile, and
# packages/shared). On Sliplane: set the build context to the repo root and the
# Dockerfile path to apps/api/Dockerfile.
#
# The API is consumed with @portal/shared as TypeScript source, so it runs on
# ts-node (as `pnpm --filter api start`) rather than a compiled dist bundle.
FROM node:22-bookworm-slim

# Prisma needs openssl at runtime; certs for outbound TLS.
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

RUN corepack enable && corepack prepare pnpm@10.33.0 --activate
WORKDIR /app

# 1) Install deps using only the manifests first (better layer caching).
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile

# 2) Copy the source and generate the Prisma client for this platform.
COPY . .
RUN pnpm --filter api prisma:generate

ENV NODE_ENV=production
ENV API_PORT=3000
EXPOSE 3000

# Health: GET /api/v1/health (liveness), /api/v1/health/readiness (DB + Redis).
# Entrypoint applies migrations (+ idempotent seed) then starts the server.
CMD ["sh", "apps/api/docker-start.sh"]
