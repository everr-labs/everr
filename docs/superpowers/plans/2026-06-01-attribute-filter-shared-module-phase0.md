# Shared Attribute-Filter Module — Phase 0 (Extraction + Logs Refactor) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract the logs attribute-filter implementation into a shared `src/attribute-filter/` module (schemas, SQL builders with injected column mapping, query options, repository interface, and prop-driven UI), then refactor the logs domain to consume it — with zero behavior change to the logs page.

**Architecture:** A new package-internal module holds the generic, OTel-standard attribute-filter code. Domain specifics (which attribute-map columns exist, which keys to promote, which to exclude) are injected: SQL builders take a `columnFor` mapping + `sources` list; UI components take `promotedAttributes`, `excludedKeys`, `sources`, and a `domain` (for React Query key namespacing) as props. The logs domain becomes the first consumer; its existing test suite is the regression guard.

**Tech Stack:** TypeScript, Zod, `@tanstack/react-query`, base-ui (`@everr/ui` Command/Popover), ClickHouse SQL strings with bound params, vitest + jsdom (`@testing-library/react`).

**Spec:** `docs/superpowers/specs/2026-06-01-attribute-filters-traces-errors-design.md`

**Branch:** `gio/attribute-filters-traces-errors` (already created, stacked on `gio/dynamic-log-attribute-filters`).

---

## Conventions for every task

- All commands run from `packages/telemetry-explorer/` unless stated otherwise.
- Test a single file: `pnpm vitest run <path>`. Full suite: `pnpm vitest run`. Typecheck: `pnpm typecheck`.
- Commit messages must NOT mention Claude/AI/Anthropic and must NOT include `Co-Authored-By` trailers (repo rule).
- The pre-commit hook runs biome (`check`) + dead-code (`fallow`). `fallow` treats `*.test.ts(x)` as entry points; a new exported symbol with no consumer yet will be flagged. Where a task creates an export that only a *later* task consumes, the listed commit batches it with its first consumer, or the task notes the `fallow` expectation.

## File Structure (Phase 0)

**New — shared module `packages/telemetry-explorer/src/attribute-filter/`:**
- `schemas.ts` — `AttributeSourceSchema` (superset `resource|log|scope|span`), `AttributeOpSchema`, `AttributeFilterSchema`, and the `AttributeKey` / `AttributeKeysInput` / `AttributeValuesInput` types.
- `repository.ts` — `AttributeRepositoryLike` interface.
- `options.ts` — `attributeKeysOptions`, `attributeValuesOptions` (take `{ domain }`).
- `sql/types.ts` — `BuiltQuery` type.
- `sql/where.ts` — `buildAttributeClauses`.
- `sql/keys.ts` — `buildAttributeKeysQuery`, `AttributeKeyRowRaw`, `decodeAttributeKeyRows`.
- `sql/values.ts` — `buildAttributeValuesQuery`, `AttributeValueRowRaw`, `decodeAttributeValueRows`.
- `ui/attribute-meta.ts` — op labels/connectors, `opTakesValues`, source labels (incl. `span`), known-name dictionary, `attributeLabel`, `PromotedAttribute` type.
- `ui/attribute-filter-pill.tsx`, `ui/attribute-key-picker.tsx`, `ui/attribute-filter-section.tsx` — prop-driven components.

**Modified — logs domain:**
- `src/logs/sql/attribute-columns.ts` — becomes the logs column mapping (`LOGS_ATTRIBUTE_SOURCES`, `logsAttributeColumn`).
- `src/logs/sql/where.ts` — calls `buildAttributeClauses`.
- `src/logs/data/repository.ts` — `attributeKeys`/`attributeValues` call the shared builders.
- `src/logs/schemas.ts` — re-export shared attribute types; drop the duplicated definitions.
- `src/logs/data/options.ts` — `logAttributeKeysOptions`/`logAttributeValuesOptions` wrap the shared options with `domain: "logs"`.
- `src/logs/ui/log-attribute-config.ts` (new) — `LOGS_PROMOTED_ATTRIBUTES`, `LOGS_EXCLUDED_KEYS`, `LOGS_ATTRIBUTE_SOURCES_UI`.
- `src/logs/ui/log-filters.tsx` — render the shared `AttributeFilterSection` with logs props.

**Deleted — logs domain (moved to shared):**
- `src/logs/sql/attribute-keys.ts` (+ `.test.ts`)
- `src/logs/sql/attribute-values.ts` (+ `.test.ts`)
- `src/logs/ui/attribute-meta.ts` (+ `.test.ts`)
- `src/logs/ui/attribute-filter-pill.tsx` (+ `.test.tsx`)
- `src/logs/ui/attribute-key-picker.tsx` (+ `.test.tsx`)
- `src/logs/ui/attribute-filter-section.tsx`

---

## Task 1: Shared schemas

**Files:**
- Create: `src/attribute-filter/schemas.ts`
- Test: `src/attribute-filter/schemas.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/attribute-filter/schemas.test.ts
import { describe, expect, it } from "vitest";
import {
  AttributeFilterSchema,
  AttributeOpSchema,
  AttributeSourceSchema,
} from "./schemas";

describe("attribute-filter schemas", () => {
  it("accepts all four sources (superset across domains)", () => {
    for (const s of ["resource", "log", "scope", "span"]) {
      expect(AttributeSourceSchema.parse(s)).toBe(s);
    }
  });

  it("lists ops in display order", () => {
    expect(AttributeOpSchema.options).toEqual([
      "in",
      "not_in",
      "exists",
      "missing",
    ]);
  });

  it("defaults values to an empty array", () => {
    expect(
      AttributeFilterSchema.parse({ source: "resource", key: "k", op: "in" }),
    ).toEqual({ source: "resource", key: "k", op: "in", values: [] });
  });

  it("rejects an empty key", () => {
    expect(() =>
      AttributeFilterSchema.parse({ source: "log", key: "", op: "exists" }),
    ).toThrow();
  });

  // Exercises the type-only exports so the dead-code check sees them used
  // before their SQL/repository consumers land in later tasks.
  it("types the discovery inputs and key shape", () => {
    const key: AttributeKey = { source: "span", key: "http.route" };
    const keysIn: AttributeKeysInput = { timeRange: { from: "now-1h", to: "now" } };
    const valsIn: AttributeValuesInput = {
      timeRange: { from: "now-1h", to: "now" },
      source: "resource",
      key: "k",
    };
    expect([key.key, keysIn.timeRange.to, valsIn.source]).toEqual([
      "http.route",
      "now",
      "resource",
    ]);
  });
});
```

Update the test's import to include the types:

```ts
import {
  AttributeFilterSchema,
  AttributeOpSchema,
  AttributeSourceSchema,
  type AttributeKey,
  type AttributeKeysInput,
  type AttributeValuesInput,
} from "./schemas";
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `pnpm vitest run src/attribute-filter/schemas.test.ts`
Expected: FAIL — cannot resolve `./schemas`.

- [ ] **Step 3: Implement**

```ts
// src/attribute-filter/schemas.ts
import type { TimeRange } from "@everr/ui/lib/time-range";
import { z } from "zod";

// Superset of every domain's attribute maps. Logs/errors use resource|log|scope;
// traces use resource|span. Validation is permissive; each domain restricts
// which sources it offers in the UI and maps to columns in SQL.
export const AttributeSourceSchema = z.enum([
  "resource",
  "log",
  "scope",
  "span",
]);
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

export interface AttributeKey {
  source: AttributeSource;
  key: string;
}

export interface AttributeKeysInput {
  timeRange: TimeRange;
}

export interface AttributeValuesInput {
  timeRange: TimeRange;
  source: AttributeSource;
  key: string;
}
```

- [ ] **Step 4: Run it to confirm it passes**

Run: `pnpm vitest run src/attribute-filter/schemas.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/attribute-filter/schemas.ts src/attribute-filter/schemas.test.ts
git commit -m "Add shared attribute-filter schemas"
```

---

## Task 2: Shared attribute-clause builder

**Files:**
- Create: `src/attribute-filter/sql/where.ts`
- Test: `src/attribute-filter/sql/where.test.ts`

This ports the attribute switch from `src/logs/sql/where.ts` verbatim, parameterized over a `columnFor` mapping and a `startIndex`. (`sql/types.ts` is created in Task 3, where its first consumer lives, so the dead-code check never sees `BuiltQuery` unused.)

- [ ] **Step 1: Write the failing test**

```ts
// src/attribute-filter/sql/where.test.ts
import { describe, expect, it } from "vitest";
import type { AttributeSource } from "../schemas";
import { buildAttributeClauses } from "./where";

