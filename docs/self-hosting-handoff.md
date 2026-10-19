# Self-hosting and cloud separation handoff

Updated 2026-10-19. Branch: `self-host`. Base checkpoint: `98e178d84`.
The latest architecture cleanup described here is uncommitted.

## Architecture and ownership

Keep the existing two packages. Self-hosted is the complete base application in
`packages/app`; `packages/cloud` composes its shared features and adds cloud
capabilities. A third shared package is not planned. Revisit extraction only for
independent versioning, another consumer, or coupling that directory-level
ownership cannot contain.

Type-only contracts live in `packages/app/src/composition`, publicly exported
through `@everr/app/composition`. Both applications select their adapters from
`src/app/composition`. Shared code cannot import self-hosted implementation
paths directly. `pnpm check:boundaries` checks package imports and rejects runtime
statements, values, or imports in the contract directory. Runtime and identity
composition imports are restricted to their owning startup/auth modules and tests.

Server composition has three cohesive interfaces. `ApplicationRuntime` owns
migrations and application workers. `ApplicationEntry` owns installation and
signup decisions plus the guarded organization-entry destination.
`ApplicationDeployment` supplies the public ingest endpoint. Identity owns account
preflight, persistence, request locking, and application lifecycle policy. These
interfaces preserve lazy authentication and worker startup.

Shared identity translates Better Auth membership endpoints into application
policy, including remove, role update, and voluntary leave. The shared module owns
all membership and deletion hooks; application organization hooks cover creation
only. Applications supply before/after membership policy and, where needed, lock
acquisition before provider membership reads. Session resolution for leave uses
the full auth flow so both cookie and bearer credentials enforce policy. Shared
invitation guards and the initial-owner exception remain in place.

Account deletion uses `auth.deleteAccount`, which resolves an uncached session and
checks provider session freshness before any deletion. It discovers organizations,
locks them through `provider.lockAccountDeletion`, and reads current ownership and
application policy while holding those locks through deletion. Callers do not coordinate preflight or locking.
Expected application denials use the public `IdentityPolicyError` contract;
provider and database failures propagate unchanged. Cloud translates billing
ownership and permission denials in its policy adapter.

Shared ownership and application-policy checks also run in the provider's
`user.deleteUser.beforeDelete`, before credentials or sessions are removed. The
installation no longer duplicates this ownership guard. Shared creation and
deletion hold `provider.lockUserLifecycle` through their writes. Creation rechecks
the creator after locking; deletion locks before discovering memberships. Cloud
uses a per-user lock and the installation reuses its workspace lock. Server-side
`auth.api.createOrganization` scopes the full operation, including its hooks.

Cloud owns the organization-creation cookie and its continuation implementation.
The shared root route no longer reads that cookie or exposes a creation marker.
After verifying membership, organization access asks the entry adapter for a
redirect or permission to continue. Shared organization routing applies the
returned destination and preserves `returnTo`. Cloud setup and recovery routes
remain accessible without applying that dashboard-entry redirect. The old shared
continuation-helper export is removed.

Keep ordinary props and children for additions, page composition for different
loading or rendering, and explicit route registration for new flows. Shared
routes retain authentication and admin guards independently of UI composition.
The sign-in footer and device-recovery slots remain small. Feature exports such
as members and account settings hide reusable behavior; preserve database and
migration exports needed for real transactional extensions. Do not add a generic
component registry or rename helpers into barrels without hiding coordination.

Shared authentication is constructed through `@everr/app/identity/module` with
explicit database, authentication, email, and invitation-eligibility dependencies.
`identity/server` is its production composition entry. Installation identity and
both applications' request-lock scopes have explicit constructors. Database and
dedicated lock pools are constructed from explicit configuration. Constructor
imports cannot load environment or production instances, enforced by import rules.

Shared membership changes belong to `@everr/app/identity/memberships`.
Cloud downgrade calls `restrictOrganizationToOwner` within its existing transaction
and retains ownership of billing coordination, eligibility, and plan persistence.
The shared operation validates the retained Owner and owns member removal and
pending-invitation cancellation.

