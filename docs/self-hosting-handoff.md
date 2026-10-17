# Self-hosting and Cloud separation handoff

Updated 2026-10-18. Branch: `self-host`. The initial package extraction is in `fb528ab02` (`Extract cloud application and preserve shared migration history`). This handoff accompanies the subsequent adapter simplification and routing fix. Local verification passes; the remaining release checks are listed below.

## Start here

1. Read `AGENTS.md` and inspect `git status`. Preserve the existing uncommitted work.
2. Read `packages/app/README.md` and `deploy/README.md` for operation, and `DATABASE-MIGRATIONS.md` for database ownership, local switching, and upgrade verification.
3. Read the verification status below before continuing the current refactor.
4. Review the composition implementation and the simplification priorities below. The broader building-block and Backstage-style platform discussion remains exploratory.

## Intent and constraints

Self-hosted is a complete application. Its implementation, UI, and tests should not mention Cloud, editions, or features that only exist in another product. Cloud should eventually be removable into a separate repository without changing self-hosted behavior.

- `packages/app` contains the application and shared functionality. `packages/cloud` owns billing, usage metering, tenant provisioning, and commercial policy, including Polar dependencies.
- Avoid implicit adapter contracts based on matching filenames or directory layouts. Explicit interfaces are useful, but replacing an implicit contract with layers of customization machinery is not sufficient.
- Minimize churn. Do not move the whole application into a new source subtree merely to establish package boundaries.
- Self-hosted has one workspace. The first user sets it up and becomes owner; subsequent users join by invitation. There is no public signup or workspace chooser.
- SMTP is optional for self-hosted. Copyable invitation links and operator-assisted password recovery support installations without email. Cloud requires SMTP.
- GitHub remains available to both applications. Self-hosted retention defaults to 30 days; Cloud has plan-based policy.
- Preserve useful behavior tests. Do not add tests whose only purpose is asserting that physically separate cloud source or dependencies are absent, or tests that inspect YAML text.
- Do not generate schema migrations unless explicitly requested. Use disposable databases for exercises, never an existing developer or production database without authorization.
- Leave changes uncommitted unless requested. The composition pass was committed on request as `acd415cd0`; the subsequent Oxlint replacement is included in this checkpoint.

## Current architecture

Cloud lives in `packages/cloud`; the default application and shared functionality
live in `packages/app`. There is no dependency from app to cloud.

`packages/app/vite.app.ts` defines the typed build composition.
`packages/cloud/composition.ts` registers
additional routes under `welcome`, `signedIn`, and `organizationDashboard`.
These are named attachment points, not matching source-directory conventions.
Route registrations use native TanStack virtual routes, preserving route
splitting, loaders, search validation, and inferred types. Six small shared
layout files have a `-` prefix to exclude them from physical discovery because
they are registered explicitly. The rest of the shared route tree stays in its
existing directories.

Each application's ordinary `tsconfig.json` declares its complete selection of
named `@composition/*` modules. Vite and Vitest read those mappings, including
`@/*`, using TypeScript's config parser. Named entries remain subject to package
ownership checks and implementations retain explicit interfaces. The generated
compiler configs and their writer have been removed. Builds, tests, and
typechecks no longer write compiler configuration. Restart development after
changing module mappings.

Cloud's `@/*` mapping resolves internal imports in shared source. Cloud source
itself uses public package exports. The mapping currently exposes the installed
package's source layout; tightening the public API remains separate follow-up
work. All named composition aliases have shared consumers even when they have
no direct cloud consumer.

Both applications now check in `src/routeTree.gen.ts`. TanStack Start owns
generation during development and builds, including its type-registration
footer. Typechecking and the cloud route integration tests consume the
checked-in files without generation. Most routing unit tests construct smaller
trees or mock the application tree.
The standalone generator and both preparation scripts have been removed.
After changing routes, run development or a build and commit the generated
changes with the source changes. Route-generation simplification was committed
as `86f56bfc5`. The compiler-configuration simplification is included in this checkpoint.
Both production builds, both TypeScript checks, nine composition tests, 37
focused cloud tests, Oxlint boundary checks and its 122 fixtures, and Fallow
passed for this batch. Both checked-in route trees remain unchanged.