const columnFor = (s: AttributeSource) =>
  ({
    resource: "ResourceAttributes",
    log: "LogAttributes",
    scope: "ScopeAttributes",
    span: "SpanAttributes",
  })[s];

describe("buildAttributeClauses", () => {
  it("builds an IN clause with indexed params", () => {
    const { clauses, params } = buildAttributeClauses(
      [{ source: "resource", key: "deployment.environment", op: "in", values: ["prod"] }],
      columnFor,
    );
    expect(clauses[0]).toBe(
      "mapContains(ResourceAttributes, {attrKey0:String}) AND ResourceAttributes[{attrKey0:String}] IN {attrVals0:Array(String)}",
    );
    expect(params).toEqual({
      attrKey0: "deployment.environment",
      attrVals0: ["prod"],
    });
  });

  it("treats not_in as including missing-key rows", () => {
    const { clauses } = buildAttributeClauses(
      [{ source: "log", key: "http.method", op: "not_in", values: ["GET"] }],
      columnFor,
    );
    expect(clauses[0]).toBe(
      "(NOT mapContains(LogAttributes, {attrKey0:String}) OR LogAttributes[{attrKey0:String}] NOT IN {attrVals0:Array(String)})",
    );
  });

  it("emits presence-only clauses for exists and missing", () => {
    const exists = buildAttributeClauses(
      [{ source: "scope", key: "k", op: "exists", values: [] }],
      columnFor,
    );
    expect(exists.clauses[0]).toBe("mapContains(ScopeAttributes, {attrKey0:String})");
    expect(exists.params).toEqual({ attrKey0: "k" });

    const missing = buildAttributeClauses(
      [{ source: "span", key: "k", op: "missing", values: [] }],
      columnFor,
    );
    expect(missing.clauses[0]).toBe("NOT mapContains(SpanAttributes, {attrKey0:String})");
  });

  it("no-ops empty-value in/not_in (no clause, no param)", () => {
    expect(
      buildAttributeClauses(
        [{ source: "resource", key: "k", op: "in", values: [] }],
        columnFor,
      ),
    ).toEqual({ clauses: [], params: {} });
  });

  it("offsets param names by startIndex", () => {
    const { clauses, params } = buildAttributeClauses(
      [{ source: "resource", key: "k", op: "exists", values: [] }],
      columnFor,
      3,
    );
    expect(clauses[0]).toBe("mapContains(ResourceAttributes, {attrKey3:String})");
    expect(params).toEqual({ attrKey3: "k" });
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `pnpm vitest run src/attribute-filter/sql/where.test.ts`
Expected: FAIL — cannot resolve `./where`.

- [ ] **Step 3: Implement**

```ts
// src/attribute-filter/sql/where.ts
import type { AttributeFilter, AttributeSource } from "../schemas";

// Builds the attribute-map predicates shared by every domain's WHERE clause.
// `columnFor` maps a source to its ClickHouse Map column; `startIndex` lets a
// caller that already has positional params avoid name collisions. Param names
// are `attrKey{i}` / `attrVals{i}`.
export function buildAttributeClauses(
  attributes: AttributeFilter[],
  columnFor: (source: AttributeSource) => string,
  startIndex = 0,
): { clauses: string[]; params: Record<string, unknown> } {
  const clauses: string[] = [];
  const params: Record<string, unknown> = {};

  attributes.forEach((filter, i) => {
    const index = startIndex + i;
    const column = columnFor(filter.source);
    const keyParam = `attrKey${index}`;
    const valsParam = `attrVals${index}`;
    const contains = `mapContains(${column}, {${keyParam}:String})`;
    const access = `${column}[{${keyParam}:String}]`;

    switch (filter.op) {
      case "in":
        if (filter.values.length === 0) return;
        params[keyParam] = filter.key;
        clauses.push(`${contains} AND ${access} IN {${valsParam}:Array(String)}`);
        params[valsParam] = filter.values;
        break;
      case "not_in":
        if (filter.values.length === 0) return;
        params[keyParam] = filter.key;
        clauses.push(
          `(NOT ${contains} OR ${access} NOT IN {${valsParam}:Array(String)})`,
        );
        params[valsParam] = filter.values;
        break;
      case "exists":
        params[keyParam] = filter.key;
        clauses.push(contains);
        break;
      case "missing":
        params[keyParam] = filter.key;
        clauses.push(`NOT ${contains}`);
        break;
    }
  });

  return { clauses, params };
}
```

- [ ] **Step 4: Run it to confirm it passes**

Run: `pnpm vitest run src/attribute-filter/sql/where.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/attribute-filter/sql/where.ts src/attribute-filter/sql/where.test.ts
git commit -m "Add shared attribute-clause SQL builder"
```

---

## Task 3: Shared attribute-keys query builder

**Files:**
- Create: `src/attribute-filter/sql/types.ts`
- Create: `src/attribute-filter/sql/keys.ts`
- Test: `src/attribute-filter/sql/keys.test.ts`

Ports `src/logs/sql/attribute-keys.ts`, replacing the hardcoded `ATTRIBUTE_SOURCES`/`attributeColumn` with injected `sources` + `columnFor`. Also creates `sql/types.ts` (`BuiltQuery`), first consumed here.

- [ ] **Step 1: Write the failing test**

```ts
// src/attribute-filter/sql/keys.test.ts
import { describe, expect, it } from "vitest";
import type { AttributeSource } from "../schemas";
import { buildAttributeKeysQuery, decodeAttributeKeyRows } from "./keys";

const columnFor = (s: AttributeSource) =>
  ({ resource: "ResourceAttributes", span: "SpanAttributes" })[s] ?? "";

describe("buildAttributeKeysQuery", () => {
  it("unions a SELECT per requested source and binds the time range", () => {
    const { sql, params } = buildAttributeKeysQuery(
      { timeRange: { from: "now-1h", to: "now" } },
      { tableName: "traces", sources: ["resource", "span"], columnFor },
    );
    expect(sql).toContain("mapKeys(ResourceAttributes)");
    expect(sql).toContain("'resource' AS source");
    expect(sql).toContain("mapKeys(SpanAttributes)");
    expect(sql).toContain("'span' AS source");
    expect(sql).toContain("UNION ALL");
    expect(sql).toContain("LIMIT 500");
    expect(params.fromTime).toBeDefined();
    expect(params.toTime).toBeDefined();
  });

  it("rejects an invalid table name", () => {
    expect(() =>
      buildAttributeKeysQuery(
        { timeRange: { from: "now-1h", to: "now" } },
        { tableName: "bad; DROP", sources: ["resource"], columnFor },
      ),
    ).toThrow();
  });

  it("decodes rows into {source, key}", () => {
    expect(
      decodeAttributeKeyRows([{ key: "http.route", source: "span" }]),
    ).toEqual([{ source: "span", key: "http.route" }]);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `pnpm vitest run src/attribute-filter/sql/keys.test.ts`
Expected: FAIL — cannot resolve `./keys`.

- [ ] **Step 3: Implement both files**

```ts
// src/attribute-filter/sql/types.ts
export type BuiltQuery = { sql: string; params: Record<string, unknown> };
```

```ts
// src/attribute-filter/sql/keys.ts
import { resolveTimeRange, type TimeRange } from "@everr/ui/lib/time-range";
import { validateTableName } from "../../sql/table";
import type { AttributeKey, AttributeSource } from "../schemas";
import type { BuiltQuery } from "./types";

const KEY_LIMIT = 500;

export interface AttributeKeyRowRaw {
  key: string;
  source: AttributeSource;
}

export function buildAttributeKeysQuery(
  input: { timeRange: TimeRange },
  opts: {
    tableName: string;
    sources: AttributeSource[];
    columnFor: (source: AttributeSource) => string;
  },
): BuiltQuery {
  validateTableName(opts.tableName);
  const { fromISO, toISO } = resolveTimeRange(input.timeRange);
  const selects = opts.sources.map(
    (source) => `
        SELECT DISTINCT arrayJoin(mapKeys(${opts.columnFor(source)})) AS key, '${source}' AS source
        FROM ${opts.tableName}
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
): AttributeKey[] {
  return rows.map((row) => ({ source: row.source, key: row.key }));
}
```

> Note: assumes the target table exposes a `TimestampTime` column (true for the logs and traces OTel tables). The errors/traces plans will confirm per-domain.

- [ ] **Step 4: Run it to confirm it passes**

Run: `pnpm vitest run src/attribute-filter/sql/keys.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/attribute-filter/sql/keys.ts src/attribute-filter/sql/keys.test.ts
git commit -m "Add shared attribute-keys query builder"
```

---

## Task 4: Shared attribute-values query builder

**Files:**
- Create: `src/attribute-filter/sql/values.ts`
- Test: `src/attribute-filter/sql/values.test.ts`

Ports `src/logs/sql/attribute-values.ts` with injected `columnFor`.

- [ ] **Step 1: Write the failing test**

```ts
// src/attribute-filter/sql/values.test.ts
import { describe, expect, it } from "vitest";
import type { AttributeSource } from "../schemas";
import { buildAttributeValuesQuery, decodeAttributeValueRows } from "./values";

const columnFor = (s: AttributeSource) =>
  ({ resource: "ResourceAttributes", span: "SpanAttributes" })[s] ?? "";

describe("buildAttributeValuesQuery", () => {
  it("selects distinct non-empty values for the key with the source column", () => {
    const { sql, params } = buildAttributeValuesQuery(
      { timeRange: { from: "now-1h", to: "now" }, source: "span", key: "http.route" },
      { tableName: "traces", columnFor },
    );
    expect(sql).toContain("SpanAttributes[{key:String}] AS v");
    expect(sql).toContain("mapContains(SpanAttributes, {key:String})");
    expect(sql).toContain("LIMIT 100");
    expect(params.key).toBe("http.route");
    expect(params.fromTime).toBeDefined();
  });

  it("rejects an invalid table name", () => {
    expect(() =>
      buildAttributeValuesQuery(
        { timeRange: { from: "now-1h", to: "now" }, source: "resource", key: "k" },
        { tableName: "bad name", columnFor },
      ),
    ).toThrow();
  });

  it("decodes value rows", () => {
    expect(decodeAttributeValueRows([{ v: "GET" }, { v: "POST" }])).toEqual([
      "GET",
      "POST",
    ]);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `pnpm vitest run src/attribute-filter/sql/values.test.ts`
Expected: FAIL — cannot resolve `./values`.

- [ ] **Step 3: Implement**

```ts
// src/attribute-filter/sql/values.ts
import { resolveTimeRange, type TimeRange } from "@everr/ui/lib/time-range";
import { validateTableName } from "../../sql/table";
import type { AttributeSource } from "../schemas";
import type { BuiltQuery } from "./types";

const VALUE_LIMIT = 100;

export interface AttributeValueRowRaw {
  v: string;
}

export function buildAttributeValuesQuery(
  input: { timeRange: TimeRange; source: AttributeSource; key: string },
  opts: { tableName: string; columnFor: (source: AttributeSource) => string },
): BuiltQuery {
  validateTableName(opts.tableName);
  const column = opts.columnFor(input.source);
  const { fromISO, toISO } = resolveTimeRange(input.timeRange);
  const sql = `
      SELECT DISTINCT ${column}[{key:String}] AS v
      FROM ${opts.tableName}
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

- [ ] **Step 4: Run it to confirm it passes**

Run: `pnpm vitest run src/attribute-filter/sql/values.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/attribute-filter/sql/values.ts src/attribute-filter/sql/values.test.ts
git commit -m "Add shared attribute-values query builder"
```

---

## Task 5: Shared repository interface + query options

**Files:**
- Create: `src/attribute-filter/repository.ts`
- Create: `src/attribute-filter/options.ts`
- Test: `src/attribute-filter/options.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/attribute-filter/options.test.ts
import { describe, expect, it } from "vitest";
import { attributeKeysOptions, attributeValuesOptions } from "./options";
import type { AttributeRepositoryLike } from "./repository";

const repo = {} as AttributeRepositoryLike;
const timeRange = { from: "now-1h", to: "now" };

describe("attribute options", () => {
  it("namespaces the keys query by domain", () => {
    const opts = attributeKeysOptions(repo, { timeRange }, { domain: "traces" });
    expect(opts.queryKey).toEqual(["traces", "attributeKeys", timeRange]);
  });

  it("namespaces the values query by domain, source, and key", () => {
    const opts = attributeValuesOptions(
      repo,
      { timeRange, source: "span", key: "http.route" },
      { domain: "traces" },
    );
    expect(opts.queryKey).toEqual([
      "traces",
      "attributeValues",
      timeRange,
      "span",
      "http.route",
    ]);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `pnpm vitest run src/attribute-filter/options.test.ts`
Expected: FAIL — cannot resolve `./options`.

- [ ] **Step 3: Implement both files**

```ts
// src/attribute-filter/repository.ts
import type {
  AttributeKey,
  AttributeKeysInput,
  AttributeValuesInput,
} from "./schemas";

// The slice of a domain repository the attribute-filter UI needs. Each domain's
// repository (logs, errors, traces) implements these two methods.
export type AttributeRepositoryLike = {
  attributeKeys(input: AttributeKeysInput): Promise<AttributeKey[]>;
  attributeValues(input: AttributeValuesInput): Promise<string[]>;
};
```

```ts
// src/attribute-filter/options.ts
import type { TimeRange } from "@everr/ui/lib/time-range";
import type { AttributeRepositoryLike } from "./repository";
import type { AttributeSource } from "./schemas";

export function attributeKeysOptions(
  repo: AttributeRepositoryLike,
  input: { timeRange: TimeRange },
  opts: { domain: string },
) {
  return {
    queryKey: [opts.domain, "attributeKeys", input.timeRange] as const,
    queryFn: () => repo.attributeKeys(input),
  };
}

export function attributeValuesOptions(
  repo: AttributeRepositoryLike,
  input: { timeRange: TimeRange; source: AttributeSource; key: string },
  opts: { domain: string },
) {
  return {
    queryKey: [
      opts.domain,
      "attributeValues",
      input.timeRange,
      input.source,
      input.key,
    ] as const,
    queryFn: () => repo.attributeValues(input),
  };
}
```

- [ ] **Step 4: Run it to confirm it passes**

Run: `pnpm vitest run src/attribute-filter/options.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/attribute-filter/repository.ts src/attribute-filter/options.ts src/attribute-filter/options.test.ts
git commit -m "Add shared attribute repository interface and query options"
```

---

## Task 6: Shared UI metadata

**Files:**
- Create: `src/attribute-filter/ui/attribute-meta.ts`
- Test: `src/attribute-filter/ui/attribute-meta.test.ts`

Ports `src/logs/ui/attribute-meta.ts` but **without** `PROMOTED_ATTRIBUTES` (now per-domain), and **adds** `span: "Span"` to the source labels. Exports a `PromotedAttribute` type for domains to use.

- [ ] **Step 1: Write the failing test**

```ts
// src/attribute-filter/ui/attribute-meta.test.ts
import { describe, expect, it } from "vitest";
import {
  ATTRIBUTE_OP_CONNECTORS,
  ATTRIBUTE_OP_LABELS,
  ATTRIBUTE_SOURCE_LABELS,
  attributeLabel,
  opTakesValues,
  type PromotedAttribute,
} from "./attribute-meta";

describe("attribute metadata", () => {
  it("labels every op", () => {
    expect(ATTRIBUTE_OP_LABELS).toEqual({
      in: "Is",
      not_in: "Is not",
      exists: "Exists",
      missing: "Missing",
    });
  });

  it("provides a lowercase connector for every op", () => {
    expect(ATTRIBUTE_OP_CONNECTORS).toEqual({
      in: "is",
      not_in: "is not",
      exists: "exists",
      missing: "missing",
    });
  });

  it("labels every source including span", () => {
    expect(ATTRIBUTE_SOURCE_LABELS).toEqual({
      resource: "Resource",
      log: "Log",
      scope: "Scope",
      span: "Span",
    });
  });

  it("knows which ops take values", () => {
    expect(opTakesValues("in")).toBe(true);
    expect(opTakesValues("not_in")).toBe(true);
    expect(opTakesValues("exists")).toBe(false);
    expect(opTakesValues("missing")).toBe(false);
  });

  it("returns a friendly label for known keys, undefined otherwise", () => {
    expect(attributeLabel("service.name")).toBe("Service");
    expect(attributeLabel("http.route")).toBe("Route");
    expect(attributeLabel("custom.unknown.thing")).toBeUndefined();
  });

  // Keeps the type-only export reachable for the dead-code check before the
  // picker/section consume it.
  it("types a promoted attribute", () => {
    const p: PromotedAttribute = { source: "resource", key: "host.name" };
    expect(p.key).toBe("host.name");
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `pnpm vitest run src/attribute-filter/ui/attribute-meta.test.ts`
Expected: FAIL — cannot resolve `./attribute-meta`.

- [ ] **Step 3: Implement**

```ts
// src/attribute-filter/ui/attribute-meta.ts
import type { AttributeOp, AttributeSource } from "../schemas";

export const ATTRIBUTE_OP_LABELS: Record<AttributeOp, string> = {
  in: "Is",
  not_in: "Is not",
  exists: "Exists",
  missing: "Missing",
};

// Lowercase connectors used when rendering a filter inline as a pill
// (e.g. "Environment is production").
export const ATTRIBUTE_OP_CONNECTORS: Record<AttributeOp, string> = {
  in: "is",
  not_in: "is not",
  exists: "exists",
  missing: "missing",
};

// Whether an op takes a list of values (vs. presence-only checks).
export function opTakesValues(op: AttributeOp): boolean {
  return op === "in" || op === "not_in";
}

export const ATTRIBUTE_SOURCE_LABELS: Record<AttributeSource, string> = {
  resource: "Resource",
  log: "Log",
  scope: "Scope",
  span: "Span",
};

// Friendly display names for well-known OTel attribute keys, keyed by raw key.
// Unknown keys fall back to the raw key in the UI.
const KNOWN_ATTRIBUTE_LABELS: Record<string, string> = {
  "service.name": "Service",
  "service.namespace": "Namespace",
  "service.version": "Version",
  "service.instance.id": "Instance",
  "deployment.environment": "Environment",
  "deployment.environment.name": "Environment",
  "host.name": "Host",
  "host.arch": "Host arch",
  "os.type": "OS",
  "process.runtime.name": "Runtime",
  "telemetry.sdk.name": "SDK",
  "telemetry.sdk.language": "SDK language",
  "vcs.repository.name": "Repository",
  "vcs.ref.head.name": "Branch",
  "k8s.pod.name": "Pod",
  "k8s.namespace.name": "K8s namespace",
  "k8s.node.name": "Node",
  "container.name": "Container",
  "http.route": "Route",
  "http.request.method": "HTTP method",
  "db.system": "DB system",
  "rpc.method": "RPC method",
};

export function attributeLabel(key: string): string | undefined {
  return KNOWN_ATTRIBUTE_LABELS[key];
}

// A promoted ("Suggested") attribute, supplied per domain.
export interface PromotedAttribute {
  source: AttributeSource;
  key: string;
}
```

> Note: the four span/HTTP/DB/RPC entries are additions so traces (Phase 2) get friendly names; they don't affect logs.

- [ ] **Step 4: Run it to confirm it passes**

Run: `pnpm vitest run src/attribute-filter/ui/attribute-meta.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/attribute-filter/ui/attribute-meta.ts src/attribute-filter/ui/attribute-meta.test.ts
git commit -m "Add shared attribute UI metadata"
```

---

## Task 7: Shared attribute-filter pill

**Files:**
- Create: `src/attribute-filter/ui/attribute-filter-pill.tsx`
- Test: `src/attribute-filter/ui/attribute-filter-pill.test.tsx`

Ports `src/logs/ui/attribute-filter-pill.tsx`. Changes vs. the logs original: repo type is `AttributeRepositoryLike`; values come from the shared `attributeValuesOptions` (passed a `domain`); the component gains a required `domain` prop. Everything visual is unchanged.

- [ ] **Step 1: Write the failing test**

```tsx
// src/attribute-filter/ui/attribute-filter-pill.test.tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { AttributeRepositoryLike } from "../repository";
import type { AttributeFilter } from "../schemas";
import { AttributeFilterPill } from "./attribute-filter-pill";

const timeRange = { from: "now-1h", to: "now" };

function renderPill(filter: AttributeFilter, opts: { defaultOpen?: boolean } = {}) {
  const repo = {
    attributeValues: vi.fn().mockResolvedValue(["production", "staging"]),
  } as unknown as AttributeRepositoryLike;
  const onChange = vi.fn();
  const onRemove = vi.fn();
  render(
    <QueryClientProvider client={new QueryClient()}>
      <AttributeFilterPill
        repo={repo}
        domain="logs"
        timeRange={timeRange}
        filter={filter}
        defaultOpen={opts.defaultOpen}
        onChange={onChange}
        onRemove={onRemove}
      />
    </QueryClientProvider>,
  );
  return { onChange, onRemove };
}

const baseFilter: AttributeFilter = {
  source: "resource",
  key: "deployment.environment",
  op: "in",
  values: [],
};

describe("AttributeFilterPill", () => {
  it("shows friendly name, connector, and 'any value' for a pending in-filter", () => {
    renderPill(baseFilter);
    expect(screen.getByText("Environment")).toBeInTheDocument();
    expect(screen.getByText("is")).toBeInTheDocument();
    expect(screen.getByText("any value")).toBeInTheDocument();
  });

  it("summarizes selected values with an overflow count", () => {
    renderPill({ ...baseFilter, values: ["production", "staging"] });
    expect(screen.getByText("production +1")).toBeInTheDocument();
  });

  it("falls back to the raw key for an unknown attribute", () => {
    renderPill({ ...baseFilter, key: "custom.unknown.thing" });
    expect(screen.getByText("custom.unknown.thing")).toBeInTheDocument();
  });

  it("exposes the raw attribute key as a hover title", () => {
    renderPill(baseFilter);
    expect(screen.getByTitle("deployment.environment")).toBeInTheDocument();
  });

  it("removes the filter when the remove button is clicked", () => {
    const { onRemove } = renderPill(baseFilter);
    fireEvent.click(screen.getByLabelText("Remove Environment filter"));
    expect(onRemove).toHaveBeenCalledTimes(1);
  });

  it("opens the editor and lists readable op labels", () => {
    renderPill(baseFilter);
    fireEvent.click(screen.getByText("Environment"));
    expect(screen.getByText("Is not")).toBeInTheDocument();
    expect(screen.getByText("Exists")).toBeInTheDocument();
    expect(screen.getByText("Missing")).toBeInTheDocument();
  });

  it("loads and toggles discovered values for in/not_in", async () => {
    const { onChange } = renderPill(baseFilter, { defaultOpen: true });
    expect(screen.getByPlaceholderText("Search values...")).toBeInTheDocument();
    fireEvent.click(await screen.findByText("production"));
    expect(onChange).toHaveBeenCalledWith({ ...baseFilter, values: ["production"] });
  });

  it("hides the value picker for exists/missing", () => {
    renderPill({ ...baseFilter, op: "missing" }, { defaultOpen: true });
    expect(screen.queryByPlaceholderText("Search values...")).not.toBeInTheDocument();
  });

  it("changes the op when an op button is clicked", () => {
    const { onChange } = renderPill(baseFilter, { defaultOpen: true });
    fireEvent.click(screen.getByText("Is not"));
    expect(onChange).toHaveBeenCalledWith({ ...baseFilter, op: "not_in" });
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `pnpm vitest run src/attribute-filter/ui/attribute-filter-pill.test.tsx`
Expected: FAIL — cannot resolve `./attribute-filter-pill`.

- [ ] **Step 3: Implement** (the logs pill, re-pointed imports + `domain` prop)

```tsx
// src/attribute-filter/ui/attribute-filter-pill.tsx
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
import { cn } from "@everr/ui/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { X } from "lucide-react";
import { useState } from "react";
import { attributeValuesOptions } from "../options";
import type { AttributeRepositoryLike } from "../repository";
import type { AttributeFilter, AttributeOp } from "../schemas";
import {
  ATTRIBUTE_OP_CONNECTORS,
  ATTRIBUTE_OP_LABELS,
  attributeLabel,
  opTakesValues,
} from "./attribute-meta";

const OPS: AttributeOp[] = ["in", "not_in", "exists", "missing"];

function valueSummary(values: string[]): string | null {
  if (values.length === 0) return null;
  const extra = values.length - 1;
  return extra > 0 ? `${values[0]} +${extra}` : values[0];
}

function PillEditor({
  repo,
  domain,
  timeRange,
  filter,
  onChange,
}: {
  repo: AttributeRepositoryLike;
  domain: string;
  timeRange: TimeRange;
  filter: AttributeFilter;
  onChange: (next: AttributeFilter) => void;
}) {
  const name = attributeLabel(filter.key);
  const showValues = opTakesValues(filter.op);
  const { data: values = [], isLoading } = useQuery({
    ...attributeValuesOptions(
      repo,
      { timeRange, source: filter.source, key: filter.key },
      { domain },
    ),
    enabled: showValues,
  });

  const toggleValue = (value: string) => {
    const next = filter.values.includes(value)
      ? filter.values.filter((v) => v !== value)
      : [...filter.values, value];
    onChange({ ...filter, values: next });
  };

  return (
    <div className="flex flex-col">
      <div className="border-b px-2.5 py-2">
        <div className="truncate text-xs font-medium">{name ?? filter.key}</div>
        {name ? (
          <div className="text-muted-foreground truncate font-mono text-[10px]">
            {filter.key}
          </div>
        ) : null}
      </div>

      <div className="flex gap-1 p-1.5">
        {OPS.map((op) => (
          <button
            key={op}
            type="button"
            data-active={filter.op === op || undefined}
            aria-pressed={filter.op === op}
            onClick={() => onChange({ ...filter, op })}
            className={cn(
              "flex-1 rounded px-1.5 py-1 text-[11px] transition-colors",
              "text-muted-foreground hover:bg-muted/70",
              "outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
              "data-active:bg-muted data-active:text-foreground data-active:font-medium",
            )}
          >
            {ATTRIBUTE_OP_LABELS[op]}
          </button>
        ))}
      </div>

      {showValues ? (
        <Command className="*-data-[slot=command-input-wrapper]:p-0 rounded-none border-t p-0">
          <CommandInput
            wrapperClassName="p-0 border-b"
            inputGroupClassName="border-none rounded-none bg-transparent h-8"
            placeholder="Search values..."
          />
          <CommandList>
            <CommandEmpty>{isLoading ? "Loading..." : "No values."}</CommandEmpty>
            <CommandGroup>
              {values.map((value: string) => (
                <CommandItem
                  key={value}
                  value={value}
                  data-checked={filter.values.includes(value) || undefined}
                  onSelect={() => toggleValue(value)}
                >
                  <span className="truncate">{value}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      ) : null}
    </div>
  );
}

export function AttributeFilterPill({
  repo,
  domain,
  timeRange,
  filter,
  onChange,
  onRemove,
  defaultOpen = false,
}: {
  repo: AttributeRepositoryLike;
  domain: string;
  timeRange: TimeRange;
  filter: AttributeFilter;
  onChange: (next: AttributeFilter) => void;
  onRemove: () => void;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const name = attributeLabel(filter.key) ?? filter.key;
  const connector = ATTRIBUTE_OP_CONNECTORS[filter.op];
  const summary = opTakesValues(filter.op) ? valueSummary(filter.values) : null;

  return (
    <div className="bg-background ring-offset-background focus-within:border-ring focus-within:ring-primary flex w-full items-stretch overflow-hidden rounded-md border text-xs shadow-xs focus-within:ring-2 focus-within:ring-offset-[3px]">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          render={
            <button
              type="button"
              title={filter.key}
              className="hover:bg-muted/60 flex min-w-0 flex-1 flex-col gap-0.5 px-2 py-1.5 text-left outline-none transition-colors"
            />
          }
        >
          <span className="flex min-w-0 items-center gap-1">
            <span className="truncate font-medium">{name}</span>
            <span className="text-muted-foreground shrink-0">{connector}</span>
          </span>
          {opTakesValues(filter.op) ? (
            <span className="truncate">
              {summary ?? (
                <span className="text-muted-foreground/70 italic">any value</span>
              )}
            </span>
          ) : null}
        </PopoverTrigger>
        <PopoverContent align="start" className="w-64 overflow-hidden p-0">
          <PillEditor
            repo={repo}
            domain={domain}
            timeRange={timeRange}
            filter={filter}
            onChange={onChange}
          />
        </PopoverContent>
      </Popover>
      <button
        type="button"
        aria-label={`Remove ${name} filter`}
        className="hover:bg-muted text-muted-foreground hover:text-foreground flex items-center justify-center border-l px-1.5 outline-none transition-colors"
        onClick={onRemove}
      >
        <X className="size-3" />
      </button>
    </div>
  );
}
```

- [ ] **Step 4: Run it to confirm it passes**

Run: `pnpm vitest run src/attribute-filter/ui/attribute-filter-pill.test.tsx`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add src/attribute-filter/ui/attribute-filter-pill.tsx src/attribute-filter/ui/attribute-filter-pill.test.tsx
git commit -m "Add shared attribute-filter pill"
```

---

## Task 8: Shared attribute-key picker

**Files:**
- Create: `src/attribute-filter/ui/attribute-key-picker.tsx`
- Test: `src/attribute-filter/ui/attribute-key-picker.test.tsx`

Ports `src/logs/ui/attribute-key-picker.tsx` (the current version, including the in-range `Suggested` filtering and the excluded-key support). Changes: repo type `AttributeRepositoryLike`; keys from shared `attributeKeysOptions` with `domain`; `promotedAttributes`, `excludedKeys`, and `sources` are **props**.

- [ ] **Step 1: Write the failing test**

```tsx
// src/attribute-filter/ui/attribute-key-picker.test.tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { AttributeRepositoryLike } from "../repository";
import type { AttributeSource } from "../schemas";
import { AttributeKeyPicker } from "./attribute-key-picker";
import type { PromotedAttribute } from "./attribute-meta";

const timeRange = { from: "now-1h", to: "now" };
const PROMOTED: PromotedAttribute[] = [
  { source: "resource", key: "vcs.repository.name" },
];
const EXCLUDED = new Set(["resource:service.name"]);
const SOURCES: AttributeSource[] = ["resource", "log", "scope"];

function renderPicker(
  activeKeys?: ReadonlySet<string>,
  keys: { source: string; key: string }[] = [
    { source: "resource", key: "vcs.repository.name" },
    { source: "log", key: "custom.unknown.thing" },
  ],
) {
  const repo = {
    attributeKeys: vi.fn().mockResolvedValue(keys),
  } as unknown as AttributeRepositoryLike;
  const onSelect = vi.fn();
  render(
    <QueryClientProvider client={new QueryClient()}>
      <AttributeKeyPicker
        repo={repo}
        domain="logs"
        timeRange={timeRange}
        activeKeys={activeKeys}
        promotedAttributes={PROMOTED}
        excludedKeys={EXCLUDED}
        sources={SOURCES}
        onSelect={onSelect}
      />
    </QueryClientProvider>,
  );
  return { onSelect };
}

describe("AttributeKeyPicker", () => {
  it("pins in-range promoted attributes under a Suggested group", async () => {
    renderPicker();
    fireEvent.click(screen.getByText("Filter"));
    expect(await screen.findByText("Suggested")).toBeInTheDocument();
    expect(screen.getByText("Repository")).toBeInTheDocument();
    expect(screen.getByText("vcs.repository.name")).toBeInTheDocument();
  });

  it("shows discovered non-promoted keys (raw key when unknown)", async () => {
    renderPicker();
    fireEvent.click(screen.getByText("Filter"));
    expect(await screen.findByText("custom.unknown.thing")).toBeInTheDocument();
  });

  it("hides keys that are already active", async () => {
    renderPicker(new Set(["resource:vcs.repository.name"]));
    fireEvent.click(screen.getByText("Filter"));
    await screen.findByText("custom.unknown.thing");
    expect(screen.queryByText("Repository")).not.toBeInTheDocument();
  });

  it("omits promoted attributes absent from the discovered range", async () => {
    renderPicker(undefined, [{ source: "log", key: "custom.unknown.thing" }]);
    fireEvent.click(screen.getByText("Filter"));
    await screen.findByText("custom.unknown.thing");
    expect(screen.queryByText("Suggested")).not.toBeInTheDocument();
    expect(screen.queryByText("Repository")).not.toBeInTheDocument();
  });

  it("hides excluded keys (service.name)", async () => {
    renderPicker(undefined, [
      { source: "resource", key: "service.name" },
      { source: "log", key: "custom.unknown.thing" },
    ]);
    fireEvent.click(screen.getByText("Filter"));
    await screen.findByText("custom.unknown.thing");
    expect(screen.queryByText("service.name")).not.toBeInTheDocument();
  });

  it("shows the empty state when the range has no attributes", async () => {
    renderPicker(undefined, []);
    fireEvent.click(screen.getByText("Filter"));
    expect(await screen.findByText("No attributes.")).toBeInTheDocument();
    expect(screen.queryByText("Suggested")).not.toBeInTheDocument();
  });

  it("matches a known item when searching by its raw key", async () => {
    renderPicker();
    fireEvent.click(screen.getByText("Filter"));
    await screen.findByText("Repository");
    fireEvent.change(screen.getByPlaceholderText("Search attributes..."), {
      target: { value: "vcs.repository" },
    });
    expect(screen.getByText("Repository")).toBeInTheDocument();
    expect(screen.queryByText("custom.unknown.thing")).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `pnpm vitest run src/attribute-filter/ui/attribute-key-picker.test.tsx`
Expected: FAIL — cannot resolve `./attribute-key-picker`.

- [ ] **Step 3: Implement**

```tsx
// src/attribute-filter/ui/attribute-key-picker.tsx
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
import { attributeKeysOptions } from "../options";
import type { AttributeRepositoryLike } from "../repository";
import type { AttributeKey, AttributeSource } from "../schemas";
import {
  ATTRIBUTE_SOURCE_LABELS,
  attributeLabel,
  type PromotedAttribute,
} from "./attribute-meta";

const filterKey = (source: AttributeSource, key: string) => `${source}:${key}`;

export function AttributeKeyPicker({
  repo,
  domain,
  timeRange,
  activeKeys,
  promotedAttributes,
  excludedKeys,
  sources,
  onSelect,
}: {
  repo: AttributeRepositoryLike;
  domain: string;
  timeRange: TimeRange;
  // Keys (`source:key`) already in use, hidden from the menu.
  activeKeys?: ReadonlySet<string>;
  promotedAttributes: PromotedAttribute[];
  // Keys (`source:key`) surfaced by a dedicated top-level filter, hidden here.
  excludedKeys: ReadonlySet<string>;
  sources: AttributeSource[];
  onSelect: (key: { source: AttributeSource; key: string }) => void;
}) {
  const [open, setOpen] = useState(false);
  const { data: keys = [], isLoading } = useQuery({
    ...attributeKeysOptions(repo, { timeRange }, { domain }),
    enabled: open,
  });

  const promotedKeySet = new Set(
    promotedAttributes.map((p) => filterKey(p.source, p.key)),
  );

  const isActive = (source: AttributeSource, key: string) =>
    activeKeys?.has(filterKey(source, key)) ?? false;

  const choose = (source: AttributeSource, key: string) => {
    onSelect({ source, key });
    setOpen(false);
  };

  const renderItem = (source: AttributeSource, key: string) => {
    const label = attributeLabel(key);
    return (
      <CommandItem
        key={filterKey(source, key)}
        value={`${source} ${label ?? ""} ${key}`}
        onSelect={() => choose(source, key)}
      >
        {label ? (
          <span className="flex min-w-0 flex-col">
            <span className="truncate">{label}</span>
            <span className="text-muted-foreground truncate font-mono text-[10px]">
              {key}
            </span>
          </span>
        ) : (
          <span className="truncate font-mono">{key}</span>
        )}
      </CommandItem>
    );
  };

  // Promoted keys are only suggested when they actually appear in the current
  // range — otherwise we'd offer a chip that can never narrow these rows and
  // hide the empty state behind it.
  const discoveredKeySet = new Set(
    keys.map((k: AttributeKey) => filterKey(k.source, k.key)),
  );

  const suggested = promotedAttributes.filter(
    (p) =>
      !isActive(p.source, p.key) &&
      discoveredKeySet.has(filterKey(p.source, p.key)),
  );

  const grouped = sources.map((source) => ({
    source,
    keys: keys.filter(
      (k: AttributeKey) =>
        k.source === source &&
        !isActive(k.source, k.key) &&
        !promotedKeySet.has(filterKey(k.source, k.key)) &&
        !excludedKeys.has(filterKey(k.source, k.key)),
    ),
  }));

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button variant="outline" size="sm" className="h-8 w-full justify-start" />
        }
      >
        <Plus className="size-3.5" />
        Filter
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-(--radix-popper-anchor-width) min-w-56 p-0"
      >
        <Command className="p-0">
          <CommandInput
            wrapperClassName="p-0 border-b"
            inputGroupClassName="border-none rounded-none bg-transparent h-8"
            placeholder="Search attributes..."
          />
          <CommandList>
            <CommandEmpty>
              {isLoading ? "Loading..." : "No attributes."}
            </CommandEmpty>
            {suggested.length > 0 && (
              <CommandGroup heading="Suggested">
                {suggested.map((p) => renderItem(p.source, p.key))}
              </CommandGroup>
            )}
            {grouped.map(
              (group) =>
                group.keys.length > 0 && (
                  <CommandGroup
                    key={group.source}
                    heading={ATTRIBUTE_SOURCE_LABELS[group.source]}
                  >
                    {group.keys.map((item: AttributeKey) =>
                      renderItem(item.source, item.key),
                    )}
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

- [ ] **Step 4: Run it to confirm it passes**

Run: `pnpm vitest run src/attribute-filter/ui/attribute-key-picker.test.tsx`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/attribute-filter/ui/attribute-key-picker.tsx src/attribute-filter/ui/attribute-key-picker.test.tsx
git commit -m "Add shared attribute-key picker"
```

---

## Task 9: Shared attribute-filter section

**Files:**
- Create: `src/attribute-filter/ui/attribute-filter-section.tsx`
- Test: `src/attribute-filter/ui/attribute-filter-section.test.tsx`

Ports `src/logs/ui/attribute-filter-section.tsx`, threading `domain`, `promotedAttributes`, `excludedKeys`, `sources` to the picker/pill.

- [ ] **Step 1: Write the failing test**

```tsx
// src/attribute-filter/ui/attribute-filter-section.test.tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { AttributeRepositoryLike } from "../repository";
import type { AttributeFilter, AttributeSource } from "../schemas";
import { AttributeFilterSection } from "./attribute-filter-section";
import type { PromotedAttribute } from "./attribute-meta";

const timeRange = { from: "now-1h", to: "now" };
const PROMOTED: PromotedAttribute[] = [];
const EXCLUDED = new Set<string>();
const SOURCES: AttributeSource[] = ["resource", "log", "scope"];

function setup(attributes: AttributeFilter[]) {
  const repo = {
    attributeKeys: vi.fn().mockResolvedValue([]),
    attributeValues: vi.fn().mockResolvedValue([]),
  } as unknown as AttributeRepositoryLike;
  const onChange = vi.fn();
  render(
    <QueryClientProvider client={new QueryClient()}>
      <AttributeFilterSection
        repo={repo}
        domain="logs"
        timeRange={timeRange}
        attributes={attributes}
        promotedAttributes={PROMOTED}
        excludedKeys={EXCLUDED}
        sources={SOURCES}
        onChange={onChange}
      />
    </QueryClientProvider>,
  );
  return { onChange };
}

describe("AttributeFilterSection", () => {
  it("renders the header and the add-filter trigger", () => {
    setup([]);
    expect(screen.getByText("Attributes")).toBeInTheDocument();
    expect(screen.getByText("Filter")).toBeInTheDocument();
  });

  it("renders a pill per active filter", () => {
    setup([{ source: "resource", key: "deployment.environment", op: "in", values: [] }]);
    expect(screen.getByText("Environment")).toBeInTheDocument();
  });

  it("removes a filter via its pill", () => {
    const { onChange } = setup([
      { source: "resource", key: "deployment.environment", op: "in", values: [] },
    ]);
    fireEvent.click(screen.getByLabelText("Remove Environment filter"));
    expect(onChange).toHaveBeenCalledWith([]);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `pnpm vitest run src/attribute-filter/ui/attribute-filter-section.test.tsx`
Expected: FAIL — cannot resolve `./attribute-filter-section`.

- [ ] **Step 3: Implement**

```tsx
// src/attribute-filter/ui/attribute-filter-section.tsx
import type { TimeRange } from "@everr/ui/lib/time-range";
import { useState } from "react";
import type { AttributeRepositoryLike } from "../repository";
import type { AttributeFilter, AttributeSource } from "../schemas";
import { AttributeFilterPill } from "./attribute-filter-pill";
import { AttributeKeyPicker } from "./attribute-key-picker";
import type { PromotedAttribute } from "./attribute-meta";

function filterKey(source: AttributeSource, key: string) {
  return `${source}:${key}`;
}

export function AttributeFilterSection({
  repo,
  domain,
  timeRange,
  attributes,
  promotedAttributes,
  excludedKeys,
  sources,
  onChange,
}: {
  repo: AttributeRepositoryLike;
  domain: string;
  timeRange: TimeRange;
  attributes: AttributeFilter[];
  promotedAttributes: PromotedAttribute[];
  excludedKeys: ReadonlySet<string>;
  sources: AttributeSource[];
  onChange: (next: AttributeFilter[]) => void;
}) {
  // The filter just added — its pill mounts with its editor open so the user
  // can pick values immediately.
  const [lastAdded, setLastAdded] = useState<string | null>(null);

  const activeKeys = new Set(attributes.map((f) => filterKey(f.source, f.key)));

  const addFilter = (source: AttributeSource, key: string) => {
    if (activeKeys.has(filterKey(source, key))) return;
    setLastAdded(filterKey(source, key));
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
      <span className="text-muted-foreground text-xs">Attributes</span>
      {attributes.length > 0 && (
        <div className="flex flex-col gap-1.5">
          {attributes.map((filter, index) => {
            const key = filterKey(filter.source, filter.key);
            return (
              <AttributeFilterPill
                key={key}
                repo={repo}
                domain={domain}
                timeRange={timeRange}
                filter={filter}
                defaultOpen={key === lastAdded}
                onChange={(next) => updateAt(index, next)}
                onRemove={() => removeAt(index)}
              />
            );
          })}
        </div>
      )}
      <AttributeKeyPicker
        repo={repo}
        domain={domain}
        timeRange={timeRange}
        activeKeys={activeKeys}
        promotedAttributes={promotedAttributes}
        excludedKeys={excludedKeys}
        sources={sources}
        onSelect={({ source, key }) => addFilter(source, key)}
      />
    </div>
  );
}
```

- [ ] **Step 4: Run it to confirm it passes**

Run: `pnpm vitest run src/attribute-filter/ui/attribute-filter-section.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/attribute-filter/ui/attribute-filter-section.tsx src/attribute-filter/ui/attribute-filter-section.test.tsx
git commit -m "Add shared attribute-filter section"
```

---

## Task 10: Logs column mapping

**Files:**
- Modify: `src/logs/sql/attribute-columns.ts` (full rewrite)

Replace the self-contained column helper with one that types against the shared `AttributeSource` and exports a logs-specific `sources` list + `columnFor`. This task's exports are consumed in Tasks 11 and 12; commit it together with Task 11 if `fallow` flags the new exports as unused (the repository in Task 12 also consumes them).

- [ ] **Step 1: Rewrite the file**

```ts
// src/logs/sql/attribute-columns.ts
import type { AttributeSource } from "../../attribute-filter/schemas";

const COLUMNS: Record<string, string> = {
  resource: "ResourceAttributes",
  log: "LogAttributes",
  scope: "ScopeAttributes",
};

export const LOGS_ATTRIBUTE_SOURCES: AttributeSource[] = [
  "resource",
  "log",
  "scope",
];

export function logsAttributeColumn(source: AttributeSource): string {
  const column = COLUMNS[source];
  if (!column) throw new Error(`Unknown logs attribute source: ${source}`);
  return column;
}
```

- [ ] **Step 2: Typecheck (will surface old-name consumers)**

Run: `pnpm typecheck`
Expected: errors in `src/logs/sql/where.ts`, `src/logs/sql/attribute-keys.ts`, `src/logs/sql/attribute-values.ts` referencing the removed `attributeColumn` / `ATTRIBUTE_SOURCES`. These are fixed/deleted in Tasks 11–12. Do not commit alone — proceed.

---

## Task 11: Logs WHERE uses the shared clause builder; delete logs attribute SQL

**Files:**
- Modify: `src/logs/sql/where.ts`
- Delete: `src/logs/sql/attribute-keys.ts`, `src/logs/sql/attribute-keys.test.ts`, `src/logs/sql/attribute-values.ts`, `src/logs/sql/attribute-values.test.ts`

- [ ] **Step 1: Rewrite the attribute portion of `where.ts`**

Replace the inline `(input.attributes ?? []).forEach(...)` block with a call to the shared builder. The full file:

```ts
// src/logs/sql/where.ts
import { buildAttributeClauses } from "../../attribute-filter/sql/where";
import type { AttributeFilter, LogLevel } from "../schemas";
import { logsAttributeColumn } from "./attribute-columns";
import { LOG_LEVEL_EXPR } from "./level-expr";

export interface WhereInput {
  query?: string;
  levels: LogLevel[];
  services: string[];
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

  const attr = buildAttributeClauses(input.attributes ?? [], logsAttributeColumn);
  clauses.push(...attr.clauses);
  Object.assign(params, attr.params);

  if (input.traceId) {
    clauses.push("TraceId = {traceId:String}");
  }

  return { clause: clauses.join("\n      AND "), params };
}
```

- [ ] **Step 2: Delete the moved logs SQL files**

```bash
git rm src/logs/sql/attribute-keys.ts src/logs/sql/attribute-keys.test.ts \
       src/logs/sql/attribute-values.ts src/logs/sql/attribute-values.test.ts
```

- [ ] **Step 3: Run the logs SQL tests (regression guard)**

Run: `pnpm vitest run src/logs/sql/where.test.ts`
Expected: PASS — the existing `where.test.ts` asserts `attrKey0`/`attrVals0` and the empty-value no-op, all preserved.

- [ ] **Step 4: Commit (Tasks 10 + 11 together)**

```bash
git add src/logs/sql/attribute-columns.ts src/logs/sql/where.ts
git commit -m "Route logs WHERE through the shared attribute-clause builder"
```

---

## Task 12: Logs repository uses shared key/value builders

**Files:**
- Modify: `src/logs/data/repository.ts`

- [ ] **Step 1: Update imports and the two methods**

Replace the imports of `../sql/attribute-keys` and `../sql/attribute-values` with the shared builders, and reimplement `attributeKeys`/`attributeValues`:

Remove these import blocks:

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

Add:

```ts
import {
  type AttributeKeyRowRaw,
  buildAttributeKeysQuery,
  decodeAttributeKeyRows,
} from "../../attribute-filter/sql/keys";
import {
  type AttributeValueRowRaw,
  buildAttributeValuesQuery,
  decodeAttributeValueRows,
} from "../../attribute-filter/sql/values";
import {
  LOGS_ATTRIBUTE_SOURCES,
  logsAttributeColumn,
} from "../sql/attribute-columns";
```

Replace the method bodies:

```ts
  async attributeKeys(
    input: LogAttributeKeysInput,
  ): Promise<LogAttributeKey[]> {
    const { sql, params } = buildAttributeKeysQuery(input, {
      tableName: this.tableName,
      sources: LOGS_ATTRIBUTE_SOURCES,
      columnFor: logsAttributeColumn,
    });
    const rows = await this.client.execute<AttributeKeyRowRaw>(sql, params);
    return decodeAttributeKeyRows(rows);
  }

  async attributeValues(input: LogAttributeValuesInput): Promise<string[]> {
    const { sql, params } = buildAttributeValuesQuery(input, {
      tableName: this.tableName,
      columnFor: logsAttributeColumn,
    });
    const rows = await this.client.execute<AttributeValueRowRaw>(sql, params);
    return decodeAttributeValueRows(rows);
  }
```

(`LogAttributeKey`, `LogAttributeKeysInput`, `LogAttributeValuesInput` are still imported from `../schemas`; after Task 13 they are aliases of the shared types.)

- [ ] **Step 2: Run logs data/repository tests**

Run: `pnpm vitest run src/logs/data`
Expected: PASS — `repository.test.ts` exercises `attributeKeys`/`attributeValues`; SQL shape is identical to before.

- [ ] **Step 3: Commit**

```bash
git add src/logs/data/repository.ts
git commit -m "Build logs attribute keys/values with shared SQL builders"
```

---

## Task 13: Logs schemas re-export shared attribute types

**Files:**
- Modify: `src/logs/schemas.ts`

The logs schema currently *defines* `AttributeSourceSchema`, `AttributeOpSchema`, `AttributeFilterSchema`, `LogAttributeKey`, `LogAttributeKeysInputSchema`/`Input`, `LogAttributeValuesInputSchema`/`Input`. Replace the definitions with re-exports/aliases of the shared types so every existing logs import keeps resolving.

- [ ] **Step 1: Edit the schema**

Remove the local definitions of `AttributeSourceSchema`, `AttributeSource`, `AttributeOpSchema`, `AttributeOp`, `AttributeFilterSchema`, `AttributeFilter`, `LogAttributeKey`, `LogAttributeKeysInputSchema`, `LogAttributeKeysInput`, `LogAttributeValuesInputSchema`, `LogAttributeValuesInput`.

Add near the top (after the existing imports):

```ts
import {
  AttributeFilterSchema,
  type AttributeKey,
  type AttributeKeysInput,
  AttributeOpSchema,
  AttributeSourceSchema,
  type AttributeValuesInput,
} from "../attribute-filter/schemas";

// Re-export the shared attribute types under both the generic and the
// historical logs-specific names so existing imports keep working.
export {
  AttributeFilterSchema,
  AttributeOpSchema,
  AttributeSourceSchema,
} from "../attribute-filter/schemas";
export type {
  AttributeFilter,
  AttributeOp,
  AttributeSource,
} from "../attribute-filter/schemas";

export type LogAttributeKey = AttributeKey;
export type LogAttributeKeysInput = AttributeKeysInput;
export type LogAttributeValuesInput = AttributeValuesInput;

export const LogAttributeKeysInputSchema = z.object({
  timeRange: TimeRangeSchema,
});
export const LogAttributeValuesInputSchema = z.object({
  timeRange: TimeRangeSchema,
  source: AttributeSourceSchema,
  key: z.string().min(1),
});
```

Keep `LogsSearchFiltersShape` referencing `AttributeFilterSchema` (now the imported one). Keep all other logs schema content unchanged.

- [ ] **Step 2: Run schema + dependent tests**

Run: `pnpm vitest run src/logs/schemas.test.ts`
Expected: PASS — the existing schema tests still hold (same shapes/defaults).

- [ ] **Step 3: Typecheck**

Run: `pnpm typecheck`
Expected: PASS for the telemetry-explorer package (logs UI/options consumers still resolve their imports).

- [ ] **Step 4: Commit**

```bash
git add src/logs/schemas.ts
git commit -m "Re-export shared attribute types from logs schemas"
```

---

## Task 14: Logs options wrap the shared options

**Files:**
- Modify: `src/logs/data/options.ts`

- [ ] **Step 1: Replace the two attribute option functions**

Remove `logAttributeKeysOptions` and `logAttributeValuesOptions` bodies and re-implement them as thin wrappers over the shared options with `domain: "logs"`, preserving their existing call signatures and query keys (the shared options already produce `["logs", ...]`):

```ts
import {
  attributeKeysOptions,
  attributeValuesOptions,
} from "../../attribute-filter/options";
import type { AttributeSource } from "../../attribute-filter/schemas";
```

```ts
export function logAttributeKeysOptions(
  repo: LogsRepositoryLike,
  input: { timeRange: TimeRange },
) {
  return attributeKeysOptions(repo, input, { domain: "logs" });
}

export function logAttributeValuesOptions(
  repo: LogsRepositoryLike,
  input: { timeRange: TimeRange; source: AttributeSource; key: string },
) {
  return attributeValuesOptions(repo, input, { domain: "logs" });
}
```

`LogsRepositoryLike` structurally satisfies `AttributeRepositoryLike` (it has `attributeKeys`/`attributeValues`), so passing it is type-safe. Remove the now-unused `LogAttributeKey` import if present.

- [ ] **Step 2: Run options tests**

Run: `pnpm vitest run src/logs/data/options.test.ts`
Expected: PASS — query keys are unchanged (`["logs", "attributeKeys", timeRange]`, `["logs", "attributeValues", timeRange, source, key]`).

- [ ] **Step 3: Commit**

```bash
git add src/logs/data/options.ts
git commit -m "Wrap shared attribute options in logs domain"
```

---

## Task 15: Logs UI config + switch log-filters to the shared section; delete logs UI attribute files

**Files:**
- Create: `src/logs/ui/log-attribute-config.ts`
- Modify: `src/logs/ui/log-filters.tsx`
- Delete: `src/logs/ui/attribute-meta.ts`, `src/logs/ui/attribute-meta.test.ts`, `src/logs/ui/attribute-filter-pill.tsx`, `src/logs/ui/attribute-filter-pill.test.tsx`, `src/logs/ui/attribute-key-picker.tsx`, `src/logs/ui/attribute-key-picker.test.tsx`, `src/logs/ui/attribute-filter-section.tsx`

- [ ] **Step 1: Create the logs attribute config**

```ts
// src/logs/ui/log-attribute-config.ts
import type { AttributeSource } from "../../attribute-filter/schemas";
import type { PromotedAttribute } from "../../attribute-filter/ui/attribute-meta";

export const LOGS_ATTRIBUTE_SOURCES_UI: AttributeSource[] = [
  "resource",
  "log",
  "scope",
];

export const LOGS_PROMOTED_ATTRIBUTES: PromotedAttribute[] = [
  { source: "resource", key: "vcs.repository.name" },
  { source: "resource", key: "deployment.environment" },
  { source: "resource", key: "host.name" },
];

// service.name backs the dedicated Service filter, so it's redundant as a chip.
export const LOGS_EXCLUDED_KEYS: ReadonlySet<string> = new Set([
  "resource:service.name",
]);
```

- [ ] **Step 2: Update `log-filters.tsx` import + usage**

Change the import of `AttributeFilterSection`:

```ts
import { AttributeFilterSection } from "../../attribute-filter/ui/attribute-filter-section";
import {
  LOGS_ATTRIBUTE_SOURCES_UI,
  LOGS_EXCLUDED_KEYS,
  LOGS_PROMOTED_ATTRIBUTES,
} from "./log-attribute-config";
```

Replace the `<AttributeFilterSection .../>` usage with the prop-driven form:

```tsx
      <AttributeFilterSection
        repo={repo}
        domain="logs"
        timeRange={timeRange}
        attributes={attributes}
        promotedAttributes={LOGS_PROMOTED_ATTRIBUTES}
        excludedKeys={LOGS_EXCLUDED_KEYS}
        sources={LOGS_ATTRIBUTE_SOURCES_UI}
        onChange={(nextAttributes) => onChange({ attributes: nextAttributes })}
      />
```

- [ ] **Step 3: Delete the moved logs UI files**

```bash
git rm src/logs/ui/attribute-meta.ts src/logs/ui/attribute-meta.test.ts \
       src/logs/ui/attribute-filter-pill.tsx src/logs/ui/attribute-filter-pill.test.tsx \
       src/logs/ui/attribute-key-picker.tsx src/logs/ui/attribute-key-picker.test.tsx \
       src/logs/ui/attribute-filter-section.tsx
```

- [ ] **Step 4: Run the full telemetry-explorer suite + typecheck**

Run: `pnpm vitest run`
Expected: PASS — all remaining logs tests plus the new shared-module tests. (Net test count: the logs UI/SQL attribute tests are replaced by the shared-module tests.)

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/logs/ui/log-attribute-config.ts src/logs/ui/log-filters.tsx
git commit -m "Consume shared attribute-filter UI in logs and remove logs copies"
```

---

## Task 16: Cross-package verification

**Files:** none (verification only)

- [ ] **Step 1: Telemetry-explorer green**

Run (from `packages/telemetry-explorer/`): `pnpm vitest run && pnpm typecheck`
Expected: all tests pass; typecheck clean.

- [ ] **Step 2: App typecheck** (it imports `AttributeFilterSchema` etc. from `@everr/telemetry-explorer/logs` — still exported)

Run (from repo root): `pnpm --filter @everr/app typecheck`
Expected: PASS. If the app references any removed symbol, fix the import to the re-exported name.

- [ ] **Step 3: Desktop typecheck** (no `typecheck` script — invoke tsc directly, per the memory note)

Run (from repo root): `cd packages/desktop-app && pnpm exec tsc --noEmit`
Expected: PASS. The desktop logs page imports the logs UI/types, which are unchanged at the barrel level.

- [ ] **Step 4: Confirm the logs page still works in the running app**

Per the `run` skill: start the web app, open the logs page, add an attribute filter, pick a value, confirm results narrow and the op labels read `Is`/`Is not`/`Exists`/`Missing`. (Behavioral parity is the Phase 0 acceptance bar.)

- [ ] **Step 5: Final phase commit (if any verification fixes were needed)**

```bash
git add -A
git commit -m "Fix cross-package imports after attribute-filter extraction"
```

---

## Spec coverage check (Phase 0 portion)

- Shared `schemas.ts` with superset source enum → Task 1. ✓
- Shared `sql/where.ts` `buildAttributeClauses` (semantics preserved, `startIndex`) → Task 2. ✓
- Shared `sql/keys.ts` + `sql/values.ts` (sources + columnFor injection) → Tasks 3–4. ✓
- Shared `repository.ts` `AttributeRepositoryLike` + `options.ts` with `domain` → Task 5. ✓
- Shared `ui/attribute-meta.ts` (span label added, promoted removed) → Task 6. ✓
- Shared pill/picker/section, prop-driven → Tasks 7–9. ✓
- Logs refactor (columns, where, repository, schemas, options, UI) with existing tests as guard → Tasks 10–15. ✓
- Cross-package (app + desktop, desktop via `tsc --noEmit`) → Task 16. ✓

## Out of scope for Phase 0

Errors and traces integration (separate plans, authored after this lands). No new package `exports` entry is needed — the shared types reach the app via the logs/errors/traces barrels.