The [app README](../packages/app/README.md) is the ownership and extension guide.
Client destinations and dashboard additions remain application-owned, with static
route typing, literal dashboard IDs, and lightweight manifests separate from
loaded dashboard documents.

## Product constraints

- App is complete on its own and does not depend on cloud. Cloud owns billing,
  usage metering, tenant provisioning, commercial policy, and Polar dependencies.
- Self-hosted has one workspace. Initial setup creates its owner; later users
  join by invitation. Public signup and workspace switching are unavailable.
  SMTP is optional, with copyable invitation links and operator recovery.
- GitHub is available to both applications. App retention defaults to 30 days;
  cloud supplies plan-based policy and requires SMTP.
- Preserve behavior tests; do not add tests asserting absent cloud features or
  YAML text content. Do not generate migrations while iterating on schemas.
- Use disposable databases for exercises. Existing developer and production
  databases are not disposable. Leave changes uncommitted unless requested.

Read [AGENTS.md](../AGENTS.md) before editing. For installation and recovery,
read [deploy/README.md](../deploy/README.md). For billing behavior, read
[cloud billing](../packages/cloud/docs/billing.md). For migration changes or
upgrade exercises, read [DATABASE-MIGRATIONS.md](../DATABASE-MIGRATIONS.md).

## Current composition

App resolves private source through `#app/*` with explicit file extensions.
Cloud imports declared `@everr/app` exports. Each application's `tsconfig.json`
selects a complete set of named `@composition/*` modules; Vite and Vitest consume
those mappings. Type-only contracts in `src/composition` are exported from `@everr/app/composition`.
Selected modules and registered routes must belong to the composing package.
There are no generated compiler configs. Restart development after mapping changes.

`packages/app/vite.app.ts` registers routes at `welcome`, `signedIn`, and
`organizationDashboard` through TanStack virtual routes. Shared routes retain
file-based discovery; explicitly registered layouts use the `-` ignore prefix.
Both generated route trees are tracked. Regenerate them through development or
a build after route changes. Preserve the explicit
`ReturnType<typeof requireSession>` guard wrappers that avoid circular inference.

`ApplicationPages` composes member loading/rendering and account lifecycle UI.
`ApplicationLayouts` assembles user menus and welcome layouts with React nodes.
Shared modules retain admin visibility and signed-in action visibility. Server
policy remains independent of UI selection. Removing a slot can break behavior
even if types compile.

Import enforcement uses `pnpm check:boundaries`. It covers declared exports, private aliases,
cross-package relative imports, re-exports, literal dynamic/type imports, and
mocks. Generated route trees and `.md?raw` assets have deliberate exceptions;
computed nonliteral imports are outside the checked contract.

## Test ownership and retained interfaces

App owns ordinary shared tests. Cloud runs its scenarios and the shared alerting
integration suites using Vitest-provided migrations and schema targets. Keep the
cloud tenant-column assertion in cloud. Shared worker tests own task registration,
event logging, and supervision; cloud tests the composed runtime and its reserved
pool, shutdown, isolation, and recovery.

The export/test cleanup is complete enough to stop pruning by count. Retain
interfaces with useful consumers, including these deliberate exceptions:

- The pure invitation resolver lets routing tests exercise real resolution
  without loading server-only database/auth dependencies. A partial mock of the
  server-function module failed browser-test collection; do not repeat that
  approach without redesigning the invitation interface.
- Shared testing configuration, route helpers, storage fixtures, and the PGlite
  helper support real integration behavior. Rename or consolidate only if the
  resulting interface also simplifies migration/worker setup.
- Consent and telemetry configuration exports support real provider behavior and
  receiver configuration checks. Avoid replacing that coverage with extra mocks.
- Database/schema/migration exports support schema extensions, transactions, and
  upgrades. Preserve those capabilities rather than duplicating baselines.

Membership enforcement is covered through production auth hooks and Better Auth
endpoints, including invitation creation/acceptance, direct addition, denial,
and initial-owner creation. Preserve those tests when changing identity assembly.

## Database and collector constraints

