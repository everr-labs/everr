# Verified Organization milestones

The shared product contract lives in `@everr/app/organizations/consultations`.
Cloud owns detection and `organization_milestones`; query modules depend only on
the server completion capability in `server/organizations/consultations.ts`.
Self-hosted has a no-op capability and no milestone table, CRM dependency or new
configuration. Task 10 supplies this capability. Task 11 observes the narrow
trace-detail actions listed below; other reads remain unobserved.

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
not a claim that all earlier actions or all surfaces were observed. Task 10 alone had
no live action coverage. The supported task 11 completion paths begin observing
only when deployed; observations lost before admission/commit and historical
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

## Supported completion paths (task 11)

The module at `packages/app/src/server/organizations/consultation-completion.ts`
inspects successful results synchronously, without additional SQL, Membership
lookups, network calls or an evidence queue. It inspects at most 1,000 trace rows,
then calls the existing `observe` capability without awaiting marker persistence.
The existing 32-operation admission limit and 3-second shutdown drain therefore
still cover all asynchronous observation work. The current authorization lookup
carries the verified Membership ID into completion. It is not reconstructed from
a request field or looked up again after completion.

| Surface | Observed action                                                                 | Evidence and exclusions                                                                                                                                                                                  |
| ------- | ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| UI      | Standalone trace-detail navigation through `consultTrace` in the route loader   | The fixed `TracesRepository.getTrace` returns actual scoped spans. Router intent preload skips this loader read. Ordinary viewer `getTrace` refresh, focus, reconnect and retry reads remain unobserved. |
| CLI     | Successful `/api/cli/sql` raw trace-detail query matching the grammar below     | Session/current Membership and active Organization come from `requireOrgMiddleware`; rows come from that Organization's existing SQL capability. NDJSON is successfully built before observation.        |
| MCP     | Successful OAuth `query` tool raw trace-detail query matching the grammar below | The verified token's Organization and User, plus the existing current-Membership check's ID, establish the principal. Only rows included in the successful response budget are inspected.                |

Current CLI SQL and MCP OAuth authorization are Member-backed. They record the
actual User and Membership; no Organization-client grant or invented User is
introduced. The shared contract continues to support real Organization query
clients without a User, when such a trusted authorization path exists.

The CLI/MCP grammar is a full-match allowlist for observation, not a SQL security
parser. All other SQL retains its existing behavior and simply supplies no
activation evidence. It accepts `SELECT * FROM traces WHERE TraceId = '<32 hex>'`,
optionally followed by all three fixed predicates in this order:
`AND ServiceName = '<letters, digits, underscore, dot or hyphen>'`,
`AND Timestamp >= '<timestamp>'`, `AND Timestamp < '<timestamp>'`.
Then optional `ORDER BY Timestamp` with optional `ASC`/`DESC`, required `LIMIT`
from 1 through 1,000, and an optional terminal semicolon are accepted. Case and
whitespace are flexible. Comments, aliases, projections, CTEs, joins, subqueries,
UNION, extra statements, SETTINGS and other predicates are not observed. A copied
constant/alias result cannot impersonate the raw telemetry source.

Prefer the bounded service/time variant, for example:

```sql
SELECT * FROM traces
WHERE TraceId = '0123456789abcdef0123456789abcdef'
  AND ServiceName = 'checkout'
  AND Timestamp >= '2026-10-23 00:00:00'
  AND Timestamp < '2026-10-24 00:00:00'
ORDER BY Timestamp ASC LIMIT 100
```

The server observes returned trace identity and stored resource/span attributes,
not a browser claim or merely a nonempty result. Production evidence requires
`deployment.environment.name = production`, or the legacy
`deployment.environment = production` when the current key is absent. CI evidence
requires the existing receiver conventions together: namespace `cicd`, provider
`github`, a positive `cicd.pipeline.run.id`, repository `owner/name`, and a nonempty
`cicd.pipeline.name`. A service name alone never proves provenance. Flat and nested
ClickHouse JSON representations are supported. Unknown origin stays unknown.

Known non-customer service tokens (`everr`, `demo`, `test`, `synthetic`,
`telemetrygen`, `verify`), namespace `everr`, repositories owned by `everr-labs`,
truthy test/demo/synthetic/internal attribute keys, and explicit non-customer
`everr.telemetry.provenance`/`everr.data.provenance` resource values are excluded.
These are conservative conventions over authenticated stored telemetry, not an
independent attestation of every application's claimed environment. A mislabeled
or unmarked synthetic trace is indistinguishable from customer telemetry with
the same stored attributes. No customer payload is exported in facts or logs.

Unsupported actions include dashboard rendering, all Panel queries and TestData,
log/error/CI-run detail endpoints, list/search/aggregate queries, schema probes,
`SELECT 1`, CLI CI watch/status polling, backfill and generic background reads.
An empty result supplies no evidence. Dashboard observations are deliberately
absent because query completion does not prove rendering or an initial visit;
a multi-panel dashboard or automatic refresh cannot produce a marker here.
Repeated valid details are arbitrated by the existing durable once-per-Organization
marker, including across processes. A browser or external script that deliberately
invokes the exact same authorized detail operation is indistinguishable at HTTP
level. This coverage does not promise universal human-intent detection or exclusion
of externally scripted detail requests. It introduces no client flag as authority.
Cached details that do not run the loader read are not newly observed.

The standalone route sets `preloadStaleTime: 0`, so a skipped intent preload
cannot suppress its subsequent actual navigation loader. That loader still uses
`ensureQueryData`: already cached details require no additional server read and
therefore supply no new observation. Embedded viewers do not use this loader and
remain unobserved.

Unexpected evidence-inspection/observer failures emit
`organization.consultations.failed` with only
`everr.consultation.failure_stage = completion` through the existing server logger.
Logger failure is also contained. There is no SQL, result, trace ID, customer
attribute or exception text in this signal. Marker-stage logs/counters above
remain unchanged. The task 11 isolated proof retained three durable markers from
actually OTLP-ingested trace rows, six once-only milestone facts, one unchanged
unknown Organization and one fresh sanitized failure log queried through Everr.
It exercised the completion seam with fixture authorization and a disposable
embedded PostgreSQL database, not an authenticated HTTP/browser journey. `.auth`
was absent, so the authenticated manual app check was skipped. Evidence lives in
`.verify-everr/artifacts/task11-query-value-observations/`; production remains
unverified and no application migration was generated or applied.
