FROM node:24.22.1-trixie-slim@sha256:43b9ba1142b8dcf33fa8f922ca1be85714adc444e0586c7cf7726daaeabc1bea AS base
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
    pnpm install --filter @everr/app... --frozen-lockfile --ignore-scripts

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
# The MCP query tool description inlines the telemetry skill's schema at build time.
COPY skills/everr-use-telemetry/rules/schema.md ./skills/everr-use-telemetry/rules/schema.md
# SPA prerender initializes auth and mailer configuration without using them.
# These values exist only during this command; runtime configuration is required.
RUN SKIP_ENV_VALIDATION=true \
    BETTER_AUTH_URL=http://localhost:3000 \
    BETTER_AUTH_SECRET=prerender-only-not-a-runtime-secret \
    pnpm --filter @everr/app build && \
    test -s packages/app/.output/public/_shell.html

# Require every source SQL file and journal in the output so startup can migrate.
RUN set -eu; \
    for file in packages/app/drizzle/*.sql packages/app/drizzle/meta/_journal.json; do \
      test -s "packages/app/.output/drizzle/${file#packages/app/drizzle/}"; \
    done

# Stage 3: production
# Node 24.22.1, keep in sync with the builder and .node-version.
FROM gcr.io/distroless/nodejs24-debian13:nonroot@sha256:cb606325b7ec4af55462cb0b424a53b452a5b4a894ffe841fcf1048d216fb9f8 AS runner
WORKDIR /app
ENV NODE_ENV=production
# Nitro includes the runtime dependencies in its standalone output.
COPY --from=build /app/packages/app/.output ./.output

EXPOSE 3000
CMD [".output/server/index.mjs"]
