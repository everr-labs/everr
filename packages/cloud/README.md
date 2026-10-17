# Cloud application

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
stop either runner. Organization handlers and the scanner use their reserved
Postgres pool too.
SIGTERM and SIGINT drain both runners before flushing telemetry. ClickHouse
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

`composition.ts` supplies paths to the shared build factory. TanStack combines
the shared physical route directory with `src/routes` and generates this
package's route tree. `src/composition/client.tsx` defines entry routes and
telemetry defaults; `src/composition/ui.ts` supplies navigation and welcome
page actions. Shared modules are imported through explicit `@everr/app`
exports. The export surface and remaining adapter aliases can be narrowed
independently of package extraction.

The build outputs `.output`; use `packages/cloud/Dockerfile` for the container.
This package's environment files use Vite's `cloud` mode. Email delivery
requires both `EMAIL_DSN` and `EMAIL_FROM`.

Database startup applies the shared app migrations and `src/drizzle`.
Existing databases first complete `src/drizzle-legacy` before adopting the
separate migration histories. Plans and customer references belong to
`organization_billing`; subscription and checkout tables are also owned here.
Do not generate new migrations while iterating on schema changes.

The test command runs this package's scenarios and the shared behavior tests.
Its provisioning and tenant-aware ClickHouse fixtures live in `src/testing`.
Installation-specific scenarios under the dependency's `src/app/tests` are
excluded from this composed application's suite.
