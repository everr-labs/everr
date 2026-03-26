FROM node:24.4-alpine3.22 AS base
RUN corepack enable
WORKDIR /app

# Stage 1: install dependencies
FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/app/package.json ./packages/app/
COPY packages/datemath/package.json ./packages/datemath/
COPY packages/ui/package.json ./packages/ui/
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --ignore-scripts

# Stage 2: build
FROM deps AS build
COPY packages/datemath ./packages/datemath
COPY packages/ui ./packages/ui
COPY packages/app ./packages/app
RUN pnpm --filter @everr/app build

# Stage 3: production
FROM node:24.4-alpine3.22 AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nodejs
COPY --from=build /app/packages/app/.output ./.output

# Copy migration files
COPY packages/app/drizzle ./drizzle

EXPOSE 3000
USER nodejs
CMD ["node", ".output/server/index.mjs"]