Oxlint checks source-package boundaries through `pnpm check:boundaries`, the
pre-commit hook, and CI. Build configuration no longer scans source imports. Relative imports must stay in the owning package; shared internals
cannot be reached using its private `@/` alias. Cross-package code uses declared
package exports. Literal dynamic imports, type imports, re-exports, and test
mocks are checked. Route and adapter entry files must belong to the composing
package. Router tests use named shared module references rather than matching
shared filenames. Generated route trees and `.md?raw` documentation assets have
explicit exceptions. This prevents accidental coupling, not deliberate changes
to the enforcement itself. The public export surface is still broad and must
be treated as an API when packages are versioned separately.

### Public package interface

This checkpoint reduces app exports from 131 to 117 without moving
implementation files. `@everr/app/composition` explicitly re-exports adapter
types only; it does not load default implementations. Members, account-settings
dialog/actions, and page-layout have capability entry points. Runtime factories
and client defaults remain separate. Removed paths have no compatibility aliases;
cloud consumers and mocks use the new interface. Duplicate schema/environment
paths and unused dashboard/root-route exports have also been removed. Boundary
fixtures reject the former page-contract and member-component paths across all
ten checked import syntaxes (142 fixtures total).

Verification for this export pass: both typechecks and production builds,
52 focused cloud UI/routing/data tests, boundary lint and fixtures, and Fallow
passed. Browser checks confirmed both member pages and the cloud account
settings dialog; no deletion was submitted. Generated route trees did not
change. This pass and the preceding compiler-config simplification are included in
this checkpoint.

The public interface is still wider than desired. Many remaining exports serve
cloud tests of shared internals, especially alerting and route guards. Address
test ownership and reusable test harnesses before removing those exports. Merely
renaming them under a testing prefix would leave the coupling intact. Shared
runtime helpers also need selective capability interfaces; do not combine
browser and server dependencies into one runtime barrel.

### UI ownership

- `ApplicationPages.members` supplies loading and rendering inside the existing
  authentication, organization, provisioning, and admin guards. App renders the
  shared members feature. Cloud loads policy and chooses that feature or its
  upgrade screen. No invitation-entitlement fallback remains in the shared route.
- `ProductUI` declares typed menu and welcome-action contributions, sign-in
  footer, account-deletion component, and device-login recovery component.
  Default implementations contain ordinary installation behavior. Cloud owns
  workspace switching, billing links, signup links, organization-deletion
  choices, and CLI-specific instructions.
- `DeleteAccountDialog` owns confirmation, loading, and errors. Cloud composes
  its organization-deletion choices around that reusable behavior. Those tests
  live in cloud and are no longer conditional tests in the shared application.
- `ProductClient` retains ordinary configuration: home dashboard, additional
  manifest entries, entry destinations, and telemetry endpoint. It has no
  signup/deletion flags or CLI-specific JSX.

Server authorization continues to enforce policy independently of rendering.
The remaining contracts are explicit public interfaces. Removing a contribution
consumer is a behavioral API break even if the types still compile; tests cover
menu placement/admin visibility, page selection, welcome actions, and account
lifecycle behavior.

This completes the requested composition pass, not a platform/plugin system or
a physical repository split. This pass is committed as `acd415cd0` (`Make application composition and UI ownership explicit`).

## Remaining simplification work

The implementation improves ownership and makes contracts explicit, but still
has tooling debt. Passing verification establishes compatibility, not simplicity.
The following improvements are proposed, not implemented, in priority order:

