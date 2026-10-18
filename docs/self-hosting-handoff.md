# Self-hosting and Cloud separation handoff

Updated 2026-10-18. Branch: `self-host`.

## Current checkpoint

The worker test ownership and export cleanup checkpoint is `7e7f8fd1b`.
UI assembly and the preceding export review are in `770aa55de`. Storage test
ownership cleanup is in `dc21b7af3`; membership endpoint coverage and UI mock
cleanup are in `5ee82832a`. This checkpoint includes the test-pruning pass below. The
resolver investigation and deferred packaging experiment are recorded below.

The application has **53 public package exports**. All have consumers in cloud
source or configuration. Ten currently serve only cloud tests or their
configuration; that does not make them automatically removable. The interface
review below identifies concrete opportunities and the remaining split risks.

Read `AGENTS.md`, `packages/app/README.md`, `deploy/README.md`, and
`DATABASE-MIGRATIONS.md` before changing behavior. Check `git status` and preserve
existing work. The broader building-block/platform discussion remains exploratory.

## Intent and constraints

Self-hosted is a complete application. Its implementation, UI, and tests should
not mention Cloud, editions, or features that only exist in another product.
Cloud should eventually move into a separate repository without changing
self-hosted behavior.

- App owns the application and shared functionality. Cloud owns billing, usage
  metering, tenant provisioning, commercial policy, and Polar dependencies.
- Use explicit interfaces, not matching filenames or directory layouts. Do not
  introduce a plugin framework or relocate the whole source tree.
- Self-hosted has one workspace: the first user creates it and becomes owner;
  subsequent users join by invitation. There is no public signup or workspace
  chooser. SMTP is optional, with copyable invitation links and operator recovery.
- GitHub is available to both applications. App retention defaults to 30 days;
  cloud supplies plan-based policy and requires SMTP.
- Preserve behavior tests. Do not test that physically separate cloud features
  are absent, and do not add YAML text-content tests.
- Do not generate migrations unless explicitly requested. Use disposable
  databases for exercises. Existing developer and production databases are not
  disposable.
- Leave further changes uncommitted unless requested.

## Architecture that is already in place

`packages/app` does not depend on `packages/cloud`. App imports its own source
through package-private `#app/*` mappings with explicit extensions. Cloud uses
explicit public package exports; neither application has an `@/*` mapping.

Each application's `tsconfig.json` selects its complete set of named
`@composition/*` modules. Vite and Vitest read those mappings with TypeScript's
config parser. Implementations satisfy explicit public contracts exported as
types from `@everr/app/composition`. Build-time ownership checks require selected
modules and registered routes to belong to the composing package. There are no
generated compiler configs. Restart development after changing mappings.

`packages/app/vite.app.ts` defines build composition. Cloud registers additional
routes at the named `welcome`, `signedIn`, and `organizationDashboard` attachment
points using native TanStack virtual routes. Source filenames do not select
replacements. Shared routes retain their existing file-based layout; explicitly
registered shared layouts use the `-` ignore prefix.

Both `src/routeTree.gen.ts` files are tracked. TanStack Start generates them in
development and builds; tests and typechecks consume them without generation.
After route changes, run development or a build and commit the generated changes.
The authenticated and signed-in guards keep an explicit
`ReturnType<typeof requireSession>` wrapper to avoid circular route inference.
Do not replace this with casts or source exclusions.

### UI and policy ownership

- `ApplicationPages.members` supplies loading/rendering inside the existing
  guards. Cloud selects shared member management or its upgrade screen.
- `ApplicationPages.account` assembles shared `AccountSettings` behavior with
  the application's deletion section. `DeleteAccountDialog` owns confirmation,
  loading, and errors; cloud owns organization-deletion choices.
- `ApplicationLayouts` assembles `UserMenu` and `WelcomeLayout` through ordinary
  JSX. Cloud supplies workspace switching, billing, and setup-page switching.
  Shared behavior retains admin visibility and signed-in action visibility.
  Contribution IDs and placement registries are gone. The mascot is private.
- `ProductUI` retains only sign-in footer and device-login recovery content.
  Keep these small slots for now. Extracting complete forms just to eliminate
  them would add movement and interfaces without simplifying behavior.
- `ProductClient` supplies configuration, including entry destinations,
  additional dashboards, and telemetry endpoint. Server policy enforces access
  independently of UI selection.

Removing an action slot can be a behavioral interface break even when types
compile. Existing tests cover assembly, visibility, invitation returns, account
lifecycle, and organization switching.

### Tests and import enforcement

Ordinary app tests run in app. Cloud runs its own tests plus the shared alerting
integration suites selected by `@everr/app/testing/config`. The shared harness
accepts additional migrations and a schema target through Vitest provide/inject,
without cloud imports or branches. The tenant-column assertion belongs to cloud.

