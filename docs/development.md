# Worktree development

Run from the repository root:

```sh
pnpm dev         # plain terminal output
pnpm dev --tui   # Process Compose's interactive interface
pnpm dev --help  # Process Compose options
```

Ctrl+C stops the stack. In TUI mode, confirm Process Compose's quit dialog. Database volumes survive ordinary stops. Cloud collector queues persist across restarts. App collector queues are in memory; pending App telemetry is not retained across restarts. The shared Portless proxy remains running for other worktrees.

Prerequisites: Process Compose (tested with 1.122.0, install with `brew install process-compose`), Go 1.26, Make, Node 24, installed workspace dependencies, and Docker with Compose. Docker's normal context and environment are honored. Portless is pinned as a workspace dependency; its initial HTTPS setup may require permission. Run `pnpm exec portless proxy start` first if certificate setup is needed.

## Control a running stack

Each stack exposes a Process Compose Unix socket at `.dev/pc.sock`. From another terminal in the same checkout:

```sh
process-compose -U -u .dev/pc.sock process list
process-compose -U -u .dev/pc.sock process restart cloud
process-compose -U -u .dev/pc.sock process logs cloud
process-compose -U -u .dev/pc.sock down
```

The socket lives under `DEV_STATE_DIR` when that directory is overridden, so verification runs have their own control socket. The control API does not use a TCP port.

## What starts

Process Compose runs App, Cloud, and one native collector for each application. Each collector handles public OTLP/HTTP, OTLP/gRPC, and signed GitHub replay on separate listeners. The existing Make targets build both the cloud and self-hosted collector distributions for the host. Docker runs PostgreSQL and a separate ClickHouse container for each application.

Portless handles HTTP port allocation and worktree prefixes. Application service names remain `app` and `app-cloud`; collector names are `app-ingest` and `cloud-ingest`. For a worktree named `portless`, the URLs are:

| Service      | URL                                       |
| ------------ | ----------------------------------------- |
| App          | `https://portless.app.localhost`          |
| Cloud        | `https://portless.app-cloud.localhost`    |
| App ingest   | `https://portless.app-ingest.localhost`   |
| Cloud ingest | `https://portless.cloud-ingest.localhost` |

The actual URLs are obtained with `portless get` and printed at startup. Development exposes authenticated OTLP/HTTP (`/v1/logs`, `/v1/traces`, `/v1/metrics`) through Portless and authenticated OTLP/gRPC on separate loopback listeners. The gRPC ports are assigned at startup and printed with the HTTP URLs; they remain stable for collector restarts within that run. Portless forwards HTTP/1 to backends, so gRPC clients use the printed direct addresses. Production collector configuration is unchanged.

Collectors start after database provisioning, with the application and ingest URLs already configured. Process Compose checks PostgreSQL's TCP listener and both ClickHouse schemas before starting the collectors, then waits for their public and GitHub listeners before starting App and Cloud. Collectors verify keys through the matching application's HTTPS URL when authenticated telemetry arrives. There is no endpoint handshake, Docker-to-host callback, or waiting application wrapper. Vite and the collectors bind to loopback.

Each checkout owns one PostgreSQL server and two ClickHouse servers, with Docker-assigned loopback ports:

| Application | PostgreSQL database | ClickHouse service | Read database | Landing database |
| ----------- | ------------------- | ------------------ | ------------- | ---------------- |
| App         | `everr_app`         | `clickhouse-app`   | `app`         | `otel`           |
| Cloud       | `everr_cloud`       | `clickhouse-cloud` | `app`         | `otel`           |

Both ClickHouse images use the table definitions and SQL query limits in `clickhouse/init/shared/`. Their access policies live in `clickhouse/init/self-hosted/` and `clickhouse/init/cloud/`. Separate servers and volumes let both products use the same database and user names. Self-hosted creates installation-wide readers and one SQL API user directly, with no tenant row policies or per-organization user-management grants. Cloud keeps its tenant policies and per-organization SQL users. Each application runs its PostgreSQL migrations and workers against its own database.

## Configuration and data

On first startup in an unconfigured worktree, the entry point copies `packages/app/.env` and `packages/cloud/.env` from the primary Git worktree before starting services or builds. If a package already has `.env` or an applicable local/mode override, that package is left untouched, including symlinks. Bootstrap copies only `.env`, with permissions `0600`, and prints filenames only. The copies are independent snapshots; later edits in the primary worktree do not propagate. Help and dry-run commands skip copying. If the primary worktree has no `.env` for a package, startup prints setup guidance and leaves the normal environment validation in place.

