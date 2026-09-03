# ClickHouse Direct Ingest Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The collector writes telemetry straight into the `app.*` tables, stamped with tenant and retention resolved at authentication, so the `otel.*` landing tables, the materialized views, the retention dictionary and everything that keeps the dictionary correct disappear.

**Architecture:** The app already tells the collector which tenant an API key belongs to (`/api/internal/verify-key`) and which tenant a forwarded GitHub webhook belongs to (`x-everr-tenant-id` header). Both paths now also carry the tenant's retention in days per signal. The collector stamps them as resource attributes (`everr.tenant.id`, `everr.retention.logs_days`, `everr.retention.traces_days`, `everr.retention.metrics_days`) and the upstream ClickHouse exporter writes into `app.*`. On each `app.*` table, `tenant_id` and `retention_days` become `DEFAULT` columns computed from `ResourceAttributes`, so the exporter's insert, which names only its own columns, fills them. The partition key `(day, retention_days)`, the TTL, the codecs and the indexes from PR #426 stay exactly as they are. The retention attributes stay in the stored `ResourceAttributes` map; this was weighed against stripping them through a `Null` landing table and a view, and the simpler design won.

**Tech Stack:** ClickHouse 26.2 (dev image, `clickhouse/Dockerfile`), OpenTelemetry Collector 0.152.0 built with `ocb` from `collector/config/manifest.yaml`, Go extension `collector/extension/everrapikeyauth`, upstream `clickhouseexporter` v0.152.0, TanStack Start app in `packages/app` (vitest, biome, tsc).

**Spec:** This plan is the spec. Background: `docs/clickhouse-retention-rollout.md` (the stamped-retention model whose write path this replaces) and the discussion in PR #426.

## Global Constraints

- Never mention Claude, Anthropic or AI assistance in commits, PR text or code comments.
- Docs and comments use ASD-STE100 Simplified Technical English. No em dashes or en dashes anywhere in docs.
- Custom attributes carry the `everr.` prefix. Standard OTel semconv names stay unprefixed.
- Do not add `tenant_id = toUInt64(getSetting('SQL_everr_tenant_id'))` to any query; row policies handle it.
- Do not generate drizzle migrations. This plan touches no Postgres schema.
- Never run docker test suites or `cargo test --workspace` locally. Per-package unit tests only.
- Use `everr-dev` for CLI commands in this workspace.
- Commit after every task. Plain commits on the feature branch, no attribution footers.
- Branch: `gio/direct-ingest`, created from `ttl-improvements` (PR #426) once it has merged, or stacked on it if not.

## Why DEFAULT and not MATERIALIZED

The production cut-over has two writers into `app.*` for a short window: the old materialized views, which insert `tenant_id` and `retention_days` explicitly, and the exporter, which omits them. A `MATERIALIZED` column rejects explicit inserts (`Cannot insert column ..., because it is MATERIALIZED column`). A `DEFAULT` column accepts an explicit value and computes its expression when the column is omitted, so both writers work on the same table and the cut-over needs no rebuild. Verified on the pinned image. The final state keeps `DEFAULT`.

## Why the retention DEFAULT throws on a missing attribute, and how

`retention_days = 0` means `day + 0` is already past, so the row is expired at insert with no error anywhere (PR #426, finding 1). After this plan the only writer is our own collector, so a missing attribute is a collector misconfiguration, not user input. The `DEFAULT` expression is evaluated for every exporter row anyway; the guard adds one string comparison. It turns silent data loss into a failed insert the exporter retries and logs.

The form matters, verified on the pinned image: `if(cond, throwIf(true, 'msg'), value)` throws for every row because the constant `throwIf(true, ...)` is folded before short-circuit evaluation. The working form is:

```sql
toUInt16OrZero(ResourceAttributes['everr.retention.logs_days'])
  + throwIf(ResourceAttributes['everr.retention.logs_days'] = '', 'everr.retention.logs_days resource attribute missing')
```

`throwIf` returns 0 for rows that pass and only throws when its condition is true. Gio should confirm the guard; to remove it, delete the `+ throwIf(...)` term.

## Names used across tasks

| Where | Name | Value |
|---|---|---|
| verify-key JSON | `tenantId`, `keyId`, `logsDays`, `tracesDays`, `metricsDays` | numbers for the three `*Days` |
| collector auth data | `tenant_id`, `key_id`, `retention_logs_days`, `retention_traces_days`, `retention_metrics_days` | strings |
| webhook headers (app to collector) | `x-everr-tenant-id`, `x-everr-retention-logs-days`, `x-everr-retention-traces-days`, `x-everr-retention-metrics-days` | decimal strings |
| resource attributes (stored) | `everr.tenant.id`, `everr.retention.logs_days`, `everr.retention.traces_days`, `everr.retention.metrics_days` | strings |
| `app.*` columns | `tenant_id String`, `retention_days UInt16` | `DEFAULT` from the map |

---

### Task 1: App resolves a tenant's retention from its subscription

**Files:**
- Create: `packages/app/src/lib/retention.server.ts`
- Create: `packages/app/src/lib/retention.server.test.ts`
- Read for context: `packages/app/src/lib/retention.ts`, `packages/app/src/lib/billing-data.server.ts`

**Interfaces:**
- Consumes: `readOrgEntitlement(orgId: string): Promise<OrgEntitlement>` from `billing-data.server.ts`; `resolveRetention(tier: Tier): TenantRetention` from `retention.ts`.
- Produces: `retentionForOrg(orgId: string): Promise<TenantRetention>` where `TenantRetention = { tracesDays: number; logsDays: number; metricsDays: number }`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/app/src/lib/retention.server.test.ts
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/billing-data.server", () => ({
  readOrgEntitlement: vi.fn(),
}));

import { readOrgEntitlement } from "@/lib/billing-data.server";
import { resolveRetention } from "@/lib/retention";
import { retentionForOrg } from "./retention.server";

