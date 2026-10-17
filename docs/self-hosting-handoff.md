# Self-hosting and Cloud separation handoff

Updated 2026-10-17. Branch: `self-host`. The initial package extraction is in `fb528ab02` (`Extract cloud application and preserve shared migration history`). This handoff accompanies the subsequent adapter simplification and routing fix. Local verification passes; the remaining product-boundary review and release checks are listed below.

## Start here

1. Read `AGENTS.md` and inspect `git status`. Preserve the existing uncommitted work.
2. Read `packages/app/README.md` and `deploy/README.md` for operation, and `DATABASE-MIGRATIONS.md` for database ownership, local switching, and upgrade verification.
3. Read the verification status below before continuing the current refactor.
4. Finalize the existing split before broadening the architecture. The UI direction below remains a proposal. The subsequent building-block and Backstage-style platform discussion was exploratory, not an implementation request.

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
- Leave changes uncommitted unless requested. The user authorized committing the current checkpoint.

## Current architecture

Cloud has already moved out of the app source tree into `packages/cloud`. Both packages have their own configuration and cloud-specific routes live in the cloud package. Shared routes and internals are still reused through the existing build composition; the desired independent UI composition described below is not yet in place.

The adapter refactor replaces the `@app/*` filename convention with explicitly selected `@composition/server`, `client`, `product`, `navigation`, `dashboards`, `ui`, and `routes` modules. Selection is configured in `packages/app/vite.app.ts`, `packages/cloud/composition.ts`, and the TypeScript configs. Implementations need not have matching filenames. Build entry paths and aliases still exist; this is not yet a fully package-API-based boundary.

Relevant contracts live in `packages/app/src/product`. The app server implementation is `src/app/composition/server.ts`; cloud's is `packages/cloud/src/runtime.ts`. Several forwarding files and no-op modules were removed. Server implementations load identity dependencies lazily to avoid initializing authentication infrastructure for unrelated operations.

Cloud billing, checkout, organization checkout, and suspended-page implementations now live directly in their route files. The remaining cloud members-unavailable component lives in `packages/cloud/src/components`. Its unused self-hosted counterpart was deleted.

### UI customization that still needs reconsideration

`packages/app/src/app/composition/ui.ts` and the UI context/provider were removed, but customization remains:

- `NavUser` receives an optional `ProductUI` object containing workspace and organization menu components.
- The welcome layout renders optional `WelcomeActions`.
- The members route renders optional `MembersUnavailable` when invitations are disabled.
- `ProductClient` controls public signup, workspace deletion, device-login instructions, the home dashboard, and other client configuration.

These contracts are typed, but self-hosted still carries behavior whose consumer is cloud. Removing a prop or stopping rendering an optional slot can break cloud. Type checking catches some API changes, but cannot guarantee that a slot continues to render or behave correctly.

## Proposed UI direction

Treat self-hosted and cloud as two applications consuming shared feature components, rather than treating the self-hosted application itself as a customizable library.

Each application owns its route files, loading, access decisions, navigation, and layout composition. Share substantial reusable features such as a profile form, members table, dashboard view, and user-menu presentation. Shared feature components receive data and callbacks rather than depending on specific route IDs or parent route context.

For example, a shared `UserMenu` can own its trigger, popup, accessibility, and presentation while accepting ordinary children. Self-hosted assembles account and logout actions. Cloud assembles workspace switching, billing, account, and logout actions. The shared menu knows nothing about Cloud or `ProductUI`.

For members management, the self-hosted route loads members and renders the shared feature. Cloud's route checks entitlement and chooses between that feature and a cloud-owned upgrade screen. Server-side authorization remains responsible for enforcing restrictions.

This does not eliminate contracts. Shared component props remain a public API and require compatibility management. The intended improvement is that those APIs describe reusable behavior used by both applications, rather than special accommodations embedded in self-hosted. After a repository split, versioned package dependencies allow cloud to adopt breaking changes deliberately.

Tradeoffs and guardrails:

- Accept a small amount of duplicated route and layout assembly. Keep substantial feature behavior shared to avoid divergent implementations.
- Do not replace UI slots with imports into private self-hosted components, filenames, or route internals.
- Do not introduce a plugin registry or move the entire source tree for this change.
- Evaluate generic settings separately. A configurable home dashboard can remain useful without representing an edition.
- Start with the user menu and members page. Inspect the resulting boundary before applying it to welcome, signup, account deletion, and device login.

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

## Remaining work

1. Finish reviewing and validating the current split. Keep the scope on the existing implementation; a platform redesign is deferred.
2. Revisit the proposed UI boundary with the user after finalizing the current work. A user-menu and members-page prototype was suggested, but has not been implemented.
3. Revisit the remaining `ProductUI` and `ProductClient` UI accommodations. Move cloud-specific composition and access screens into cloud-owned routes/components where appropriate. Keep ordinary reusable settings only when justified.
4. Verify that shared UI exports and adapters have explicit contracts and do not require matching internal file layouts. The current build aliases and shared-route consumption still need scrutiny before claiming independent packages.
5. Run both typechecks to completion, relevant behavior tests, production builds sequentially, formatting, `fallow check`, and `git diff --check` after the final edits. Manually verify affected UI with credentials from the main worktree's `.auth`, when available.
6. Before release, exercise a complete fresh Compose lifecycle: setup, real ingestion/querying, invitation acceptance without SMTP, and operator recovery. Verify CI using the required skill. Before a deployed cloud upgrade, rehearse against a representative disposable copy and coordinate replacement of old instances around column removal.

Both typechecks and Fallow pass after the routing fix. Full suites pass: self-hosted has 1,894 passing tests and two skipped; cloud has 2,333 passing tests and one skipped. An initial concurrent app/cloud test and build run caused self-hosted timeouts; running the app suite alone passed without test changes or increased timeouts. Both production builds pass, including their prerendered shells. Browser checks against a disposable PostgreSQL database verified self-hosted setup redirection and cloud sign-in redirection from protected routes. These were anonymous-route smoke checks, not a complete signed-in product walkthrough. Remote CI could not be checked because `everr-dev ci status` reported no active session. Main-history database adoption was exercised locally, not against production.

For cloud build verification, supply required email configuration; a previous successful build used `EMAIL_DSN=smtp://localhost:1025 EMAIL_FROM=review@example.com`. Check prerender output as well as process exit. Run app and cloud builds sequentially because they share build inputs. Full cloud tests previously needed `NODE_OPTIONS=--no-experimental-webstorage` on the local Node version.

## Local state and deferred scope

Worktree: `/Users/gio/.herdr/worktrees/everr/self-host`. Main worktree: `/Users/gio/workspace/everr-labs/everr`. Manual-test credentials are in the main worktree's `.auth`; do not copy secrets into documentation or commits.

Temporary database containers and servers used for the latest adapter verification were stopped and removed. Recheck processes and environment files rather than relying on previous ports or session IDs. Existing developer databases are not disposable.

Physically splitting repositories, distribution and published images, release automation, and CLI profiles remain future work. Keep this pass focused on explicit boundaries, simpler UI ownership, and restoring verification. Do not add a new architectural layer merely to anticipate those later tasks.
