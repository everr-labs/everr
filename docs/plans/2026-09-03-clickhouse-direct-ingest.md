# ClickHouse Direct Ingest Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Telemetry is written to disk once, into the `app.*` tables, stamped with tenant and retention resolved at authentication, so the stored `otel.*` copy, the retention dictionary and everything that keeps the dictionary correct disappear.

**Architecture:** The app already tells the collector which tenant an API key belongs to (`/api/internal/verify-key`) and which tenant a forwarded GitHub webhook belongs to (`x-everr-tenant-id` header). Both paths now also carry the tenant's retention in days per signal. The collector stamps them as resource attributes (`everr.tenant.id`, `everr.retention.logs_days`, `everr.retention.traces_days`, `everr.retention.metrics_days`). The upstream ClickHouse exporter keeps writing to `otel.*`, but those tables become `ENGINE = Null`: they store nothing and only trigger the materialized views. Each view reads the stamps from the resource attributes, strips the `everr.retention.*` keys from the stored map, and writes the row into `app.*`. The `app.*` tables keep their partition key `(day, retention_days)`, TTL, codecs and indexes from PR #426 unchanged.

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

## Why a Null landing table and a view, not DEFAULT columns on `app.*`

Two designs were measured on 600k exporter-shaped log rows, single thread, three rounds each. Direct insert into `app.*` with `tenant_id` and `retention_days` as `DEFAULT` columns took 0.41 to 0.81 s; the exporter writing to a `Null` table with a view stamping and stripping took 0.40 to 0.57 s. Same compressed size. The `Null` engine stores nothing, so the only disk write is `app.*` either way, and the view's expressions cost nothing measurable. The view wins on three points:

- It removes `everr.retention.*` from the stored `ResourceAttributes` with `mapFilter`, so retention never shows up in query results or the SQL API. `DEFAULT` columns cannot alter the map the exporter inserts.
- The exporter config keeps its default table names and database. Only processors change.
- The `app.*` tables do not change at all: same columns, same keys, same writers (view and alert projection both insert `tenant_id` and `retention_days` explicitly).

## Why the view throws on a missing retention attribute, and how