1. Continue narrowing the shared package's public interface. The first pass
   consolidates adapter types and gives members, account settings, and layout
   stable entry points. Next address test-only exports through test ownership and
   shared harnesses, then group runtime helpers where a capability can hide
   meaningful implementation details. Preserve useful behavior coverage.
2. Keep UI assembly close to each application's entry points. Cloud should
   assemble its menus, account page, and welcome experience from shared
   components; the default application should assemble its ordinary experience.
   Reduce the responsibilities of `ProductUI`, which currently mixes contribution
   lists with component replacements and risks becoming a catchall. Keep
   substantial feature behavior shared and make these changes selectively to
   avoid another large reorganization.

Keep the explicit native route registrations. They make ownership visible and
preserve TanStack routing and code splitting without matching-file overrides.
Next, tighten the public API and make targeted UI assembly changes. Do not replace this work with a general plugin
framework or move the whole source tree.

### Oxlint package-boundary enforcement

The Oxlint implementation replaces the custom TypeScript scanner
and removes its calls from composition preparation. `.oxlintrc.json` enables only
`boundaries/dependencies` from `eslint-plugin-boundaries`. Every built-in rule
category is disabled. Biome's configuration and commands are unchanged.

The plugin classifies packages and checks resolved targets using
`eslint-import-resolver-typescript`. Declarative dependency-node selectors add
Vitest mocks and TypeScript import-type expressions to the plugin's built-in
static imports, re-exports, dynamic imports, and `require` support. Policies allow
same-package access, public workspace exports, external dependencies, and named
composition modules. They reject private aliases across packages, relative
cross-package access including missing targets, and unresolvable `@everr/*`
imports including unexported subpaths. Unlike the old scanner, an exported path
whose target is missing also fails, so workspace exports must be available.
Documentation `.md?raw` assets and generated route trees retain their exceptions.
Computed, nonliteral specifiers remain outside the checked contract.

Run `pnpm check:boundaries` for both applications and `pnpm test:boundaries` for
the regression fixtures. The pre-commit hook runs the check. The app workflow
runs both commands and watches both application packages and the configuration.
Builds and typechecks now focus on their own responsibilities rather than invoking
a second source parser. Composition entry ownership remains a build-time check.

The executable fixture test exercises all ten supported import/mock syntaxes
against forbidden relative paths, private aliases, unexported subpaths, absolute
paths, and composition subpaths. It also checks valid public exports, local
aliases, ordinary external imports, documentation assets, and unrelated lint
violations. Fixtures are removed in a `finally` block. Only the boundary rule
may report diagnostics. Run this test when upgrading Oxlint or the plugin.

Local verification passed for all 122 fixture cases, the full package scan,
both application typechecks, and Fallow. Existing application dependency
resolutions are preserved.
Remote CI has not yet been verified for this checkpoint. The local CLI reported
no active session during implementation; check the pushed revision before release.