Cloud routing tests load the actual composed route tree. They preserve relevant
routes and replace unrelated page bodies through the shared testing interface.
Its opaque references are test infrastructure, not runtime override contracts.
The route inventory excludes ignored helpers and test files.

App owns worker task-registration tests (GitHub enabled and disabled), event
logging, and supervisor behavior. Cloud tests the composed runtime's reserved
pool, memoization, shutdown, failure isolation, and retry recovery. Cloud no
longer mocks the shared GitHub or preview task modules.

Oxlint runs only `boundaries/dependencies`; Biome retains formatting and general
linting. Run `pnpm check:boundaries` and, when changing enforcement,
`pnpm test:boundaries`. Checks cover public exports, private aliases, relative
cross-package access, static/dynamic/type imports, re-exports, and test mocks.
Generated route trees and `.md?raw` documentation assets have explicit exceptions.
Computed nonliteral imports are outside the checked contract. Build configuration
checks composition ownership but no longer scans source imports.

## Remaining export review

This is a review of current consumers, not a proposal to rename every file-based
entry point. No unused export was found. Export count alone is not the goal.

| Area | Evidence and next action |
| --- | --- |
| Invitation resolver, retain | Tried replacing the separate resolver import with a partial mock of `data/invite`. Importing the original module loads `db/client` and fails during browser-test collection on server-only environment access; the module also imports authentication middleware. Reverted the experiment. Keep the pure resolver export so the routing test exercises real invitation behavior without mocking additional server dependencies. Reconsider only alongside a useful invitation-interface redesign. |
| Storage test ownership, completed | App `src/lib/clickhouse.test.ts` owns shared client settings, SQL API metadata, writes, and telemetry wrapping. Cloud `src/clickhouse/provisioning.test.ts` retains tenant-scope enforcement, derived credentials, provisioning, authentication failure, and cancellation coverage through the real shared clients. Removed the `telemetry/clickhouse` public export and its cloud mock. Runtime code, SQL, and schema are unchanged. |
| Membership enforcement, completed | Replaced three helper-only tests with seven tests using the production auth configuration and its registered policy hooks against PGlite. They call Better Auth invitation creation, direct member addition, and invitation acceptance for hobby, suspended, and active pro states, verify persistence on success and denial, and preserve initial-owner creation. Billing/provisioning side effects and entitlement reads are isolated; the actual cloud policy and shared hooks run. Removed the `product/membership.server` export. |
| UI test interfaces, reviewed | Removed redundant `data/auth` mocks and the `telemetry/client` mock, then removed both exports. Onboarding renders the real consent gate and loads browser telemetry with development export disabled. Menu tests render the real consent gate and exercise opening privacy preferences, saving a choice, and revoking it. Keep `telemetry/consent-gate` for that provider and `telemetry/config` for receiver configuration coverage. Keep `data/invite` for invitation server-function doubles and its pure resolver export as explained above. |
| Deliberate test infrastructure | Keep `testing/config`, `testing/routes`, `testing/alerting-storage`, and the PGlite helper while their consumers need them. The PGlite helper currently has an alerting-internal export name despite serving organization lifecycle tests. A future generic database-test interface should preserve migration/worker setup; a naming change alone is not a reduction. |
| Worker capabilities | Events, job enqueueing, and supervision have production cloud callers. Runtime startup is consumed by the composed cloud test. Keep that test at the real runtime interface. Do not merge these unrelated functions into a barrel just to count fewer exports. |
| Auth and organization lifecycle | `lib/auth.server`, `lib/auth-client`, `lib/serverFn`, organization locks, continuation cookies, cleanup, and role helpers have real runtime consumers. Preserve browser/server separation and transactional ownership. Introduce a higher-level operation only when it can hide a complete workflow, not just forward to these helpers. |
| Storage and migrations | `db/client`, `db/schema`, `db/migrations`, Drizzle config, and migration entry points support real schema extensions, transactions, and upgrades. `migrations/journal` is consumed by legacy-upgrade tests. Do not conceal this dependency by duplicating schema or baselines. |
| Stable feature interfaces | Keep members, account settings/dialog/actions, user menu, welcome, page layout, and type-only composition contracts. Their callers assemble substantial shared behavior. Product factories and client defaults are intentionally separate from the type-only contracts. |

The ten exports currently used only by cloud tests/configuration are:
`data/invite`, `data/invite-resolver`,
`server/alerting/testing/pglite-database`, `server/worker/runtime`,
`telemetry/consent-gate`,
`telemetry/config`, `testing/config`, `testing/routes`, `testing/alerting-storage`,
and `migrations/journal`.

### Deferred: standalone packaging experiment, 2026-10-18

