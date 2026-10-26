# Cloud CRM operations

This is the current operator contract for the cloud Brevo projection. Contacts
represent Users, Companies represent Organizations and explicit associations
represent current Membership pairs. Campaigns, historical Events API delivery,
welcome messages, lists and automations are outside this rollout. Existing SMTP
authentication delivery is unchanged. The integration defaults to disabled.

## Before enabling

Use a matching reviewed application build and a separately reviewed deployment
change. Configuration validation checks environment values only. It performs no
startup HTTP and does not verify database schema, provider fields, credentials,
permissions, account identity or the deployed build.

1. Confirm the target application build and its targeted checks pass. Deployment
   configuration belongs to `everr-deploy` and must match that build.
2. Have the schema changes reviewed and delivered through the normal migration
   process before starting this build against the target database. Cloud ships
   `0001_crm_projection`, with its snapshot and journal entry. Generating these files does not apply them. Cloud needs the
   complete current definitions in `packages/cloud/src/db/schema/crm.ts`
   (`crm_projection`, `crm_brevo_budget`, `crm_bootstrap`, `crm_reconciliation`)
   including current columns, primary/unique keys and checks. Merely finding the tables is inadequate.
   Shared auth, Membership and cloud billing/subscription schema must also exist.
   Graphile's public `add_job` function and `jobs` view must be available to the
   application/administrative database role. Do not run `db:generate` to improvise
   this rollout or apply schema with the bootstrap command.
3. Verify the correct Brevo account and key permissions without printing the key.
   Provision and inspect all fields below. Confirm their exact names and types in
   Brevo's field settings or the authenticated metadata inventories
   `GET /v3/contacts/attributes` and `GET /v3/companies/attributes`. Contacts expose
   `name` and `type`; Companies expose `label`, `internalName` and
   `attributeTypeName`. Capture only the required-field names/types and status.
4. In an isolated account first, then as an explicitly owned target-account canary,
   synchronize a uniquely marked disposable Contact and Company with distinctive
   values in every owned field. Read those exact records back by their external
   identity/mapping and compare every nonempty value and value type, including
   `false`/`true` boolean verification and ISO/date text. Exercise clearing nullable
   fields to empty Company text too. A 2xx write, field label alone or local
   `synced` outcome cannot prove that Brevo retained unknown attributes. Stop if
   any field is absent, renamed, wrongly typed or silently ignored. Verify explicit
   canary association and suppression, then clean only those owned fixtures and
   verify exact-ID absence. Preserve the field definitions. No canary may trigger
   a campaign, list, invitation or automation.
5. Record build identity, schema review/application evidence, account/namespace,
   sanitized field inventory and exact fixture readbacks in the rollout evidence.
   Keep customer profiles, keys, SQL payloads and provider error bodies out of logs.
   Do not enable until these gates have passed for the actual target.

From the same operator environment, inspect schema metadata without profile data
and compare it with the matching build's schema source. For example:

```sh
psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 <<'SQL'
BEGIN READ ONLY;
SELECT table_name, column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name IN
  ('crm_projection', 'crm_brevo_budget', 'crm_bootstrap', 'crm_reconciliation')
ORDER BY table_name, ordinal_position;
SELECT tablename, indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public' AND tablename IN
  ('crm_projection', 'crm_brevo_budget', 'crm_bootstrap', 'crm_reconciliation')
ORDER BY tablename, indexname;
SELECT conrelid::regclass AS table_name, conname, pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE conrelid IN (to_regclass('public.crm_projection'), to_regclass('public.crm_brevo_budget'),
  to_regclass('public.crm_bootstrap'), to_regclass('public.crm_reconciliation'))
ORDER BY table_name, conname;
ROLLBACK;
SQL
```

This inspection is read-only and does not certify a build or apply missing DDL.
Review absence and differences before starting the target build. The administrative
role also needs working Graphile admission permissions; paused bounded admission
checks that path without provider HTTP.

Manual field settings and exact fixture readbacks are an operator gate, not an
automatic application preflight. The shipped CLI has no provider-field validator.
If metadata is checked programmatically, use bounded response/body deadlines,
reject redirects, sanitize output and coordinate the same account budgets as
other clients. Do not poll metadata at startup or bypass an active cooldown.

