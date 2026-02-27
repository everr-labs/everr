FROM node:24.4-alpine3.22 AS base
RUN corepack enable
WORKDIR /app

# Stage 0: build everr CLI artifact for docs hosting
FROM rust:1.89-alpine3.22 AS everr-cli-build
WORKDIR /app
RUN apk add --no-cache build-base linux-headers
COPY everr-cli/Cargo.toml everr-cli/Cargo.lock ./everr-cli/
COPY everr-cli/src ./everr-cli/src
RUN cargo build --release --manifest-path everr-cli/Cargo.toml
RUN mkdir -p /out && \
    cp /app/everr-cli/target/release/everr /out/everr && \
    cd /out && \
    sha256sum everr | awk '{print $1 "  everr"}' > everr.sha256

# Stage 1: install dependencies
FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/docs/package.json ./packages/docs/
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --ignore-scripts

# Stage 2: build
FROM deps AS build
COPY . .
COPY --from=everr-cli-build /out/everr ./packages/docs/public/everr
COPY --from=everr-cli-build /out/everr.sha256 ./packages/docs/public/everr.sha256
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
