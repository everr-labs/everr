# Cloud CRM operations

CRM synchronization is best effort. Production Cloud uses its production Brevo
account. Local development uses a separate account and API key. IDs are stable
within an account and have no deployment namespace.

## Configuration

| Variable               | Value                                           |
| ---------------------- | ----------------------------------------------- |
| `CRM_BREVO_MODE`       | `disabled` (default), `paused`, or `configured` |
| `CRM_BREVO_API_KEY`    | Required in configured and paused modes         |
| `CRM_BREVO_TIMEOUT_MS` | Optional request deadline, default 10000 ms     |

Disabled mode admits no CRM work. Paused mode admits commands but runs no CRM
consumer. Configured mode starts the dedicated one-slot runner. Changes require
restarting the affected process. There are no CRM tables or migrations.

Before enabling an account, prepare the owned provider attributes and read back
fixture records. Brevo can ignore unknown attributes, so HTTP success alone does
not prove field configuration. Ensure unrelated account automations do not send
messages on record creation. This integration does not enroll campaigns or lists.

| Record  | Attributes                                                                                                                                                                                       |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Contact | Standard `EXT_ID`; custom `EVERR_NAME` and `EVERR_REGISTERED_AT` as text, `EVERR_EMAIL_VERIFIED` as boolean                                                                                      |
| Company | Text attributes `everr_org_id`, `everr_created_at`, `everr_plan`, `everr_app_state`, `everr_subscription_status`, `everr_current_period_end`, `everr_cancel_at_period_end`, `everr_provisioning` |

Company attribute labels use `EVERR_...`; confirm their actual provider internal
names match the lower-case names above. Prepare any required provider fields for
creation. Contact identity is `everr:v1:user:<encoded-id>`; Company identity is
`everr:v1:organization:<encoded-id>`. Do not change these formats on existing data
without an explicit migration of the remote identities.

## Manual commands

The script requires `DATABASE_URL`, enabled CRM configuration, and the same target
database as the integration runner. Supply configuration through the process
environment. It admits work through Graphile and makes no provider calls itself.

```sh
# Full current-state sync, safe to repeat.
pnpm --filter @everr/app-cloud crm:sync

# Rerun one source, or one explicit pair.
pnpm --filter @everr/app-cloud crm:sync --user-id USER_ID
pnpm --filter @everr/app-cloud crm:sync --organization-id ORGANIZATION_ID
pnpm --filter @everr/app-cloud crm:sync --user-id USER_ID --organization-id ORGANIZATION_ID

# Preview orphan records and obsolete associations, then explicitly apply cleanup.
pnpm --filter @everr/app-cloud crm:sync --prune
pnpm --filter @everr/app-cloud crm:sync --prune --apply
```

The result includes `eventId`, Graphile `jobId`, task and admitted count. A full
scan reports its candidate/admitted counts in telemetry with that event ID. These
counts describe queue admission, not successful remote synchronization. In paused
mode work waits until a configured runner starts.

A full scan starts at the beginning on each run. It admits Users and Organizations;
parent handlers admit their current Memberships. Prune inventories the current
account, recognizes exact Everr identities and previews missing local entities or
links absent from current Memberships. Apply admits the normal handlers, which
recheck current sources before changing Brevo. Records without recognized Everr
identities and links to foreign Contacts are preserved. Duplicate Company
identities require inspection and are skipped.

## Failure behavior

Graphile retains transient failures after eight attempts. Credential/schema errors,
identity conflicts, malformed commands and ambiguous Company creates emit terminal
errors and acknowledge the command without a success diagnostic. Rerun by source ID
after fixing the cause. No projection recovery command or revision is required.

429 responses pause only the dedicated CRM consumer until the indicated reset or
Retry-After time, without consuming the job's transient retry allowance. Shutdown
cancels waits. Cooldowns are in memory; restarting can encounter a new 429. The
single named queue serializes work across replicas of this database. External
clients using the same Brevo account can still consume quota.

If Company creation has an ambiguous outcome, inspect the exact `everr_org_id` in
Brevo before rerunning. The rerun inventories all pages and recovers a unique
visible match. It never immediately repeats the failed POST. Delayed visibility
or process crashes can still produce duplicates; this integration promises no
exactly-once creation. Duplicate matches are reported instead of merged or deleted.

The Company ID is stored only in server-owned Organization metadata
`everr.crm.brevoCompanyId`. Missing or foreign IDs are resolved against the current
account before writes. Source deletion removes metadata; cleanup therefore looks
up the external identity. Missed notifications are repaired by another source
event or manual full sync/prune. There is no periodic repair or persistent status
that proves the remote record is synchronized.

## Telemetry

Task spans use scope `everr-cloud.crm`. Structured `crm.sync` logs include outcome,
entity kind, source ID, business event ID, job ID, operation, attempt, bounded error
code and the estimated next retry when applicable. `crm.provider.backpressure`
logs include the bounded operation, 429 status, delay and next request time. IDs
are omitted from metric dimensions. No provider bodies, profile values or keys are
logged.

Metrics are `everr.crm.sync.outcomes`, `everr.crm.sync.lag` (seconds),
`everr.crm.provider.rate_limits` and `everr.crm.provider.wait` (seconds).
The `synced` outcome means the observed operation completed, not durable proof of
future consistency. Native Graphile retry timing is estimated from its exponential
backoff and can be delayed by queue load.

Use Everr logs filtered by time, service and `everr.business_event.id` or source ID
to find `failed`, `retry`, `exhausted` and `invalid` outcomes. Follow `TraceId` to
join task and provider backpressure signals. Inspect queued transient failures
through Graphile's public jobs API. A terminally acknowledged command is inspected
through telemetry and retried with `crm:sync`.

Prune skips orphan records with associations to foreign records, reporting
`foreign_associations_present`. It rechecks those associations at execution, so a
foreign link added after preview also blocks deletion. Inspect and resolve those
links manually before rerunning cleanup. Ordinary lifecycle deletion remains
source-authoritative; the additional association protection applies to prune.

Membership move commands carry optional previous User/Organization endpoints and
synchronize both pairs from current state. Distinct event job keys retain each
move's cleanup target across consecutive moves. Role-only updates keep normal
pair coalescing. An old association is retained if another current Membership
still connects the old pair.