App applies `packages/app/drizzle`, tracked in `drizzle.__drizzle_migrations`.
Cloud first upgrades legacy databases when needed, then applies shared migrations
and `packages/cloud/src/drizzle` under the startup lock. Cloud additions use
`drizzle.__everr_cloud_migrations`. Billing fields belong to cloud-owned tables.

Legacy adoption preserves history and pinned baseline markers without marking
later migrations applied. Keep `src/drizzle-legacy` until supported databases
have transitioned and an intermediate upgrade path is documented. Returning to
app leaves cloud tables intact; a multi-workspace database still cannot run as a
single-workspace installation. The migration document owns detailed procedures.

Collector separation uses complete `manifest.self-hosted.yaml` and
`manifest.cloud.yaml` files and explicit build targets. The Go manifest generator
is removed. Usage components remain in their original connector, extension, and
processor directories with unchanged module identities. Keep shared component
versions aligned across manifests. Replacement paths are relative to generated
module directories under `collector/build/`, including debug builds.

## Deferred independent distribution

Keep both applications in this repository for now. Independent distribution and
a physical repository split are not the next cleanup task. The 2026-10-18 scratch
tarball experiment established dependency installation, but not a working
standalone application. Retain these findings for when that work resumes:

- Packaging needs a version/content strategy. Prepared copies installed only
  after scratch manifest changes and with lifecycle scripts disabled.
- Installed TypeScript build/test entry points failed Node's loader. The alternate
  build loader progressed but exposed missing tooling dependencies. Typechecking
  also failed on dependencies and inclusion of shared test source.
- An isolated route-generation probe passed, but generated imports contained
  installation-specific pnpm paths. This was not a production build pass.
- Migrations/public assets were present; email static symlinks and repository-root
  resources were not. CSS scanning also assumes sibling directories.

Before claiming portability, resolve exported tooling/dependencies, package-owned
assets, typecheck inputs, and route generation. Then verify fresh-tarball builds,
tests, styling, and migrations. Old `/tmp` artifacts are disposable evidence,
not a supported harness or a prerequisite for resuming the work.

## Architecture cleanup verification (2026-10-19)

Both application typechecks and package-import plus contract checks pass. Three
real-Oxlint regression cases also verify lifecycle import restrictions. Full
suites with two workers passed 2,157 self-hosted tests and 473 cloud tests; the
Polar sandbox test remains skipped. Focused membership checks verify policy
denials preserve storage and successful changes invoke reconciliation, including
bearer-authenticated leave. The cloud cookie tests cover session/organization
binding, tampering, expiry, and setup destinations.

Both production builds pass. Cloud prerendering requires SMTP configuration;
its build used a local `smtp://localhost:1025` placeholder because this checkout
has no SMTP DSN configured. This does not verify live email delivery or a running
cloud deployment. The first unrestricted parallel suite runs timed out under
resource contention; the final runs used two workers. Incomplete older test
mocks were repaired without weakening their behavior assertions.

Manual self-hosted browser checks used the main worktree test account at
`http://localhost:5174`: sign-in, home, members, account settings, and repeated
account/home navigation. One initial account navigation redirected to sign-in;
a fresh session and repeated navigation passed. No account or membership changes
were made. Local Everr telemetry contained fresh `everr-dev-app` traces during
these checks. Remote status remains unavailable because the CLI has no active
session. Local verification servers and sessions are cleaned up after testing.

The navigation follow-up uses TanStack `createLink` for rail rows, literal
route patterns with params in the command palette, and authored Link elements
for breadcrumbs. Persistent compile-only checks in both applications reject
unknown routes, missing or invalid params, invalid search, and routes belonging
only to the other application. A real-router breadcrumb test verifies encoded
dynamic parent URLs from a splat leaf. Built-in YAML loading now validates its
catalog envelope and dashboard spec instead of asserting the parsed type.
The identity plugin contribution is optional, removing the empty self-hosted
implementation, and Cloud no longer needs a direct YAML dependency.