Applications and collectors load the resulting package settings. Cloud requires its Polar configuration and both `EMAIL_DSN` and `EMAIL_FROM` in every environment, including development. SMTP remains optional for the self-hosted App. GitHub ingress and Smee start by default using each package's existing `GITHUB_APP_*` and `SMEE_CHANNEL` settings. The PEM contents travel with `GITHUB_APP_PRIVATE_KEY`; no separate PEM file is copied. Both applications and collectors use Vite's default development dotenv lookup; credentials do not need to be exported again. Cloud builds use the default production mode and tests use the default test mode. Cloud composition is selected by its package configuration, independently of Vite mode. If you have legacy `.env.cloud` or `.env.cloud.local` settings, move them to the package's `.env` or `.env.local`.

Mailpit remains optional:

```sh
pnpm dev -f process-compose.mail.yaml
```

Mailpit gets checkout-scoped, Docker-assigned SMTP and UI ports. The mail override points both applications at it. GitHub receivers start inside the same collectors as public ingestion. Application workers replay to private loopback listeners using automatically assigned ports; those internal endpoints need no Portless routes. See [Contributing](../CONTRIBUTING.md) for existing GitHub settings. Cloud uses one durable queue directory for both ingestion paths.

Process Compose declares fixed development settings, which override application dotenv values. The stack uses `dev` for database passwords and a fixed development-only auth/verification secret. Bootstrap copies existing configuration without generating credentials. Each ClickHouse container initializes its own schema and users on its first start. PostgreSQL's standard entrypoint runs `scripts/dev/init-postgres.sql` on fresh storage to create the application databases and roles. Switching from the earlier generated auth secret requires signing in again; locally stored encrypted integration settings may need to be recreated. The self-hosted App collector uses in-memory buffering without Cloud usage accounting. The Cloud collector retains usage accounting and durable queues under `.dev/cloud-queue/`. Process Compose writes its log to `.dev/process-compose.log`. Old App queue directories, separate GitHub queue directories, and Docker queue volumes are no longer used.

Instance identity comes from the canonical checkout path. Branch changes in the same checkout preserve data; distinct paths use distinct Docker projects and volumes. The entry script uses macOS `shlock` or Linux `flock` to prevent concurrent starts in one checkout.

The verification helper runs this same graph with its own `DEV_STATE_DIR`, `COMPOSE_PROJECT_NAME`, Portless service names and supervisor socket. It can coexist with the usual development stack without sharing databases, queues or routes. See the [verification skill](../.agents/skills/verify-everr/SKILL.md) for launch and cleanup.

## Implementation

- `process-compose.yaml` owns builds, dependencies, fixed development settings, readiness, process failure handling, and shutdown.
- `scripts/dev/compose.yaml` declares the database containers and volumes and builds each product's ClickHouse image. The standard ClickHouse entrypoint initializes each server directly. This file is used through `pnpm dev`; Process Compose owns readiness, so the dev containers do not declare Docker health checks. The separate deployment Compose file retains its health checks.
- `scripts/dev/collector-app.yaml` declares self-hosted public ingestion and GitHub replay with in-memory buffering.
- `scripts/dev/collector-cloud.yaml` shares Cloud usage accounting and durable queues across public ingestion and GitHub replay. Both preserve authentication, tenant isolation, and retention processors from `collector/config.example.yml`.
- `scripts/dev/collector.mjs` loads existing package dotenv settings and replaces itself with the native collector.
- `scripts/dev/bootstrap-env.mjs` initializes unconfigured packages from their `.env` files in the primary worktree.
- `scripts/dev/init-postgres.sql` creates the App and Cloud PostgreSQL databases and roles on fresh storage.
- `scripts/dev/start.sh` establishes the checkout environment and executes Process Compose with forwarded arguments.
- `scripts/dev/exec.sh` resolves the application's Docker ports, forwards its Portless origin and local certificate settings, and executes the command supplied by YAML.

Process Compose uses failure-only shutdown with SIGTERM accepted as an expected exit, avoiding an `exit_on_end` shutdown issue in version 1.122.0. A spontaneous successful process exit is not treated as failure. Shutdown stops applications and their workers before the collectors, then stops the databases. Portless allows its child processes up to ten seconds to terminate. App telemetry still buffered at exit is discarded; Cloud queues remain on disk.
