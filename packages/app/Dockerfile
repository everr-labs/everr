FROM node:24.21.0-trixie-slim@sha256:8ec5d7557396cfe32d21c3f9c13072355ceab22b584578ca4bb28af31120cffe AS base
RUN corepack enable
WORKDIR /app

# Stage 1: install dependencies
FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/app/package.json ./packages/app/
COPY packages/otel-errors/package.json ./packages/otel-errors/
COPY packages/otel-web/package.json ./packages/otel-web/
COPY packages/tanstack-start-otel/package.json ./packages/tanstack-start-otel/
COPY packages/datemath/package.json ./packages/datemath/
COPY packages/ui/package.json ./packages/ui/
COPY packages/telemetry-explorer/package.json ./packages/telemetry-explorer/
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --ignore-scripts

# Stage 2: build
FROM deps AS build
# Public (origin-bound, ingest-only) browser key baked into the client bundle by
# Vite at build time. Optional: when unset, browser error tracking stays off.
ARG VITE_EVERR_PUBLIC_INGEST_KEY
ENV VITE_EVERR_PUBLIC_INGEST_KEY=$VITE_EVERR_PUBLIC_INGEST_KEY
COPY packages/otel-errors ./packages/otel-errors
COPY packages/otel-web ./packages/otel-web
COPY packages/tanstack-start-otel ./packages/tanstack-start-otel
COPY packages/datemath ./packages/datemath
COPY packages/ui ./packages/ui
COPY packages/telemetry-explorer ./packages/telemetry-explorer
COPY packages/app ./packages/app
# SPA prerender initializes auth and mailer configuration without using them.
# These values exist only during this command; runtime configuration is required.
RUN SKIP_ENV_VALIDATION=true \
    BETTER_AUTH_URL=http://localhost:3000 \
    BETTER_AUTH_SECRET=prerender-only-not-a-runtime-secret \
    EMAIL_DSN=smtp://localhost:1025 \
    pnpm --filter @everr/app build && \
    test -s packages/app/.output/public/_shell.html

# Stage 3: production
# Node 24.21.0, keep in sync with the builder and .nvmrc.
FROM gcr.io/distroless/nodejs24-debian13:nonroot@sha256:bb6b03d81066993293a10feda7250e8e1cc034035fe9b61cfceededa7c8bf04d AS runner
WORKDIR /app
ENV NODE_ENV=production
# Nitro includes the runtime dependencies in its standalone output.
COPY --from=build /app/packages/app/.output ./.output

# Drizzle needs the SQL files and journal, but not development snapshots.
COPY packages/app/drizzle/*.sql ./drizzle/
COPY packages/app/drizzle/meta/_journal.json ./drizzle/meta/_journal.json

EXPOSE 3000
CMD [".output/server/index.mjs"]