describe("retentionForOrg", () => {
  it("returns the retention of the organization's tier", async () => {
    vi.mocked(readOrgEntitlement).mockResolvedValueOnce({
      tier: "pro",
      status: "active",
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
    });

    await expect(retentionForOrg("org_42")).resolves.toEqual(
      resolveRetention("pro"),
    );
    expect(readOrgEntitlement).toHaveBeenCalledWith("org_42");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd packages/app && pnpm exec vitest run src/lib/retention.server.test.ts`
Expected: FAIL, cannot resolve `./retention.server`.

- [ ] **Step 3: Write the implementation**

```ts
// packages/app/src/lib/retention.server.ts
import { readOrgEntitlement } from "@/lib/billing-data.server";
import { resolveRetention, type TenantRetention } from "@/lib/retention";

// Retention is stamped on telemetry by the collector at ingestion, from the
// values this returns. Callers: the API key verify endpoint, the GitHub
// webhook forwarder, and alert history inserts.
export async function retentionForOrg(
  orgId: string,
): Promise<TenantRetention> {
  const { tier } = await readOrgEntitlement(orgId);
  return resolveRetention(tier);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd packages/app && pnpm exec vitest run src/lib/retention.server.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/lib/retention.server.ts packages/app/src/lib/retention.server.test.ts
git commit -m "feat(app): resolve a tenant's retention from its subscription"
```

---

### Task 2: verify-key returns the tenant's retention

**Files:**
- Modify: `packages/app/src/routes/api/internal/verify-key.ts`
- Modify: `packages/app/src/routes/api/internal/verify-key.test.ts`

**Interfaces:**
- Consumes: `retentionForOrg(orgId)` from Task 1.
- Produces: JSON `{ tenantId, keyId, logsDays, tracesDays, metricsDays }` on 200. The Go extension in Task 5 decodes exactly these field names.

- [ ] **Step 1: Add the mock and extend the existing success test**

In `verify-key.test.ts`, next to the existing `vi.mock("@/lib/auth.server", ...)`:

```ts
vi.mock("@/lib/retention.server", () => ({
  retentionForOrg: vi.fn(),
}));
```

Replace the `beforeEach`:

```ts
beforeEach(async () => {
  vi.clearAllMocks();
  const { retentionForOrg } = await import("@/lib/retention.server");
  vi.mocked(retentionForOrg).mockResolvedValue({
    logsDays: 30,
    tracesDays: 30,
    metricsDays: 395,
  });
});
```

Change the assertion in `returns 200 with tenantId for a valid ingest key` to:

```ts
    expect(await res.json()).toEqual({
      tenantId: "org_42",
      keyId: "ak_3",
      logsDays: 30,
      tracesDays: 30,
      metricsDays: 395,
    });
    const { retentionForOrg } = await import("@/lib/retention.server");
    expect(retentionForOrg).toHaveBeenCalledWith("org_42");
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd packages/app && pnpm exec vitest run src/routes/api/internal/verify-key.test.ts`
Expected: FAIL on the success test, the response lacks the three `*Days` fields.

- [ ] **Step 3: Return retention from the handler**

In `verify-key.ts`, add the import:

```ts
import { retentionForOrg } from "@/lib/retention.server";
```

Change the response type and the payload:

```ts
type VerifyKeyResponse = {
  tenantId: string;
  keyId: string;
  // Retention in days per signal. The collector stamps these on every
  // resource it ingests with this key, and the app.* tables partition and
  // expire by them, so this is the only place retention enters the pipeline.
  logsDays: number;
  tracesDays: number;
  metricsDays: number;
};
```

```ts
        const retention = await retentionForOrg(result.key.referenceId);
        const payload: VerifyKeyResponse = {
          tenantId: result.key.referenceId,
          keyId: result.key.id,
          logsDays: retention.logsDays,
          tracesDays: retention.tracesDays,
          metricsDays: retention.metricsDays,
        };
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd packages/app && pnpm exec vitest run src/routes/api/internal/verify-key.test.ts`
Expected: PASS, all tests.

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/routes/api/internal/verify-key.ts packages/app/src/routes/api/internal/verify-key.test.ts
git commit -m "feat(app): return the tenant's retention from verify-key"
```

---

### Task 3: Forwarded GitHub webhooks carry retention headers

**Files:**
- Modify: `packages/app/src/server/github-events/collector.ts`
- Create: `packages/app/src/server/github-events/collector.test.ts`

**Interfaces:**
- Consumes: `retentionForOrg(orgId)` from Task 1.
- Produces: the request to `INGRESS_COLLECTOR_URL` carries `x-everr-retention-logs-days`, `x-everr-retention-traces-days`, `x-everr-retention-metrics-days` as decimal strings next to `x-everr-tenant-id`. The collector config in Task 6 reads them.

- [ ] **Step 1: Write the failing test**

```ts
// packages/app/src/server/github-events/collector.test.ts
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/env", () => ({
  env: { INGRESS_COLLECTOR_URL: "http://collector.test/webhook/github" },
}));
vi.mock("@/lib/retention.server", () => ({
  retentionForOrg: vi.fn(),
}));

import { retentionForOrg } from "@/lib/retention.server";
import { replayWebhookToCollector } from "./collector";

describe("replayWebhookToCollector", () => {
  afterEach(() => vi.restoreAllMocks());

  it("sends tenant and retention headers to the collector", async () => {
    vi.mocked(retentionForOrg).mockResolvedValueOnce({
      logsDays: 14,
      tracesDays: 14,
      metricsDays: 14,
    });
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(null, { status: 204 }));

    await replayWebhookToCollector(
      { headers: { "x-github-event": "push" }, body: Buffer.from("{}") },
      "org_7",
    );

    const [, init] = fetchMock.mock.calls[0];
    const headers = init?.headers as Headers;
    expect(headers.get("x-everr-tenant-id")).toBe("org_7");
    expect(headers.get("x-everr-retention-logs-days")).toBe("14");
    expect(headers.get("x-everr-retention-traces-days")).toBe("14");
    expect(headers.get("x-everr-retention-metrics-days")).toBe("14");
    expect(retentionForOrg).toHaveBeenCalledWith("org_7");
  });
});
```

If `WebhookHeaders` is not a plain record of strings, adapt the `headers` literal to the type in `./types` but keep the assertions.

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd packages/app && pnpm exec vitest run src/server/github-events/collector.test.ts`
Expected: FAIL, the retention headers are `null`.

- [ ] **Step 3: Set the headers**

In `collector.ts`, add the import and the header names:

```ts
import { retentionForOrg } from "@/lib/retention.server";

const tenantHeaderName = "x-everr-tenant-id";
// The collector's internal pipeline copies these into resource attributes
// (collector/config.example.yml, processor `resource`), and the app.* tables
// stamp retention_days from them.
const retentionHeaderNames = {
  logsDays: "x-everr-retention-logs-days",
  tracesDays: "x-everr-retention-traces-days",
  metricsDays: "x-everr-retention-metrics-days",
} as const;
```

After `headers.set(tenantHeaderName, organizationId);`:

```ts
  const retention = await retentionForOrg(organizationId);
  headers.set(retentionHeaderNames.logsDays, String(retention.logsDays));
  headers.set(retentionHeaderNames.tracesDays, String(retention.tracesDays));
  headers.set(retentionHeaderNames.metricsDays, String(retention.metricsDays));
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd packages/app && pnpm exec vitest run src/server/github-events/collector.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/server/github-events/collector.ts packages/app/src/server/github-events/collector.test.ts
git commit -m "feat(app): forward retention headers with GitHub webhooks"
```

---

### Task 4: `app.*` tables own their schema and stamp from resource attributes

The `app.*` tables are currently created with `CREATE TABLE ... AS SELECT ... FROM otel.X WHERE 1 = 0` plus index and codec mirror blocks. They become explicit `CREATE TABLE` statements: the column list of the matching `otel.*` table from `clickhouse/init/03-create-otel-tables.sql` with its codecs, the same skip indexes, plus the two `DEFAULT` columns. The `otel.*` tables, the materialized views, the dictionary and its source table go away. `app.alert_events` loses its dictionary `DEFAULT`; the app writes `retention_days` explicitly (Task 8).

**Files:**
- Create: `clickhouse/init/10-create-tables.sql` (replaces `10-create-mvs.sql`)
- Delete: `clickhouse/init/03-create-otel-tables.sql`, `clickhouse/init/10-create-mvs.sql`, `clickhouse/config.d/dictionaries.xml`
- Modify: `clickhouse/init/12-create-alert-events.sql`, `clickhouse/init/00-setup.sh`, `clickhouse/Dockerfile`

**Interfaces:**
- Produces: tables `app.traces`, `app.logs`, `app.metrics_gauge`, `app.metrics_sum`, `app.metrics_histogram`, `app.metrics_exponential_histogram`, `app.metrics_summary` with exporter-compatible column lists and the `DEFAULT` columns below. The exporter config in Task 6 points at these names.

- [ ] **Step 1: Write `10-create-tables.sql`**

For each of the seven tables, take the `CREATE TABLE otel.X (...)` block from `03-create-otel-tables.sql` verbatim (columns, codecs, `INDEX` lines) and produce:

```sql
CREATE TABLE IF NOT EXISTS app.logs
(
    -- every column of otel.otel_logs, with its CODEC, copied verbatim, then:
    -- Stamped by the collector on every resource; see docs/clickhouse-retention-rollout.md.
    tenant_id String DEFAULT ResourceAttributes['everr.tenant.id'] CODEC(ZSTD(1)),
    -- A missing attribute would stamp 0 and expire the row at insert with no
    -- error, so refuse the row instead; the exporter retries and logs it.
    -- Keep this form: if(x = '', throwIf(true, ...), ...) is constant-folded
    -- and throws for every row.
    retention_days UInt16 DEFAULT toUInt16OrZero(ResourceAttributes['everr.retention.logs_days'])
        + throwIf(ResourceAttributes['everr.retention.logs_days'] = '', 'everr.retention.logs_days resource attribute missing'),
    -- every INDEX line of otel.otel_logs, copied verbatim
)
ENGINE = MergeTree
PARTITION BY (toDate(TimestampTime), retention_days)
ORDER BY (tenant_id, ServiceName, TimestampTime, Timestamp)
TTL toDate(TimestampTime) + toIntervalDay(retention_days)
SETTINGS index_granularity = 8192, ttl_only_drop_parts = 1;
```

Per table use these keys, taken from the current `10-create-mvs.sql`:

| table | attribute for `retention_days` | PARTITION BY | ORDER BY | TTL |
|---|---|---|---|---|
| traces | `everr.retention.traces_days` | `(toDate(Timestamp), retention_days)` | `(tenant_id, ServiceName, SpanName, toDateTime(Timestamp))` | `toDate(Timestamp) + toIntervalDay(retention_days)` |
| logs | `everr.retention.logs_days` | `(toDate(TimestampTime), retention_days)` | `(tenant_id, ServiceName, TimestampTime, Timestamp)` | `toDate(TimestampTime) + toIntervalDay(retention_days)` |
| metrics_gauge, metrics_sum, metrics_histogram, metrics_exponential_histogram, metrics_summary | `everr.retention.metrics_days` | `(toDate(TimeUnix), retention_days)` | `(tenant_id, ServiceName, MetricName, Attributes, toUnixTimestamp64Nano(TimeUnix))` | `toDate(TimeUnix) + toIntervalDay(retention_days)` |

`otel_logs.TimestampTime` is `DateTime DEFAULT toDateTime(Timestamp) CODEC(Delta(4), ZSTD(1))`; keep it exactly so, the exporter omits it and the default fills it.

The file header comment:

```sql
-- The collector's ClickHouse exporter writes straight into these tables.
-- tenant_id and retention_days are DEFAULT columns computed from the resource
-- attributes the collector stamps at authentication, so the exporter's insert,
-- which names only its own columns, fills them. The tables partition by
-- (day, retention_days) and expire by whole-part drop; every row in a
-- partition expires on the same day, so nothing is ever rewritten to expire a
-- tenant. A retention change applies to rows ingested from that point on.
-- RETENTION_BY_TIER (packages/app/src/lib/retention.ts) is the only source of
-- retention values.
--
-- Column lists and codecs follow the upstream clickhouseexporter schema for
-- v0.152.0. When the exporter version changes, diff its DDL against this file.
```

If the guard decision is reversed, the `retention_days` line becomes `retention_days UInt16 DEFAULT toUInt16OrZero(ResourceAttributes['everr.retention.logs_days'])` and nothing else changes.

- [ ] **Step 2: Update `12-create-alert-events.sql`**

Replace the `retention_days` line with a plain column, the app supplies it:

```sql
  -- Written by the app from the tenant's plan (packages/app/src/lib/retention.server.ts).
  retention_days UInt16,
```

Remove `GRANT dictGet ON app.tenant_retention TO web_app_admin;`. Keep `app.alert_events_logs_mv` unchanged; it supplies `tenant_id` and `retention_days` explicitly, which a `DEFAULT` column accepts.

- [ ] **Step 3: Update grants in `00-setup.sh`**

Replace `GRANT SELECT, INSERT, CREATE TABLE, ALTER TABLE ON otel.* TO collector_rw;` with:

```sql
-- The exporter writes into app.* and reads system tables for its version and
-- schema checks; it never creates or alters tables (create_schema: false).
GRANT SELECT, INSERT ON app.* TO collector_rw;
```

Delete the retention-source grant block (`GRANT INSERT, SELECT ON app.tenant_retention_source TO web_app_admin;` and its comment) and the `GRANT dictGet ON app.tenant_retention TO collector_rw;` block with its comment. Remove `CREATE DATABASE IF NOT EXISTS otel` if present in the script.

- [ ] **Step 4: Remove the dictionary config and the deleted files**

```bash
git rm clickhouse/init/03-create-otel-tables.sql clickhouse/init/10-create-mvs.sql clickhouse/config.d/dictionaries.xml
```

In `clickhouse/Dockerfile`, remove the line `COPY config.d/ /etc/clickhouse-server/config.d/` and delete the now-empty `clickhouse/config.d` directory.

- [ ] **Step 5: Verify on a throwaway container**

```bash
docker build -q -t ch-di ./clickhouse
docker rm -f ch-di-test 2>/dev/null
docker run -d --name ch-di-test -e CLICKHOUSE_USER=default -e CLICKHOUSE_PASSWORD=everr \
  -e CLICKHOUSE_DEFAULT_ACCESS_MANAGEMENT=1 -e COLLECTOR_RW_PASSWORD=collector-dev \
  -e APP_RO_PASSWORD=app-dev -e WEB_APP_ADMIN_PASSWORD=web-app-admin-dev ch-di
sleep 20
docker logs ch-di-test 2>&1 | grep -i exception   # expect nothing
docker exec ch-di-test clickhouse-client --password everr --multiquery --query "
-- exporter-shaped insert: no tenant_id, no retention_days
INSERT INTO app.logs (Timestamp, ResourceAttributes, Body)
  VALUES (now64(9), map('everr.tenant.id','org1','everr.retention.logs_days','30'), 'x');
SELECT tenant_id, retention_days, TimestampTime FROM app.logs;
SELECT partition FROM system.parts WHERE database='app' AND table='logs' AND active;
-- explicit insert (the alert_events projection path) still works on a DEFAULT column
INSERT INTO app.logs (Timestamp, ResourceAttributes, Body, tenant_id, retention_days)
  VALUES (now64(9), map(), 'y', 'org2', 14);
SELECT count() FROM app.logs;
-- a row without the retention attribute is refused, not silently expired
INSERT INTO app.logs (Timestamp, ResourceAttributes, Body) VALUES (now64(9), map('everr.tenant.id','org1'), 'z');"
```

Expected: `org1  30  <now>`; partition `('<today>',30)`; count `2`; the last insert fails with `everr.retention.logs_days resource attribute missing`. Repeat the first insert shape for `app.traces` (`Timestamp, ResourceAttributes, SpanName`, attribute `everr.retention.traces_days`) and `app.metrics_gauge` (`TimeUnix, ResourceAttributes, MetricName`, attribute `everr.retention.metrics_days`). Then:

```bash
docker exec ch-di-test clickhouse-client --password everr --query "SHOW GRANTS FOR collector_rw"
docker rm -f ch-di-test; docker rmi ch-di
```

Expected: `GRANT SELECT, INSERT ON app.* TO collector_rw` and nothing on `otel`.

- [ ] **Step 6: Commit**

```bash
git add clickhouse
git commit -m "feat(clickhouse): app tables own their schema and stamp tenant and retention from resource attributes"
```

---

### Task 5: Auth extension exposes retention to processors

**Files:**
- Modify: `collector/extension/everrapikeyauth/extension.go`
- Modify: `collector/extension/everrapikeyauth/cache.go`
- Modify: `collector/extension/everrapikeyauth/authenticator.go`
- Modify: `collector/extension/everrapikeyauth/authenticator_test.go`

**Interfaces:**
- Consumes: verify-key JSON from Task 2.
- Produces: `client.Info.Auth` attributes `retention_logs_days`, `retention_traces_days`, `retention_metrics_days` as decimal strings, next to `tenant_id` and `key_id`. Task 6 reads them with `from_context: auth.retention_logs_days` and friends.

- [ ] **Step 1: Write the failing tests**

Add to `authenticator_test.go`:

```go
func TestAuthenticate_Success_StampsRetention(t *testing.T) {
	srv := fakeVerifyServer(t, func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(verifyResponse{
			TenantID: "org_42", KeyID: "ak_1",
			LogsDays: 30, TracesDays: 30, MetricsDays: 395,
		})
	})
	defer srv.Close()
	e := newTestExt(t, srv.URL)

	ctx, err := e.Authenticate(context.Background(), authHeaders("good"))
	if err != nil {
		t.Fatal(err)
	}
	cl := client.FromContext(ctx)
	for name, want := range map[string]string{
		"retention_logs_days":    "30",
		"retention_traces_days":  "30",
		"retention_metrics_days": "395",
	} {
		if got := cl.Auth.GetAttribute(name); got != want {
			t.Errorf("%s: got %v want %s", name, got, want)
		}
	}
	if names := cl.Auth.GetAttributeNames(); len(names) != 5 {
		t.Errorf("attribute names: got %v", names)
	}
}

func TestAuthenticate_RejectsResponseWithoutRetention(t *testing.T) {
	srv := fakeVerifyServer(t, func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(verifyResponse{TenantID: "org_42", KeyID: "ak_1"})
	})
	defer srv.Close()
	e := newTestExt(t, srv.URL)

	if _, err := e.Authenticate(context.Background(), authHeaders("good")); err == nil {
		t.Fatal("expected error: a verify response without retention must not authenticate")
	}
}
```

The second test is the fail-closed rule: a row can only exist with a stamp, so an app that does not return retention (an old deploy) must not be allowed to ingest.

Update `TestAuthenticate_Success_StampsAuthData` and every other test that encodes a `verifyResponse` so they include `LogsDays: 14, TracesDays: 14, MetricsDays: 14`, otherwise they now fail closed.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd collector/extension/everrapikeyauth && go test ./...`
Expected: compile error, `verifyResponse` has no field `LogsDays`.

- [ ] **Step 3: Carry retention through response, result and auth data**

`extension.go`, the response struct:

```go
// verifyResponse mirrors VerifyKeyResponse on the app side.
type verifyResponse struct {
	TenantID    string `json:"tenantId"`
	KeyID       string `json:"keyId"`
	LogsDays    uint16 `json:"logsDays"`
	TracesDays  uint16 `json:"tracesDays"`
	MetricsDays uint16 `json:"metricsDays"`
}
```

`extension.go`, in `verify`, the `http.StatusOK` case after decoding:

```go
		if vr.LogsDays == 0 || vr.TracesDays == 0 || vr.MetricsDays == 0 {
			// A zero retention would expire rows at insert. Refuse to
			// authenticate rather than stamp it.
			return nil, fmt.Errorf("verify response missing retention for tenant %s", vr.TenantID)
		}
		return &authResult{
			tenantID: vr.TenantID, keyID: vr.KeyID,
			logsDays: vr.LogsDays, tracesDays: vr.TracesDays, metricsDays: vr.MetricsDays,
		}, nil
```

`extension.go`, in `Authenticate`:

```go
	cl.Auth = authData{
		tenantID: res.tenantID, keyID: res.keyID,
		logsDays: res.logsDays, tracesDays: res.tracesDays, metricsDays: res.metricsDays,
	}
```

`cache.go`:

```go
// authResult is what the verify endpoint tells us.
type authResult struct {
	tenantID    string
	keyID       string
	logsDays    uint16
	tracesDays  uint16
	metricsDays uint16
}
```

`authenticator.go`:

```go
package everrapikeyauth

import "strconv"

// authData implements client.AuthData. It exposes tenant, key and retention
// so processors (resourceprocessor with `from_context: auth.<name>`) can stamp
// them onto telemetry. Values are strings because resource attributes read
// from context are strings.
type authData struct {
	tenantID    string
	keyID       string
	logsDays    uint16
	tracesDays  uint16
	metricsDays uint16
}

const (
	attrTenantID    = "tenant_id"
	attrKeyID       = "key_id"
	attrLogsDays    = "retention_logs_days"
	attrTracesDays  = "retention_traces_days"
	attrMetricsDays = "retention_metrics_days"
)

func (a authData) GetAttribute(name string) any {
	switch name {
	case attrTenantID:
		return a.tenantID
	case attrKeyID:
		return a.keyID
	case attrLogsDays:
		return strconv.FormatUint(uint64(a.logsDays), 10)
	case attrTracesDays:
		return strconv.FormatUint(uint64(a.tracesDays), 10)
	case attrMetricsDays:
		return strconv.FormatUint(uint64(a.metricsDays), 10)
	default:
		return nil
	}
}

func (a authData) GetAttributeNames() []string {
	return []string{attrTenantID, attrKeyID, attrLogsDays, attrTracesDays, attrMetricsDays}
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd collector/extension/everrapikeyauth && go test ./... && go vet ./...`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add collector/extension/everrapikeyauth
git commit -m "feat(collector): expose the tenant's retention from the API key authenticator"
```

---

### Task 6: Collector config writes into `app.*` with retention stamped

**Files:**
- Modify: `collector/config.example.yml`
- Read: `collector/extension/everrapikeyauth/SMOKE.md` (the smoke flow to rerun in Task 9)

**Interfaces:**
- Consumes: auth attributes from Task 5, webhook headers from Task 3, tables from Task 4.
- Produces: resource attributes `everr.retention.logs_days`, `everr.retention.traces_days`, `everr.retention.metrics_days` on every resource; exporter targets `app.logs`, `app.traces`, `app.metrics_*`.

- [ ] **Step 1: Internal pipeline processor**

Replace the `resource:` processor block:

```yaml
  # Internal pipeline (github webhook): tenant and retention come from trusted
  # headers the app sets when it forwards the webhook
  # (packages/app/src/server/github-events/collector.ts).
  resource:
    attributes:
      - action: upsert
        key: everr.tenant.id
        from_context: metadata.x-everr-tenant-id
      - action: convert
        key: everr.tenant.id
        converted_type: int
      - action: upsert
        key: everr.retention.logs_days
        from_context: metadata.x-everr-retention-logs-days
      - action: upsert
        key: everr.retention.traces_days
        from_context: metadata.x-everr-retention-traces-days
      - action: upsert
        key: everr.retention.metrics_days
        from_context: metadata.x-everr-retention-metrics-days
```

Leave the existing `convert ... int` step as is unless the smoke test in Task 9 shows `tenant_id` stored differently from the public pipeline; `tenant_id` is a `String` column and the map value is read as text either way.

- [ ] **Step 2: Public pipeline processors**

Extend `attributes/strip_user_tenant` so clients cannot smuggle retention on records:

```yaml
  attributes/strip_user_tenant:
    actions:
      - action: delete
        key: everr.tenant.id
      - action: delete
        key: everr.retention.logs_days
      - action: delete
        key: everr.retention.traces_days
      - action: delete
        key: everr.retention.metrics_days
```

Extend `resource/public_tenant`; `upsert` overwrites any client-supplied resource value:

```yaml
  resource/public_tenant:
    attributes:
      - action: upsert
        key: everr.tenant.id
        from_context: auth.tenant_id
      - action: upsert
        key: everr.retention.logs_days
        from_context: auth.retention_logs_days
      - action: upsert
        key: everr.retention.traces_days
        from_context: auth.retention_traces_days
      - action: upsert
        key: everr.retention.metrics_days
        from_context: auth.retention_metrics_days
```

- [ ] **Step 3: Exporter**

```yaml
  clickhouse:
    endpoint: http://clickhouse:8123
    username: collector_rw
    password: collector-dev
    # Writes straight into the tenant-scoped read model. Schema is owned by
    # clickhouse/init/10-create-tables.sql; the exporter never creates it.
    database: app
    create_schema: false
    logs_table_name: logs
    traces_table_name: traces
    metrics_tables:
      gauge:
        name: metrics_gauge
      sum:
        name: metrics_sum
      summary:
        name: metrics_summary
      histogram:
        name: metrics_histogram
      exponential_histogram:
        name: metrics_exponential_histogram
```

Remove `ttl: 72h`; it only applies when the exporter creates the schema.

- [ ] **Step 4: Validate the config**

Run: `cd collector && make build && ./build/everr-collector validate --config=config.example.yml`
Expected: exits 0. If `validate` is not a subcommand in this build, run `./build/everr-collector --config=config.example.yml` for five seconds and confirm the log reaches `Everything is ready` before the ClickHouse connection error (no ClickHouse runs in this step).

- [ ] **Step 5: Commit**

```bash
git add collector/config.example.yml
git commit -m "feat(collector): write into app tables with tenant and retention stamped at auth"
```

---

### Task 7: Remove the dictionary write path from the app

**Files:**
- Modify: `packages/app/src/lib/clickhouse.ts` (delete `seedDefaultRetention`, `upsertTenantRetention`, the retention imports)
- Modify: `packages/app/src/lib/clickhouse.test.ts` (delete the `upsertTenantRetention` and `seedDefaultRetention` describes and their imports)
- Modify: `packages/app/src/lib/billing-data.server.ts` (delete the `upsertTenantRetention` call and import at the end of `upsertOrgSubscription`, and the read-back that only feeds it; check the two commits on `ttl-improvements` after `8b6c5df1b`, they touched this function)
- Modify: `packages/app/src/server.ts` (delete the `startup.retention_default` span block and the `seedDefaultRetention` import)
- Modify: `packages/app/src/lib/retention.ts` (delete `DEFAULT_RETENTION_TENANT_ID`; rewrite the comment above `RETENTION_BY_TIER`)

**Interfaces:**
- `resolveRetention` and `RETENTION_BY_TIER` stay; `retentionForOrg` from Task 1 is now their only consumer.

- [ ] **Step 1: Delete the code and tests**

Remove the items listed above. The new comment on `RETENTION_BY_TIER`:

```ts
// The only retention values that exist. retentionForOrg (retention.server.ts)
// hands them to the collector, which stamps them on every resource, and the
// app.* tables partition by (day, retention_days). A table holds one live
// partition per day per distinct value in its column below: 14 + 30 = 44 for
// logs and traces, 14 + 395 = 409 for each metrics table. A new tier or a new
// value adds its days to that budget; keep it under about 1,000 per table.
```

- [ ] **Step 2: Verify nothing references the removed symbols**

Run: `grep -rn 'upsertTenantRetention\|seedDefaultRetention\|DEFAULT_RETENTION_TENANT_ID\|tenant_retention' packages/app/src`
Expected: no output.

- [ ] **Step 3: Run the app checks**

Run: `cd packages/app && pnpm exec vitest run src/lib && pnpm exec tsc --noEmit -p . && pnpm exec biome check src`
Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add packages/app/src
git commit -m "refactor(app): drop the retention dictionary write path"
```

---

### Task 8: Alert events carry their retention

**Files:**
- Modify: `packages/app/src/server/alerts/03-events.ts`
- Modify or create: `packages/app/src/server/alerts/03-events.test.ts`

**Interfaces:**
- Consumes: `retentionForOrg(orgId)` from Task 1.
- Produces: every row inserted into `app.alert_events` has `retention_days: number` equal to the tenant's `logsDays`, matching what the old `DEFAULT` did.

- [ ] **Step 1: Write the failing test**

```ts
// packages/app/src/server/alerts/03-events.test.ts (add to the file if it exists)
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/clickhouse", () => ({ insertAdminRows: vi.fn() }));
vi.mock("@/lib/retention.server", () => ({ retentionForOrg: vi.fn() }));
vi.mock("@/telemetry/logger", () => ({
  serverLogger: { error: vi.fn() },
  exceptionAttributes: () => ({}),
}));

import { insertAdminRows } from "@/lib/clickhouse";
import { retentionForOrg } from "@/lib/retention.server";
import { recordAlertEvents } from "./03-events";

describe("recordAlertEvents", () => {
  it("stamps each row with the tenant's logs retention", async () => {
    vi.mocked(retentionForOrg).mockResolvedValue({
      logsDays: 30,
      tracesDays: 30,
      metricsDays: 395,
    });

    await recordAlertEvents(
      { id: "def_1" },
      [
        {
          tenant_id: "org_1",
          alert_definition_id: "def_1",
          repoid: "r",
          slug: "s",
          preview: "",
          event_type: "firing",
        },
      ],
      "alerts.test",
    );

    expect(retentionForOrg).toHaveBeenCalledWith("org_1");
    expect(insertAdminRows).toHaveBeenCalledWith(
      "app.alert_events",
      [expect.objectContaining({ tenant_id: "org_1", retention_days: 30 })],
      expect.anything(),
    );
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd packages/app && pnpm exec vitest run src/server/alerts/03-events.test.ts`
Expected: FAIL, `retention_days` missing from the inserted row.

- [ ] **Step 3: Stamp the rows**

In `03-events.ts`, add the import and change `insertAlertEvents`:

```ts
import { retentionForOrg } from "@/lib/retention.server";
```

```ts
// Alert history follows the tenant's logs retention, like its projection
// into app.logs. One lookup per distinct tenant in the batch.
async function insertAlertEvents(rows: AlertEventRow[]): Promise<void> {
  const tenants = [...new Set(rows.map((row) => row.tenant_id))];
  const retention = new Map(
    await Promise.all(
      tenants.map(
        async (tenantId) =>
          [tenantId, (await retentionForOrg(tenantId)).logsDays] as const,
      ),
    ),
  );
  const stamped = rows.map((row) => ({
    ...row,
    retention_days: retention.get(row.tenant_id),
  }));
  return insertAdminRows("app.alert_events", stamped, {
    async_insert: 1,
    wait_for_async_insert: 1,
    date_time_input_format: "best_effort",
  });
}
```

`AlertEventRow` stays as the caller-facing type; `retention_days` is added at insert time.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd packages/app && pnpm exec vitest run src/server/alerts && pnpm exec tsc --noEmit -p .`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/server/alerts
git commit -m "feat(app): stamp alert events with the tenant's retention"
```

---

### Task 9: End-to-end smoke on the dev stack

This step recreates the dev ClickHouse volume. Tell Gio before running it and skip it if the dev data must survive; Task 4 already verifies the schema on a throwaway container.

**Files:**
- Read: `collector/extension/everrapikeyauth/SMOKE.md`, `docker-compose.yaml`

- [ ] **Step 1: Rebuild ClickHouse and the collector**

```bash
docker compose stop collector clickhouse
mv volumes/clickhouse "volumes/clickhouse.pre-direct-ingest.$(date +%Y%m%d)"
docker compose build clickhouse collector
docker compose up -d clickhouse
docker compose logs clickhouse 2>&1 | grep -i exception   # expect nothing
docker compose up -d collector
```

- [ ] **Step 2: Start the app and ingest with a real key**

Start the app (`cd packages/app && pnpm dev`) and follow `SMOKE.md` steps 1 to 5 with `telemetrygen`. In step 5 also pass a spoofed retention on the client side:

```
--otlp-attributes 'everr.tenant.id="org_evil"' --otlp-attributes 'everr.retention.logs_days="3650"'
```

- [ ] **Step 3: Check the stamps**

```bash
docker exec everr-clickhouse-1 clickhouse-client --password everr --query "
SELECT tenant_id, retention_days, ResourceAttributes['everr.retention.logs_days'] AS attr, count()
FROM app.logs GROUP BY ALL FORMAT PrettyCompact"
```

Expected: one row, `tenant_id` is the key's organization, `retention_days` and `attr` are that organization's plan (14 for a free organization), not `org_evil` and not `3650`. Repeat for `app.traces` and `app.metrics_gauge` with the matching attribute names.

- [ ] **Step 4: Check the webhook path**

Trigger a GitHub Actions run on a connected repository (or replay a stored webhook through the app), then:

```bash
docker exec everr-clickhouse-1 clickhouse-client --password everr --query "
SELECT tenant_id, retention_days FROM app.traces WHERE ServiceName = 'github-actions' GROUP BY ALL"
```

Expected: the organization's id and plan retention.

- [ ] **Step 5: Confirm ingestion in Everr**

Run `everr-dev status` and open the logs explorer for the dev organization; the smoke rows are visible. Per the project rule, telemetry changes are verified through Everr, not only through SQL.

- [ ] **Step 6: Commit nothing; record the result in the PR description**

---

### Task 10: Documentation and the production cut-over

**Files:**
- Modify: `docs/clickhouse-retention-rollout.md`
- Modify: `packages/docs/content/docs/reference/retention.mdx`
- Create: `clickhouse/migrations/2026-09-03-direct-ingest.sh`; delete `clickhouse/migrations/2026-09-01-retention-days-partitions.sh` (PR #426's rebuild has run by then)

**Interfaces:**
- Produces: the ordered production procedure. Order: app deploy (Tasks 1, 2, 3, 7, 8), then `STEP=1`, then collector deploy (Tasks 5, 6), then `STEP=3`.

- [ ] **Step 1: Write the cut-over script**

```bash
#!/bin/bash
# Cut the collector over from otel.* + materialized views to direct ingest
# into app.*. Order matters:
#   1. tenant_id and retention_days become DEFAULT columns. Both writers work
#      after this: the views insert explicit values, the exporter omits them.
#   2. (outside this script) deploy the collector config that stamps
#      everr.retention.* and writes to app.*.
#   3. drop the views, the otel.* tables, the dictionary and its source.
# Run STEP=1, deploy the collector, confirm rows arrive with stamps, then run
# STEP=3. The app must already be deployed before STEP=1 (it writes
# alert_events.retention_days explicitly).
#
# Usage:
#   STEP=1 clickhouse/migrations/2026-09-03-direct-ingest.sh --host <h> --secure --user default --password '<pw>'
set -euo pipefail
cd "$(dirname "$0")/.."
client() { ${CLICKHOUSE_CLIENT:-clickhouse-client} "$@"; }
run_sql() { client "${CLIENT_ARGS[@]}" --multiquery --query "$1"; }
CLIENT_ARGS=("$@")

declare -A ATTR=(
  [traces]=everr.retention.traces_days [logs]=everr.retention.logs_days
  [metrics_gauge]=everr.retention.metrics_days [metrics_sum]=everr.retention.metrics_days
  [metrics_histogram]=everr.retention.metrics_days [metrics_exponential_histogram]=everr.retention.metrics_days
  [metrics_summary]=everr.retention.metrics_days
)

case "${STEP:?set STEP=1 or STEP=3}" in
1)
  for t in "${!ATTR[@]}"; do
    a=${ATTR[$t]}
    run_sql "ALTER TABLE app.${t}
      MODIFY COLUMN tenant_id String DEFAULT ResourceAttributes['everr.tenant.id'] CODEC(ZSTD(1)),
      MODIFY COLUMN retention_days UInt16 DEFAULT toUInt16OrZero(ResourceAttributes['${a}']) + throwIf(ResourceAttributes['${a}'] = '', '${a} resource attribute missing')"
  done
  run_sql "ALTER TABLE app.alert_events MODIFY COLUMN retention_days UInt16"
  run_sql "GRANT SELECT, INSERT ON app.* TO collector_rw"
  echo "step 1 done: deploy the collector config, confirm stamps, then run STEP=3"
  ;;
3)
  run_sql "SELECT throwIf(
    (SELECT count() FROM app.logs WHERE TimestampTime > now() - INTERVAL 10 MINUTE AND ResourceAttributes['everr.retention.logs_days'] = '') > 0,
    'rows without everr.retention.logs_days arrived in the last 10 minutes: the collector is not stamping yet')"
  for t in "${!ATTR[@]}"; do run_sql "DROP VIEW IF EXISTS app.${t}_mv"; done
  for t in "${!ATTR[@]}"; do run_sql "DROP TABLE IF EXISTS otel.otel_${t}"; done
  run_sql "DROP DICTIONARY IF EXISTS app.tenant_retention"
  run_sql "DROP TABLE IF EXISTS app.tenant_retention_source"
  run_sql "REVOKE ALL ON otel.* FROM collector_rw"
  run_sql "DROP DATABASE IF EXISTS otel"
  echo "step 3 done"
  run_sql "SELECT tenant_id, retention_days, count() FROM app.logs WHERE TimestampTime > now() - INTERVAL 5 MINUTE GROUP BY ALL FORMAT PrettyCompact"
  ;;
esac
```

`ALTER TABLE app.alert_events MODIFY COLUMN retention_days UInt16` drops the dictionary `DEFAULT`, which is why the app deploy comes before `STEP=1`. Rows the old views wrote between `STEP=1` and the collector deploy still carry no `everr.retention.*` attribute but have explicit stamps, so the guard in `STEP=3` looks only at the last ten minutes.

Test the script against a container built from the `ttl-improvements` branch (the pre-plan schema): run `STEP=1`, insert an exporter-shaped row (into `app.logs`, omitting the two columns) and a view-shaped row (into `otel.otel_logs`), run `STEP=3`, insert the exporter-shaped row again. All inserts succeed and are stamped; `otel` is gone.

- [ ] **Step 2: Update `docs/clickhouse-retention-rollout.md`**

Replace the "Where the numbers live", "Failure modes" and "Production rollout" sections. The facts to state:

- Retention is stamped by the collector from the plan the app returns at authentication (`verify-key`) or forwards as headers (GitHub webhooks). `RETENTION_BY_TIER` is the only source. There is no dictionary, no seed row, no reconciliation.
- The exporter writes into `app.*`; `tenant_id` and `retention_days` are `DEFAULT` columns from `ResourceAttributes`. The `everr.retention.*` attributes remain in the stored map.
- A plan change reaches new rows once the collector's auth cache expires: `cache_ttl` in the `everr_apikey` extension, 30 s by default. Webhooks read the plan on every forward.
- Failure modes: verify-key without retention fails authentication (fail closed); a resource without the attribute is refused by the table's `DEFAULT` and retried by the exporter; a stale auth cache carries the previous plan for at most `cache_ttl`.
- Production cut-over: the ordered steps above with the exact commands.
- `everr-deploy`: exporter config (`database: app`, table names, remove `ttl`), remove `app_ro_dictget_tenant_retention`, remove the dictionary and source table resources and their grants, `collector_rw` grant becomes `SELECT, INSERT ON app.*`, remove `dictionaries_lazy_load` if it was added.
- Keep "Parts per insert" and the measurements; add one sentence: the `otel.*` copy is gone, so every row is written and merged once.

- [ ] **Step 3: Update the public retention page**

In `retention.mdx`, "How we handle failures", replace the bullet about new organizations with: "Retention is looked up from your plan when the collector authenticates your API key, and cached for 30 seconds." Keep the rest; it already describes ingestion stopping rather than storing a wrong window.

- [ ] **Step 4: Scan for dashes and stale references**

```bash
grep -rnP '[\x{2013}\x{2014}]' docs/clickhouse-retention-rollout.md packages/docs/content/docs/reference/retention.mdx clickhouse
grep -rn 'tenant_retention\|dictGet\|otel\.otel_\|10-create-mvs\|dictionaries_lazy_load' clickhouse docs packages/app/src collector/config.example.yml
```

Expected: nothing from either.

- [ ] **Step 5: Commit**

```bash
git add docs clickhouse/migrations packages/docs
git commit -m "docs(clickhouse): direct ingest cut-over and retention flow"
```

---

### Task 11: Pull request

- [ ] **Step 1: Run every check once more**

```bash
cd packages/app && pnpm exec vitest run && pnpm exec tsc --noEmit -p . && pnpm exec biome check src
cd ../../collector/extension/everrapikeyauth && go test ./... && go vet ./...
```

- [ ] **Step 2: Open the PR**

Title: `feat(ingest): collector writes straight into app tables with retention stamped at auth`

Body sections: Why (double write, dictionary correctness, the `dictGet` returns 0 class of bugs), What (the names table from this plan, `DEFAULT` columns, fail-closed rules, the decision to keep the attributes in the stored map), Verified (Task 4 container output, Task 9 smoke results), Cut-over (the ordered steps and the everr-deploy changes), Follow-ups (read-side schema items from PR #426 remain). No attribution footers.

---

## Self-review notes

- Every writer into `app.*` after this plan supplies or derives `tenant_id` and `retention_days`: exporter (`DEFAULT` from attributes, Tasks 4 and 6), alert events (explicit, Task 8), alert projection view (explicit, unchanged).
- Every path that produces the attributes fails closed on a missing plan: `verify-key` cannot respond without `retentionForOrg` resolving; the extension rejects a response without retention (Task 5); the webhook forwarder awaits `retentionForOrg` before sending (Task 3); the table refuses a row without the attribute (Task 4).
- The `throwIf` constant-folding pitfall is encoded in the column comment and in the cut-over script so a future edit does not reintroduce it.
- Names are consistent across tasks: `retentionForOrg`, `logsDays`/`tracesDays`/`metricsDays` in JSON, `retention_*_days` in auth data, `x-everr-retention-*-days` headers, `everr.retention.*_days` attributes.
- The local collector (`collector/cmd/everr-local-collector`, chdb) has its own schema and pipeline and is not touched.
