# React (Vite) static SPA served by nginx. BUILD CONTEXT MUST BE THE REPO ROOT
# (pnpm monorepo). On Sliplane: build context = repo root, Dockerfile path =
# apps/web/Dockerfile.
#
# The API base URL is injected at RUNTIME (not baked at build) via the
# API_BASE_URL env var — the entrypoint writes it into /env.js, so one image
# works across environments.

# --- Build stage -------------------------------------------------------------
FROM node:22-bookworm-slim AS build
RUN corepack enable && corepack prepare pnpm@10.33.0 --activate
WORKDIR /app

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm --filter web build

# --- Runtime stage -----------------------------------------------------------
FROM nginx:1.27-alpine AS runtime
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
# nginx:alpine runs every /docker-entrypoint.d/*.sh before starting.
COPY apps/web/docker-entrypoint.sh /docker-entrypoint.d/40-portal-env.sh
RUN chmod +x /docker-entrypoint.d/40-portal-env.sh
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 80
