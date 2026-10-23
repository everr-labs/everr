# Self-hosting and Cloud separation handoff

Updated 2026-10-20. Branch: `self-host`. PR: [#522](https://github.com/everr-labs/everr/pull/522).
PR review is ongoing. Both products use explicit plain-SQL ClickHouse
initialization files with separate databases and access policies.

## Development switching and worktrees

Cloud and self-hosted each initialize `otel` and `app` in their own ClickHouse
server. Table definitions and SQL query limits live in `clickhouse/init/shared`;
access setup lives in `clickhouse/init/cloud` and `clickhouse/init/self-hosted`.
Both retain tenant columns in their physical table layouts.
Cloud keeps tenant stamping, row policies, and per-organization SQL
credentials. Self-hosted creates installation-wide access directly, without
creating and then removing Cloud policies or user-management grants.

Each worktree runs App and Cloud together with separate PostgreSQL databases,
ClickHouse containers and volumes, and host collectors. Development builds each
product's ClickHouse image and supplies local credentials; the standard database
entrypoint applies its initialization files on fresh storage.
See the [worktree development guide](development.md) for ports and lifecycle.
The same ClickHouse images are used by development and self-hosted deployment.

The self-hosted development collector stamps the authenticated workspace ID.
Production self-hosted telemetry omits that stamp; its tenant columns default to
an empty value. Self-hosted reads do not filter by tenant in either environment.

Initialization runs only on fresh storage. This bundle targets fresh installations.

## Product boundaries

- `packages/app` is the complete single-workspace self-hosted application and owns
  shared features. `packages/cloud` composes it and owns billing, usage metering,
  tenant provisioning, commercial policy, and Polar integration. Keep these two
  packages; independent distribution and a third shared package are deferred.
- Self-hosted creates its owner during initial setup. Later users join by
  invitation; public signup and workspace switching are unavailable. SMTP is
  optional, with copyable invitation links and operator account recovery.
- GitHub is available to both applications. Self-hosted retention defaults to
  30 days; Cloud supplies plan-based policy and requires SMTP.
- `packages/local-app` is the separate browser UI for the CLI's local collector.
  It explores local logs, traces, and errors and manages collector status/restarts.
  It has no remote account, sign-in, sign-out, or profile controls.

Read [AGENTS.md](../AGENTS.md) before editing. Detailed ownership and extension
rules live in the [app README](../packages/app/README.md) and
[Cloud README](../packages/cloud/README.md). Installation and recovery procedures
live in the [deployment guide](../deploy/README.md); billing behavior lives in
[Cloud billing](../packages/cloud/docs/billing.md).

## Architecture to preserve

Type-only contracts live in `packages/app/src/composition`, exported through
`@everr/app/composition`. Each application supplies adapters in its own
`src/app/composition`. App uses private `#app/*` imports; Cloud uses declared
`@everr/app` exports. TypeScript mappings select `@composition/*` modules for
Vite and Vitest. Restart development after changing mappings.

Runtime owns migrations and worker lifecycle; entry owns installation/signup and
organization-entry decisions; deployment supplies the public ingest endpoint.
Storage owns query settings/credentials, readiness, and telemetry tenant identity.
`createOrganizationSql` checks readiness and binds SQL API access to an organization;
CLI, MCP, dashboards, alert workers, and apply validation use that boundary.
Application-owned queries retain separate credentials.

Identity owns shared membership/deletion guards, provider translation, and request
lock lifetimes. Application adapters supply policy and persistence integration.
Use `auth.deleteAccount` for deletion and the shared memberships interface for
membership changes. Preserve the creation/deletion lock coordination and initial
owner exception. Constructor imports must remain independent of environment
settings and production database instances.

Keep shared routes' authentication and admin guards independent of UI composition.
Applications register their additional routes explicitly. Both generated route
trees are tracked; regenerate after route changes. Extend shared UI with props,
children, or page composition. `pnpm run check` enforces exports, ownership,
contract purity, and restricted runtime/identity/SQL imports.

## Storage and deployment state

Postgres uses the app history in `packages/app/drizzle`, tracked in
`drizzle.__drizzle_migrations`. Cloud adds `packages/cloud/src/drizzle`, tracked
separately in `drizzle.__everr_cloud_migrations`. Existing pre-split databases first
complete Cloud's frozen `src/drizzle-legacy` history and adopt the new baselines.
Keep that upgrade path until supported installations have transitioned.

App and Cloud can reuse the shared Postgres history; returning to app retains
Cloud tables. The single-workspace restriction still applies. Production builds
stage executable SQL and journals under `.output/drizzle`, including Cloud and
legacy histories where needed, so ordinary Node startup and containers both work.
See [DATABASE-MIGRATIONS.md](../DATABASE-MIGRATIONS.md) for switching and upgrades.

The ClickHouse Dockerfile copies `clickhouse/init/shared` into the base stage.
The default `cloud` stage adds `clickhouse/init/cloud`; the `self-hosted` stage
adds `clickhouse/init/self-hosted`. There is no renderer, template expansion,
combined development bootstrap, access override, or Node build stage. Self-hosted
SQL access uses the fixed `sql_api` user with its read-only profile and quota,
without tenant filters. Both products use `app_ro`, `web_app_admin`, and
`collector_rw` against their own ClickHouse server.

Collectors use complete `manifest.cloud.yaml` and `manifest.self-hosted.yaml`
files and explicit build targets. Cloud usage components retain their module
identities. Keep shared component versions aligned across manifests.

`deploy/compose.yaml` builds the full self-hosted app, Postgres, ClickHouse, and
collector. It is separate from the CLI's lightweight local UI/collector runtime.
Cloud publishing builds `packages/cloud/Dockerfile` and pushes the existing
`rg.fr-par.scw.cloud/everr/app` image with SHA and `latest` tags after relevant
changes reach `main`; PR branch pushes do not publish it.

## CLI and local UI state

The CLI uses one saved session (`session.json`, or `session-dev.json` for debug
builds) containing only the API URL and token. `cloud login` accepts `--url`;
organization selection happens during browser approval. A successful login
replaces the previous session; failed logins preserve it. Existing session files
remain readable. Profiles and repository
`.everr/config.yaml` targeting have been removed; the CLI does not create or read
that directory. Existing local configuration files are left untouched.

`cloud status --json` fetches the current identity, installation URL, and
advertised ingestion endpoint from the server. The endpoint is not cached in the
session file; exporter configuration remains explicit.

Local commands and the local UI are independent of remote sessions. The local UI
backend exposes no remote account/auth commands and constructs no remote login
state. Loopback and request-origin guards remain.
See the [CLI README](../packages/cli/README.md) and
[local UI README](../packages/local-app/README.md) for commands and telemetry.

## Verification and remaining release work

Previous sessions passed both application typechecks and production builds,
full app/Cloud suites, import/contract enforcement, and dead-code checks. Later
focused checks covered identity, storage, worker lifecycle, and routing. These
results span several revisions; they are not a fresh full run of current HEAD.

The shared development stack passed fresh authenticated logs, traces, and metrics
ingestion, queried through the Everr CLI and checked in the logs UI. Disposable
ClickHouse checks confirmed unfiltered self-hosted dev reads, Cloud tenant
isolation, SQL restrictions, and repeatable access setup. Both app typechecks,
focused configuration tests, import boundaries, and Compose validation passed.
The original eight ClickHouse init files still match main byte for byte.

The latest fixes passed production migration staging checks, disposable fresh and
legacy database upgrade exercises, and CLI session regression tests. Local UI
cleanup passed 22 frontend tests, typecheck/build, relevant Rust suites, and six
asset-backed lifecycle tests, including real ingestion/querying and startup with
unusable remote settings. Browser verification confirmed collector-only settings
and local navigation. Pre-commit checks passed for the pushed commits.

Live self-hosted sign-in, SQL, apply validation, navigation, and ingestion were
verified in earlier sessions. Live Cloud ingestion, MCP OAuth, Polar sandbox, and
a complete fresh self-hosted deployment lifecycle remain unverified. Remote CI
status has not been established for the pushed revision; the last source CLI
attempt could not reach its configured local app. Use the CI skill to check it.

Before release, exercise fresh Compose setup with real ingestion/querying,
invitation acceptance without SMTP, and operator recovery. Rehearse Cloud upgrades
against a representative disposable database and coordinate replacement of old
instances around column removal. Preserve existing developer/production data.
Independent tarball distribution remains unproven and outside this cleanup.

Run heavy app/Cloud suites and production builds sequentially to avoid resource
contention. Prior local tests needed `NODE_OPTIONS=--no-experimental-webstorage`;
Cloud builds used local SMTP placeholders, which did not verify email delivery.
Manual app credentials are in `.auth` on the main worktree. Recheck services and
ports rather than relying on session history.