Both typechecks, production builds, full suites, import and contract checks, and
dead-code checks passed again after these changes. Manual checks against the
built self-hosted app passed sign-in, dashboard and runbook rails, breadcrumbs,
and command-palette navigation to a built-in dashboard, followed by logout.
Dashboard data queries failed in this local environment, so this verifies
navigation and document rendering rather than data retrieval. Development
browser verification hit reload and password-manager interference; the built
app completed the navigation checks. No changes have been committed.

## Historical verification status and release work

Storage composition: `@composition/storage` selects each application's `app/storage.ts`.
The type-only `ApplicationStorage` contract groups query settings/credentials,
readiness, and telemetry tenant identity. Shared SQL, ingestion verification,
collector forwarding, and row writing consume it directly. The former
`app/clickhouse.ts` helpers and server forwarding are removed. Client readiness
redirects remain in navigation. Self-hosted navigation no-ops and the ingest
endpoint live directly in their composition objects, without helper modules.
All 132 focused app checks and 27 cloud tests
(including alert-history integration), both typechecks, import boundaries, and
dead-code checks pass. Live self-hosted ingestion through the local collector
returned 200, and the authenticated Everr SQL endpoint found the probe exactly
once. The approved temporary ingest-only key was revoked and the session signed
out. The configured ingest key returned 401 for this installation; its configuration
was left unchanged. Cloud ingestion was exercised by integration tests, not a
running cloud deployment.

Identity composition: 20 focused app tests (including composition registration,
invitation/signup, membership locking, and auth endpoints), nine cloud auth and
membership-policy tests, both typechecks, import boundaries, and dead-code checks
passed. Live self-hosted HTTP sign-in, active-organization session resolution,
and sign-out passed. Cloud behavior was verified through its integration tests.

Worker lifecycle: `startAppWorkers` now returns its shutdown handle; the separate
stop hook is removed. Shared runtime owns one idempotent shutdown operation,
registered before startup completes. It drains both groups on shutdown and rolls
back partial startup, preserving startup and cleanup failures. Runner retry and
hot-reload supervision remain in `managedWorker`. All 22 worker/lifecycle tests,
both application typechecks, import boundaries, and dead-code checks pass. The
local browser still reaches sign-in; cloud shutdown was covered through the
contract and lifecycle tests, not a live cloud process.

SQL access: `createOrganizationSql` binds the organization after checking storage
readiness. CLI, MCP, dashboard middleware, and the alert worker use this boundary;
application-owned queries retain separate credentials. The apply auth boundary
now provides the same access through the registry to alert validation, which
receives only `queryWithMeta`. Permissions, readiness ordering, error responses,
and the validation cache shared by dry-run and write passes are preserved.
The worker still records failure history and reschedules when storage is pending.
Both typechecks, 91 focused apply tests, import boundaries, and dead-code checks
passed. The prior worker change also passed 18 cloud integration tests. Startup verification now reaches the sign-in page. The local database retained
the earlier `__everr_core_migrations` ledger; its baseline hash matched the current
SQL exactly. Recording that baseline with its current journal timestamp in
`__drizzle_migrations` and restarting Vite resolved the duplicate-type failure
without changing schema or application data.

The import boundary now rejects direct low-level SQL API imports, whole-module
runtime imports, and runtime re-exports from `lib/clickhouse.ts`. The organization
SQL factory, cloud credential provisioning, and tests are exempt; existing package
boundaries still apply to those exemptions. Types and application-owned query
imports remain allowed. The import regression test and app/cloud boundary scan pass.

Live self-hosted checks after repair: sign-in, session resolution, and organization
listing returned 200. Authenticated dashboard RPCs returned an empty dashboard
list, panel rows for `SELECT 1 AS value`, and the expected variable option.
CLI SQL returned 200 for valid SQL and 400 for an unknown column. Apply dry runs
returned a successful alert plan for valid SQL and a file-specific 400 for invalid
SQL. Cookie-only apply returned 401 as expected because apply requires a bearer
credential. Browser navigation to `/setup` redirected through `/` to sign-in.
No alert rules or dashboards were created. These were live HTTP checks except
for browser routing; signed-in visual rendering, a real worker evaluation,
MCP OAuth and cloud runtime remain unverified. Self-hosted end-to-end ingestion
subsequently passed as recorded above. The local
collector is running, but the freshness check showed CLI traces only.

