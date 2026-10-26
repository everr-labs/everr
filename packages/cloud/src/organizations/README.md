# Verified Organization milestones

The shared product contract lives in `@everr/app/organizations/consultations`.
Cloud owns activation qualification, milestone event definitions and `organization_milestones`; query modules depend only on
the server completion capability in `server/organizations/consultations.ts`.
Self-hosted has a no-op capability and no milestone table, CRM dependency or new
configuration. Only the trace-detail actions listed below are observed.

## Evidence and authorization

Only trusted server completion code may construct `TraceConsultation`. Never
deserialize a request/browser claim into this authority or expose a marker-write
endpoint. Completion code derives Organization scope from the authenticated action
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

The shared contract contains only the authenticated principal, the surface
(`ui`, `cli`, or `mcp`), and the consulted traces' identity, service and stored
resource/span attributes. Organization scope occurs once, on the principal.
It has no activation rule, milestone definition, provider dependency, dashboard
variant or repeated declarations of success, authorization or provenance.

Cloud validates this input and applies Rule 1: at least one consulted trace must
be the Organization's own Production or CI telemetry. Origin classification and
exclusions for TestData, demo, synthetic and internal Everr data live exclusively
in Cloud. Shared server code recognizes supported completed trace reads, leaving
probes, arbitrary SQL and background refreshes unobserved. Cloud then persists only
Organization ID, surface and server observation times. Future log, error, CI-run
and dashboard consultation coverage requires an explicit contract extension.

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
not a claim that all earlier actions or all surfaces were observed. Supported
completion paths begin observing
only when deployed; observations lost before admission/commit and historical
actions remain unknown. A later valid consultation can establish a later observed
date, but cannot reconstruct a lost earlier first-value date.

Cloud constructs the capability independently of outbound consumers. Event
routes are currently empty, so product markers persist without external
delivery. Future projections can read stored dates/version from a committed view;
missing markers remain unknown rather than dates derived from creation or billing.

The observer directly admits at most 32 observations in flight, with no
intermediate event or unbounded queue. `observe(...)` returns void and is never
awaited by the completed action. Validation, overload, clock, database and publication
failures are measured and contained. Each marker transaction has a 2-second SQL
statement timeout and 500-millisecond lock timeout; the existing database pool
has a bounded connection wait. Shutdown closes admission, drains for at most
3 seconds before workers and telemetry stop. An in-flight marker can finish
after that timeout. Publication directly awaits Graphile admission, without a
separate drain or admission gate; enqueue failures use the shared publisher
diagnostics. Hard termination can still lose events while preserving stored markers.

## Database migration

Cloud migration `0001_organization_milestones` creates the marker table, its
constraints and the cascading Organization reference. It belongs to the Cloud
migration history, after the shared App schema. Include it in the target rollout
before expecting marker persistence. Generating these artifacts does not apply
them to a database.

## Telemetry

The existing server logger and OTel providers export
`organization.milestones.failed` and monotonic counter
`everr.organization_milestones.failures` (unit `1`). The only diagnostic attribute
is `everr.milestone.failure_stage`, with bounded values `validation`, `envelope`,
`storage`, `publication`, `overload`, `closed`, `drain`. No raw SQL, evidence,
credentials, profiles or exception messages are logged. Logger and counter errors
are guarded independently, including rejected promises.

For local development set `OTEL_EXPORTER_OTLP_ENDPOINT` to the local collector's
reported OTLP origin. Verify logs and metrics in that installation after exercising
the matching build. Remote export uses the app's existing
`EVERR_INGEST_ENDPOINT` and `EVERR_INGEST_KEY`, with
`DEPLOYMENT_ENVIRONMENT` describing the application environment. Explicit
`OTEL_EXPORTER_OTLP_ENDPOINT` takes precedence and does not use the Everr key.
These diagnostics reuse the existing exporter configuration.

## Supported completion paths

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

The shared server reports returned trace identity and stored resource/span attributes.
Cloud qualifies these completed reads, rather than accepting a browser claim or
merely a nonempty result. Production evidence requires
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
remain unchanged. See the [event bus guide](../../../../docs/event-bus.md) for the
milestone fact payloads, publication guarantees and Graphile handler wiring.
