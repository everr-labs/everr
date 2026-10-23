# Verified Organization milestones

The shared product contract lives in `@everr/app/organizations/consultations`.
Cloud owns detection and `organization_milestones`; query modules depend only on
the server completion capability in `server/organizations/consultations.ts`.
Self-hosted has a no-op capability and no milestone table, CRM dependency or new
configuration. Task 10 supplies this capability; task 11 wires actual completion
paths. No existing query, UI, CLI or MCP action is observed by this increment.

## Evidence and authorization

Only trusted server completion code may construct `UsefulConsultation`. Never
deserialize a request/browser claim into this authority or expose a marker-write
endpoint. Task 11 must derive Organization scope from the authenticated action
and provenance/usefulness from the completed read, not from a browser assertion
or the fact that an arbitrary SQL result is nonempty.

The principal is either a Member with User and Membership IDs whose current
Membership authorized the action, or an authorized Organization client with an
explicit Organization query grant and client ID. A client need not have a User
identity; no actor is invented. Existing MCP OAuth authorization is Member-backed
and must retain its existing current-Membership authorization at completion.
Authorization is verified at the completed action. A later Membership departure
does not invalidate that historical observation. The asynchronous store checks
that the source Organization still exists, under a share lock, without imposing
a second, later Membership decision.

Rule 1 requires successful own Production or CI telemetry consultation in that
same Organization. Detail evidence identifies trace, log, error or CI run content;
dashboard evidence requires an initial consultation with rendered own-data panels;
interactive CLI/MCP query evidence requires telemetry-analysis purpose and matched
own records. The strict schema checks scope, principal, surface, trigger and
evidence shape before admission to storage. Task 11 must distinguish real own
telemetry from TestData, demo, synthetic and internal Everr data, exclude probes
and `SELECT 1`, polling, backfill and redundant refreshes, and assemble one
dashboard observation rather than one per Panel. Provisioning, keys, usage bytes,
subscription and Plan have no observation shape that can activate an Organization.

## Persistence, time and coverage

Rule 1 establishes first-queryable and activated markers together from one valid
consultation. A single insert with Organization primary key and `ON CONFLICT DO
NOTHING` arbitrates concurrent replicas. Only the winning committed insertion
publishes `telemetry.first_queryable` and `organization.activated`, each best
effort with no invented actor. Quiet periods and subsequent observations never
reset or rewrite the marker. Organization deletion cascades product markers;
the CRM projection retains its independent deletion/cleanup identities.

Both milestone times are the server time captured at observation admission after
successful completion, before asynchronous persistence. A customer telemetry
Timestamp is not accepted. `observer_started_at` records capability construction
in the process that won the first insertion. It is a process coverage bound,
not a claim that all earlier actions or all surfaces were observed. Task 10 has
no live action coverage. Task 11 must document which completion paths start
observing at rollout; observations lost before admission/commit and historical
actions remain unknown. A later valid consultation can establish a later observed
date, but cannot reconstruct a lost earlier first-value date.

Cloud constructs the capability independently of Brevo mode. After task 11 wiring,
markers continue while CRM is disabled or paused. Disabled CRM has no outbound
subscribers; paused CRM retains admitted consumer work. Neither condition changes
the product rule or marker. Latest Company snapshots read stored dates/version in
their committed view, repairing current fields after a lost fact through later
source notifications or the planned reconciliation. They do not replay historical
facts. Missing markers produce null snapshot fields and empty provider text, not
false activation or dates derived from Organization creation, usage or billing.

Admission reuses the existing bounded publisher, with at most 32 observations in
flight and no unbounded queue. `observe(...)` returns void and is never awaited
by the completed action. Validation, overload, clock, database and publication
failures are measured and contained. Each marker transaction has a 2-second SQL
statement timeout and 500-millisecond lock timeout; the existing database pool
has a bounded connection wait. Shutdown closes admission, drains for at most
3 seconds, then drains domain publication before workers and telemetry. A timed
out in-flight marker may finish later; its fact can be lost after publication
closes, while its stored marker remains repairable.

## Telemetry

The existing server logger and OTel providers export
`organization.milestones.failed` and monotonic counter
`everr.organization_milestones.failures` (unit `1`). The only diagnostic attribute
is `everr.milestone.failure_stage`, with bounded values `validation`, `envelope`,
`storage`, `publication`, `overload`, `closed`, `drain`. No raw SQL, evidence,
credentials, profiles or exception messages are logged. Logger and counter errors
are guarded independently, including rejected promises.

For local development set `OTEL_EXPORTER_OTLP_ENDPOINT` to the local collector's
reported OTLP origin. The isolated proof sets its own service identity and exports
logs/metrics to an owned collector. Remote activation uses the app's existing
`EVERR_INGEST_ENDPOINT` and `EVERR_INGEST_KEY`, with
`DEPLOYMENT_ENVIRONMENT` describing the application environment. Explicit
`OTEL_EXPORTER_OTLP_ENDPOINT` takes precedence and does not use the Everr key.
No exporter, production configuration or production activation was added.

The task 10 isolated proof queried eight fresh failure logs across all seven
stages and the matching counter with only the bounded attribute and unit `1`.
Evidence is retained under `.verify-everr/artifacts/task10-activation-milestones/`.
Production ingestion remains unverified.
