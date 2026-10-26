# Cloud CRM synchronization

Cloud synchronizes Users to Brevo Contacts, Organizations to Companies, and
Memberships to explicit Contact/Company pairs. Configuration and operator commands
are documented in the [operations runbook](../../../../docs/crm-operations.md).

## Best-effort contract

Committed lifecycle facts select small Graphile commands through `crmEventRoutes`.
The shared publisher contains admission failures and never calls Brevo. A process
crash between source commit and enqueue can lose a notification. There is no outbox,
event history, persistent projection or automatic reconciliation. A later event or
manual full sync repairs current state; neither promises complete event history.

Handlers reread authoritative source state. User and Organization snapshots use
short read-only repeatable-read transactions. Provider calls and backpressure never
hold a source transaction. Plan, subscription, effective access and provisioning
remain separate fields. Readiness has no direct CRM route and refreshes through
another lifecycle event or manual sync.

## Identity and mapping

Contact `ext_id` is `everr:v1:user:<encoded-user-id>`. Company `everr_org_id` is
`everr:v1:organization:<encoded-organization-id>`. IDs do not depend on email,
domain, deployment name or host. Production Cloud and local development use
separate Brevo accounts and API keys. Never share one account across independent
databases with overlapping source identities.

The only persisted CRM value is the Company ID in Organization metadata key
`everr.crm.brevoCompanyId`. Cloud strips client-supplied mappings on creation and
preserves the server-owned key atomically during metadata replacement, including
bulk updates. The worker updates only that key directly, without auth hooks,
lifecycle events or overwriting provisioning state. No CRM migration is required.

A mapping is a lookup hint for the currently configured Brevo account. The worker
verifies the returned Company's external identity. Missing IDs, 404 responses and
foreign records fall back to paginated inventory lookup. A foreign record is never
modified. A unique match repairs the metadata; no match allows creation. Duplicate
identities stop the command and require inspection.

Company POST is not exactly-once. An accepted create with a lost response stops
that command and emits an error; it is not immediately repeated. A manual rerun
looks up the identity first and binds a visible match. Contact ambiguous creates
can use native retries because each retry looks up the unique `ext_id` first.
There is no durable creation guard, including across crashes or delayed visibility.

Missing sources trigger deletion through external identity lookup. No local
mapping or tombstone is required after a database cascade. A removed pair only
unlinks its endpoints. Deletion of a parent also removes its remote associations.
Missed deletions and pair removals are repairable with manual prune.

## Execution and failure policy

All sync and scan commands use the single named `crm-brevo` queue. Graphile owns
the queue for the complete task across replicas. A separate supervised runner has
one slot and its own pool; provisioning capacity remains independent. Old queue
partitions and endpoint advisory locks are removed.

The HTTP adapter repeats explicit 429 rejections after the provider reset or
Retry-After delay. Waiting is cancellable and does not use native retry attempts.
Cooldown is in memory only. A restart can encounter another 429. Other users of
the Brevo account can consume its capacity; no database permit system is maintained.

Transient reads/idempotent writes and infrastructure failures throw sanitized
errors for Graphile's eight-attempt exponential backoff. Terminal provider errors,
identity conflicts, invalid commands and ambiguous Company creates emit structured
errors and return without a success diagnostic. The Graphile command completes;
manual reruns are new admissions by source ID, not projection recovery operations.
Unexpected provider exceptions and bodies never enter worker logs.

The task checks the source after writes and queues a successor if its profile
changed or was deleted. Parent tasks admit current Membership pairs. Membership
prerequisites run directly inside the same task, without waiting for child jobs.
These checks improve convergence but cannot make HTTP atomic with source writes.

## Manual sync and telemetry

`pnpm --filter @everr/app-cloud crm:sync` admits a full scan. Optional source-ID
flags admit a User, Organization or pair. `--prune` only previews remote orphan
records and obsolete owned pairs. `--prune --apply` admits their normal sync
commands, which reread current source state before acting. Both endpoints of a
pruned pair must carry recognized Everr identities. Foreign records and links
remain untouched. Duplicate Company identities are reported and skipped.

A scan has no persisted cursor. It pages local IDs and remote inventories, admits
coalesced commands, and releases the outbound queue before children run. Its
completion means admission, not remote convergence. Rerunning starts at the first
page. Preview performs only source reads and provider GET requests.

OTel task spans join structured outcome logs with backpressure logs. Metrics cover
outcomes, lag and provider rate-limit waits. IDs are log/span attributes, never
metric dimensions. See the runbook for failure lookup and retry commands.

Prune skips orphan records with associations to foreign records, reporting
`foreign_associations_present`. It rechecks those associations at execution, so a
foreign link added after preview also blocks deletion. Inspect and resolve those
links manually before rerunning cleanup. Ordinary lifecycle deletion remains
source-authoritative; the additional association protection applies to prune.