| Contact normal attribute | Required Brevo type | Written value                       |
| ------------------------ | ------------------- | ----------------------------------- |
| `EVERR_NAME`             | `text`              | Current User name                   |
| `EVERR_REGISTERED_AT`    | `text`              | Original registration ISO timestamp |
| `EVERR_EMAIL_VERIFIED`   | `boolean`           | Boolean verification state          |

Contact `EXT_ID` is Brevo's standard external identity, sent as `ext_id` on create
and read with `identifierType=ext_id`; `EMAIL` is the standard email attribute.
Neither is an additional Everr custom field. Do not substitute email for identity.

All eight Company fields below have provider type `text`. The uppercase label
and lower-case internal name are distinct. The adapter writes the internal name.
Company `name` is standard and source-owned (returned as `attributes.name` on
GET and normalized by the adapter); provider `created_at` is read-only
and is never Everr's creation date.

| Company label                | Required internal name       | Written value                       |
| ---------------------------- | ---------------------------- | ----------------------------------- |
| `EVERR_ORG_ID`               | `everr_org_id`               | Deployment-scoped external identity |
| `EVERR_CREATED_AT`           | `everr_created_at`           | Original Organization ISO timestamp |
| `EVERR_PLAN`                 | `everr_plan`                 | `hobby` or `pro`                    |
| `EVERR_APP_STATE`            | `everr_app_state`            | `hobby`, `pro` or `suspended`       |
| `EVERR_SUBSCRIPTION_STATUS`  | `everr_subscription_status`  | Current status or empty text        |
| `EVERR_CURRENT_PERIOD_END`   | `everr_current_period_end`   | ISO timestamp or empty text         |
| `EVERR_CANCEL_AT_PERIOD_END` | `everr_cancel_at_period_end` | Text `true` or `false`              |
| `EVERR_PROVISIONING`         | `everr_provisioning`         | Current storage readiness           |

## Configuration and namespace

| Environment field         | Contract                                                                                             |
| ------------------------- | ---------------------------------------------------------------------------------------------------- |
| `CRM_BREVO_MODE`          | `disabled` (default), `paused`, `configured`                                                         |
| `CRM_BREVO_API_KEY`       | Secret required for paused/configured                                                                |
| `CRM_BREVO_DEPLOYMENT`    | Permanent deployment namespace, required for paused/configured                                       |
| `CRM_BREVO_ACCOUNT_SCOPE` | Stable nonsecret account identity, required for paused/configured, unchanged across API-key rotation |
| `CRM_BREVO_TIMEOUT_MS`    | Whole HTTP/body deadline, default 10000, integer 100 through 30000                                   |

Use one logical deployment/account namespace per worker database. Replicas share
that namespace, account scope, Graphile schema and durable budgets. Jobs are not
multi-deployment routing, even though checkpoint keys contain a deployment.
Never run a second independent deployment namespace in the same worker database.
Separate installations should use separate Brevo accounts unless external
account-wide coordination is provided. Equal account-scope strings across separate
databases do not coordinate quota. Every other client against that Brevo account
also consumes provider quota. Never change the namespace to solve a mapping error.

| Mode       | Live CRM event-to-job routes         | Outbound worker and periodic scan | Administration                            |
| ---------- | ------------------------------------ | --------------------------------- | ----------------------------------------- |
| disabled   | None                                 | None                              | Bootstrap/recovery refuse                 |
| paused     | Persist pending commands best effort | None                              | Bootstrap/recovery may admit bounded work |
| configured | Persist pending commands best effort | Independent one-slot runner       | Bootstrap/recovery may admit bounded work |

Mode changes require configuration reconstruction/restart. Restart every replica
when pausing and allow old requests to drain. Pausing does not undo a request that
Brevo already accepted. Invalid enabled configuration fails startup validation;
missing credentials never silently consume jobs. Self-hosted has no CRM imports,
configuration, schema or jobs. Source operations await the Graphile enqueue attempt after commit, containing
its errors. They never wait for Brevo.

## Bounded bootstrap and normal repair

