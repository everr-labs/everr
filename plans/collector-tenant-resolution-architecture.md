# Collector Tenant Resolution Architecture Plan

## Summary
The current approach (GitHub receiver directly querying Postgres) is workable for a private distribution, but it is not the most idiomatic OpenTelemetry Collector architecture.

Recommended target architecture:
- Receiver remains ingestion/parsing focused.
- Tenant enrichment moves to a dedicated processor.
- DB/caching/lifecycle is owned by an extension.

This keeps component responsibilities clean and aligns better with Collector design patterns.

---

## Current State

### What exists today
- `githubactionsreceiver` extracts `installation_id` from webhook payloads.
- Receiver resolves `installation_id -> tenant_id` via Postgres lookup.
- Receiver writes `everr.tenant.id` onto resource attributes before export.

### Technical implications
- Receiver has infrastructure coupling (Postgres DSN, cache behavior, connectivity).
- Receiver startup/runtime behavior depends on external DB availability.
- Tenant resolution logic is tightly bound to one signal source.

---

## Why this is less idiomatic in OTel Collector terms

1. Responsibility mixing
- Receiver is expected to ingest protocol payloads and convert to pdata.
- External business lookup + caching is enrichment/business logic, typically processor territory.

2. Reduced reusability
- Any future source requiring tenant attribution cannot reuse logic without copying receiver internals.

3. Harder lifecycle management
- DB pools, cache invalidation, health concerns are better centralized in an extension.

4. Tougher observability boundaries
- It is cleaner to monitor enrichment latency/errors separately from ingress parsing.

---

## Recommended Target Design

## 1) Receiver (`githubactionsreceiver`)
Receiver responsibilities:
- Validate webhook signature.
- Parse GitHub payloads.
- Emit telemetry with stable source identifiers only.

Receiver output attributes should include:
- `everr.github.installation_id` (required)
- Existing GitHub workflow/run/job attributes

Receiver should not:
- open DB connections
- resolve tenant mappings
- cache tenant mappings

## 2) Processor (`tenantenricherprocessor`)
Processor responsibilities:
- Read `everr.github.installation_id` from resource attrs.
- Resolve `tenant_id` via resolver service.
- Write `everr.tenant.id` resource attribute.
- Enforce fail-closed behavior by default.

Suggested processor config:
```yaml
tenantenricher:
  resolver: tenantresolver
  source_attribute: everr.github.installation_id
  target_attribute: everr.tenant.id
  on_missing_source: error      # error | passthrough | drop
  on_resolve_error: error       # error | passthrough | drop
  cache_ttl: 10s                # optional processor-local cache
```

## 3) Extension (`tenantresolverextension`)
Extension responsibilities:
- Own Postgres pool configuration.
- Perform lookup query.
- Optionally maintain shared cache.
- Expose health/readiness/metrics.

Suggested extension config:
```yaml
extensions:
  tenantresolver:
    postgres_dsn: postgresql://...
    schema: public
    table: github_installation_tenants
    cache:
      enabled: true
      ttl: 10s
      max_entries: 100000
    startup_ping:
      enabled: true
      timeout: 3s
```

Processor references extension by name.

---

## Data Flow (Target)

1. Webhook arrives at `githubactionsreceiver`.
2. Receiver emits pdata with `everr.github.installation_id`.
3. `tenantenricherprocessor` resolves tenant via `tenantresolverextension`.
4. Processor writes `everr.tenant.id`.
5. Exporters (ClickHouse/etc.) consume only enriched records.

---

## Behavior and Policy Decisions

## Fail-closed vs fail-open
Recommendation: fail-closed for production security isolation.
- Missing/invalid mapping => drop/error record.
- No tenant ID should reach storage for multitenant datasets.

Optional escape hatch for local/dev:
- `on_resolve_error: passthrough` with explicit warning logs.

## Cache consistency
- Keep short TTL (5-10s) unless explicit invalidation is available.
- If installation relink/unlink events are available, invalidate keys immediately.
- Installation lifecycle persistence policy: keep mapping row history and update an `installation_status` flag on uninstall/suspend instead of deleting records; resolver only returns tenant for `active` status.

## Query qualification
- Use fully-qualified table name (`schema.table`) in resolver to avoid `search_path` drift.

---

## Migration Plan

## Phase 0: Stabilize current receiver path (short term)
- Add startup DB ping and schema-qualified lookup.
- Tighten cache TTL and document consistency window.

## Phase 1: Add source attribute in receiver
- Ensure receiver always emits `everr.github.installation_id`.
- Keep existing direct tenant attribution temporarily for backward compatibility.

## Phase 2: Introduce extension + processor
- Implement `tenantresolverextension`.
- Implement `tenantenricherprocessor`.
- Wire pipeline in parallel in staging.

## Phase 3: Cut over
- Disable receiver-side tenant resolution.
- Enforce processor-based enrichment only.
- Remove Postgres config from receiver.

## Phase 4: Cleanup
- Delete receiver DB/cache code paths.
- Update docs/config examples.
- Add runbooks for resolver health and mapping incidents.

---

## Compatibility and Rollout Strategy

1. Backward compatibility period
- Support both modes via feature flag:
  - `receiver_tenant_resolution_enabled` (default true during transition)
  - `processor_tenant_enrichment_enabled` (false -> true in rollout)

2. Staged rollout
- Dev -> staging -> canary prod -> full prod.
- Compare attribution parity between old and new paths.

3. Safe rollback
- Keep receiver path available until parity SLO is met.

---

## Testing Plan

## Unit tests
- Processor handles missing source attr per policy.
- Processor sets `everr.tenant.id` on success.
- Resolver handles no rows, db errors, timeouts.
- Cache behavior (hit/miss/expiry/invalidate).

## Integration tests
- End-to-end with test Postgres and synthetic webhook payload.
- Relink/unlink scenario validates no cross-tenant attribution.
- Uninstall/suspend/unsuspend scenario validates status transitions without row deletion.

## Load tests
- High webhook throughput with realistic cache hit rates.
- Validate resolver latency and failure behavior.

---

## Observability Requirements

Expose metrics on processor/extension:
- `tenant_resolution_requests_total`
- `tenant_resolution_hits_total`
- `tenant_resolution_misses_total`
- `tenant_resolution_errors_total`
- `tenant_resolution_latency_ms`
- `tenant_cache_hit_ratio`

Log fields:
- `installation_id`
- `tenant_id` (when resolved)
- resolver error class
- policy action taken (`error/drop/passthrough`)

---

## Risks and Mitigations

1. Increased complexity (new components)
- Mitigation: phased rollout and temporary dual-path.

2. Attribution drift during migration
- Mitigation: parity checks and canary gates.

3. Resolver outage causing data drop (fail-closed)
- Mitigation: strong alerting, short MTTR runbook, optional bounded queue.

---

## Acceptance Criteria

1. Receiver no longer requires Postgres configuration.
2. Tenant attribution is produced by processor using extension.
3. Fail-closed behavior is configurable and default in production.
4. Mapping changes propagate within documented bound (or immediate with invalidation).
5. Observability metrics and alerts are in place for resolver health.
6. Existing dashboards/queries continue to work with `everr.tenant.id` unchanged.

---

## Recommendation
Proceed with extension + processor split. Keep current receiver implementation only as an interim step while migration is executed in phases.
