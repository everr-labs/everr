# Dynamic Log Attribute Filters Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users filter the logs search UI on any attribute present in the current time range (resource, log-record, and scope attribute maps), instead of only the hardcoded Service/Source/Level/Trace filters.

**Architecture:** Lazy two-step discovery — one cheap query lists attribute *keys* per time range across all three OTel maps; a per-key query fetches *values* only when a key is opened. Filters carry `in`/`not_in`/`exists`/`missing` semantics and AND together. The dedicated Source filter is retired in favor of a generic attribute filter, with Repository/Environment/Host surfaced as promoted quick-pick chips.

**Tech Stack:** TypeScript, Zod, ClickHouse (Map columns), TanStack Query + Router, React, vitest. Monorepo packages `@everr/telemetry-explorer` (logs domain) and `@everr/app` (route + server functions).

**Spec:** `docs/superpowers/specs/2026-06-01-dynamic-log-attribute-filters-design.md`

**Conventions:**
- Run a single test file: `pnpm --filter @everr/telemetry-explorer exec vitest run <path>`
- Typecheck a package: `pnpm --filter @everr/telemetry-explorer typecheck` / `pnpm --filter @everr/app typecheck`
- `repos` is kept working until the final cleanup task (Task 16) so every intermediate commit compiles and passes. UI components have no existing test precedent in `logs/ui/`, so they are gated by typecheck + manual verification rather than unit tests.

---

### Task 1: Schema — attribute filter types & discovery inputs

**Files:**
- Modify: `packages/telemetry-explorer/src/logs/schemas.ts`
- Test: `packages/telemetry-explorer/src/logs/schemas.test.ts` (create)

Adds the `attributes` filter array (alongside the still-present `repos`) plus the discovery input schemas and result types. `repos` is intentionally **not** removed yet.

- [ ] **Step 1: Write the failing test**

```ts
// schemas.test.ts
import { describe, expect, it } from "vitest";
import {
  AttributeFilterSchema,
  LogsExplorerInputSchema,
} from "./schemas";

describe("AttributeFilterSchema", () => {
  it("defaults values to an empty array", () => {
    const parsed = AttributeFilterSchema.parse({
      source: "resource",
      key: "deployment.environment",
      op: "in",
    });
    expect(parsed.values).toEqual([]);
  });

  it("rejects an empty key", () => {
    expect(() =>
      AttributeFilterSchema.parse({ source: "log", key: "", op: "exists" }),
    ).toThrow();
  });

  it("rejects an unknown op", () => {
    expect(() =>
      AttributeFilterSchema.parse({
        source: "scope",
        key: "k",
        op: "regex",
      }),
    ).toThrow();
  });
});

describe("LogsExplorerInputSchema", () => {
  it("defaults attributes to an empty array", () => {
    const parsed = LogsExplorerInputSchema.parse({
      timeRange: { from: "now-1h", to: "now" },
    });
    expect(parsed.attributes).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @everr/telemetry-explorer exec vitest run src/logs/schemas.test.ts`
Expected: FAIL — `AttributeFilterSchema` is not exported.

- [ ] **Step 3: Write minimal implementation**

In `schemas.ts`, add the new schemas/types directly after the existing `LogLevel` type and before `LogsSearchFiltersShape`:

```ts
export const AttributeSourceSchema = z.enum(["resource", "log", "scope"]);
export type AttributeSource = z.infer<typeof AttributeSourceSchema>;

export const AttributeOpSchema = z.enum(["in", "not_in", "exists", "missing"]);
export type AttributeOp = z.infer<typeof AttributeOpSchema>;

export const AttributeFilterSchema = z.object({
  source: AttributeSourceSchema,
  key: z.string().min(1),
  op: AttributeOpSchema,
  values: z.array(z.string()).default([]),
});
export type AttributeFilter = z.infer<typeof AttributeFilterSchema>;
```

Update `LogsSearchFiltersShape` to add `attributes` (keep `repos` for now):

```ts
export const LogsSearchFiltersShape = {
  levels: z.array(LogLevelSchema).default([]),
  services: z.array(z.string()).default([]),
  repos: z.array(z.string()).default([]),
  attributes: z.array(AttributeFilterSchema).default([]),
} as const;
```

Add discovery input schemas and a key type at the end of the file (after `LogFilterOptions`):

```ts
export const LogAttributeKeysInputSchema = z.object({
  timeRange: TimeRangeSchema,
});
export type LogAttributeKeysInput = z.infer<typeof LogAttributeKeysInputSchema>;

export const LogAttributeValuesInputSchema = z.object({
  timeRange: TimeRangeSchema,
  source: AttributeSourceSchema,
  key: z.string().min(1),
});
export type LogAttributeValuesInput = z.infer<
  typeof LogAttributeValuesInputSchema
>;

export interface LogAttributeKey {
  source: AttributeSource;
  key: string;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @everr/telemetry-explorer exec vitest run src/logs/schemas.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/telemetry-explorer/src/logs/schemas.ts packages/telemetry-explorer/src/logs/schemas.test.ts
git commit -m "Add attribute filter schema and discovery inputs"
```

---

### Task 2: Attribute source → column whitelist

**Files:**
- Create: `packages/telemetry-explorer/src/logs/sql/attribute-columns.ts`
- Test: `packages/telemetry-explorer/src/logs/sql/attribute-columns.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// attribute-columns.test.ts
import { describe, expect, it } from "vitest";
import { ATTRIBUTE_SOURCES, attributeColumn } from "./attribute-columns";

describe("attributeColumn", () => {
  it("maps each source to its ClickHouse column", () => {
    expect(attributeColumn("resource")).toBe("ResourceAttributes");
    expect(attributeColumn("log")).toBe("LogAttributes");
    expect(attributeColumn("scope")).toBe("ScopeAttributes");
  });

  it("throws on an unknown source", () => {
    // @ts-expect-error testing runtime guard with an invalid source
    expect(() => attributeColumn("bogus")).toThrow(/unknown attribute source/i);
  });

  it("exposes every source", () => {
    expect(ATTRIBUTE_SOURCES).toEqual(["resource", "log", "scope"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @everr/telemetry-explorer exec vitest run src/logs/sql/attribute-columns.test.ts`
Expected: FAIL — cannot find module `./attribute-columns`.

- [ ] **Step 3: Write minimal implementation**

```ts
// attribute-columns.ts
import type { AttributeSource } from "../schemas";

const COLUMNS: Record<AttributeSource, string> = {
  resource: "ResourceAttributes",
  log: "LogAttributes",
  scope: "ScopeAttributes",
};

export const ATTRIBUTE_SOURCES = Object.keys(COLUMNS) as AttributeSource[];

export function attributeColumn(source: AttributeSource): string {
  const column = COLUMNS[source];
  if (!column) throw new Error(`Unknown attribute source: ${source}`);
  return column;
}
```

