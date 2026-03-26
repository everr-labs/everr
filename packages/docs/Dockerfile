FROM node:24.4-alpine3.22 AS base
RUN corepack enable
WORKDIR /app

# Stage 1: install dependencies
FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/docs/package.json ./packages/docs/
COPY packages/ui/package.json ./packages/ui/
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --ignore-scripts

# Stage 2: build
FROM deps AS build
COPY . .
COPY packages/ui ./packages/ui
RUN pnpm --filter docs build

# Stage 3: production
FROM node:24.4-alpine3.22 AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nodejs
COPY --from=build /app/packages/docs/.output ./.output
EXPOSE 3000
USER nodejs
CMD ["node", ".output/server/index.mjs"]
