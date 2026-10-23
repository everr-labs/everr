# Worktree development

Run from the repository root:

```sh
pnpm dev         # plain terminal output
pnpm dev --tui   # Process Compose's interactive interface
pnpm dev --help  # Process Compose options
```

Ctrl+C stops the stack. In TUI mode, confirm Process Compose's quit dialog. Database volumes survive ordinary stops. Cloud collector queues persist across restarts. App collector queues are in memory; pending App telemetry is not retained across restarts. The shared Portless proxy remains running for other worktrees.

Prerequisites: Process Compose (tested with 1.122.0, install with `brew install process-compose`), Go 1.26, Make, Node 24, installed workspace dependencies, and Docker with Compose. Docker's normal context and environment are honored. Portless is pinned as a workspace dependency; its initial HTTPS setup may require permission. Run `pnpm exec portless proxy start` first if certificate setup is needed.

## What starts

Process Compose runs App, Cloud, and a separate native collector for each application. The existing Make targets build both the cloud and self-hosted collector distributions for the host. Docker runs PostgreSQL and a separate ClickHouse container for each application.

Portless handles HTTP port allocation and worktree prefixes. Application service names remain `app` and `app-cloud`; collector names are `app-ingest` and `cloud-ingest`. For a worktree named `portless`, the URLs are:

| Service      | URL                                       |
| ------------ | ----------------------------------------- |
| App          | `https://portless.app.localhost`          |
| Cloud        | `https://portless.app-cloud.localhost`    |
| App ingest   | `https://portless.app-ingest.localhost`   |
| Cloud ingest | `https://portless.cloud-ingest.localhost` |

The actual URLs are obtained with `portless get` and printed at startup. This development collector configuration exposes authenticated OTLP/HTTP (`/v1/logs`, `/v1/traces`, `/v1/metrics`). It does not expose a separate OTLP/gRPC listener. Production collector configuration is unchanged.

Applications start after database provisioning, with their stable ingest URLs already configured. Each collector starts after its application's health check passes and verifies keys through the application's HTTPS URL. There is no endpoint handshake, Docker-to-host callback, or waiting application wrapper. Vite and the collectors bind to loopback.

Each checkout owns one PostgreSQL server and two ClickHouse servers, with Docker-assigned loopback ports:

| Application | PostgreSQL database | ClickHouse service | Read database | Landing database |
| ----------- | ------------------- | ------------------ | ------------- | ---------------- |
| App         | `everr_app`         | `clickhouse-app`   | `app`         | `otel`           |
| Cloud       | `everr_cloud`       | `clickhouse-cloud` | `app`         | `otel`           |

Both ClickHouse images use the table definitions and SQL query limits in `clickhouse/init/shared/`. Their access policies live in `clickhouse/init/self-hosted/` and `clickhouse/init/cloud/`. Separate servers and volumes let both products use the same database and user names. Self-hosted creates installation-wide readers and one SQL API user directly, with no tenant row policies or per-organization user-management grants. Cloud keeps its tenant policies and per-organization SQL users. Each application runs its PostgreSQL migrations and workers against its own database.

## Configuration and data

The entry point does not copy or read application dotenv files. Applications load their own optional settings. Cloud requires its Polar configuration and both `EMAIL_DSN` and `EMAIL_FROM` in every environment, including development. SMTP remains optional for the self-hosted App. GitHub ingress and Smee are disabled in this basic stack.

Generated local connection settings override application dotenv values. The stack uses fixed development credentials (`dev` for database passwords and a fixed development-only auth/verification secret). No credentials are generated or loaded from `secrets.json`. Each ClickHouse container initializes its own schema and users on its first start. PostgreSQL provisioning creates the application databases and sets their local credentials. Switching from the earlier generated auth secret requires signing in again; locally stored encrypted integration settings may need to be recreated. The self-hosted App collector uses in-memory buffering without Cloud usage accounting. The Cloud collector retains usage accounting and durable queues under `.dev/instances/<instance>/cloud-queue/`. Old App queue directories and Docker queue volumes are no longer used.

Instance identity comes from the canonical checkout path. Branch changes in the same checkout preserve data; distinct paths use distinct Docker projects and volumes. The entry script uses macOS `shlock` or Linux `flock` to prevent concurrent starts in one checkout.

## Implementation

- `process-compose.yaml` owns builds, dependencies, readiness, process failure handling, and shutdown.
- `scripts/dev/compose.yaml` declares the database containers and volumes and builds each product's ClickHouse image. The standard ClickHouse entrypoint initializes each server directly.
- `scripts/dev/collector-app.yaml` declares self-hosted public ingestion with in-memory buffering.
- `scripts/dev/collector-cloud.yaml` retains Cloud usage accounting and durable queues. Both preserve authentication, tenant isolation, and retention processors from `collector/config.example.yml`.
- `scripts/dev/start.sh` establishes the checkout environment, runs provisioning preparation, and executes Process Compose with forwarded arguments.
- `tools/dev/cmd/prepare` provisions databases, and loads connection settings before executing a command supplied by YAML. It does not supervise processes or generate Compose/collector YAML.

Process Compose uses failure-only shutdown with SIGTERM accepted as an expected exit, avoiding an `exit_on_end` shutdown issue in version 1.122.0. A spontaneous successful process exit is not treated as failure. Shutdown stops collectors before their applications and databases. Portless allows its child processes up to ten seconds to terminate. App telemetry still buffered at exit is discarded; Cloud queues remain on disk.