`AttributeSource` was added to `../schemas` in Task 1, so this compiles immediately.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @everr/telemetry-explorer exec vitest run src/logs/sql/attribute-columns.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/telemetry-explorer/src/logs/sql/attribute-columns.ts packages/telemetry-explorer/src/logs/sql/attribute-columns.test.ts
git commit -m "Add attribute source to column whitelist"
```

---

### Task 3: WHERE builder returns params and supports attribute filters

**Files:**
- Modify: `packages/telemetry-explorer/src/logs/sql/where.ts`
- Modify: `packages/telemetry-explorer/src/logs/sql/explorer.ts:46-58` (params block)
- Modify: `packages/telemetry-explorer/src/logs/sql/totals.ts` (facet where + params)
- Modify: `packages/telemetry-explorer/src/logs/sql/histogram.ts` (where + params)
- Test: `packages/telemetry-explorer/src/logs/sql/where.test.ts` (rewrite)

`buildWhereClause` now returns `{ clause, params }`. The dynamic attribute params live in `params`; callers merge them into their existing static params. `repos` handling is preserved.

- [ ] **Step 1: Rewrite the test file**

```ts
// where.test.ts
import { describe, expect, it } from "vitest";
import { buildWhereClause } from "./where";

describe("buildWhereClause", () => {
  it("starts with the time-range bounds", () => {
    const { clause } = buildWhereClause({ levels: [], services: [] });
    expect(clause).toContain(
      "TimestampTime >= parseDateTimeBestEffort({fromTime:String})",
    );
    expect(clause).toContain(
      "TimestampTime <= parseDateTimeBestEffort({toTime:String})",
    );
  });

  it("adds positionCaseInsensitive when query is set", () => {
    const { clause } = buildWhereClause({
      query: "boom",
      levels: [],
      services: [],
    });
    expect(clause).toContain("positionCaseInsensitive(Body, {query:String}) > 0");
  });

  it("filters levels when present and includeLevels is not false", () => {
    const { clause } = buildWhereClause({ levels: ["error"], services: [] });
    expect(clause).toContain("IN {levels:Array(String)}");
  });

  it("omits the levels filter when includeLevels is false", () => {
    const { clause } = buildWhereClause({
      levels: ["error"],
      services: [],
      includeLevels: false,
    });
    expect(clause).not.toContain("{levels:Array(String)}");
  });

  it("filters services by IN", () => {
    const { clause } = buildWhereClause({ levels: [], services: ["svc-a"] });
    expect(clause).toContain("ServiceName IN {services:Array(String)}");
  });

  it("builds an IN attribute clause with indexed params", () => {
    const { clause, params } = buildWhereClause({
      levels: [],
      services: [],
      attributes: [
        { source: "resource", key: "deployment.environment", op: "in", values: ["prod"] },
      ],
    });
    expect(clause).toContain("mapContains(ResourceAttributes, {attrKey0:String})");
    expect(clause).toContain(
      "ResourceAttributes[{attrKey0:String}] IN {attrVals0:Array(String)}",
    );
    expect(params).toEqual({
      attrKey0: "deployment.environment",
      attrVals0: ["prod"],
    });
  });

  it("builds a NOT IN attribute clause that includes logs missing the key", () => {
    const { clause } = buildWhereClause({
      levels: [],
      services: [],
      attributes: [
        { source: "log", key: "http.method", op: "not_in", values: ["GET"] },
      ],
    });
    expect(clause).toContain(
      "(NOT mapContains(LogAttributes, {attrKey0:String}) OR LogAttributes[{attrKey0:String}] NOT IN {attrVals0:Array(String)})",
    );
  });

  it("builds exists and missing clauses without value params", () => {
    const exists = buildWhereClause({
      levels: [],
      services: [],
      attributes: [{ source: "scope", key: "lib", op: "exists", values: [] }],
    });
    expect(exists.clause).toContain("mapContains(ScopeAttributes, {attrKey0:String})");
    expect(exists.params).toEqual({ attrKey0: "lib" });

    const missing = buildWhereClause({
      levels: [],
      services: [],
      attributes: [{ source: "resource", key: "host.name", op: "missing", values: [] }],
    });
    expect(missing.clause).toContain(
      "NOT mapContains(ResourceAttributes, {attrKey0:String})",
    );
  });

  it("indexes multiple attribute filters independently", () => {
    const { params } = buildWhereClause({
      levels: [],
      services: [],
      attributes: [
        { source: "resource", key: "a", op: "in", values: ["1"] },
        { source: "log", key: "b", op: "exists", values: [] },
      ],
    });
    expect(params).toEqual({ attrKey0: "a", attrVals0: ["1"], attrKey1: "b" });
  });

  it("filters traceId when set", () => {
    const { clause } = buildWhereClause({
      traceId: "abc",
      levels: [],
      services: [],
    });
    expect(clause).toContain("TraceId = {traceId:String}");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @everr/telemetry-explorer exec vitest run src/logs/sql/where.test.ts`
Expected: FAIL — `buildWhereClause` returns a string, so `.clause`/`.params` are undefined.

- [ ] **Step 3: Rewrite `where.ts`**

```ts
import {
  resourceAttribute,
  resourceAttributeKeyExists,
} from "../../sql/resource-attributes";
import type { AttributeFilter, LogLevel } from "../schemas";
import { attributeColumn } from "./attribute-columns";
import { LOG_LEVEL_EXPR } from "./level-expr";

const REPOSITORY_RESOURCE_ATTRIBUTE = "vcs.repository.name";

export interface WhereInput {
  query?: string;
  levels: LogLevel[];
  services: string[];
  repos?: string[];
  attributes?: AttributeFilter[];
  traceId?: string;
  includeLevels?: boolean;
}

export interface WhereResult {
  clause: string;
  params: Record<string, unknown>;
}

export function buildWhereClause(input: WhereInput): WhereResult {
  const clauses = [
    "TimestampTime >= parseDateTimeBestEffort({fromTime:String})",
    "TimestampTime <= parseDateTimeBestEffort({toTime:String})",
  ];
  const params: Record<string, unknown> = {};

  if (input.query) {
    clauses.push("positionCaseInsensitive(Body, {query:String}) > 0");
  }
  if (input.includeLevels !== false && input.levels.length > 0) {
    clauses.push(`${LOG_LEVEL_EXPR} IN {levels:Array(String)}`);
  }
  if (input.services.length > 0) {
    clauses.push("ServiceName IN {services:Array(String)}");
  }
  if (input.repos && input.repos.length > 0) {
    const repoFilter = `${resourceAttribute(REPOSITORY_RESOURCE_ATTRIBUTE)} IN {repos:Array(String)}`;
    clauses.push(
      input.repos.includes("")
        ? repoFilter
        : `${resourceAttributeKeyExists(REPOSITORY_RESOURCE_ATTRIBUTE)} AND ${repoFilter}`,
    );
  }

  (input.attributes ?? []).forEach((filter, index) => {
    const column = attributeColumn(filter.source);
    const keyParam = `attrKey${index}`;
    const valsParam = `attrVals${index}`;
    const contains = `mapContains(${column}, {${keyParam}:String})`;
    const access = `${column}[{${keyParam}:String}]`;
    params[keyParam] = filter.key;

    switch (filter.op) {
      case "in":
        clauses.push(`${contains} AND ${access} IN {${valsParam}:Array(String)}`);
        params[valsParam] = filter.values;
        break;
      case "not_in":
        clauses.push(
          `(NOT ${contains} OR ${access} NOT IN {${valsParam}:Array(String)})`,
        );
        params[valsParam] = filter.values;
        break;
      case "exists":
        clauses.push(contains);
        break;
      case "missing":
        clauses.push(`NOT ${contains}`);
        break;
    }
  });

  if (input.traceId) {
    clauses.push("TraceId = {traceId:String}");
  }

  return { clause: clauses.join("\n      AND "), params };
}
```

- [ ] **Step 4: Update the three callers to merge params**

In `explorer.ts`, replace the `const whereClause = buildWhereClause(input);` line and the `params` block:

```ts
  const where = buildWhereClause(input);
  const sql = `
      SELECT
        Timestamp AS timestampRaw,
        ${LOG_LEVEL_EXPR} AS level,
        Body AS body,
        TraceId AS traceId,
        SpanId AS spanId,
        ServiceName AS serviceName,
        toString(cityHash64(Body)) AS bodyHash
      FROM ${tableName}
      WHERE ${where.clause}
      ORDER BY Timestamp DESC
      LIMIT {limit:UInt32}
      OFFSET {offset:UInt32}
      `;
  return {
    sql,
    params: {
      fromTime: fromISO,
      toTime: toISO,
      query: input.query,
      levels: input.levels,
      services: input.services,
      repos: input.repos,
      traceId: input.traceId,
      limit: input.limit,
      offset: input.offset,
      ...where.params,
    },
  };
```

In `totals.ts`, replace `const facetWhereClause = buildWhereClause({ ...input, includeLevels: false });` and the `params` block:

```ts
  const where = buildWhereClause({ ...input, includeLevels: false });
  const sql = `
      SELECT
        countIf(level = 'error') AS error,
        countIf(level = 'warning') AS warning,
        countIf(level = 'info') AS info,
        countIf(level = 'debug') AS debug,
        countIf(level = 'trace') AS trace,
        countIf(level = 'unknown') AS unknown
      FROM (
        SELECT ${LOG_LEVEL_EXPR} AS level
        FROM ${tableName}
        WHERE ${where.clause}
      )
      `;
  return {
    sql,
    params: {
      fromTime: fromISO,
      toTime: toISO,
      query: input.query,
      levels: input.levels,
      services: input.services,
      repos: input.repos,
      traceId: input.traceId,
      ...where.params,
    },
  };
```

In `histogram.ts`, replace `const whereClause = buildWhereClause(input);`, the `WHERE ${whereClause}` usage, and the `params` block:

```ts
  const where = buildWhereClause(input);
  const intervalSeconds = bucketSeconds(
    fromDate,
    toDate,
    input.histogramBuckets,
  );
  const sql = `
      SELECT
        toStartOfInterval(TimestampTime, INTERVAL ${intervalSeconds} SECOND) AS bucket,
        count() AS total,
        countIf(level = 'error') AS error,
        countIf(level = 'warning') AS warning,
        countIf(level = 'info') AS info,
        countIf(level = 'debug') AS debug,
        countIf(level = 'trace') AS trace,
        countIf(level = 'unknown') AS unknown
      FROM (
        SELECT TimestampTime, ${LOG_LEVEL_EXPR} AS level
        FROM ${tableName}
        WHERE ${where.clause}
      )
      GROUP BY bucket
      ORDER BY bucket ASC
      `;
  return {
    sql,
    params: {
      fromTime: fromISO,
      toTime: toISO,
      query: input.query,
      levels: input.levels,
      services: input.services,
      repos: input.repos,
      traceId: input.traceId,
      ...where.params,
    },
    intervalSeconds,
    fromDate,
    toDate,
  };
```

- [ ] **Step 5: Run the SQL tests and typecheck**

Run: `pnpm --filter @everr/telemetry-explorer exec vitest run src/logs/sql && pnpm --filter @everr/telemetry-explorer typecheck`
Expected: PASS — all `sql/*.test.ts` green, no type errors.

- [ ] **Step 6: Commit**

```bash
git add packages/telemetry-explorer/src/logs/sql/where.ts packages/telemetry-explorer/src/logs/sql/where.test.ts packages/telemetry-explorer/src/logs/sql/explorer.ts packages/telemetry-explorer/src/logs/sql/totals.ts packages/telemetry-explorer/src/logs/sql/histogram.ts
git commit -m "Return params from where builder and support attribute filters"
```

---

### Task 4: Attribute key discovery query

**Files:**
- Create: `packages/telemetry-explorer/src/logs/sql/attribute-keys.ts`
- Test: `packages/telemetry-explorer/src/logs/sql/attribute-keys.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// attribute-keys.test.ts
import { describe, expect, it } from "vitest";
import {
  buildAttributeKeysQuery,
  decodeAttributeKeyRows,
} from "./attribute-keys";

describe("buildAttributeKeysQuery", () => {
  it("unions distinct keys across all three maps within range", () => {
    const built = buildAttributeKeysQuery({
      timeRange: { from: "now-1h", to: "now" },
    });
    expect(built.sql).toContain("DISTINCT arrayJoin(mapKeys(ResourceAttributes))");
    expect(built.sql).toContain("DISTINCT arrayJoin(mapKeys(LogAttributes))");
    expect(built.sql).toContain("DISTINCT arrayJoin(mapKeys(ScopeAttributes))");
    expect(built.sql).toContain("UNION ALL");
    expect(built.sql).toContain("LIMIT 500");
    expect(typeof built.params.fromTime).toBe("string");
    expect(typeof built.params.toTime).toBe("string");
  });
});

describe("decodeAttributeKeyRows", () => {
  it("maps rows to typed keys", () => {
    expect(
      decodeAttributeKeyRows([
        { key: "host.name", source: "resource" },
        { key: "http.method", source: "log" },
      ]),
    ).toEqual([
      { key: "host.name", source: "resource" },
      { key: "http.method", source: "log" },
    ]);
  });

  it("returns an empty array for no rows", () => {
    expect(decodeAttributeKeyRows([])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @everr/telemetry-explorer exec vitest run src/logs/sql/attribute-keys.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// attribute-keys.ts
import { resolveTimeRange, type TimeRange } from "@everr/ui/lib/time-range";
import type { AttributeSource, LogAttributeKey } from "../schemas";
import { ATTRIBUTE_SOURCES, attributeColumn } from "./attribute-columns";
import type { BuiltQuery } from "./explorer";
import { validateTableName } from "./table";

const KEY_LIMIT = 500;

export interface AttributeKeyRowRaw {
  key: string;
  source: AttributeSource;
}

export function buildAttributeKeysQuery(
  input: { timeRange: TimeRange },
  opts: { tableName?: string } = {},
): BuiltQuery {
  const tableName = opts.tableName ?? "logs";
  validateTableName(tableName);
  const { fromISO, toISO } = resolveTimeRange(input.timeRange);
  const selects = ATTRIBUTE_SOURCES.map(
    (source) => `
        SELECT DISTINCT arrayJoin(mapKeys(${attributeColumn(source)})) AS key, '${source}' AS source
        FROM ${tableName}
        WHERE TimestampTime >= parseDateTimeBestEffort({fromTime:String})
          AND TimestampTime <= parseDateTimeBestEffort({toTime:String})`,
  );
  const sql = `
      SELECT key, source FROM (
        ${selects.join("\n        UNION ALL\n")}
      )
      WHERE key != ''
      ORDER BY source, key
      LIMIT ${KEY_LIMIT}
      `;
  return { sql, params: { fromTime: fromISO, toTime: toISO } };
}

export function decodeAttributeKeyRows(
  rows: AttributeKeyRowRaw[],
): LogAttributeKey[] {
  return rows.map((row) => ({ key: row.key, source: row.source }));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @everr/telemetry-explorer exec vitest run src/logs/sql/attribute-keys.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/telemetry-explorer/src/logs/sql/attribute-keys.ts packages/telemetry-explorer/src/logs/sql/attribute-keys.test.ts
git commit -m "Add attribute key discovery query"
```

---

### Task 5: Attribute value discovery query

**Files:**
- Create: `packages/telemetry-explorer/src/logs/sql/attribute-values.ts`
- Test: `packages/telemetry-explorer/src/logs/sql/attribute-values.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// attribute-values.test.ts
import { describe, expect, it } from "vitest";
import {
  buildAttributeValuesQuery,
  decodeAttributeValueRows,
} from "./attribute-values";

describe("buildAttributeValuesQuery", () => {
  it("queries distinct values for the key in the resolved column within range", () => {
    const built = buildAttributeValuesQuery({
      timeRange: { from: "now-1h", to: "now" },
      source: "log",
      key: "http.method",
    });
    expect(built.sql).toContain("DISTINCT LogAttributes[{key:String}] AS v");
    expect(built.sql).toContain("mapContains(LogAttributes, {key:String})");
    expect(built.sql).toContain("LogAttributes[{key:String}] != ''");
    expect(built.sql).toContain("LIMIT 100");
    expect(built.params.key).toBe("http.method");
    expect(typeof built.params.fromTime).toBe("string");
  });

  it("rejects an unknown source", () => {
    expect(() =>
      buildAttributeValuesQuery({
        timeRange: { from: "now-1h", to: "now" },
        // @ts-expect-error invalid source
        source: "bogus",
        key: "k",
      }),
    ).toThrow(/unknown attribute source/i);
  });
});

describe("decodeAttributeValueRows", () => {
  it("extracts the v column", () => {
    expect(
      decodeAttributeValueRows([{ v: "GET" }, { v: "POST" }]),
    ).toEqual(["GET", "POST"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @everr/telemetry-explorer exec vitest run src/logs/sql/attribute-values.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// attribute-values.ts
import { resolveTimeRange, type TimeRange } from "@everr/ui/lib/time-range";
import type { AttributeSource } from "../schemas";
import { attributeColumn } from "./attribute-columns";
import type { BuiltQuery } from "./explorer";
import { validateTableName } from "./table";

const VALUE_LIMIT = 100;

export interface AttributeValueRowRaw {
  v: string;
}

export function buildAttributeValuesQuery(
  input: { timeRange: TimeRange; source: AttributeSource; key: string },
  opts: { tableName?: string } = {},
): BuiltQuery {
  const tableName = opts.tableName ?? "logs";
  validateTableName(tableName);
  const column = attributeColumn(input.source);
  const { fromISO, toISO } = resolveTimeRange(input.timeRange);
  const sql = `
      SELECT DISTINCT ${column}[{key:String}] AS v
      FROM ${tableName}
      WHERE TimestampTime >= parseDateTimeBestEffort({fromTime:String})
        AND TimestampTime <= parseDateTimeBestEffort({toTime:String})
        AND mapContains(${column}, {key:String})
        AND ${column}[{key:String}] != ''
      ORDER BY v
      LIMIT ${VALUE_LIMIT}
      `;
  return { sql, params: { fromTime: fromISO, toTime: toISO, key: input.key } };
}

export function decodeAttributeValueRows(
  rows: AttributeValueRowRaw[],
): string[] {
  return rows.map((row) => row.v);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @everr/telemetry-explorer exec vitest run src/logs/sql/attribute-values.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/telemetry-explorer/src/logs/sql/attribute-values.ts packages/telemetry-explorer/src/logs/sql/attribute-values.test.ts
git commit -m "Add attribute value discovery query"
```

---

### Task 6: Repository methods for discovery

**Files:**
- Modify: `packages/telemetry-explorer/src/logs/data/repository.ts`
- Test: `packages/telemetry-explorer/src/logs/data/repository.test.ts` (extend)

- [ ] **Step 1: Add failing tests**

Append to `repository.test.ts` (it already constructs a `LogsRepository` with a fake `SqlClient` — follow the existing setup in that file; the fake client records the last `sql`/`params` and returns a canned row set):

```ts
describe("LogsRepository attribute discovery", () => {
  it("attributeKeys decodes rows from the key query", async () => {
    const client = {
      execute: async () => [
        { key: "host.name", source: "resource" },
        { key: "http.method", source: "log" },
      ],
    };
    const repo = new LogsRepository(client);
    const keys = await repo.attributeKeys({
      timeRange: { from: "now-1h", to: "now" },
    });
    expect(keys).toEqual([
      { key: "host.name", source: "resource" },
      { key: "http.method", source: "log" },
    ]);
  });

  it("attributeValues decodes the v column", async () => {
    const client = { execute: async () => [{ v: "GET" }, { v: "POST" }] };
    const repo = new LogsRepository(client);
    const values = await repo.attributeValues({
      timeRange: { from: "now-1h", to: "now" },
      source: "log",
      key: "http.method",
    });
    expect(values).toEqual(["GET", "POST"]);
  });
});
```

> If the existing `repository.test.ts` uses a shared fake-client helper, reuse it instead of the inline `client` objects above; match whatever pattern is already in the file.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @everr/telemetry-explorer exec vitest run src/logs/data/repository.test.ts`
Expected: FAIL — `attributeKeys`/`attributeValues` not on `LogsRepository`.

- [ ] **Step 3: Implement the methods**

Add imports at the top of `repository.ts`:

```ts
import {
  type AttributeKeyRowRaw,
  buildAttributeKeysQuery,
  decodeAttributeKeyRows,
} from "../sql/attribute-keys";
import {
  type AttributeValueRowRaw,
  buildAttributeValuesQuery,
  decodeAttributeValueRows,
} from "../sql/attribute-values";
```

Add to the imported types from `../schemas`: `LogAttributeKey`, `LogAttributeKeysInput`, `LogAttributeValuesInput`.

Add two methods to the `LogsRepository` class (after `filterOptions`):

```ts
  // fallow-ignore-next-line unused-class-member
  async attributeKeys(input: LogAttributeKeysInput): Promise<LogAttributeKey[]> {
    const { sql, params } = buildAttributeKeysQuery(input, {
      tableName: this.tableName,
    });
    const rows = await this.client.execute<AttributeKeyRowRaw>(sql, params);
    return decodeAttributeKeyRows(rows);
  }

  // fallow-ignore-next-line unused-class-member
  async attributeValues(input: LogAttributeValuesInput): Promise<string[]> {
    const { sql, params } = buildAttributeValuesQuery(input, {
      tableName: this.tableName,
    });
    const rows = await this.client.execute<AttributeValueRowRaw>(sql, params);
    return decodeAttributeValueRows(rows);
  }
```

Extend the `LogsRepositoryLike` type:

```ts
export type LogsRepositoryLike = Pick<
  LogsRepository,
  | "explorer"
  | "totals"
  | "histogram"
  | "detail"
  | "filterOptions"
  | "attributeKeys"
  | "attributeValues"
>;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @everr/telemetry-explorer exec vitest run src/logs/data/repository.test.ts`
Expected: PASS.

> Do NOT run the full-package `typecheck` here. From Task 1 onward the `attributes` field is a required member of the inferred query-input types, but the UI container (`logs-explorer.tsx`) does not supply it until Task 14 — so `pnpm --filter @everr/telemetry-explorer typecheck` reports known errors in `logs-explorer.tsx` (and UI tests) until Task 14 lands. The vitest run above is the gate for this task. The package typecheck goes green at Task 14.

- [ ] **Step 5: Commit**

```bash
git add packages/telemetry-explorer/src/logs/data/repository.ts packages/telemetry-explorer/src/logs/data/repository.test.ts
git commit -m "Add repository methods for attribute discovery"
```

---

### Task 7: Query option factories for keys and values

**Files:**
- Modify: `packages/telemetry-explorer/src/logs/data/options.ts`
- Test: `packages/telemetry-explorer/src/logs/data/options.test.ts` (extend)

- [ ] **Step 1: Add failing tests**

Append to `options.test.ts` (follow the file's existing style — it asserts on `queryKey`/`select` of the option factories):

```ts
describe("logAttributeKeysOptions", () => {
  it("keys the query by time range", () => {
    const repo = {} as never;
    const opts = logAttributeKeysOptions(repo, {
      timeRange: { from: "now-1h", to: "now" },
    });
    expect(opts.queryKey).toEqual([
      "logs",
      "attributeKeys",
      { from: "now-1h", to: "now" },
    ]);
  });
});

describe("logAttributeValuesOptions", () => {
  it("keys the query by source and key", () => {
    const repo = {} as never;
    const opts = logAttributeValuesOptions(repo, {
      timeRange: { from: "now-1h", to: "now" },
      source: "log",
      key: "http.method",
    });
    expect(opts.queryKey).toEqual([
      "logs",
      "attributeValues",
      { from: "now-1h", to: "now" },
      "log",
      "http.method",
    ]);
    expect(opts.select(["GET"])).toEqual(["GET"]);
  });
});
```

Add the new factory names to the existing import from `./options` at the top of the test file.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @everr/telemetry-explorer exec vitest run src/logs/data/options.test.ts`
Expected: FAIL — factories not exported.

- [ ] **Step 3: Implement the factories**

Add to the type import from `../schemas` in `options.ts`: `AttributeSource`, `LogAttributeKey`. Append at the end of the file:

```ts
export function logAttributeKeysOptions(
  repo: LogsRepositoryLike,
  input: { timeRange: TimeRange },
) {
  return {
    queryKey: ["logs", "attributeKeys", input.timeRange] as const,
    queryFn: () => repo.attributeKeys(input),
    select: (data: LogAttributeKey[]) => data,
  };
}

export function logAttributeValuesOptions(
  repo: LogsRepositoryLike,
  input: { timeRange: TimeRange; source: AttributeSource; key: string },
) {
  return {
    queryKey: [
      "logs",
      "attributeValues",
      input.timeRange,
      input.source,
      input.key,
    ] as const,
    queryFn: () => repo.attributeValues(input),
    select: (data: string[]) => data,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @everr/telemetry-explorer exec vitest run src/logs/data/options.test.ts`
Expected: PASS.

> As in Task 6, skip the full-package `typecheck` here — `logs-explorer.tsx` still lacks the required `attributes` field until Task 14, so the package typecheck reports known UI errors until then. The vitest run is the gate for this task.

- [ ] **Step 5: Commit**

```bash
git add packages/telemetry-explorer/src/logs/data/options.ts packages/telemetry-explorer/src/logs/data/options.test.ts
git commit -m "Add query options for attribute key and value discovery"
```

---

### Task 8: Server functions for discovery (app)

**Files:**
- Modify: `packages/app/src/data/logs-explorer/server.ts`
- Modify: `packages/app/src/data/logs-explorer/remote-repo.ts`

No new unit tests (these are thin server-fn wrappers, matching the existing untested `getLogFilterOptions`). Gated by typecheck.

- [ ] **Step 1: Add the server functions**

In `server.ts`, add to the import from `@everr/telemetry-explorer/logs`: `LogAttributeKeysInputSchema`, `LogAttributeValuesInputSchema`. Append after `getLogFilterOptions`:

```ts
export const getLogAttributeKeys = createAuthenticatedServerFn({ method: "GET" })
  .inputValidator(LogAttributeKeysInputSchema)
  .handler(({ data, context: { clickhouse } }) =>
    repoFromContext(clickhouse).attributeKeys(data),
  );

export const getLogAttributeValues = createAuthenticatedServerFn({
  method: "GET",
})
  .inputValidator(LogAttributeValuesInputSchema)
  .handler(({ data, context: { clickhouse } }) =>
    repoFromContext(clickhouse).attributeValues(data),
  );
```

- [ ] **Step 2: Wire them into the remote repo**

In `remote-repo.ts`, add to the type import: `LogAttributeKey`, `LogAttributeKeysInput`, `LogAttributeValuesInput`. Import the new functions from `./server`. Add to the `remoteRepo` object:

```ts
  attributeKeys: (input: LogAttributeKeysInput): Promise<LogAttributeKey[]> =>
    getLogAttributeKeys({ data: input }),
  attributeValues: (input: LogAttributeValuesInput): Promise<string[]> =>
    getLogAttributeValues({ data: input }),
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @everr/app typecheck`
Expected: `remoteRepo` satisfies `LogsRepositoryLike` (now including the two new methods) and the new server functions compile. If the app typecheck transitively compiles `@everr/telemetry-explorer` source, it may surface the same known `logs-explorer.tsx` "missing `attributes`" errors that persist until Task 14 — that is expected. Confirm there are **no new errors originating from `server.ts` or `remote-repo.ts`**; those two files must be clean.

- [ ] **Step 4: Commit**

```bash
git add packages/app/src/data/logs-explorer/server.ts packages/app/src/data/logs-explorer/remote-repo.ts
git commit -m "Add server functions for attribute discovery"
```

---

### Task 9: Attribute UI metadata constants

**Files:**
- Create: `packages/telemetry-explorer/src/logs/ui/attribute-meta.ts`
- Test: `packages/telemetry-explorer/src/logs/ui/attribute-meta.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// attribute-meta.test.ts
import { describe, expect, it } from "vitest";
import {
  ATTRIBUTE_OP_LABELS,
  ATTRIBUTE_SOURCE_LABELS,
  PROMOTED_ATTRIBUTES,
} from "./attribute-meta";

describe("attribute metadata", () => {
  it("labels every op", () => {
    expect(ATTRIBUTE_OP_LABELS.in).toBe("Is");
    expect(ATTRIBUTE_OP_LABELS.not_in).toBe("Is not");
    expect(ATTRIBUTE_OP_LABELS.exists).toBe("Exists");
    expect(ATTRIBUTE_OP_LABELS.missing).toBe("Missing");
  });

  it("labels every source", () => {
    expect(ATTRIBUTE_SOURCE_LABELS.resource).toBe("Resource");
    expect(ATTRIBUTE_SOURCE_LABELS.log).toBe("Log");
    expect(ATTRIBUTE_SOURCE_LABELS.scope).toBe("Scope");
  });

  it("promotes repository, environment, and host as resource attributes", () => {
    expect(PROMOTED_ATTRIBUTES).toEqual([
      { source: "resource", key: "vcs.repository.name", label: "Repository" },
      { source: "resource", key: "deployment.environment", label: "Environment" },
      { source: "resource", key: "host.name", label: "Host" },
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @everr/telemetry-explorer exec vitest run src/logs/ui/attribute-meta.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// attribute-meta.ts
import type { AttributeOp, AttributeSource } from "../schemas";

export const ATTRIBUTE_OP_LABELS: Record<AttributeOp, string> = {
  in: "Is",
  not_in: "Is not",
  exists: "Exists",
  missing: "Missing",
};

export const ATTRIBUTE_SOURCE_LABELS: Record<AttributeSource, string> = {
  resource: "Resource",
  log: "Log",
  scope: "Scope",
};

export interface PromotedAttribute {
  source: AttributeSource;
  key: string;
  label: string;
}

export const PROMOTED_ATTRIBUTES: PromotedAttribute[] = [
  { source: "resource", key: "vcs.repository.name", label: "Repository" },
  { source: "resource", key: "deployment.environment", label: "Environment" },
  { source: "resource", key: "host.name", label: "Host" },
];
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @everr/telemetry-explorer exec vitest run src/logs/ui/attribute-meta.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/telemetry-explorer/src/logs/ui/attribute-meta.ts packages/telemetry-explorer/src/logs/ui/attribute-meta.test.ts
git commit -m "Add attribute UI metadata constants"
```

---

### Task 10: Attribute key picker component

**Files:**
- Create: `packages/telemetry-explorer/src/logs/ui/attribute-key-picker.tsx`

A searchable popover listing discovered keys grouped by source. Selecting a key calls `onSelect({ source, key })`. Uses the same `Command`/`Popover` primitives as `FilterCombobox`. Gated by typecheck + manual verification (Task 15).

- [ ] **Step 1: Implement the component**

```tsx
// attribute-key-picker.tsx
import { Button } from "@everr/ui/components/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@everr/ui/components/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@everr/ui/components/popover";
import type { TimeRange } from "@everr/ui/lib/time-range";
import { useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { useState } from "react";
import { logAttributeKeysOptions } from "../data/options";
import type { LogsRepositoryLike } from "../data/repository";
import type { AttributeSource, LogAttributeKey } from "../schemas";
import { ATTRIBUTE_SOURCE_LABELS } from "./attribute-meta";

export function AttributeKeyPicker({
  repo,
  timeRange,
  onSelect,
}: {
  repo: LogsRepositoryLike;
  timeRange: TimeRange;
  onSelect: (key: { source: AttributeSource; key: string }) => void;
}) {
  const [open, setOpen] = useState(false);
  const { data: keys = [], isLoading } = useQuery({
    ...logAttributeKeysOptions(repo, { timeRange }),
    enabled: open,
  });

  const grouped = (["resource", "log", "scope"] as AttributeSource[]).map(
    (source) => ({
      source,
      keys: keys.filter((k: LogAttributeKey) => k.source === source),
    }),
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button variant="outline" size="sm" className="h-8 w-full justify-start" />
        }
      >
        <Plus className="size-3.5" />
        Add filter
      </PopoverTrigger>
      <PopoverContent align="start" className="w-(--radix-popper-anchor-width) min-w-56 p-0">
        <Command className="p-0">
          <CommandInput
            wrapperClassName="p-0 border-b"
            inputGroupClassName="border-none rounded-none bg-transparent h-8"
            placeholder="Search attributes..."
          />
          <CommandList>
            <CommandEmpty>{isLoading ? "Loading..." : "No attributes."}</CommandEmpty>
            {grouped.map(
              (group) =>
                group.keys.length > 0 && (
                  <CommandGroup
                    key={group.source}
                    heading={ATTRIBUTE_SOURCE_LABELS[group.source]}
                  >
                    {group.keys.map((item: LogAttributeKey) => (
                      <CommandItem
                        key={`${item.source}:${item.key}`}
                        value={`${group.source} ${item.key}`}
                        onSelect={() => {
                          onSelect({ source: item.source, key: item.key });
                          setOpen(false);
                        }}
                      >
                        <span className="truncate">{item.key}</span>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                ),
            )}
            {keys.length >= 500 && (
              <div className="text-muted-foreground px-2 py-1 text-xs">
                Showing first 500 attributes
              </div>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @everr/telemetry-explorer typecheck`
Expected: PASS.

> If `CommandGroup` does not accept a `heading` prop in this codebase's `command` component, render the label as a plain `<div className="text-muted-foreground px-2 py-1 text-xs">` above the items instead. Verify the prop on `packages/ui/src/components/command.tsx` before implementing.

- [ ] **Step 3: Commit**

```bash
git add packages/telemetry-explorer/src/logs/ui/attribute-key-picker.tsx
git commit -m "Add attribute key picker component"
```

---

### Task 11: Attribute filter row component

**Files:**
- Create: `packages/telemetry-explorer/src/logs/ui/attribute-filter-row.tsx`

One active filter: key label, op `Select`, value `FilterCombobox` (hidden for `exists`/`missing`), remove button. Gated by typecheck + manual verification.

- [ ] **Step 1: Verify the Select primitive**

Run: `ls packages/ui/src/components/select.tsx`
Expected: the file exists. Open it and confirm the exported names (`Select`, `SelectTrigger`, `SelectValue`, `SelectContent`, `SelectItem`). Adjust the imports in Step 2 to match the actual exports.

- [ ] **Step 2: Implement the component**

```tsx
// attribute-filter-row.tsx
import { Button } from "@everr/ui/components/button";
import { FilterCombobox } from "@everr/ui/components/filter-combobox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@everr/ui/components/select";
import type { TimeRange } from "@everr/ui/lib/time-range";
import { X } from "lucide-react";
import { logAttributeValuesOptions } from "../data/options";
import type { LogsRepositoryLike } from "../data/repository";
import type { AttributeFilter, AttributeOp } from "../schemas";
import { ATTRIBUTE_OP_LABELS } from "./attribute-meta";

const OPS: AttributeOp[] = ["in", "not_in", "exists", "missing"];

export function AttributeFilterRow({
  repo,
  timeRange,
  filter,
  onChange,
  onRemove,
}: {
  repo: LogsRepositoryLike;
  timeRange: TimeRange;
  filter: AttributeFilter;
  onChange: (next: AttributeFilter) => void;
  onRemove: () => void;
}) {
  const showValues = filter.op === "in" || filter.op === "not_in";

  return (
    <div className="flex flex-col gap-1 rounded-md border p-2">
      <div className="flex items-center justify-between gap-1">
        <span className="truncate font-mono text-xs" title={filter.key}>
          {filter.key}
        </span>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={`Remove ${filter.key} filter`}
          onClick={onRemove}
        >
          <X className="size-3" />
        </Button>
      </div>
      <Select
        value={filter.op}
        onValueChange={(op) =>
          onChange({ ...filter, op: op as AttributeOp })
        }
      >
        <SelectTrigger className="h-7 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {OPS.map((op) => (
            <SelectItem key={op} value={op}>
              {ATTRIBUTE_OP_LABELS[op]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {showValues && (
        <FilterCombobox
          label=""
          values={filter.values}
          onChange={(values) => onChange({ ...filter, values })}
          options={logAttributeValuesOptions(repo, {
            timeRange,
            source: filter.source,
            key: filter.key,
          })}
          placeholder="Any value"
          searchPlaceholder="Search values..."
          className="w-full"
        />
      )}
    </div>
  );
}
```

> Confirm `Select`'s controlled API in this codebase (`value` + `onValueChange`). If it differs (e.g. `defaultValue`/`onChange`), adapt. `FilterCombobox`'s `label` renders a `<Label>`; passing `""` yields an empty label — acceptable here since the key is already shown above. If an empty label looks wrong in manual verification, change `FilterCombobox` to make `label` optional, or pass `"Values"`.

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @everr/telemetry-explorer typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/telemetry-explorer/src/logs/ui/attribute-filter-row.tsx
git commit -m "Add attribute filter row component"
```

---

### Task 12: Attribute filter section component

**Files:**
- Create: `packages/telemetry-explorer/src/logs/ui/attribute-filter-section.tsx`

Owns the promoted chips, the active-filter list, and the key picker. Gated by typecheck + manual verification.

- [ ] **Step 1: Implement the component**

```tsx
// attribute-filter-section.tsx
import { Badge } from "@everr/ui/components/badge";
import type { TimeRange } from "@everr/ui/lib/time-range";
import type { LogsRepositoryLike } from "../data/repository";
import type { AttributeFilter, AttributeSource } from "../schemas";
import { AttributeFilterRow } from "./attribute-filter-row";
import { AttributeKeyPicker } from "./attribute-key-picker";
import { PROMOTED_ATTRIBUTES } from "./attribute-meta";

function filterKey(source: AttributeSource, key: string) {
  return `${source}:${key}`;
}

export function AttributeFilterSection({
  repo,
  timeRange,
  attributes,
  onChange,
}: {
  repo: LogsRepositoryLike;
  timeRange: TimeRange;
  attributes: AttributeFilter[];
  onChange: (next: AttributeFilter[]) => void;
}) {
  const activeKeys = new Set(
    attributes.map((f) => filterKey(f.source, f.key)),
  );

  const addFilter = (source: AttributeSource, key: string) => {
    if (activeKeys.has(filterKey(source, key))) return;
    onChange([...attributes, { source, key, op: "in", values: [] }]);
  };

  const updateAt = (index: number, next: AttributeFilter) => {
    onChange(attributes.map((f, i) => (i === index ? next : f)));
  };

  const removeAt = (index: number) => {
    onChange(attributes.filter((_, i) => i !== index));
  };

  return (
    <div className="flex flex-col gap-2">
      <span className="text-muted-foreground text-xs font-medium">Attributes</span>
      <div className="flex flex-wrap gap-1">
        {PROMOTED_ATTRIBUTES.map((promoted) => {
          const isActive = activeKeys.has(
            filterKey(promoted.source, promoted.key),
          );
          return (
            <Badge
              key={promoted.key}
              variant={isActive ? "default" : "outline"}
              className="cursor-pointer"
              onClick={() => addFilter(promoted.source, promoted.key)}
            >
              {promoted.label}
            </Badge>
          );
        })}
      </div>
      {attributes.map((filter, index) => (
        <AttributeFilterRow
          key={filterKey(filter.source, filter.key)}
          repo={repo}
          timeRange={timeRange}
          filter={filter}
          onChange={(next) => updateAt(index, next)}
          onRemove={() => removeAt(index)}
        />
      ))}
      <AttributeKeyPicker
        repo={repo}
        timeRange={timeRange}
        onSelect={({ source, key }) => addFilter(source, key)}
      />
    </div>
  );
}
```

> `Badge` may not forward `onClick`/`cursor` cleanly in this codebase. Verify against `packages/ui/src/components/badge.tsx`; if it doesn't accept `onClick`, wrap each badge in a `<button type="button">` instead.

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @everr/telemetry-explorer typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/telemetry-explorer/src/logs/ui/attribute-filter-section.tsx
git commit -m "Add attribute filter section component"
```

---

### Task 13: Wire the section into the filters bar (remove Source combobox)

**Files:**
- Modify: `packages/telemetry-explorer/src/logs/ui/log-filters.tsx`

- [ ] **Step 1: Update `LogFiltersBarProps`**

Replace `repos: string[];` with `attributes: AttributeFilter[];` and update the `onChange` patch type: remove `repos?` and add `attributes?`. Add the imports:

```ts
import type { AttributeFilter, LogLevel } from "../schemas";
import { AttributeFilterSection } from "./attribute-filter-section";
```

Remove the now-unused imports `logRepoFilterOptions` and (if no longer referenced) `logServiceFilterOptions` stays — Service is kept. Keep `logServiceFilterOptions`.

The updated props interface:

```ts
export interface LogFiltersBarProps {
  repo: LogsRepositoryLike;
  timeRange: TimeRange;
  levels: LogLevel[];
  services: string[];
  attributes: AttributeFilter[];
  traceId: string | undefined;
  levelCounts?: Record<LogLevel, number>;
  onChange: (patch: {
    levels?: LogLevel[];
    services?: string[];
    attributes?: AttributeFilter[];
    traceId?: string;
  }) => void;
}
```

- [ ] **Step 2: Update the component body**

Add `attributes` to the destructured params. Remove the entire `<FilterCombobox label="Source" ... />` block. After the Service `<FilterCombobox>`, insert:

```tsx
      <Separator />
      <AttributeFilterSection
        repo={repo}
        timeRange={timeRange}
        attributes={attributes}
        onChange={(nextAttributes) => onChange({ attributes: nextAttributes })}
      />
```

Keep the `<TraceFilter />` block as-is below it.

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @everr/telemetry-explorer typecheck`
Expected: FAIL — `logs-explorer.tsx` still passes `repos` to `LogFiltersBar`. This is fixed in Task 14; the package will not fully typecheck until then. Confirm the only errors are in `logs-explorer.tsx` referencing `repos`/`attributes`.

- [ ] **Step 4: Commit**

```bash
git add packages/telemetry-explorer/src/logs/ui/log-filters.tsx
git commit -m "Render attribute filter section in the logs filter bar"
```

---

### Task 14: Thread attributes through the explorer container

**Files:**
- Modify: `packages/telemetry-explorer/src/logs/ui/logs-explorer.tsx`

- [ ] **Step 1: Update the `LogsExplorerSearch` type**

In the `LogsExplorerSearch` interface (around line 33), replace `repos: string[];` with `attributes: AttributeFilter[];`. Add the import:

```ts
import type { AttributeFilter, LogExplorerRow, LogLevel } from "../schemas";
```

- [ ] **Step 2: Update the state, sync, filterInput, and props**

- In the destructure (line 191): replace `repos` with `attributes`:
  `const { showVolume, q, levels, services, attributes, traceId } = search;`
- In the `useState` initializer (lines 200-206): replace `repos,` with `attributes,`.
- In the `useEffect` sync (line 211): replace `repos,` with `attributes,`:
  `setFilters({ q, levels, services, attributes, traceId });`
- In `filterInput` (lines 219-226): replace `repos: filters.repos,` with `attributes: filters.attributes,`.
- In the `<LogFiltersBar>` props (lines 327-336): replace `repos={filters.repos}` with `attributes={filters.attributes}`.

- [ ] **Step 3: Typecheck the package**

Run: `pnpm --filter @everr/telemetry-explorer typecheck`
Expected: PASS — the package now fully typechecks (Task 13's error is resolved). Note `LogsExplorerInput` still carries `repos` (defaulting to `[]`), which is harmless until Task 16.

- [ ] **Step 4: Commit**

```bash
git add packages/telemetry-explorer/src/logs/ui/logs-explorer.tsx
git commit -m "Thread attribute filters through the logs explorer"
```

---

### Task 15: Map attributes in the route & manual verification

**Files:**
- Modify: `packages/app/src/routes/_authenticated/_dashboard/logs.tsx`

- [ ] **Step 1: Update the search mapping**

In `LogsExplorerPage`, the `explorerSearch` object maps route search → `LogsExplorerSearch`. Replace `repos: filters.repos,` with `attributes: filters.attributes,`. Because `SearchSchema` spreads `LogsSearchFiltersShape`, `attributes` is already part of `filters` — no other route change is needed.

```ts
  const explorerSearch: LogsExplorerSearch = {
    q: filters.q,
    levels: filters.levels,
    services: filters.services,
    attributes: filters.attributes,
    traceId: filters.traceId,
    showVolume,
  };
```

- [ ] **Step 2: Typecheck the app**

Run: `pnpm --filter @everr/app typecheck`
Expected: PASS.

- [ ] **Step 3: Manual verification**

Start the app (`pnpm dev:web`), open the Logs page, and confirm:
- The **Source** combobox is gone; an **Attributes** section appears with Repository / Environment / Host chips and an **Add filter** button.
- Clicking **Add filter** opens a searchable popover grouped by Resource / Log / Scope, populated from the current time range.
- Adding a key creates a row defaulting to **Is**; opening the value combobox lists distinct values for that key; selecting values narrows the log results and the histogram/totals update.
- Switching a row to **Is not** / **Exists** / **Missing** behaves correctly (value picker hidden for Exists/Missing).
- The `attributes` filter is reflected in the URL and survives reload / back-forward.
- Clicking a promoted chip adds that attribute filter; clicking it again does not duplicate it.

- [ ] **Step 4: Commit**

```bash
git add packages/app/src/routes/_authenticated/_dashboard/logs.tsx
git commit -m "Map attribute filters in the logs route"
```

---

### Task 16: Retire the legacy `repos` filter end-to-end

**Files:**
- Modify: `packages/telemetry-explorer/src/logs/schemas.ts`
- Modify: `packages/telemetry-explorer/src/logs/sql/where.ts` + `where.test.ts`
- Modify: `packages/telemetry-explorer/src/logs/sql/explorer.ts`, `totals.ts`, `histogram.ts`
- Modify: `packages/telemetry-explorer/src/logs/sql/filter-options.ts` + `filter-options.test.ts`
- Modify: `packages/telemetry-explorer/src/logs/data/options.ts`

Now that Repository is handled via `attributes`, remove the dead `repos` path. Done last so every prior commit stayed green.

- [ ] **Step 1: Remove `repos` from the schema**

In `schemas.ts`, delete the `repos: z.array(z.string()).default([]),` line from `LogsSearchFiltersShape`. In `LogFilterOptions`, remove the `repos: string[];` field, leaving `{ services: string[]; }`.

- [ ] **Step 2: Remove the `repos` branch from `where.ts`**

Delete the `repos?: string[];` field from `WhereInput`, the `REPOSITORY_RESOURCE_ATTRIBUTE` constant, the `resourceAttribute`/`resourceAttributeKeyExists` imports, and the entire `if (input.repos && input.repos.length > 0) { ... }` block.

- [ ] **Step 3: Remove `repos` params from the three query builders**

In `explorer.ts`, `totals.ts`, and `histogram.ts`, delete the `repos: input.repos,` line from each `params` object.

- [ ] **Step 4: Trim `filter-options.ts` to services only**

Replace the file body so it queries and decodes only `services`:

```ts
import { resolveTimeRange, type TimeRange } from "@everr/ui/lib/time-range";
import type { LogFilterOptions } from "../schemas";
import type { BuiltQuery } from "./explorer";
import { validateTableName } from "./table";

export interface FilterOptionsRowRaw {
  services: string[];
}

export function buildFilterOptionsQuery(
  input: { timeRange: TimeRange },
  opts: { tableName?: string } = {},
): BuiltQuery {
  const tableName = opts.tableName ?? "logs";
  validateTableName(tableName);
  const { fromISO, toISO } = resolveTimeRange(input.timeRange);
  const sql = `
      SELECT
        (SELECT groupArray(v) FROM (
          SELECT DISTINCT ServiceName AS v
          FROM ${tableName}
          WHERE TimestampTime >= parseDateTimeBestEffort({fromTime:String})
            AND TimestampTime <= parseDateTimeBestEffort({toTime:String})
            AND ServiceName != ''
          ORDER BY v
          LIMIT 100
        )) AS services
      `;
  return { sql, params: { fromTime: fromISO, toTime: toISO } };
}

export function decodeFilterOptionsRows(
  rows: FilterOptionsRowRaw[],
): LogFilterOptions {
  const row = rows[0];
  return { services: row?.services ?? [] };
}
```

Update `filter-options.test.ts`: remove the assertions referencing `ResourceAttributes['vcs.repository.name']` / `mapContains` / `repos`, and change the empty-row expectation to `{ services: [] }`.

- [ ] **Step 5: Remove `logRepoFilterOptions`**

In `data/options.ts`, delete the `logRepoFilterOptions` function. (`logServiceFilterOptions` stays.) Grep to confirm no remaining references: `grep -rn "logRepoFilterOptions\|\.repos\b\|repos:" packages/telemetry-explorer/src packages/app/src | grep -v node_modules` — expect no hits except unrelated matches (e.g. `runs-list`).

- [ ] **Step 6: Run the full package test suite + both typechecks**

Run: `pnpm --filter @everr/telemetry-explorer test && pnpm --filter @everr/telemetry-explorer typecheck && pnpm --filter @everr/app typecheck`
Expected: PASS across the board.

- [ ] **Step 7: Commit**

```bash
git add packages/telemetry-explorer/src/logs packages/app/src
git commit -m "Retire legacy repos filter in favor of attribute filters"
```

---

### Task 17: Final verification & formatting

- [ ] **Step 1: Format / lint**

Run: `pnpm check:fix`
Expected: no remaining errors; commit any formatting changes.

- [ ] **Step 2: Full test run**

Run: `pnpm --filter @everr/telemetry-explorer test`
Expected: PASS.

- [ ] **Step 3: Re-verify the app manually** (smoke test from Task 15, Step 3) if any UI files changed during formatting.

- [ ] **Step 4: Commit any formatting changes**

```bash
git add -A
git commit -m "Format dynamic attribute filter changes"
```
