FROM node:24.4-alpine3.22 AS base

FROM base AS deps
WORKDIR /app

RUN ls -la
COPY package.json pnpm-lock.yaml ./
RUN corepack enable
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --ignore-scripts

FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

RUN corepack enable
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm build

FROM node:24.4-alpine3.22 AS runner
WORKDIR /app

ENV NODE_ENV=production

# Create a non-root user
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nodejs

# Copy only necessary files
COPY --from=builder /app/.output ./.output

# Expose the port the app will run on
EXPOSE 3000

USER nodejs

# Start the Node.js server
CMD ["node", ".output/server/index.mjs"]
