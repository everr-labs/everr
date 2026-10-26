# Cloud application

See [organization billing](docs/billing.md) for Polar identity, access, checkout
recovery, and verification.

# Cloud organization data access setup

The organization adapter atomically records provisioning intent alongside creation.
Deletion atomically records cleanup intent alongside the organization and
Postgres-resource deletion. A failed enqueue rolls the transaction back.
Organization creation enqueues `clickhouse/provision-organization` in Graphile
Worker. New organizations start with the server-owned `metadata.clickhouseReady`
flag set to false. The worker creates the SQL API user, grants its role, creates all
row policies, and authenticates a query before setting readiness to true.
Provisioning and deletion share a named queue per organization. Their dedicated
runner reserves two execution slots and its own Postgres pool, so alerting,
GitHub, and maintenance jobs cannot delay setup. Both retry up to 1,000 times,
with short initial delays and a 30-second cap. Jitter spreads retries out.
The worker reschedules failed lifecycle jobs through Graphile's public API
after their failure is persisted. Startup and the periodic scan bring forward
retries left with longer delays by an older deployment or an interrupted
reschedule.
Each runner has an independent supervisor that restarts startup and runtime
failures every five seconds. A retry-recovery failure is logged and does not
stop the other runners. Organization handlers and the scanner use their reserved
Postgres pool too.
SIGTERM and SIGINT drain all runners before flushing telemetry. ClickHouse
requests receive Graphile's shutdown abort signal after five seconds, allowing
normal shutdown to release job and queue locks. Hard kills can leave locks
behind. Inspect `graphile_worker.jobs`, confirm the owning workers are dead,
and use Graphile's `force_unlock_workers` only for those worker IDs. Never
unlock a live worker.
A scan every minute recovers organizations whose initial enqueue was
missed, without resetting pending jobs' attempt counts or retry schedules.

Email signup creates its automatic Hobby organization after the user and session
transaction commits, then selects it for that session. Users with pending
invitations keep their invitation flow instead of getting a personal organization.
After organization creation commits, signup waits up to five seconds for its
dedicated provisioning job to finish, checking readiness every 100ms. Healthy
signups return ready. The wait does not execute
ClickHouse statements itself, so provisioning and deletion remain serialized
by the per-organization queue. A timeout or failed status read leaves the
committed job running and returns the normal signup session. The deadline also
bounds a slow Postgres lookup, and an expired wait stops polling.

Authentication, invitations, and organization creation share the `_welcome`
layout. Its `_signedIn` guard requires a session, and its `_organization`
guard verifies membership for setup and recovery. The app's `_authenticated`
guard requires only a session, so account settings remain accessible without
an organization. Membership, subscription access, and provisioning have
separate pathless guards. Billing, checkout confirmation, and device approval
remain outside the data-page readiness guard.

Authentication resumes the validated original destination. Automatic Hobby
creation records a short-lived encrypted continuation cookie bound to the
session and organization. The organization guard sends that creation through
setup even if provisioning is already complete, then setup clears the cookie.
Invited users return to their invitation and join the existing organization.
Explicit creation uses the inline name and plan step, followed by provisioning;
Pro creation continues through hosted checkout and setup.

Only organization creation has the minimum 2.5-second animation. Existing
pending organizations see `/organization-pending`, which polls every three
seconds and resumes their destination immediately when ready. The minimum
creation duration never bypasses the real readiness check. Organization
authorization loads readiness once per request; data handlers reject pending
setup before contacting ClickHouse. The query helpers do not read Postgres.
CLI SQL returns HTTP 503 and `Retry-After: 5`.

Provisioning state uses the existing metadata column, so no schema change or
migration is needed. Organizations without the flag remain ready. Metadata
updates preserve the server-owned flag atomically, and provisioning changes
only that flag while retaining other metadata.

To repair an existing organization known to have incomplete SQL API
provisioning, mark its metadata pending. The next scan enqueues it:

```sql
UPDATE organization
SET metadata = (coalesce(metadata::jsonb, '{}'::jsonb)
  || '{"clickhouseReady":false}'::jsonb)::text
WHERE id = 'organization-id';
```

After provisioning exhausts its 1,000 attempts, the setup page stops polling
and offers Try again. This resets the existing organization's job to a fresh
retry budget. Status-request failures remain silent. For exhausted cleanup
jobs, repair the underlying issue and use Graphile's `reschedule_jobs` to reset
the attempts and schedule a new run.
Scans deliberately leave exhausted jobs in place for investigation. Inspect
`graphile_worker.jobs` for retry state and `clickhouse.organization.provision`
spans for the organization ID and failure details.

Every failed organization job attempt emits an ERROR log with organization,
trace, job ID, attempt, maximum attempts, exception details, and exhaustion state.
The scanner emits a health snapshot every minute and one aggregate ERROR log
when organizations have been pending longer than two minutes. Worker startup, runtime, retry recovery, and
reschedule failures also emit ERROR logs. Pending UI/CLI responses remain expected
control flow, so user polling does not flood exception telemetry.

Deployment alerts and runbooks are maintained in the `everr-deploy` repository.

# Background work