References: [Oxlint integration](https://www.jsboundaries.dev/docs/guides/oxlint-integration/),
[dependency policies](https://www.jsboundaries.dev/docs/rules/dependencies/), and
[additional dependency nodes](https://www.jsboundaries.dev/docs/settings/#boundariesadditional-dependency-nodes).

## Database context to preserve

The shared application uses ordinary Drizzle naming, matching main: `packages/app/drizzle` and `drizzle.__drizzle_migrations`. Do not rename these to "core" or introduce a second application history for cloud.

| History | Directory | Tracking table |
| --- | --- | --- |
| Shared application | `packages/app/drizzle` | `drizzle.__drizzle_migrations` |
| Cloud additions | `packages/cloud/src/drizzle` | `drizzle.__everr_cloud_migrations` |
| Original upgrade history | `packages/cloud/src/drizzle-legacy` | Existing `drizzle.__drizzle_migrations` history |

Cloud first upgrades a legacy database when necessary, then runs shared migrations, then cloud migrations under the startup lock. The app runs shared migrations only. Billing fields were extracted from organization records into cloud-owned tables.

Legacy adoption preserves original history rows and records pinned baseline markers. It must not mark later migrations as applied. The shared baseline timestamp follows the legacy chain. Tracking tables record execution; they do not prevent SQL conflicts or isolate table ownership.

Local switching reuses one shared history. Cloud adds its tables; returning to self-hosted leaves those tables and data intact. An old mixed database must first run cloud's upgrade, and a multi-workspace database still does not satisfy self-hosted's single-workspace requirement.

`drizzle-legacy` is temporary upgrade support. Remove it only after supported databases have transitioned and a documented intermediate upgrade path exists for old installations and backups. See `DATABASE-MIGRATIONS.md` for details rather than duplicating the exercise history here.

## Routing regression resolved

The adapter refactor exposed circular TanStack route inference. Passing `requireSession` directly as `beforeLoad` made TypeScript resolve its `matches` parameter through the registered router. Resolving that router required the same authenticated route, creating `TS7022`/`TS7023` and cascading context/search errors.

The authenticated and signed-in welcome routes now call the guard through a wrapper with an explicit `ReturnType<typeof requireSession>`. This breaks inference through the callback body without changing runtime behavior or weakening route types. The ordinary app and cloud typechecks cover this regression; there are no casts or excluded source files to hide it.

Diagnostic router and guard annotations were removed. Client configurations use `satisfies ProductClient` to preserve literal route destinations, and cloud's original shared-source typecheck coverage was restored. A stale routing fixture now uses the actual `access` policy field, with a behavior test that suspended organizations are redirected before telemetry loads.

## Verification and next steps

Review the composition implementation before expanding its public
interface. The default and cloud applications have passed typechecking,
production builds, full test suites, and Fallow. A route-registration test moves
a registered source file and checks that its URL and authenticated parent stay
unchanged. Import tests cover forbidden relative, alias, export, type, dynamic,
and mock access. The previous generation implementation also exercised cloud typechecking
without its generated tree. The current workflow instead supplies both trees
in the checkout.

Previous composition verification, before replacing the import scanner: 1,912 app tests and 2,340 cloud tests passed; the external Polar sandbox test was skipped. The Oxlint verification above covers the subsequent tooling change.

Signed-in browser checks used a disposable PostgreSQL database and the local
`.auth` credentials. They verified ordinary member management in app, the Hobby
upgrade screen in cloud, both menus, and the different account-deletion dialogs.
No deletion was submitted. Setup, authentication redirects, and the different sign-in footers were also checked.
The compiler-configuration batch repeated signed-in member-page and menu checks
for both production builds using a disposable database. Both selected the
expected implementations.
These checks do not constitute a complete release rehearsal.

Before release, exercise a complete fresh Compose lifecycle: real ingestion and
querying, invitation acceptance without SMTP, and operator recovery. Verify CI
using the required skill. Before a deployed cloud upgrade, rehearse against a
representative disposable database copy and coordinate replacement of old
instances around column removal. Previous main-history adoption exercises were
local, not production.

Run production builds sequentially because both use shared build inputs. The
cloud build requires email configuration; local verification used
`EMAIL_DSN=smtp://localhost:1025 EMAIL_FROM=review@example.com`. The local Node
version requires `NODE_OPTIONS=--no-experimental-webstorage` for tests.

## Local state and deferred scope

Worktree: `/Users/gio/.herdr/worktrees/everr/self-host`. Main worktree: `/Users/gio/workspace/everr-labs/everr`. Manual-test credentials are in the main worktree's `.auth`; do not copy secrets into documentation or commits.

Temporary database containers and servers used for the latest adapter verification were stopped and removed. Recheck processes and environment files rather than relying on previous ports or session IDs. Existing developer databases are not disposable.

Physically splitting repositories, distribution and published images, release automation, and CLI profiles remain future work. Keep this pass focused on explicit boundaries, simpler UI ownership, and restoring verification. Do not add a new architectural layer merely to anticipate those later tasks.
