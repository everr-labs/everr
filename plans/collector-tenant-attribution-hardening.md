# Collector Tenant Attribution Hardening Plan

## Context
The current collector tenant attribution path is functionally correct and fail-closed, but it has three hardening gaps that can cause misattribution windows or operational instability.

## Findings

### P1: Cached installation mapping can misattribute after mapping changes
- Location: `collector/receiver/githubactionsreceiver/tenant_resolver.go`
- Current behavior: installation -> tenant mapping is cached by `cache_ttl` with no explicit invalidation.
- Risk: after relink/unlink/relink, events may be attributed to the old tenant until cache expiry.

### P2: Tenant lookup relies on Postgres `search_path`
- Location: `collector/receiver/githubactionsreceiver/tenant_resolver.go`
- Current behavior: query uses unqualified table name `github_installation_tenants`.
- Risk: non-default `search_path` can break attribution and produce 500 responses.

### P3: DB connectivity issues are discovered only on first webhook
- Location: `collector/receiver/githubactionsreceiver/tenant_resolver.go`
- Current behavior: `sql.Open` is used without startup ping.
- Risk: DSN/network problems surface only under live webhook traffic.

## Plan

1. Add deterministic cache invalidation strategy (P1)
- Option A: reduce resolver cache TTL to very small default (5-10s).
- Option B (preferred): add explicit invalidation hook for installation lifecycle changes.
- Decide and document expected consistency window.

2. Qualify DB table with schema (P2)
- Update query to `public.github_installation_tenants` or make schema configurable.
- Add unit test coverage for query string or integration test with custom search path.

3. Fail fast on startup DB connectivity (P3)
- After creating DB handle, call `PingContext` with timeout.
- Bubble startup failure so collector does not accept webhooks in broken state.
- Add test coverage around initialization error path.

4. Validate behavior under relink/unlink scenarios
- Add tests for mapping change propagation and expected consistency window.
- Ensure no cross-tenant attribution in transition cases.

## Acceptance Criteria
- Mapping changes do not remain stale beyond an explicit, documented bound.
- Attribution query is independent of runtime `search_path` defaults.
- Invalid Postgres DSN/connectivity fails receiver initialization before traffic.
- New tests cover cache/invalidation, qualified query behavior, and startup ping failure.
