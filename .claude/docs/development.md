# Development Setup

## Prerequisites

- Node.js v24.13 (see `.nvmrc`)
- pnpm
- Docker and Docker Compose
- Go (for collector development)

## Initial Setup

```bash
# 1. Install dependencies
pnpm install

# 2. Start infrastructure (ClickHouse, PostgreSQL, Mailpit)
docker-compose up -d

# 3. Initialize database schema (first time only)
cd packages/app && pnpm db:push

# 4. Start development server
pnpm dev
```

## Webhook Testing

For testing GitHub webhook integration locally:

1. Set up Microsoft Dev Tunnels: `devtunnel host`
2. Configure GitHub webhook to point to your tunnel URL
3. Run the collector: `cd collector && make run`

## Available Commands

### Root Level
```bash
pnpm install          # Install all dependencies
pnpm lint             # Lint with Biome
pnpm format           # Format with Biome
pnpm check            # Full Biome check (lint + format)
```

### Web App (packages/app)
```bash
pnpm dev              # Start Vite dev server
pnpm build            # Production build
pnpm test             # Run Vitest tests
pnpm db:push          # Push database schema to PostgreSQL
```

### Go Collector (collector/)
```bash
make build            # Build OTel collector binary
make run              # Build and run with config.yaml
make lint-all         # Lint all Go packages
make test-all         # Run all Go tests
make dockerbuild      # Build Docker image
```

## Documentation

Features and documentation live in `packages/docs` — keep docs up to date when adding or modifying features.