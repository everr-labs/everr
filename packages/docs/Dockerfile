FROM node:24.4-alpine3.22 AS base

FROM base AS deps
WORKDIR /app

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/docs/package.json ./packages/docs/
RUN corepack enable
RUN pnpm install --frozen-lockfile
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --ignore-scripts

FROM base AS build
COPY . .
RUN corepack enable
RUN pnpm --filter docs build
RUN pnpm --filter docs deploy /app/deployed


FROM node:24.4-alpine3.22 AS runner
WORKDIR /app

ENV NODE_ENV=production

# Create a non-root user
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nodejs

# Copy only necessary files
COPY --from=build /app/deployed .

# Expose the port the app will run on
EXPOSE 3000

USER nodejs

# Start the Node.js server
CMD ["node", ".output/server/index.mjs"]