`retention_days = 0` means `day + 0` is already past, so the row is expired at insert with no error anywhere (PR #426, finding 1). After this plan the only writer is our own collector, so a missing attribute is a collector misconfiguration. The guard makes the insert fail, which the exporter retries and logs.

Two ClickHouse behaviours shape how it is written, both verified on the pinned image:

1. `if(cond, throwIf(true, 'msg'), value)` throws for every row: the constant `throwIf(true, ...)` is folded before short-circuit evaluation. The working form is `toUInt16OrZero(attr) + throwIf(attr = '', 'msg')`, where `throwIf` returns 0 for rows that pass and only throws when its condition is true.
2. In a `SELECT`, an alias named like a source column shadows it. `mapFilter(...) AS ResourceAttributes` followed by `ResourceAttributes['everr.retention.logs_days']` reads the filtered map and finds nothing. The stamps must be computed in an inner query, and the strip applied in the outer one.

Gio should confirm the guard. To remove it, drop the `+ throwIf(...)` term and keep `toUInt16OrZero(...)`.

## Names used across tasks

| Where | Name | Value |
|---|---|---|
| verify-key JSON | `tenantId`, `keyId`, `logsDays`, `tracesDays`, `metricsDays` | numbers for the three `*Days` |
| collector auth data | `tenant_id`, `key_id`, `retention_logs_days`, `retention_traces_days`, `retention_metrics_days` | strings |
| webhook headers (app to collector) | `x-everr-tenant-id`, `x-everr-retention-logs-days`, `x-everr-retention-traces-days`, `x-everr-retention-metrics-days` | decimal strings |
| resource attributes (in flight, stripped before storage) | `everr.tenant.id` (kept), `everr.retention.logs_days`, `everr.retention.traces_days`, `everr.retention.metrics_days` (stripped) | strings |
| `app.*` columns | `tenant_id String`, `retention_days UInt16` | set by the view |

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
  // resource it ingests with this key and the views write them into
  // app.*, so this is the only place retention enters the pipeline.
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
// (collector/config.example.yml, processor `resource`); the views stamp
// retention_days from them and strip them before storage.
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

### Task 4: `otel.*` become Null landing tables and the views stamp from attributes

**Files:**
- Modify: `clickhouse/init/03-create-otel-tables.sql`
- Modify: `clickhouse/init/10-create-mvs.sql`
- Modify: `clickhouse/init/12-create-alert-events.sql`
- Modify: `clickhouse/init/00-setup.sh`
- Delete: `clickhouse/config.d/dictionaries.xml`; remove its `COPY` line from `clickhouse/Dockerfile`

**Interfaces:**
- Consumes: resource attributes `everr.tenant.id`, `everr.retention.logs_days`, `everr.retention.traces_days`, `everr.retention.metrics_days` on every resource (Task 6).
- Produces: unchanged `app.*` tables; views that stamp and strip; no dictionary.

- [ ] **Step 1: Turn the seven `otel.*` tables into Null engines**

In `03-create-otel-tables.sql`, for each `CREATE TABLE otel.X (...)`: keep the column list exactly as it is (the exporter's insert names these columns, and `CREATE TABLE app.X AS SELECT ... FROM otel.X` copies types from it), remove every `INDEX ...` line, and replace everything from `) ENGINE = MergeTree` to the closing `;` with:

```sql
) ENGINE = Null;
```

Codecs on the columns are ignored by `Null` and harmless; leave them so the `app.*` codec mirror blocks in `10-create-mvs.sql` keep a source of truth to be compared against. Replace the file header comment with:

```sql
-- Landing tables for the collector's ClickHouse exporter. ENGINE = Null
-- stores nothing: an insert only triggers the materialized views in
-- 10-create-mvs.sql, which stamp tenant_id and retention_days from the
-- resource attributes and write the row into app.*. Column lists follow the
-- upstream clickhouseexporter schema for v0.152.0; app.* copies its types
-- from here, so keep them in step with the exporter version.
```

- [ ] **Step 2: Rewrite the views in `10-create-mvs.sql`**

Delete the `app.tenant_retention_source` table, the `app.tenant_retention` dictionary, the free-tier seed `INSERT`, the `SYSTEM RELOAD DICTIONARY`, and every comment that mentions them. Replace the file header with:

```sql
-- Per-row retention. Every app.* row is stamped with `retention_days` by its
-- materialized view from the resource attributes the collector sets at
-- authentication (everr.retention.<signal>_days), and the view strips those
-- keys before storage. The table partitions by (day, retention_days) and the
-- TTL is `day + retention_days` with ttl_only_drop_parts = 1. Every row in a
-- partition expires on the same day, so ClickHouse drops whole parts and never
-- rewrites one to expire a single tenant. A retention change applies to rows
-- ingested from that point on. Every distinct retention value costs that many
-- live partitions per table; RETENTION_BY_TIER (packages/app/src/lib/retention.ts)
-- is the only source of values.
--
-- Only the views write these tables. A missing retention attribute would
-- stamp 0 and expire the row at insert with no error, so the views refuse
-- the row instead: `toUInt16OrZero(x) + throwIf(x = '', ...)`. Do not write
-- it as if(x = '', throwIf(true, ...), ...): the constant throwIf is folded
-- and fires on every row. The stamps are computed in an inner query because
-- the `mapFilter(...) AS ResourceAttributes` alias in the outer query shadows
-- the source column.
```

Each view becomes (logs shown; traces uses `everr.retention.traces_days` and `otel.otel_traces`; the five metrics views use `everr.retention.metrics_days` and their `otel.otel_metrics_*` source):

```sql
CREATE MATERIALIZED VIEW IF NOT EXISTS app.logs_mv
TO app.logs
AS
SELECT
  * EXCEPT (ResourceAttributes),
  mapFilter((k, v) -> k NOT LIKE 'everr.retention.%', ResourceAttributes) AS ResourceAttributes
FROM
(
  SELECT
    *,
    ResourceAttributes['everr.tenant.id'] AS tenant_id,
    toUInt16OrZero(ResourceAttributes['everr.retention.logs_days'])
      + throwIf(ResourceAttributes['everr.retention.logs_days'] = '', 'everr.retention.logs_days resource attribute missing') AS retention_days
  FROM otel.otel_logs
);
```

The `CREATE TABLE app.X ... AS SELECT *, CAST(...) AS tenant_id, toUInt16(0) AS retention_days FROM otel.X WHERE 1 = 0` blocks, the index blocks and the codec blocks stay exactly as they are.

- [ ] **Step 3: Update `12-create-alert-events.sql`**

Replace the `retention_days` line with a plain column; the app supplies it (Task 8):

```sql
  -- Written by the app from the tenant's plan (packages/app/src/lib/retention.server.ts).
  retention_days UInt16,
```

Remove `GRANT dictGet ON app.tenant_retention TO web_app_admin;`. `app.alert_events_logs_mv` stays as is.

- [ ] **Step 4: Update grants in `00-setup.sh`**

Delete the retention-source grant block (`GRANT INSERT, SELECT ON app.tenant_retention_source TO web_app_admin;` with its comment) and the `GRANT dictGet ON app.tenant_retention TO collector_rw;` block with its comment. `collector_rw` keeps its `otel.*` grant; it still inserts there.

- [ ] **Step 5: Remove the dictionary config**

```bash
git rm clickhouse/config.d/dictionaries.xml
```

Remove `COPY config.d/ /etc/clickhouse-server/config.d/` from `clickhouse/Dockerfile` and delete the empty directory.

- [ ] **Step 6: Verify on a throwaway container**

```bash
docker build -q -t ch-di ./clickhouse
docker rm -f ch-di-test 2>/dev/null
docker run -d --name ch-di-test -e CLICKHOUSE_USER=default -e CLICKHOUSE_PASSWORD=everr \
  -e CLICKHOUSE_DEFAULT_ACCESS_MANAGEMENT=1 -e COLLECTOR_RW_PASSWORD=collector-dev \
  -e APP_RO_PASSWORD=app-dev -e WEB_APP_ADMIN_PASSWORD=web-app-admin-dev ch-di
sleep 20
docker logs ch-di-test 2>&1 | grep -i exception   # expect nothing
docker exec ch-di-test clickhouse-client --password everr --multiquery --query "
SELECT name, engine FROM system.tables WHERE database = 'otel' ORDER BY name;
INSERT INTO otel.otel_logs (Timestamp, TimestampTime, ResourceAttributes, Body)
  VALUES (now64(9), now(), map('everr.tenant.id','org1','everr.retention.logs_days','30','service.name','svc'), 'x');
SELECT tenant_id, retention_days, ResourceAttributes FROM app.logs;
SELECT partition FROM system.parts WHERE database = 'app' AND table = 'logs' AND active;
SELECT count() FROM otel.otel_logs;
INSERT INTO otel.otel_logs (Timestamp, TimestampTime, ResourceAttributes, Body)
  VALUES (now64(9), now(), map('everr.tenant.id','org1'), 'no-retention');"
```

Expected: seven `Null` engines; `org1  30  {'everr.tenant.id':'org1','service.name':'svc'}` (no retention key); partition `('<today>',30)`; `0` rows in the landing table; the last insert fails with `everr.retention.logs_days resource attribute missing`. Repeat the first insert for `otel.otel_traces` (`Timestamp, ResourceAttributes, SpanName`, attribute `everr.retention.traces_days`) and `otel.otel_metrics_gauge` (`TimeUnix, ResourceAttributes, MetricName`, attribute `everr.retention.metrics_days`) and check `app.traces` and `app.metrics_gauge`. Then:

```bash
docker rm -f ch-di-test; docker rmi ch-di
```

- [ ] **Step 7: Commit**

```bash
git add clickhouse
git commit -m "feat(clickhouse): stamp retention from resource attributes through Null landing tables"
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

### Task 6: Collector processors stamp retention

**Files:**
- Modify: `collector/config.example.yml`

**Interfaces:**
- Consumes: auth attributes from Task 5, webhook headers from Task 3.
- Produces: resource attributes `everr.retention.logs_days`, `everr.retention.traces_days`, `everr.retention.metrics_days` on every resource. The exporter block does not change.

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

- [ ] **Step 3: Exporter comment**

Above the `clickhouse:` exporter add:

```yaml
  # Writes into otel.* landing tables (ENGINE = Null). Nothing is stored there;
  # the views in clickhouse/init/10-create-mvs.sql stamp tenant and retention
  # and write app.*. `ttl` is unused with create_schema: false.
```

Remove `ttl: 72h`.

- [ ] **Step 4: Validate the config**

Run: `cd collector && make build && ./build/everr-collector validate --config=config.example.yml`
Expected: exits 0. If `validate` is not a subcommand in this build, run `./build/everr-collector --config=config.example.yml` for five seconds and confirm the log reaches `Everything is ready` before the ClickHouse connection error (no ClickHouse runs in this step).

- [ ] **Step 5: Commit**

```bash
git add collector/config.example.yml
git commit -m "feat(collector): stamp the tenant's retention on every resource"
```

---

### Task 7: Remove the dictionary write path from the app

**Files:**
- Modify: `packages/app/src/lib/clickhouse.ts` (delete `seedDefaultRetention`, `upsertTenantRetention`, the retention imports)
- Modify: `packages/app/src/lib/clickhouse.test.ts` (delete the `upsertTenantRetention` and `seedDefaultRetention` describes and their imports)
- Modify: `packages/app/src/lib/billing-data.server.ts` (delete the `upsertTenantRetention` call and import at the end of `upsertOrgSubscription`; the read-back comment above it goes too if nothing else needs it)
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

- [ ] **Step 3: Check the stamps and the strip**

```bash
docker exec everr-clickhouse-1 clickhouse-client --password everr --query "
SELECT tenant_id, retention_days, mapKeys(ResourceAttributes) AS keys, count()
FROM app.logs GROUP BY ALL FORMAT PrettyCompact"
```

Expected: one row; `tenant_id` is the key's organization, `retention_days` is that organization's plan (14 for a free organization), `keys` contains `everr.tenant.id` and no `everr.retention.*`. Neither `org_evil` nor `3650` appears anywhere. Repeat for `app.traces` and `app.metrics_gauge`.

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
- Produces: the ordered production procedure. Order: app deploy (Tasks 1, 2, 3, 7, 8), then collector deploy (Tasks 5, 6), then this script.

- [ ] **Step 1: Write the cut-over script**

The `app.*` tables do not change. The script swaps each landing table for a `Null` one and each view for the attribute-stamping one, then removes the dictionary. It runs after the collector already stamps the attributes, so the moment a new view is created it has what it needs.

```bash
#!/bin/bash
# Cut the write path over to direct ingest: otel.* become Null landing
# tables, the views stamp tenant_id and retention_days from the resource
# attributes the collector sets, the dictionary goes away. app.* is untouched.
#
# Run AFTER the app and the collector that stamp everr.retention.* are
# deployed. Per table there is a sub-second window between dropping the old
# view and creating the new one in which exporter inserts fail; the exporter
# retries them.
#
# Usage (from the repo root, as an admin user):
#   clickhouse/migrations/2026-09-03-direct-ingest.sh --host <h> --secure --user default --password '<pw>'
set -euo pipefail
cd "$(dirname "$0")/.."
client() { ${CLICKHOUSE_CLIENT:-clickhouse-client} "$@"; }
run_sql() { client "${CLIENT_ARGS[@]}" --multiquery --query "$1"; }
run_file() { client "${CLIENT_ARGS[@]}" --multiquery < "$1"; }
CLIENT_ARGS=("$@")
TABLES=(traces logs metrics_gauge metrics_sum metrics_histogram metrics_exponential_histogram metrics_summary)

echo "1/4 guard: the collector must already stamp retention"
run_sql "SELECT throwIf(
  (SELECT count() FROM otel.otel_logs WHERE TimestampTime > now() - INTERVAL 10 MINUTE AND ResourceAttributes['everr.retention.logs_days'] = '') > 0,
  'rows without everr.retention.logs_days arrived in the last 10 minutes: deploy the collector first')"

echo "2/4 swap landing tables and views"
for t in "${TABLES[@]}"; do
  run_sql "DROP VIEW IF EXISTS app.${t}_mv"
  run_sql "DROP TABLE IF EXISTS otel.otel_${t}"
done
run_file init/03-create-otel-tables.sql   # Null engines
run_file init/10-create-mvs.sql           # app.* CREATE IF NOT EXISTS are no-ops; views are recreated

echo "3/4 alert events keep their retention from the app"
run_sql "ALTER TABLE app.alert_events MODIFY COLUMN retention_days UInt16"

echo "4/4 remove the dictionary"
run_sql "DROP DICTIONARY IF EXISTS app.tenant_retention"
run_sql "DROP TABLE IF EXISTS app.tenant_retention_source"
run_sql "REVOKE dictGet ON app.tenant_retention FROM collector_rw, web_app_admin" || true

echo "done"
run_sql "SELECT name, engine FROM system.tables WHERE database = 'otel' ORDER BY name FORMAT PrettyCompact"
run_sql "SELECT tenant_id, retention_days, count() FROM app.logs WHERE TimestampTime > now() - INTERVAL 5 MINUTE GROUP BY ALL FORMAT PrettyCompact"
```

Step 2 drops the stored `otel.*` copies (seven days of raw rows nothing reads). Step 3 runs after the app deploy, which writes `retention_days` explicitly; the old `DEFAULT` still works until then, so ordering the app first keeps alert inserts valid throughout.

Test the script against a container built from the `ttl-improvements` branch (the pre-plan schema): seed a tenant row and the free-tier row, insert through the old views with the retention attributes present, run the script, insert again, confirm the second batch is stamped from the attributes and stripped, and confirm `otel.*` report `Null`.

- [ ] **Step 2: Update `docs/clickhouse-retention-rollout.md`**

Replace the "Where the numbers live", "Failure modes" and "Production rollout" sections. The facts to state:

- Retention is stamped by the collector from the plan the app returns at authentication (`verify-key`) or forwards as headers (GitHub webhooks). `RETENTION_BY_TIER` is the only source. There is no dictionary, no seed row, no reconciliation.
- The `otel.*` tables are `ENGINE = Null`: nothing is stored twice. The views strip `everr.retention.*` before storage; `everr.tenant.id` stays in the map.
- A plan change reaches new rows once the collector's auth cache expires: `cache_ttl` in the `everr_apikey` extension, 30 s by default. Webhooks read the plan on every forward.
- Failure modes: verify-key without retention fails authentication (fail closed); a resource without the attribute is refused by the view and retried by the exporter; a stale auth cache carries the previous plan for at most `cache_ttl`.
- Production cut-over: app deploy, collector deploy, then the script above.
- `everr-deploy`: remove `app_ro_dictget_tenant_retention`, remove the dictionary and source table resources and their grants, remove `dictionaries_lazy_load` if it was added. The exporter config keeps its table names.
- Keep "Parts per insert" and the measurements; add one sentence: the stored `otel.*` copy is gone, so every row is written and merged once.

- [ ] **Step 3: Update the public retention page**

In `retention.mdx`, "How we handle failures", replace the bullet about new organizations with: "Retention is looked up from your plan when the collector authenticates your API key, and cached for 30 seconds." Keep the rest; it already describes ingestion stopping rather than storing a wrong window.

- [ ] **Step 4: Scan for dashes and stale references**

```bash
grep -rnP '[\x{2013}\x{2014}]' docs/clickhouse-retention-rollout.md packages/docs/content/docs/reference/retention.mdx clickhouse
grep -rn 'tenant_retention\|dictGet\|dictionaries_lazy_load' clickhouse docs packages/app/src collector/config.example.yml
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

Title: `feat(ingest): stamp retention at auth and write telemetry once`

Body sections: Why (double write, dictionary correctness, the `dictGet` returns 0 class of bugs), What (the names table from this plan, Null landing tables, the view guard, fail-closed rules), Verified (Task 4 container output, Task 9 smoke results, the 600k-row comparison from this plan's rationale), Cut-over (the three ordered steps and the everr-deploy changes), Follow-ups (read-side schema items from PR #426 remain). No attribution footers.

---

## Self-review notes

- Every writer into `app.*` after this plan supplies `tenant_id` and `retention_days` explicitly: the seven views (from attributes, Task 4), alert events (from the app, Task 8), the alert projection view (unchanged).
- Every path that produces the attributes fails closed on a missing plan: `verify-key` cannot respond without `retentionForOrg` resolving; the extension rejects a response without retention (Task 5); the webhook forwarder awaits `retentionForOrg` before sending (Task 3); the view refuses a row without the attribute (Task 4).
- The two ClickHouse pitfalls (constant `throwIf` folding, alias shadowing) are encoded in the view template and its header comment so a future edit does not reintroduce them.
- Names are consistent across tasks: `retentionForOrg`, `logsDays`/`tracesDays`/`metricsDays` in JSON, `retention_*_days` in auth data, `x-everr-retention-*-days` headers, `everr.retention.*_days` attributes.
- The local collector (`collector/cmd/everr-local-collector`, chdb) has its own schema and pipeline and is not touched.
