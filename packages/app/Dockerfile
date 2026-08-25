FROM node:24.4-alpine3.22 AS base
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
RUN pnpm --filter @everr/app build

# Stage 3: production
FROM node:24.4-alpine3.22 AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nodejs
COPY --from=build /app/packages/app/.output ./.output
COPY --from=build /app/node_modules/.pnpm ./node_modules/.pnpm
COPY --from=build /app/packages/app/node_modules ./packages/app/node_modules
COPY --from=build /app/packages/app/package.json ./packages/app/package.json

# Copy migration files
COPY packages/app/drizzle ./drizzle

EXPOSE 3000
USER nodejs
CMD ["node", ".output/server/index.mjs"]