Run administrative commands from a matching operator source checkout with its
workspace dependencies installed, including the cloud package's `tsx`, and network
access to the intended PostgreSQL database. The built production container is not
assumed to contain source scripts or development dependencies. Inject the database
URL and secret through the operator's secret/environment mechanism; do not paste
keys into shell arguments, examples, process logs or repository files. The command
requires explicit `DATABASE_URL` and the enabled configuration above. For example,
after that environment is present:

```sh
cd packages/cloud
node_modules/.bin/tsx --tsconfig tsconfig.json scripts/crm-bootstrap.ts --page-size 10 --max-pages 1
# Repeat the same command to resume committed progress.
# Only after completion, explicitly begin a later full admission scan:
node_modules/.bin/tsx --tsconfig tsconfig.json scripts/crm-bootstrap.ts --page-size 10 --max-pages 1 --new-scan
```

`page-size` accepts 1 through 100 and `max-pages` accepts 1 through 1000. A page's
checkpoint and Graphile admissions commit in one short transaction; interruption
rolls back the incomplete page. An unfinished scan cannot be reset with
`--new-scan`. Progress describes admission, never remote convergence:
`admissionCompleted: true` can coexist with `remoteConverged: false`, queued work,
blocks or exhaustion. The command makes no provider requests and never clears
bindings, Company intent, blocks or failure allowances. Source passes are not a
global snapshot; inserts behind a cursor need a later full cycle.

In configured mode `crm/reconcile` runs every minute with priority 100, admits at
most 10 source/mapping rows per execution, and starts the next cycle 24 hours
after completed admission. At 100 active sync jobs it defers without advancing the
checkpoint. One admitted page can overshoot by at most 10; parent fanout can add
more jobs. Live and coalesced sync work keep priority 0. Active keyed jobs stay
undisturbed, while retained terminal jobs can be readmitted to detect newer source
changes lost before job persistence. An unchanged block/exhausted revision stays
blocked/exhausted without provider requests.

Current User/Organization/pair state, deleted sources and
remote owned-field/association drift are repaired through normal coordinated
handlers. Completed desired revision plus per-cycle `remote_check_id` prevents
same-cycle duplicate checks or allowance resets. An unchanged local snapshot is not
a remote drift check. Mapped remote 404s are detected and blocked, never recreated
automatically. Historical facts are not reconstructed.

All live, bootstrap, periodic, recovery and cleanup requests share durable account
permits: Contacts are spaced by 100 milliseconds, general operations (Companies
and associations) by 36 seconds. Provider cooldown/Retry-After can make that longer.
No scanner or worker-concurrency setting bypasses these limits. Initial import and
each fresh repair cycle can take much longer than admission, especially with many
Companies or pairs. Do not promise a 24-hour convergence deadline from the cadence.

## Diagnosis and recovery

Inspect the target database read-only and scope results to the intended deployment.
Useful views are `crm_bootstrap`, `crm_reconciliation`, `crm_projection` and the
public `graphile_worker.jobs` view. For one projection inspect desired/synced
revision, outcome, `retry_failures`, bounded `last_error_code`, last success,
`pending_since`, immutable remote identity, pair endpoint IDs and Company-create
intent. Those records contain profile snapshots, so do not export them to generic
logs. Check active jobs' attempts, maximum attempts, run time, lock owner and key;
a completed admission checkpoint alone is insufficient. `retry_failures` for the
current desired revision is the only provider-retry budget (eight allowances).
Graphile attempts track infrastructure retries independently. Queued
commands carry no `failures` or `desiredRevision` mirrors. Read the projection row
to measure remaining allowance. Sync logs report `everr.crm.failures` only when a
database count is known. Never edit Graphile's
private tables or unlock a live worker.