Entry routing follow-up: `getEntryRedirect(pathname)` replaces
`getAppEntry`. Self-hosted composition owns installation redirects; cloud retains
its `/setup` redirect to `/`. Shared root context no longer carries installation
state. Both `to` and `href` use the selected application's generated route types,
filtered with TanStack's `ResolveParams` to exclude parameterized destinations.
Navigation semantics remain unchanged. Temporary type probes reject unknown
paths, dynamic routes, external URLs, and use of `/setup` in cloud. Both typechecks,
13 focused tests, import enforcement, and dead-code checks passed. Live self-hosted `/setup` redirect verification passed after the ledger repair.

Telemetry tenancy follow-up: one `telemetryTenantId` mapping replaces
row-decoration, ingestion-response, and forwarding-header hooks. The shared writer
requires organization context through its row type and owns stored tenant columns.
It adds no runtime rejection for missing context. Best-effort history logs failures,
while strict lifecycle projection retries. Query access policies remain separate.
Both typechecks, 62 focused app tests, 28 cloud tests, import enforcement and
dead-code checks passed. Browser startup and live self-hosted ingestion now pass; live cloud ingestion
remains unverified.

Identity factory follow-up: both typechecks passed, including temporary negative
probes for the four reserved organization hooks. All 23 focused app tests and
37 focused cloud tests passed. New HTTP endpoint coverage verifies lock lifetime
through successful member removal and last-owner denial. Import enforcement and
dead-code checks passed. Live HTTP sign-in passed after the ledger repair. The CLI still has no active
session for remote status. Identity changes are committed at `b22391b4a`.

Dashboard typing follow-up: seven focused app tests and the actual catalog/home
check under cloud composition passed. Both typechecks include temporary negative
probes for unknown and undeclared home dashboard IDs; the probes are removed
after verification. Import enforcement passed. YAML and panel queries are
unchanged. Live panel and variable-option RPC checks passed after the ledger repair;
signed-in visual rendering remains unverified.

Composition cleanup (2026-10-19): both application typechecks, 30 focused app
tests, 28 focused cloud tests, and import enforcement plus its regression test
passed. Manual verification was attempted at `http://localhost:5173`, but startup
failed during the migration creating `public.alert_delivery_state`, before page
rendering. That blocker was subsequently repaired as recorded above. The branch-status command failed
with no active CLI session, so remote status remains unverified. Production
builds and full suites were not rerun for this cleanup.

These are historical results from the preceding handoff, not fresh verification
of the current HEAD. The latest recorded full cloud run passed 459 tests with
Polar sandbox skipped. The last recorded full app run passed 2,110 tests before
subsequent focused cleanups. Later checks included focused tests and both app
typechecks. Earlier UI work passed both builds and signed-in browser checks;
those results do not establish a fresh full pass after later changes.

Collector self-hosted, cloud, and self-hosted debug builds passed after manifest
simplification. Normal binaries validated configuration and retained expected
component inventories. Those checks did not include a fresh live-ingestion run.
Standalone builds/tests remain unproven. Remote checks and Polar sandbox status
must be established separately; the latest cleanup did not run the sandbox.

Before release:

1. Exercise a fresh Compose lifecycle with real ingestion/querying, invitation
   acceptance without SMTP, and operator recovery. Use the telemetry skill to
   verify ingestion.
2. Run relevant fresh suites/builds and inspect the pushed revision's remote
   checks with the CI skill. Rehearse cloud upgrades on a representative disposable
   database copy and coordinate old-instance replacement around column removal.

Run production builds sequentially because they share inputs; run heavy app/cloud
suites sequentially to avoid resource-contention timeouts. Prior local tests
required `NODE_OPTIONS=--no-experimental-webstorage`. Local cloud builds used
`EMAIL_DSN=smtp://localhost:1025` and `EMAIL_FROM=review@example.com`.

Manual app checks use `.auth` in the main worktree at
`/Users/gio/workspace/everr-labs/everr`; never copy credentials into documentation.
Recheck running services and ports rather than relying on previous session state.
