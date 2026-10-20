# Self-hosting and Cloud separation handoff

Updated 2026-10-20. Branch: `self-host`. PR: [#522](https://github.com/everr-labs/everr/pull/522).
Implementation through `7d461fb95` is committed and pushed. PR review is ongoing.
This handoff update does not implement further runtime changes.

## Open problem: development switching and worktrees

Cloud and self-hosted currently require different physical ClickHouse schemas.
Cloud has tenant columns, tenant-prefixed sorting keys, row policies, and per-org
SQL credentials. Self-hosted omits tenant storage and uses one restricted SQL user.
The renderer selects the schema when building the ClickHouse image; changing the
application process or rebuilding against an existing data volume does not convert
that database to the other variant.

The root development Compose file currently provides separate ClickHouse and
collector services for self-hosted, with different ports and persistent storage
from Cloud. Switching applications requires matching the application configuration,
ClickHouse instance, and collector. This is awkward when developing both products,
particularly across worktrees.

The development workflow needs improvement while preserving product separation
and existing developer data. No approach has been agreed. Resolve the design
with the user before implementing a replacement.

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
children, or page composition. `pnpm check:boundaries` enforces exports, ownership,
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

ClickHouse uses shared templates in `clickhouse/schema` and target-specific
fragments/access scripts. `clickhouse/render.mjs` emits ordinary initialization
files during image build. The Dockerfile defaults to Cloud; deployment Compose
explicitly selects self-hosted. These initialize fresh storage and are not an
upgrade mechanism for existing databases.

Collectors use complete `manifest.cloud.yaml` and `manifest.self-hosted.yaml`
files and explicit build targets. Cloud usage components retain their module
identities. Keep shared component versions aligned across manifests.

`deploy/compose.yaml` builds the full self-hosted app, Postgres, ClickHouse, and
collector. It is separate from the CLI's lightweight local UI/collector runtime.
Cloud publishing builds `packages/cloud/Dockerfile` and pushes the existing
`rg.fr-par.scw.cloud/everr/app` image with SHA and `latest` tags after relevant
changes reach `main`; PR branch pushes do not publish it.

## CLI and local UI state

Remote CLI profiles select an installation, organization, and account. Repository
`.everr/config.yaml` records the URL and organization; credentials remain global.
Pending CLI changes remove legacy-session migration; users with old sessions
authenticate again.

The purpose of `.everr/config.yaml` is to pin remote commands run in a repository
to an installation and workspace, independently of each developer's profile names
and global default. Login creates it at the Git root only when project configuration
is absent. It contains `version`, `url`, and `organizationId`, with no credentials
or account identity, so it can be committed and shared. Lookup stays within the
nearest Git root, including worktrees. `--profile` and `EVERR_PROFILE` override it;
otherwise the CLI requires a matching saved profile rather than falling back to
another target. This directory does not select the local collector's organization
or configure application exporters.

Open design question: the user is still unsure whether this repository directory
and its automatic creation are useful. Its intended benefit is a shared remote
target, but it adds configuration and selection precedence alongside global
profiles. Revisit that tradeoff before treating the current design as settled;
no replacement approach has been agreed.

Local commands are independent of remote connection settings: they do not read
repository targets or profile credentials, ignore `EVERR_PROFILE`, and reject
explicit `--profile`. The local UI backend no longer exposes account/auth commands
or constructs remote login state. Loopback and request-origin guards remain.
See the [CLI README](../packages/cli/README.md) and
[local UI README](../packages/local-app/README.md) for commands and telemetry.

## Verification and remaining release work

Previous sessions passed both application typechecks and production builds,
full app/Cloud suites, import/contract enforcement, and dead-code checks. Later
focused checks covered identity, storage, worker lifecycle, and routing. These
results span several revisions; they are not a fresh full run of current HEAD.

The latest fixes passed production migration staging checks, disposable fresh and
legacy database upgrade exercises, and CLI profile regression tests. Local UI
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