| Symptom                                             | Diagnosis and supported response                                                                                                                                                                                  |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| No CRM jobs                                         | Confirm mode and process build; disabled registers none. Publication may have been lost before enqueue. Configured repair or an explicit bounded bootstrap can admit current state.                               |
| Paused backlog                                      | Expected; no periodic telemetry samples or outbound work. Resume every replica with the same namespace/account after the gates pass.                                                                              |
| Deferred/rate limited                               | Honor durable `next_allowed_at`, provider Retry-After and shared account traffic. Do not reset the budget or replay rapidly.                                                                                      |
| Credentials/schema rejection                        | Inspect sanitized code and verify key/account/field inventory outside logs. Fix the cause; unchanged ordinary permanent blocks do not automatically reopen.                                                       |
| `mapped_contact_missing` / `mapped_company_missing` | Inspect exact external identity, immutable mapping, pairs, source and Company intent. There is no supported automatic replacement or clear-binding command.                                                       |
| Ambiguous Company create                            | Retain intent and mapping. The adapter resumes a single unfiltered inventory page (at most 100). A full page, multiple matches or no visible match remains inspectable; never blindly issue another POST.         |
| Source fields changed but remote did not            | Compare current desired and synced revision, failure/block state and actual exact-record readback; repair may still be waiting on general permits. Field metadata/readback gate must pass first.                  |
| Worker failure                                      | Inspect supervisor/startup/runtime logs and DB connectivity; each supervisor retries independently every five seconds. For abandoned locks, prove the owner dead before Graphile's public force-unlock procedure. |

After fixing the cause, only exhausted work (`retry_failures >= 8`) has the
supported explicit recovery command. Read the current unsynchronized desired
revision first, then admit exactly that revision from the same operator checkout:

```sh
cd packages/cloud
node_modules/.bin/tsx --tsconfig tsconfig.json scripts/crm-recover.ts --kind user --source-id USER_ID --expected-revision REVISION
```

Kinds are `user`, `organization`, `membership`. Membership source ID is the JSON
User/Organization pair stored in `crm_projection.source_id`; quote it as one shell
argument. This command makes no provider requests and reports `recovered: false`
because only admission occurred. The worker checks revision and exhaustion again
under endpoint locks, opens one allowance and retains mapping, Company intent and
known pending age. Duplicate/stale recovery cannot replenish another allowance.
Ordinary permanent/identity blocks below eight failures and mapping replacement
need a separately reviewed recovery procedure; this implementation has no command
for them. Graphile replay alone never bypasses these durable guards. A genuinely
new source snapshot can establish a newer revision but is not an operator reset.

## Telemetry and rollout

Use the existing application OTel pipeline and verify ingestion through Everr for
the target deployment. `business_events.publication.failed` plus
`everr.business_events.publication.failures` exposes lost ancillary enqueue.
CRM sync diagnostics report deferred/retry/blocked/exhausted/synced outcomes.
`crm.reconciliation` and `everr.crm.reconciliation.outcomes` cover progress,
deferral, failure, drift and missing records with bounded dimensions.
`everr.crm.sync.oldest_known_pending` (seconds) is the age of the oldest known
projection pending timestamp or active sync job creation. Legacy unknown starts
remain unknown; zero means no known timestamp, not proof of universal convergence.
It is sampled by configured periodic execution, including backlog deferral, and
paused runners do not sample it. Never infer production ingestion from isolated
verification. Use bounded time/service-filtered diagnostic queries, not profile
payloads. Deployment alert configuration belongs to `everr-deploy`.

Stage rollout as follows: schema/build review and application, provider field and
canary readback gate, paused composition on every replica, bounded bootstrap
admission, then a configured canary window. Paused mode can accumulate all live
commands and there is no shipped per-User allowlist; use an isolated environment
for a small first canary. Before configuring a real target, understand its entire
existing backlog and account quota. Watch publication failures, blocked/exhausted
work, lag, missing mappings and progress while comparing exact owned records.
Repeat field-clearing and suppression checks in the target. Expand admission only
after the actual evidence is satisfactory. Record approved target values and
application evidence in the deployment change; campaign delivery requires its own design.

For a pause/rollback, set paused and restart all replicas, drain existing HTTP and
preserve database mappings, tombstones, checkpoint and budget state. Source
operations continue. Disabled can stop new CRM admission for a longer rollback;
changes while disabled require later repair/bootstrap. Do not drop the new schema
or restore an older writer that cannot safely read current persisted task/state
formats. Prefer rolling forward with the integration paused. Resuming does not
repair an unsupported mapping replacement or unblock ordinary permanent failures.
No rollback can retract a provider request already accepted.