Decision: keep both applications in this repository for now. Independent package
distribution is future repository-split work, not a blocker or the next cleanup
task. Preserve the findings below for that future work.

Exercised a disposable cloud checkout at `/tmp/everr-standalone.Id9LNf/cloud`
using tarballs for app, UI, datemath, telemetry-explorer, and the three telemetry
SDK packages. No workspace source links were used: all 2,797 installed symlinks
resolved inside the standalone checkout, with none broken. Only tracked source
and freshly built SDK artifacts were copied; local credentials and environment
files were excluded. Repository implementation and manifests were unchanged.

The experiment needed scratch-only manifest preparation: missing versions were
set to `0.0.0-standalone`, internal dependencies became local tarball references,
and ordinary direct dependencies were pinned using the current lockfile.
Installation used `--ignore-scripts --no-frozen-lockfile`; this proves dependency
installation, not lifecycle scripts or exact transitive lockfile reproducibility.

| Check | Observed result |
| --- | --- |
| Pack unchanged app | Failed: `ERR_PNPM_PACKAGE_VERSION_NOT_FOUND`. App has no version. Cloud and telemetry-explorer also lack versions. A distribution/versioning strategy is required. |
| Pack prepared copies and install cloud | Passed for all seven tarballs and the standalone dependency install. |
| Normal production build | Failed loading exported `vite.config.ts`: Node rejects TypeScript stripping inside `node_modules`. |
| Selected composed UI/worker tests | Failed before collecting tests, for the same reason in exported `vitest.config.ts`. No standalone test pass is established. |
| Build with `--configLoader runner` | Passed the initial loader obstacle, then failed resolving `@tanstack/devtools-vite`, declared only in app's development dependencies. This confirms that changing loaders alone is insufficient. |
| Typecheck | Failed. Missing build/test dependencies and declarations include Nitro, smee-client, chdb, and Nodemailer types. Explicit inclusion of installed app source also brings app tests and dependency-resolution errors into cloud's compilation. Do not assume all errors represent undeclared runtime dependencies. |
| Isolated route generator probe | Passed after transpiling only the two composition helper modules to temporary JavaScript and invoking TanStack's installed generator directly. All 91 relative imports in the resulting tree resolve. This bypasses the failed build configuration, so it is not a successful production build. |
| Route portability | Generated imports contain the resolved pnpm store path under this installation. The tree is installation-specific; the checked-in workspace tree is not a portable package artifact. |
| Asset presence | App migrations and public assets are present. The email `src/emails/static` symlink is absent after packing. The repository-root schema Markdown used by the MCP description and ClickHouse test resources are absent. Migration execution was not exercised in this experiment. |

Additional source inspection found sibling-directory CSS scanning paths for UI
and telemetry-explorer. These need package-aware resolution; styling has not
been verified in the standalone environment.

When the repository split resumes:

1. Define versions and the package contents for the app and its internal
   dependencies. Include required assets explicitly, without copying secrets or
   relying on symlink preservation.
2. Make exported build/test entry points loadable from installed packages and
   declare their tooling dependencies or peer requirements. Consider a separate
   development package only if it simplifies that contract.
3. Correct the shared-source typecheck inputs and dependency resolution. Preserve
   intentional shared integration suites without including every app test.
4. Resolve external assets and CSS sources through package-owned resources.
5. Establish when the installation-specific route tree is regenerated, then
   repeat typechecking, production build, composed tests, asset verification,
   and migration execution from fresh tarballs.

Evidence is retained in `/tmp/standalone-{build-initial,build-runner,
tests-initial,typecheck-initial,routes}.log`, with preparation script
`/tmp/prepare-everr-standalone.cjs`. These are disposable local artifacts, not a
committed packaging harness. The physical repository split is not yet proven.

## Database context to preserve

The shared application uses the naming from main: `packages/app/drizzle` and
`drizzle.__drizzle_migrations`. Do not rename these to "core" or create a second
shared history for cloud.

| History | Directory | Tracking table |
| --- | --- | --- |
| Shared application | `packages/app/drizzle` | `drizzle.__drizzle_migrations` |
| Cloud additions | `packages/cloud/src/drizzle` | `drizzle.__everr_cloud_migrations` |
| Original upgrade history | `packages/cloud/src/drizzle-legacy` | Existing `drizzle.__drizzle_migrations` history |

Cloud upgrades legacy databases when necessary, then runs shared migrations,
then cloud migrations under the startup lock. App runs shared migrations only.
Billing fields now live in cloud-owned tables.

Legacy adoption preserves history rows and records pinned baseline markers;
it must not mark later migrations as applied. The shared baseline timestamp
follows the legacy chain. Tracking tables record execution, not SQL isolation.