The common runtime always owns the product worker (alerting, optional GitHub
handlers, preview retention). Cloud's `ApplicationRuntime.registerWorkers()`
registers its organization lifecycle worker and, in configured mode, the independent
one-slot CRM worker, without starting either. They remain in the web process with
separate reserved pools (maximum four connections each). Paused mode admits CRM
commands without running outbound work; disabled mode selects no CRM routes
or runner. Billing callbacks remain synchronous. See
[background work and domain events](../../docs/background-work.md) for task
ownership and the [CRM operations runbook](../../docs/crm-operations.md) for the
required schema/field readback gates, bounded bootstrap, repair and recovery.
Configuration validation does not establish operational readiness.

# Package composition

This package depends on `@everr/app` and supplies its product policy, client
configuration, UI extensions, routes, and infrastructure adapters. Polar,
billing, provisioning, and their database schema and migrations live here.
The app package has no dependency on this package.

```sh
pnpm --filter @everr/app-cloud dev
pnpm --filter @everr/app-cloud build
pnpm --filter @everr/app-cloud typecheck
pnpm --filter @everr/app-cloud test
pnpm --filter @everr/app-cloud db:migrate
```

`tsconfig.json` selects the implementation modules through named
`@composition/*` paths. TypeScript, Vite, and Vitest use those same mappings;
there is no generated compiler configuration. Shared source resolves its own
`#app/*` imports through its package manifest, so cloud has no shared-source
alias. Cloud source uses public `@everr/app` exports.

`composition.ts` registers added routes. Routes attach to named shared layouts
and specify their URL and source file; they do not need to mirror shared source
directories. TanStack generates this package's route tree and splits registered
route components normally. `src/routeTree.gen.ts` is checked in, just as it is in
the shared application. TanStack Start regenerates it during development and
builds; tests and typechecks consume the checked-in file. Commit generated
changes alongside route changes. Restart development after changing module
mappings.

`src/app/composition/pages.tsx` owns the members entitlement decision.
`src/app/composition/ui.tsx` registers workspace switching, billing navigation,
welcome actions, signup links, account-deletion UI, and CLI recovery copy.
Adapter types come from the type-only `@everr/app/composition` entry. Shared
features use `@everr/app/members`, `@everr/app/account-settings/dialog`,
`@everr/app/account-settings/actions`, and `@everr/app/page-layout`.
`src/app/composition/identity.ts` selects business policy and Better Auth
integration together. `src/app/identity-policy.server.ts` owns application rules;
the provider adapter owns persistence wrappers, provider hooks, and request locks.
Shared authentication remains responsible for membership and deletion guards.
Use the shared identity feature through `@everr/app/identity/server`,
`@everr/app/identity/client`, and `@everr/app/identity/roles`.

`src/organizations/commands.server.ts` owns explicit organization creation,
checkout completion, and downgrade. Its callers supply the authenticated actor
and input. Eligibility checks, lock ordering, provider coordination, and database
writes stay in that workflow. Request handlers in `src/data` validate and translate
requests without coordinating database mutations. Automatic signup organization
creation retains its own post-commit onboarding flow.

Shared modules are imported through explicit `@everr/app` exports. Import checks
run through `pnpm run check` at the repository root and in CI. The pre-commit
hook runs the same rules on staged files. They reject relative imports into other
packages, the app's private `#app/` imports, and non-exported package paths.

Client configuration retains ordinary settings: home dashboard, additional
manifest entries, entry destinations, and telemetry endpoint. It no longer
contains signup/deletion switches or CLI-specific JSX.

The build outputs `.output`; use `packages/cloud/Dockerfile` for the container.
This package's environment files use Vite's `cloud` mode. Email delivery
requires both `EMAIL_DSN` and `EMAIL_FROM`; the local `pnpm dev` stack supplies
them through Mailpit.

Database startup applies the shared app migrations and `src/drizzle`.
Plans and customer references belong to `organization_billing`; subscription and
checkout tables are also owned here. Generate migrations from the current App or
Cloud schema after iteration, not while changing schema. See the
[migration guide](../../DATABASE-MIGRATIONS.md) for ownership and database
compatibility.

The test command runs this package's scenarios and the shared alerting
integration suites. Ordinary app unit tests run only in app. Vitest's `provide`
configuration passes cloud migrations and the schema target to the shared
alerting harness; the suites exercise the same behavior against this
application's database setup. Provisioning fixtures remain in `src/testing`,
and the cloud-only tenant-column assertion stays in this package.

## Billing and readiness facts

Cloud publishes subscription and Plan business facts, together with the shared
identity and readiness contracts. Configured and paused modes select 12 CRM event-to-job routes; disabled selects none. Billing publishes
a subscription fact only after accepting and committing a newer provider revision.
Plan changes describe actual stored transitions: an inactive Pro subscription can
suspend access without changing Plan. Hobby downgrade facts follow its local
transaction, and owner Membership repair facts follow their standalone insert.
Provisioning publishes readiness only for a guarded pending-to-ready update that
returns a row. Publication awaits Graphile admission and preserves the existing billing
locks, provider checks, critical provisioning jobs, and cleanup guarantees.

See the internal [event bus guide](../../docs/event-bus.md) for emitted facts and
Graphile handler wiring and the [CRM operations runbook](../../docs/crm-operations.md).
