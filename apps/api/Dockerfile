# NestJS API image. BUILD CONTEXT MUST BE THE REPO ROOT (this is a pnpm
# monorepo — the build needs pnpm-workspace.yaml, the lockfile, and
# packages/shared). On Sliplane: set the build context to the repo root and the
# Dockerfile path to apps/api/Dockerfile.
#
# The API is consumed with @portal/shared as TypeScript source, so it runs on
# ts-node (as `pnpm --filter api start`) rather than a compiled dist bundle.
FROM node:22-bookworm-slim

# Prisma needs openssl at runtime; certs for outbound TLS. pg_dump is for the
# database backups (D38, docs/BACKUPS.md): it must be at least the server's major
# version. The production server is Sliplane Managed PostgreSQL 18 (read off the
# Sliplane console, 2026-10-10; recorded in docs/BACKUPS.md), and Debian bookworm's
# own archive stops at 15, so the client comes from the PostgreSQL project's apt
# repository (PGDG) at major 18. Before every dump the API compares pg_dump's major
# with the server's and refuses, naming the number to raise here, if the client is
# older. The final `pg_dump --version` makes a missing client fail the image build.
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates curl \
  && install -d /usr/share/postgresql-common/pgdg \
  && curl -fsSL -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc \
       https://www.postgresql.org/media/keys/ACCC4CF8.asc \
  && echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt bookworm-pgdg main" \
       > /etc/apt/sources.list.d/pgdg.list \
  && apt-get update \
  && apt-get install -y --no-install-recommends postgresql-client-18 \
  && apt-get purge -y --auto-remove curl \
  && rm -rf /var/lib/apt/lists/* \
  && pg_dump --version

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
# Entrypoint backs up (production only), applies migrations (+ idempotent seed), then
# starts the server.
CMD ["sh", "apps/api/docker-start.sh"]