Local switching reuses the shared history. Cloud adds tables; returning to app
leaves them intact. Old mixed databases must first run cloud's upgrade. A
multi-workspace database still does not satisfy the single-workspace requirement.
Remove `drizzle-legacy` only after supported databases transition and an
intermediate upgrade path is documented for old installations and backups.
See `DATABASE-MIGRATIONS.md` for the exercise history and upgrade procedure.

## Test-pruning pass

Removed 12 cases and 129 net lines from six test files, without runtime changes:

- Removed the self-hosted collaboration helper assertion. Real invitation
  creation and acceptance remain covered with SMTP enabled and disabled. Kept
  the separate organization creation/deletion restriction test.
- Removed mocked account-page forwarding tests. Actual deletion behavior remains
  covered by the account-deletion suite; the removed tests asserted synthetic
  markup supplied by their own mocks.
- Removed basic member-page selection cases. The retained refresh/isolation test
  renders both allowed and restricted states across organizations and revisits.
- Removed the setup-screen test for absent old controls and its unused auth mock.
  Pending/error UI, completion, revoked access, and retry behavior remain covered.
- Removed the hook-level fast-completion timer case. The real-router onboarding
  test already checks 2,499 ms versus 2,500 ms, navigation, and session refresh.
  Kept readiness loss, prolonged waiting, and immediate recovery cases. Removed
  unused query providers from those hook tests.
- Removed four duplicate unsafe-URL cases from the cloud setup route suite. The
  shared return-destination suite covers those inputs; cloud retains its extra
  setup/chooser loop cases and local destination preservation.
- Removed the runtime test that only compared a returned endpoint literal.
  Receiver selection and credential behavior remain tested separately.

Verification: 15 affected cloud tests and 11 app tests passed, including the
stronger tests retained in place of the removed cases. Both typechecks, boundary
lint, and Fallow passed. The last full cloud-suite result below predates these
deletions.

## Verification and next steps

Membership/UI cleanup verification: all 472 cloud tests passed, with the Polar
sandbox test skipped. Both typechecks and boundary lint passed. Seven endpoint
tests replace the three membership-helper tests, and the menu now exercises
real consent settings. No runtime implementation changed.

Storage cleanup verification: 12 app client/telemetry tests and eight cloud
storage/provisioning tests passed. Both typechecks and boundary lint passed.
This change moves test coverage and removes a test-only public export; it does
not change runtime behavior. No live ingestion or browser exercise was run.

Latest worker checkpoint: 14 focused app worker tests and all 472 cloud tests
passed, with the external Polar sandbox test skipped. Both typechecks, boundary
lint, and Fallow passed. Commit hooks passed for `7e7f8fd1b`.

The UI checkpoint passed both production builds, focused UI/routing tests, and
signed-in browser checks for member pages, account confirmation dialogs, menus,
welcome screens, and switching organizations. The last full app suite after the
shared alerting test move passed 2,110 tests; subsequent app changes used focused
checks, not a fresh full-app run. Generated route trees stayed unchanged through
the UI/export/worker cleanup. The standalone packaging experiment above adds failure evidence and a route
generation probe, not a passing standalone runtime check.

Polar sandbox is opt-in via `pnpm --filter @everr/app-cloud test:billing:sandbox`.
It loads cloud's `.env`, requires `POLAR_SERVER=sandbox`, and enables
`EVERR_POLAR_SANDBOX_TEST=1`. It makes real sandbox calls, creates customers and
checkout sessions, tests membership/token behavior, and deletes its customers.
It has not been run during the latest cleanup.

Next work, in order:

Membership endpoint coverage and the remaining UI test-interface review are
complete. Keep the remaining deliberate test interfaces; do not add mocks or
rename barrels solely to reduce the export count.

1. Before release, run a complete fresh Compose lifecycle with real ingestion and
   querying, invitation acceptance without SMTP, and operator recovery. Use the
   required telemetry skill to verify ingestion.
2. Verify the pushed revision's remote checks using the CI skill. Remote status
   is not established by these local results. Rehearse deployed cloud upgrades
   against a representative disposable database copy and coordinate old-instance
   replacement around column removal. Previous main-history exercises were local.

Run production builds sequentially because they share build inputs. Run heavy
app/cloud suites sequentially to avoid startup timeouts from resource contention.
Local cloud builds used `EMAIL_DSN=smtp://localhost:1025` and
`EMAIL_FROM=review@example.com`. Local tests need
`NODE_OPTIONS=--no-experimental-webstorage` with the current Node version.

Worktree: `/Users/gio/.herdr/worktrees/everr/self-host`. Main worktree:
`/Users/gio/workspace/everr-labs/everr`. Browser-test credentials are in the main
worktree's `.auth`; never copy secrets into documentation or commits. Temporary
servers and databases from the latest checks were stopped. Recheck local state
rather than relying on old ports. Physical repository extraction, published
packages/images, and release automation remain future work.
