# Shared Logs Explorer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract the logs explorer into a shared `@everr/logs-explorer` package, keep the webapp green, and ship a working `/logs` page in the desktop app backed by the local CLI's chdb SQL endpoint.

**Architecture:** New workspace package owns schemas, SQL builders, a typed repository over a `SqlClient` seam, react-query option factories, and the page UI. The webapp wraps `@clickhouse/client` as one `SqlClient`; the desktop app implements a second `SqlClient` that posts SQL to the local collector via a new Tauri command. Both sides use the same SQL builders.

**Tech Stack:** TypeScript, React, TanStack Router, TanStack Query, zod, Vitest, ClickHouse (cloud + chdb local), Rust (Tauri), reqwest.

**Spec:** `docs/superpowers/specs/2026-05-09-shared-logs-explorer-design.md`

---

## File Structure

### New files in `packages/logs-explorer/`

| File | Responsibility |
|---|---|
| `package.json`, `tsconfig.json` | workspace package wiring |
| `src/index.ts` | public exports barrel |
| `src/schemas.ts` | zod schemas + types (moved from webapp) |
| `src/sql/level-expr.ts` | the `LOG_LEVEL_EXPR` constant + `LOG_LEVELS` |
| `src/sql/where.ts` | `buildWhereClause` |
| `src/sql/explorer.ts` | `buildExplorerQuery` + `mapLogRow` |
| `src/sql/totals.ts` | `buildTotalsQuery` + totals row decoder |
| `src/sql/histogram.ts` | `bucketSeconds`, `buildHistogramQuery`, `mapHistogramRow`, `fillHistogramBuckets` |
| `src/sql/detail.ts` | `buildDetailQuery` + detail row decoder |
| `src/sql/filter-options.ts` | `buildFilterOptionsQuery` + decoder |
| `src/sql/*.test.ts` | unit tests for each builder |
| `src/data/client.ts` | `SqlClient` interface |
| `src/data/repository.ts` | `LogsRepository` |
| `src/data/repository.test.ts` | repo tests with fake client |
| `src/data/options.ts` | react-query option factories taking a repo |
| `src/ui/logs-explorer.tsx` | top-level page component |
| `src/ui/log-row.tsx` | virtuoso row + level badge |
| `src/ui/log-inspector.tsx` | inspector panel (`LogInspectorDetails`) |
| `src/ui/log-histogram.tsx` | histogram chart |
| `src/ui/log-filters.tsx` | filter combobox bar (`LogFiltersBar`) |
| `src/ui/log-level-meta.ts` | shared `LOG_LEVEL_META` const |
| `src/context.tsx` | `LogsExplorerProvider` + `useLogsExplorer()` |

### Modified webapp files (`packages/app/`)

| File | Change |
|---|---|
| `src/data/logs-explorer/schemas.ts` | re-export from package |
| `src/data/logs-explorer/server.ts` | shim: server fns delegate to `LogsRepository(ClickhouseSqlClient)` |
| `src/data/logs-explorer/options.ts` | replaced by `RemoteSqlClient` + package's option factories |
| `src/data/logs-explorer/server.test.ts` | tests retained, assertions use SQL builders' output |
| `src/routes/_authenticated/_dashboard/logs.tsx` | shrinks to ~30 lines, mounts `<LogsExplorer />` |
| `package.json` | depends on `@everr/logs-explorer` |

### Modified desktop files

| File | Change |
|---|---|
| `packages/desktop-app/src-tauri/src/telemetry/mod.rs` | export new `query` submodule |
| `packages/desktop-app/src-tauri/src/telemetry/query.rs` | new — `telemetry_sql_query` command + Rust unit test |
| `packages/desktop-app/src-tauri/src/lib.rs` | register the command |
| `packages/desktop-app/src-tauri/capabilities/default.json` | allow the new command |
| `packages/desktop-app/src/features/logs/local-sql-client.ts` | new — `SqlClient` impl over `invoke` |
| `packages/desktop-app/src/features/logs/param-substitute.ts` | new — typed parameter substitution |
| `packages/desktop-app/src/features/logs/param-substitute.test.ts` | new |
| `packages/desktop-app/src/features/logs/logs-page.tsx` | new — route component |
| `packages/desktop-app/src/router.ts` | register `/logs` route |
| `packages/desktop-app/src/features/desktop-shell/app-shell.tsx` | add `/logs` sidebar link |
| `packages/desktop-app/package.json` | depends on `@everr/logs-explorer` |

---

## Conventions

- **Run tests** from repo root with `pnpm --filter <package> test`.
- **Commits** use conventional-commit prefixes (`feat:`, `refactor:`, `test:`).
- **Verify** each task by running the listed test command and checking the expected output before committing.
- Use `everr-dev` (not `everr`) when issuing CLI commands during dev.

---

## Task 1: Scaffold `@everr/logs-explorer` package

**Files:**
- Create: `packages/logs-explorer/package.json`
- Create: `packages/logs-explorer/tsconfig.json`
- Create: `packages/logs-explorer/src/index.ts`
- Create: `packages/logs-explorer/vitest.config.ts`

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "@everr/logs-explorer",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@everr/datemath": "workspace:*",
    "@everr/ui": "workspace:*",
    "@tanstack/react-query": "catalog:",
    "@tanstack/react-router": "1.169.2",
    "ansi-to-react": "^6.2.6",
    "lucide-react": "catalog:",
    "react": "catalog:",
    "react-dom": "catalog:",
    "react-virtuoso": "^4.18.6",
    "recharts": "catalog:",
    "zod": "catalog:"
  },
  "devDependencies": {
    "@testing-library/jest-dom": "^6.9.1",
    "@testing-library/react": "^16.3.2",
    "@types/react": "catalog:",
    "@types/react-dom": "catalog:",
    "jsdom": "^29.1.1",
    "typescript": "catalog:",
    "vitest": "^4.1.5"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "jsx": "react-jsx",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": false,
    "resolveJsonModule": true,
    "baseUrl": ".",
    "paths": { "@/*": ["src/*"] }
  },
  "include": ["src/**/*"]
}
```

- [ ] **Step 3: Create `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test-setup.ts"],
  },
});
```

- [ ] **Step 4: Create `src/test-setup.ts`**

```ts
import "@testing-library/jest-dom/vitest";
```

- [ ] **Step 5: Create empty `src/index.ts`**

```ts
export {};
```

- [ ] **Step 6: Install + verify package shows up in workspace**

Run: `pnpm install`
Expected: completes without error; `pnpm --filter @everr/logs-explorer test` runs (no tests yet) → "No test files found" exit code 0 or skipped.

- [ ] **Step 7: Commit**

```bash
git add packages/logs-explorer pnpm-lock.yaml
git commit -m "feat(logs-explorer): scaffold workspace package"
```

---

## Task 2: Move schemas into the package

**Files:**
- Create: `packages/logs-explorer/src/schemas.ts`
- Create: `packages/logs-explorer/src/time-range.ts`

- [ ] **Step 1: Create `src/time-range.ts`**

The package needs the same `TimeRange` shape as the webapp. Reuse the UI-package definition (already shared) plus a `resolveTimeRange` helper.

```ts
import { isValid, resolve } from "@everr/datemath";
import {
  DEFAULT_TIME_RANGE,
  type TimeRange,
} from "@everr/ui/components/time-range-picker";
import { z } from "zod";

export type { TimeRange };
export { DEFAULT_TIME_RANGE };

const datemath = z.string().refine(isValid);

export const TimeRangeSchema = z.object({
  from: datemath.catch(DEFAULT_TIME_RANGE.from),
  to: datemath.catch(DEFAULT_TIME_RANGE.to),
});

export function toClickHouseDateTime(date: Date): string {
  return date.toISOString().replace("T", " ").replace("Z", "");
}

export function resolveTimeRange(range: TimeRange) {
  const fromDate = resolve(range.from, { roundUp: false });
  const toDate = resolve(range.to, { roundUp: true });
  return {
    fromDate,
    toDate,
    fromISO: toClickHouseDateTime(fromDate),
    toISO: toClickHouseDateTime(toDate),
  };
}
```

- [ ] **Step 2: Create `src/schemas.ts`** (copied from `packages/app/src/data/logs-explorer/schemas.ts`, with the `TimeRangeSchema` import pointed at the package-local module)

```ts
import { z } from "zod";
import { TimeRangeSchema } from "./time-range";

export const LogLevelSchema = z.enum([
  "error",
  "warning",
  "info",
  "debug",
  "trace",
  "unknown",
]);

export type LogLevel = z.infer<typeof LogLevelSchema>;

const LogsFilterShape = {
  timeRange: TimeRangeSchema,
  query: z.string().trim().optional(),
  levels: z.array(LogLevelSchema).default([]),
  services: z.array(z.string()).default([]),
  repos: z.array(z.string()).default([]),
  traceId: z.string().trim().optional(),
} as const;

export const LogsExplorerInputSchema = z.object({
  ...LogsFilterShape,
  limit: z.number().int().min(1).max(500).default(200),
  offset: z.number().int().min(0).default(0),
});
export type LogsExplorerInput = z.infer<typeof LogsExplorerInputSchema>;

export const LogsTotalsInputSchema = z.object(LogsFilterShape);
export type LogsTotalsInput = z.infer<typeof LogsTotalsInputSchema>;

export const LogHistogramInputSchema = z.object({
  ...LogsFilterShape,
  histogramBuckets: z.number().int().min(12).max(240).default(80),
});
export type LogHistogramInput = z.infer<typeof LogHistogramInputSchema>;

export const LogIdentitySchema = z.object({
  timestampRaw: z.string(),
  traceId: z.string(),
  spanId: z.string(),
  serviceName: z.string(),
  bodyHash: z.string(),
});
export type LogIdentity = z.infer<typeof LogIdentitySchema>;

export interface LogExplorerRow {
  id: string;
  identity: LogIdentity;
  timestamp: string;
  level: LogLevel;
  body: string;
}

export interface LogDetail {
  timestamp: string;
  level: LogLevel;
  severityText: string;
  severityNumber: number;
  serviceName: string;
  traceId: string;
  spanId: string;
  resourceAttributes: Record<string, string>;
  logAttributes: Record<string, string>;
  scopeAttributes: Record<string, string>;
}

export interface LogHistogramBucket {
  timestamp: string;
  endTimestamp: string;
  timeLabel: string;
  rangeLabel: string;
  total: number;
  error: number;
  warning: number;
  info: number;
  debug: number;
  trace: number;
  unknown: number;
}

export interface LogsExplorerResult {
  logs: LogExplorerRow[];
}

export interface LogsTotalsResult {
  totalCount: number;
  levelCounts: Record<LogLevel, number>;
}

export interface LogFilterOptions {
  services: string[];
  repos: string[];
}
```

- [ ] **Step 3: Re-export from `src/index.ts`**

```ts
export * from "./schemas";
export * from "./time-range";
```

- [ ] **Step 4: Verify**

Run: `pnpm --filter @everr/logs-explorer typecheck`
Expected: exit code 0.

- [ ] **Step 5: Commit**

```bash
git add packages/logs-explorer/src/schemas.ts packages/logs-explorer/src/time-range.ts packages/logs-explorer/src/index.ts
git commit -m "feat(logs-explorer): move schemas and time-range helpers"
```

---

## Task 3: SQL — level expression + WHERE clause (TDD)

**Files:**
- Create: `packages/logs-explorer/src/sql/level-expr.ts`
- Create: `packages/logs-explorer/src/sql/where.ts`
- Create: `packages/logs-explorer/src/sql/where.test.ts`

- [ ] **Step 1: Write the failing test `where.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { buildWhereClause } from "./where";

describe("buildWhereClause", () => {
  it("starts with the time-range bounds", () => {
    const sql = buildWhereClause({ levels: [], services: [], repos: [] });
    expect(sql).toContain("TimestampTime >= parseDateTimeBestEffort({fromTime:String})");
    expect(sql).toContain("TimestampTime <= parseDateTimeBestEffort({toTime:String})");
  });

  it("adds positionCaseInsensitive when query is set", () => {
    const sql = buildWhereClause({
      query: "boom",
      levels: [],
      services: [],
      repos: [],
    });
    expect(sql).toContain("positionCaseInsensitive(Body, {query:String}) > 0");
  });

  it("filters levels when present and includeLevels is not false", () => {
    const sql = buildWhereClause({
      levels: ["error"],
      services: [],
      repos: [],
    });
    expect(sql).toContain("IN {levels:Array(String)}");
  });

  it("omits the levels filter when includeLevels is false", () => {
    const sql = buildWhereClause({
      levels: ["error"],
      services: [],
      repos: [],
      includeLevels: false,
    });
    expect(sql).not.toContain("{levels:Array(String)}");
  });

  it("filters services and repos by IN", () => {
    const sql = buildWhereClause({
      levels: [],
      services: ["svc-a"],
      repos: ["repo-a"],
    });
    expect(sql).toContain("ServiceName IN {services:Array(String)}");
    expect(sql).toContain("ResourceAttributes['vcs.repository.name'] IN {repos:Array(String)}");
  });

  it("filters traceId when set", () => {
    const sql = buildWhereClause({
      traceId: "abc",
      levels: [],
      services: [],
      repos: [],
    });
    expect(sql).toContain("TraceId = {traceId:String}");
  });
});
```

- [ ] **Step 2: Run the test, expect failure**

Run: `pnpm --filter @everr/logs-explorer test`
Expected: FAIL with "Cannot find module './where'".

- [ ] **Step 3: Implement `src/sql/level-expr.ts`**

```ts
import type { LogLevel } from "../schemas";

export const LOG_LEVELS = [
  "error",
  "warning",
  "info",
  "debug",
  "trace",
  "unknown",
] as const satisfies readonly LogLevel[];

export const LOG_LEVEL_EXPR = `
  multiIf(
    SeverityNumber >= 17, 'error',
    SeverityNumber >= 13, 'warning',
    SeverityNumber >= 9, 'info',
    SeverityNumber >= 5, 'debug',
    SeverityNumber >= 1, 'trace',
    lowerUTF8(SeverityText) IN ('fatal', 'error', 'critical'), 'error',
    lowerUTF8(SeverityText) IN ('warn', 'warning'), 'warning',
    lowerUTF8(SeverityText) = 'info', 'info',
    lowerUTF8(SeverityText) = 'debug', 'debug',
    lowerUTF8(SeverityText) = 'trace', 'trace',
    'unknown'
  )
`;
```

- [ ] **Step 4: Implement `src/sql/where.ts`**

```ts
import type { LogLevel } from "../schemas";
import { LOG_LEVEL_EXPR } from "./level-expr";

export interface WhereInput {
  query?: string;
  levels: LogLevel[];
  services: string[];
  repos: string[];
  traceId?: string;
  includeLevels?: boolean;
}

export function buildWhereClause(input: WhereInput): string {
  const clauses = [
    "TimestampTime >= parseDateTimeBestEffort({fromTime:String})",
    "TimestampTime <= parseDateTimeBestEffort({toTime:String})",
  ];
  if (input.query) {
    clauses.push("positionCaseInsensitive(Body, {query:String}) > 0");
  }
  if (input.includeLevels !== false && input.levels.length > 0) {
    clauses.push(`${LOG_LEVEL_EXPR} IN {levels:Array(String)}`);
  }
  if (input.services.length > 0) {
    clauses.push("ServiceName IN {services:Array(String)}");
  }
  if (input.repos.length > 0) {
    clauses.push(
      "ResourceAttributes['vcs.repository.name'] IN {repos:Array(String)}",
    );
  }
  if (input.traceId) {
    clauses.push("TraceId = {traceId:String}");
  }
  return clauses.join("\n      AND ");
}
```

- [ ] **Step 5: Run tests, expect pass**

Run: `pnpm --filter @everr/logs-explorer test`
Expected: 6 tests pass.

- [ ] **Step 6: Commit**

```bash
git add packages/logs-explorer/src/sql
git commit -m "feat(logs-explorer): add log-level expression and WHERE builder"
```

---

## Task 4: SQL — explorer query builder (TDD)

**Files:**
- Create: `packages/logs-explorer/src/sql/explorer.ts`
- Create: `packages/logs-explorer/src/sql/explorer.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { buildExplorerQuery, mapExplorerRow } from "./explorer";

describe("buildExplorerQuery", () => {
  it("returns sql + params with limit/offset bound", () => {
    const built = buildExplorerQuery({
      timeRange: { from: "now-1h", to: "now" },
      levels: ["error"],
      services: [],
      repos: [],
      limit: 50,
      offset: 100,
    });
    expect(built.sql).toContain("FROM logs");
    expect(built.sql).toContain("ORDER BY Timestamp DESC");
    expect(built.sql).toContain("LIMIT {limit:UInt32}");
    expect(built.sql).toContain("OFFSET {offset:UInt32}");
    expect(built.params.limit).toBe(50);
    expect(built.params.offset).toBe(100);
    expect(built.params.levels).toEqual(["error"]);
  });
});

describe("mapExplorerRow", () => {
  it("normalizes timestamp and produces a stable id", () => {
    const row = mapExplorerRow({
      timestampRaw: "2026-03-09 12:00:00",
      level: "info",
      body: "hi",
      traceId: "t",
      spanId: "s",
      serviceName: "svc",
      bodyHash: "h",
    });
    expect(row.id).toBe("2026-03-09 12:00:00|t|s|svc|h");
    expect(row.timestamp).toMatch(/^2026-03-09T12:00:00/);
    expect(row.identity.bodyHash).toBe("h");
  });
});
```

- [ ] **Step 2: Run, expect failure**

Run: `pnpm --filter @everr/logs-explorer test`
Expected: FAIL with "Cannot find module './explorer'".

- [ ] **Step 3: Implement `src/sql/explorer.ts`**

```ts
import { normalizeTimestampToUtc } from "../util/timestamp";
import type {
  LogExplorerRow,
  LogLevel,
  LogsExplorerInput,
} from "../schemas";
import { resolveTimeRange } from "../time-range";
import { LOG_LEVEL_EXPR } from "./level-expr";
import { buildWhereClause } from "./where";

export interface ExplorerRowRaw {
  timestampRaw: string;
  level: LogLevel;
  body: string;
  traceId: string;
  spanId: string;
  serviceName: string;
  bodyHash: string;
}

export interface BuiltQuery {
  sql: string;
  params: Record<string, unknown>;
}

export function buildExplorerQuery(input: LogsExplorerInput): BuiltQuery {
  const { fromISO, toISO } = resolveTimeRange(input.timeRange);
  const whereClause = buildWhereClause(input);
  const sql = `
      SELECT
        Timestamp AS timestampRaw,
        ${LOG_LEVEL_EXPR} AS level,
        Body AS body,
        TraceId AS traceId,
        SpanId AS spanId,
        ServiceName AS serviceName,
        toString(cityHash64(Body)) AS bodyHash
      FROM logs
      WHERE ${whereClause}
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
    },
  };
}

export function mapExplorerRow(row: ExplorerRowRaw): LogExplorerRow {
  const identity = {
    timestampRaw: row.timestampRaw,
    traceId: row.traceId,
    spanId: row.spanId,
    serviceName: row.serviceName,
    bodyHash: row.bodyHash,
  };
  return {
    id: [
      row.timestampRaw,
      row.traceId,
      row.spanId,
      row.serviceName,
      row.bodyHash,
    ].join("|"),
    identity,
    timestamp: normalizeTimestampToUtc(row.timestampRaw),
    level: row.level,
    body: row.body,
  };
}
```

- [ ] **Step 4: Create `src/util/timestamp.ts`** (copy from webapp `lib/formatting.ts`)

```ts
export function normalizeTimestampToUtc(raw: string): string {
  // ClickHouse-style "2026-03-09 12:00:00.000" → ISO with Z
  const trimmed = raw.trim();
  const isoLike = trimmed.includes("T") ? trimmed : trimmed.replace(" ", "T");
  if (isoLike.endsWith("Z") || /[+-]\d{2}:?\d{2}$/.test(isoLike)) {
    return new Date(isoLike).toISOString();
  }
  return new Date(`${isoLike}Z`).toISOString();
}
```

- [ ] **Step 5: Run tests, expect pass**

Run: `pnpm --filter @everr/logs-explorer test`
Expected: all green (8 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/logs-explorer/src
git commit -m "feat(logs-explorer): add explorer query builder + row mapper"
```

---

## Task 5: SQL — totals query builder (TDD)

**Files:**
- Create: `packages/logs-explorer/src/sql/totals.ts`
- Create: `packages/logs-explorer/src/sql/totals.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { buildTotalsQuery, decodeTotalsRows } from "./totals";

describe("buildTotalsQuery", () => {
  it("computes totals over a level-uncoupled subquery", () => {
    const built = buildTotalsQuery({
      timeRange: { from: "now-1h", to: "now" },
      levels: ["error"],
      services: [],
      repos: [],
    });
    expect(built.sql).toContain("countIf(level = 'error') AS error");
    expect(built.sql).toContain("countIf(level = 'unknown') AS unknown");
    // includeLevels=false: no levels-IN clause in inner WHERE
    expect(built.sql).not.toContain("{levels:Array(String)}");
    expect(built.params.levels).toEqual(["error"]);
  });
});

describe("decodeTotalsRows", () => {
  it("returns zero counts when row is missing", () => {
    const result = decodeTotalsRows([], []);
    expect(result.totalCount).toBe(0);
    expect(result.levelCounts.error).toBe(0);
  });

  it("sums only selected levels into totalCount", () => {
    const result = decodeTotalsRows(
      [{ error: "2", warning: "1", info: "5", debug: "0", trace: "0", unknown: "0" }],
      ["error"],
    );
    expect(result.totalCount).toBe(2);
    expect(result.levelCounts.warning).toBe(1);
  });

  it("sums all levels when none are selected", () => {
    const result = decodeTotalsRows(
      [{ error: "1", warning: "1", info: "1", debug: "1", trace: "1", unknown: "1" }],
      [],
    );
    expect(result.totalCount).toBe(6);
  });
});
```

- [ ] **Step 2: Run, expect failure**

Run: `pnpm --filter @everr/logs-explorer test`
Expected: FAIL "Cannot find module './totals'".

- [ ] **Step 3: Implement `src/sql/totals.ts`**

```ts
import type {
  LogLevel,
  LogsTotalsInput,
  LogsTotalsResult,
} from "../schemas";
import { resolveTimeRange } from "../time-range";
import { LOG_LEVEL_EXPR } from "./level-expr";
import { LOG_LEVELS } from "./level-expr";
import { buildWhereClause } from "./where";
import type { BuiltQuery } from "./explorer";

export type TotalsRowRaw = Record<LogLevel, string | number>;

export function buildTotalsQuery(input: LogsTotalsInput): BuiltQuery {
  const { fromISO, toISO } = resolveTimeRange(input.timeRange);
  const facetWhereClause = buildWhereClause({ ...input, includeLevels: false });
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
        FROM logs
        WHERE ${facetWhereClause}
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
    },
  };
}

function emptyLevelCounts(): Record<LogLevel, number> {
  return { error: 0, warning: 0, info: 0, debug: 0, trace: 0, unknown: 0 };
}

export function decodeTotalsRows(
  rows: TotalsRowRaw[],
  selectedLevels: readonly LogLevel[],
): LogsTotalsResult {
  const row = rows[0];
  const levelCounts = emptyLevelCounts();
  if (row) {
    for (const level of LOG_LEVELS) {
      levelCounts[level] = Number(row[level] ?? 0);
    }
  }
  const effective = selectedLevels.length > 0 ? selectedLevels : LOG_LEVELS;
  const totalCount = effective.reduce((sum, level) => sum + levelCounts[level], 0);
  return { totalCount, levelCounts };
}
```

- [ ] **Step 4: Run tests, expect pass**

Run: `pnpm --filter @everr/logs-explorer test`
Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add packages/logs-explorer/src/sql/totals.ts packages/logs-explorer/src/sql/totals.test.ts
git commit -m "feat(logs-explorer): add totals query builder"
```

---

## Task 6: SQL — histogram query + bucket helpers (TDD)

**Files:**
- Create: `packages/logs-explorer/src/sql/histogram.ts`
- Create: `packages/logs-explorer/src/sql/histogram.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import {
  bucketSeconds,
  buildHistogramQuery,
  fillHistogramBuckets,
} from "./histogram";

describe("bucketSeconds", () => {
  it("picks the smallest interval >= ideal", () => {
    const from = new Date("2026-03-09T00:00:00Z");
    const to = new Date("2026-03-09T01:00:00Z");
    expect(bucketSeconds(from, to, 60)).toBe(60);
  });

  it("falls back to the largest interval when range is huge", () => {
    const from = new Date("2026-01-01T00:00:00Z");
    const to = new Date("2026-12-31T00:00:00Z");
    expect(bucketSeconds(from, to, 80)).toBe(24 * 60 * 60);
  });
});

describe("buildHistogramQuery", () => {
  it("inlines the chosen interval seconds into the SQL", () => {
    const built = buildHistogramQuery({
      timeRange: { from: "2026-03-09T00:00:00Z", to: "2026-03-09T01:00:00Z" },
      levels: [],
      services: [],
      repos: [],
      histogramBuckets: 60,
    });
    expect(built.sql).toContain("INTERVAL 60 SECOND");
  });
});

describe("fillHistogramBuckets", () => {
  it("fills missing buckets with zeros", () => {
    const from = new Date("2026-03-09T00:00:00Z");
    const to = new Date("2026-03-09T00:02:00Z");
    const buckets = fillHistogramBuckets([], from, to, 60);
    expect(buckets.length).toBeGreaterThanOrEqual(2);
    expect(buckets.every((b) => b.total === 0)).toBe(true);
  });
});
```

- [ ] **Step 2: Run, expect failure**

Run: `pnpm --filter @everr/logs-explorer test`
Expected: FAIL.

- [ ] **Step 3: Implement `src/sql/histogram.ts`**

```ts
import type { LogHistogramBucket, LogHistogramInput } from "../schemas";
import { resolveTimeRange } from "../time-range";
import { normalizeTimestampToUtc } from "../util/timestamp";
import { LOG_LEVEL_EXPR } from "./level-expr";
import { buildWhereClause } from "./where";
import type { BuiltQuery } from "./explorer";

const HISTOGRAM_INTERVAL_SECONDS = [
  1, 5, 10, 15, 30, 60,
  2 * 60, 5 * 60, 10 * 60, 15 * 60, 30 * 60,
  60 * 60, 2 * 60 * 60, 6 * 60 * 60, 12 * 60 * 60, 24 * 60 * 60,
] as const;

export function bucketSeconds(
  fromDate: Date,
  toDate: Date,
  targetBuckets: number,
): number {
  const durationSeconds = Math.max(
    1,
    (toDate.getTime() - fromDate.getTime()) / 1000,
  );
  const idealSeconds = durationSeconds / targetBuckets;
  return (
    HISTOGRAM_INTERVAL_SECONDS.find((s) => s >= idealSeconds) ??
    HISTOGRAM_INTERVAL_SECONDS[HISTOGRAM_INTERVAL_SECONDS.length - 1]
  );
}

export interface HistogramRowRaw {
  bucket: string;
  total: string | number;
  error: string | number;
  warning: string | number;
  info: string | number;
  debug: string | number;
  trace: string | number;
  unknown: string | number;
}

export interface HistogramBuilt extends BuiltQuery {
  intervalSeconds: number;
  fromDate: Date;
  toDate: Date;
}

export function buildHistogramQuery(input: LogHistogramInput): HistogramBuilt {
  const { fromISO, toISO, fromDate, toDate } = resolveTimeRange(input.timeRange);
  const whereClause = buildWhereClause(input);
  const intervalSeconds = bucketSeconds(fromDate, toDate, input.histogramBuckets);
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
        FROM logs
        WHERE ${whereClause}
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
    },
    intervalSeconds,
    fromDate,
    toDate,
  };
}

function mapHistogramRow(
  row: HistogramRowRaw & { intervalSeconds: number },
): LogHistogramBucket {
  const timestamp = normalizeTimestampToUtc(row.bucket);
  const date = new Date(timestamp);
  const endDate = new Date(date.getTime() + row.intervalSeconds * 1000);
  const opts = { hour: "2-digit", minute: "2-digit" } satisfies Intl.DateTimeFormatOptions;
  return {
    timestamp,
    endTimestamp: endDate.toISOString(),
    timeLabel: date.toLocaleTimeString([], opts),
    rangeLabel: `${date.toLocaleTimeString([], opts)} - ${endDate.toLocaleTimeString([], opts)}`,
    total: Number(row.total),
    error: Number(row.error),
    warning: Number(row.warning),
    info: Number(row.info),
    debug: Number(row.debug),
    trace: Number(row.trace),
    unknown: Number(row.unknown),
  };
}

export function fillHistogramBuckets(
  rows: HistogramRowRaw[],
  fromDate: Date,
  toDate: Date,
  intervalSeconds: number,
): LogHistogramBucket[] {
  const intervalMs = intervalSeconds * 1000;
  const startMs = Math.floor(fromDate.getTime() / intervalMs) * intervalMs;
  const endMs = Math.floor(toDate.getTime() / intervalMs) * intervalMs;
  const rowsByBucket = new Map(
    rows.map((row) => [
      new Date(normalizeTimestampToUtc(row.bucket)).getTime(),
      row,
    ]),
  );
  const buckets: LogHistogramBucket[] = [];
  for (let bucketMs = startMs; bucketMs <= endMs; bucketMs += intervalMs) {
    const row = rowsByBucket.get(bucketMs);
    buckets.push(
      row
        ? mapHistogramRow({ ...row, intervalSeconds })
        : mapHistogramRow({
            bucket: new Date(bucketMs).toISOString(),
            intervalSeconds,
            total: 0,
            error: 0,
            warning: 0,
            info: 0,
            debug: 0,
            trace: 0,
            unknown: 0,
          }),
    );
  }
  return buckets;
}
```

- [ ] **Step 4: Run tests, expect pass**

Run: `pnpm --filter @everr/logs-explorer test`
Expected: green.

- [ ] **Step 5: Commit**

```bash
git add packages/logs-explorer/src/sql/histogram.ts packages/logs-explorer/src/sql/histogram.test.ts
git commit -m "feat(logs-explorer): add histogram query + bucket helpers"
```

---

## Task 7: SQL — log detail query (TDD)

**Files:**
- Create: `packages/logs-explorer/src/sql/detail.ts`
- Create: `packages/logs-explorer/src/sql/detail.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { buildDetailQuery, mapDetailRow } from "./detail";

describe("buildDetailQuery", () => {
  it("matches by timestamp + identity components", () => {
    const built = buildDetailQuery({
      timestampRaw: "2026-03-09 12:00:00",
      traceId: "t",
      spanId: "s",
      serviceName: "svc",
      bodyHash: "h",
    });
    expect(built.sql).toContain("FROM logs");
    expect(built.sql).toContain("LIMIT 1");
    expect(built.params.traceId).toBe("t");
    expect(built.params.bodyHash).toBe("h");
  });
});

describe("mapDetailRow", () => {
  it("normalizes timestamp + coerces severity", () => {
    const detail = mapDetailRow({
      timestampRaw: "2026-03-09 12:00:00",
      level: "error",
      severityText: "ERROR",
      severityNumber: "17",
      serviceName: "svc",
      traceId: "t",
      spanId: "s",
      resourceAttributes: { a: "b" },
      logAttributes: {},
      scopeAttributes: {},
    });
    expect(detail.severityNumber).toBe(17);
    expect(detail.timestamp).toMatch(/^2026-03-09T12:00:00/);
  });
});
```

- [ ] **Step 2: Run, expect failure**

Run: `pnpm --filter @everr/logs-explorer test`
Expected: FAIL.

- [ ] **Step 3: Implement `src/sql/detail.ts`**

```ts
import type { LogDetail, LogIdentity, LogLevel } from "../schemas";
import { normalizeTimestampToUtc } from "../util/timestamp";
import { LOG_LEVEL_EXPR } from "./level-expr";
import type { BuiltQuery } from "./explorer";

export interface DetailRowRaw {
  timestampRaw: string;
  level: LogLevel;
  severityText: string;
  severityNumber: string | number;
  serviceName: string;
  traceId: string;
  spanId: string;
  resourceAttributes: Record<string, string> | null;
  logAttributes: Record<string, string> | null;
  scopeAttributes: Record<string, string> | null;
}

export function buildDetailQuery(identity: LogIdentity): BuiltQuery {
  const sql = `
      SELECT
        Timestamp AS timestampRaw,
        ${LOG_LEVEL_EXPR} AS level,
        SeverityText AS severityText,
        SeverityNumber AS severityNumber,
        ServiceName AS serviceName,
        TraceId AS traceId,
        SpanId AS spanId,
        ResourceAttributes AS resourceAttributes,
        LogAttributes AS logAttributes,
        ScopeAttributes AS scopeAttributes
      FROM logs
      WHERE TimestampTime = toDateTime(parseDateTime64BestEffort({timestampRaw:String}, 9))
        AND Timestamp = parseDateTime64BestEffort({timestampRaw:String}, 9)
        AND ServiceName = {serviceName:String}
        AND TraceId = {traceId:String}
        AND SpanId = {spanId:String}
        AND toString(cityHash64(Body)) = {bodyHash:String}
      LIMIT 1
      `;
  return { sql, params: { ...identity } };
}

export function mapDetailRow(row: DetailRowRaw): LogDetail {
  return {
    timestamp: normalizeTimestampToUtc(row.timestampRaw),
    level: row.level,
    severityText: row.severityText,
    severityNumber: Number(row.severityNumber),
    serviceName: row.serviceName,
    traceId: row.traceId,
    spanId: row.spanId,
    resourceAttributes: row.resourceAttributes ?? {},
    logAttributes: row.logAttributes ?? {},
    scopeAttributes: row.scopeAttributes ?? {},
  };
}
```

- [ ] **Step 4: Run tests, expect pass**

Run: `pnpm --filter @everr/logs-explorer test`
Expected: green.

- [ ] **Step 5: Commit**

```bash
git add packages/logs-explorer/src/sql/detail.ts packages/logs-explorer/src/sql/detail.test.ts
git commit -m "feat(logs-explorer): add detail query builder + mapper"
```

---

## Task 8: SQL — filter options (TDD)

**Files:**
- Create: `packages/logs-explorer/src/sql/filter-options.ts`
- Create: `packages/logs-explorer/src/sql/filter-options.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import {
  buildFilterOptionsQuery,
  decodeFilterOptionsRows,
} from "./filter-options";

describe("buildFilterOptionsQuery", () => {
  it("queries distinct services and repos within range", () => {
    const built = buildFilterOptionsQuery({
      timeRange: { from: "now-1h", to: "now" },
    });
    expect(built.sql).toContain("DISTINCT ServiceName");
    expect(built.sql).toContain("DISTINCT ResourceAttributes['vcs.repository.name']");
    expect(typeof built.params.fromTime).toBe("string");
  });
});

describe("decodeFilterOptionsRows", () => {
  it("returns empty arrays when no row", () => {
    expect(decodeFilterOptionsRows([])).toEqual({ services: [], repos: [] });
  });
});
```

- [ ] **Step 2: Run, expect failure**

Run: `pnpm --filter @everr/logs-explorer test`
Expected: FAIL.

- [ ] **Step 3: Implement `src/sql/filter-options.ts`**

```ts
import type { LogFilterOptions } from "../schemas";
import { resolveTimeRange, type TimeRange } from "../time-range";
import type { BuiltQuery } from "./explorer";

export interface FilterOptionsRowRaw {
  services: string[];
  repos: string[];
}

export function buildFilterOptionsQuery(input: {
  timeRange: TimeRange;
}): BuiltQuery {
  const { fromISO, toISO } = resolveTimeRange(input.timeRange);
  const sql = `
      SELECT
        (SELECT groupArray(v) FROM (
          SELECT DISTINCT ServiceName AS v
          FROM logs
          WHERE TimestampTime >= parseDateTimeBestEffort({fromTime:String})
            AND TimestampTime <= parseDateTimeBestEffort({toTime:String})
            AND ServiceName != ''
          ORDER BY v
          LIMIT 100
        )) AS services,
        (SELECT groupArray(v) FROM (
          SELECT DISTINCT ResourceAttributes['vcs.repository.name'] AS v
          FROM logs
          WHERE TimestampTime >= parseDateTimeBestEffort({fromTime:String})
            AND TimestampTime <= parseDateTimeBestEffort({toTime:String})
            AND ResourceAttributes['vcs.repository.name'] != ''
          ORDER BY v
          LIMIT 100
        )) AS repos
      `;
  return { sql, params: { fromTime: fromISO, toTime: toISO } };
}

export function decodeFilterOptionsRows(
  rows: FilterOptionsRowRaw[],
): LogFilterOptions {
  const row = rows[0];
  return { services: row?.services ?? [], repos: row?.repos ?? [] };
}
```

- [ ] **Step 4: Run tests, expect pass**

Run: `pnpm --filter @everr/logs-explorer test`
Expected: green.

- [ ] **Step 5: Commit**

```bash
git add packages/logs-explorer/src/sql/filter-options.ts packages/logs-explorer/src/sql/filter-options.test.ts
git commit -m "feat(logs-explorer): add filter-options query builder"
```

---

## Task 9: SqlClient interface + LogsRepository (TDD)

**Files:**
- Create: `packages/logs-explorer/src/data/client.ts`
- Create: `packages/logs-explorer/src/data/repository.ts`
- Create: `packages/logs-explorer/src/data/repository.test.ts`

- [ ] **Step 1: Implement `src/data/client.ts`**

```ts
export interface SqlClient {
  execute<Row>(sql: string, params: Record<string, unknown>): Promise<Row[]>;
}
```

- [ ] **Step 2: Write the failing test**

```ts
import { describe, expect, it, vi } from "vitest";
import type { SqlClient } from "./client";
import { LogsRepository } from "./repository";

const fakeClient = (rows: unknown[]): SqlClient => ({
  execute: vi.fn().mockResolvedValue(rows),
});

describe("LogsRepository.explorer", () => {
  it("maps raw rows to LogExplorerRow", async () => {
    const client = fakeClient([
      {
        timestampRaw: "2026-03-09 12:00:00",
        level: "info",
        body: "hi",
        traceId: "t",
        spanId: "s",
        serviceName: "svc",
        bodyHash: "h",
      },
    ]);
    const repo = new LogsRepository(client);
    const result = await repo.explorer({
      timeRange: { from: "now-1h", to: "now" },
      levels: [],
      services: [],
      repos: [],
      limit: 200,
      offset: 0,
    });
    expect(result.logs).toHaveLength(1);
    expect(result.logs[0].body).toBe("hi");
  });
});

describe("LogsRepository.totals", () => {
  it("decodes totals using selected levels", async () => {
    const client = fakeClient([
      { error: 1, warning: 0, info: 0, debug: 0, trace: 0, unknown: 0 },
    ]);
    const repo = new LogsRepository(client);
    const result = await repo.totals({
      timeRange: { from: "now-1h", to: "now" },
      levels: ["error"],
      services: [],
      repos: [],
    });
    expect(result.totalCount).toBe(1);
  });
});

describe("LogsRepository.detail", () => {
  it("throws when no row found", async () => {
    const repo = new LogsRepository(fakeClient([]));
    await expect(
      repo.detail({
        timestampRaw: "x",
        traceId: "t",
        spanId: "s",
        serviceName: "svc",
        bodyHash: "h",
      }),
    ).rejects.toThrow(/not found/i);
  });
});
```

- [ ] **Step 3: Run, expect failure**

Run: `pnpm --filter @everr/logs-explorer test`
Expected: FAIL "Cannot find module './repository'".

- [ ] **Step 4: Implement `src/data/repository.ts`**

```ts
import type {
  LogDetail,
  LogFilterOptions,
  LogHistogramBucket,
  LogHistogramInput,
  LogIdentity,
  LogsExplorerInput,
  LogsExplorerResult,
  LogsTotalsInput,
  LogsTotalsResult,
} from "../schemas";
import { buildDetailQuery, mapDetailRow, type DetailRowRaw } from "../sql/detail";
import {
  buildExplorerQuery,
  mapExplorerRow,
  type ExplorerRowRaw,
} from "../sql/explorer";
import {
  buildFilterOptionsQuery,
  decodeFilterOptionsRows,
  type FilterOptionsRowRaw,
} from "../sql/filter-options";
import {
  buildHistogramQuery,
  fillHistogramBuckets,
  type HistogramRowRaw,
} from "../sql/histogram";
import {
  buildTotalsQuery,
  decodeTotalsRows,
  type TotalsRowRaw,
} from "../sql/totals";
import { resolveTimeRange, type TimeRange } from "../time-range";
import type { SqlClient } from "./client";

export class LogsRepository {
  constructor(private readonly client: SqlClient) {}

  async explorer(input: LogsExplorerInput): Promise<LogsExplorerResult> {
    const { sql, params } = buildExplorerQuery(input);
    const rows = await this.client.execute<ExplorerRowRaw>(sql, params);
    return { logs: rows.map(mapExplorerRow) };
  }

  async totals(input: LogsTotalsInput): Promise<LogsTotalsResult> {
    const { sql, params } = buildTotalsQuery(input);
    const rows = await this.client.execute<TotalsRowRaw>(sql, params);
    return decodeTotalsRows(rows, input.levels);
  }

  async histogram(input: LogHistogramInput): Promise<LogHistogramBucket[]> {
    const built = buildHistogramQuery(input);
    const rows = await this.client.execute<HistogramRowRaw>(built.sql, built.params);
    return fillHistogramBuckets(rows, built.fromDate, built.toDate, built.intervalSeconds);
  }

  async detail(identity: LogIdentity): Promise<LogDetail> {
    const { sql, params } = buildDetailQuery(identity);
    const rows = await this.client.execute<DetailRowRaw>(sql, params);
    const row = rows[0];
    if (!row) throw new Error("Log entry not found");
    return mapDetailRow(row);
  }

  async filterOptions(input: { timeRange: TimeRange }): Promise<LogFilterOptions> {
    const { sql, params } = buildFilterOptionsQuery(input);
    const rows = await this.client.execute<FilterOptionsRowRaw>(sql, params);
    return decodeFilterOptionsRows(rows);
  }
}

// Re-exports so consumers don't need a deep import.
export { resolveTimeRange };
```

- [ ] **Step 5: Run tests, expect pass**

Run: `pnpm --filter @everr/logs-explorer test`
Expected: green.

- [ ] **Step 6: Commit**

```bash
git add packages/logs-explorer/src/data
git commit -m "feat(logs-explorer): add SqlClient interface and LogsRepository"
```

---

## Task 10: react-query option factories

**Files:**
- Create: `packages/logs-explorer/src/data/options.ts`

- [ ] **Step 1: Implement `src/data/options.ts`**

```ts
import { queryOptions } from "@tanstack/react-query";
import type {
  LogFilterOptions,
  LogHistogramInput,
  LogIdentity,
  LogsExplorerInput,
  LogsTotalsInput,
} from "../schemas";
import type { TimeRange } from "../time-range";
import type { LogsRepository } from "./repository";

export type LogsExplorerInfiniteInput = Omit<LogsExplorerInput, "offset">;

export function logsExplorerInfiniteOptions(
  repo: LogsRepository,
  input: LogsExplorerInfiniteInput,
) {
  return {
    queryKey: ["logs", "explorer", "infinite", input] as const,
    queryFn: ({ pageParam }: { pageParam: number }) =>
      repo.explorer({ ...input, offset: pageParam }),
    initialPageParam: 0,
    getNextPageParam: (
      lastPage: { logs: unknown[] },
      allPages: { logs: unknown[] }[],
    ) => {
      if (lastPage.logs.length < input.limit) return undefined;
      return allPages.reduce((count, page) => count + page.logs.length, 0);
    },
  };
}

export function logsTotalsOptions(repo: LogsRepository, input: LogsTotalsInput) {
  return queryOptions({
    queryKey: ["logs", "totals", input],
    queryFn: () => repo.totals(input),
  });
}

export function logDetailOptions(repo: LogsRepository, identity: LogIdentity) {
  return queryOptions({
    queryKey: ["logs", "detail", identity],
    queryFn: () => repo.detail(identity),
  });
}

export function logsHistogramOptions(
  repo: LogsRepository,
  input: LogHistogramInput,
) {
  return queryOptions({
    queryKey: ["logs", "histogram", input],
    queryFn: () => repo.histogram(input),
  });
}

function logFilterOptionsBase(
  repo: LogsRepository,
  input: { timeRange: TimeRange },
) {
  return {
    queryKey: ["logs", "filterOptions", input.timeRange] as const,
    queryFn: () => repo.filterOptions(input),
  };
}

export function logServiceFilterOptions(
  repo: LogsRepository,
  input: { timeRange: TimeRange },
) {
  return {
    ...logFilterOptionsBase(repo, input),
    select: (data: LogFilterOptions) => data.services,
  };
}

export function logRepoFilterOptions(
  repo: LogsRepository,
  input: { timeRange: TimeRange },
) {
  return {
    ...logFilterOptionsBase(repo, input),
    select: (data: LogFilterOptions) => data.repos,
  };
}
```

- [ ] **Step 2: Update `src/index.ts` to export new modules**

```ts
export * from "./schemas";
export * from "./time-range";
export type { SqlClient } from "./data/client";
export { LogsRepository } from "./data/repository";
export * from "./data/options";
```

- [ ] **Step 3: Verify**

Run: `pnpm --filter @everr/logs-explorer typecheck && pnpm --filter @everr/logs-explorer test`
Expected: exit 0, all tests pass.

- [ ] **Step 4: Commit**

```bash
git add packages/logs-explorer/src/data/options.ts packages/logs-explorer/src/index.ts
git commit -m "feat(logs-explorer): add react-query option factories"
```

---

## Task 11: Move UI — extract `<LogsExplorer />` and split files

This task moves the existing 1374-line route component into the package, splitting it into focused files. **No behavior changes** — the engineer copies code verbatim from `packages/app/src/routes/_authenticated/_dashboard/logs.tsx` into the listed targets, then rewires imports. The webapp tests still pass after Task 13–15 wire it back up; UI behavior is verified by smoke-testing in Task 15.

**Source file:** `packages/app/src/routes/_authenticated/_dashboard/logs.tsx`

**Target split:**

| Target file in `packages/logs-explorer/src/ui/` | Contents from source |
|---|---|
| `log-level-meta.ts` | `LOG_LEVEL_META`, `LOG_LEVELS` constants |
| `log-histogram.tsx` | the histogram chart subtree (recharts `BarChart`, `ChartContainer`, brush state) |
| `log-filters.tsx` | `LogFiltersBar`, level pills, `FilterCombobox` usage for services + repos, search input |
| `log-row.tsx` | the virtuoso row renderer + level badge component |
| `log-inspector.tsx` | `LogInspectorDetails`, `DetailSection`, `DetailItem`, `extractCiContext`, `severityLabel` |
| `logs-explorer.tsx` | the page component `LogsExplorerPage` (rename to `LogsExplorer`), wraps the others |

- [ ] **Step 1: Create `src/ui/log-level-meta.ts`**

Copy the `LOG_LEVELS` array and `LOG_LEVEL_META` const from `logs.tsx:80-114`. Replace the import of `LogLevel` from `@/data/logs-explorer/schemas` with `import type { LogLevel } from "../schemas"`. Export both constants.

- [ ] **Step 2: Create `src/ui/log-histogram.tsx`**

Extract the histogram subtree (recharts code + brush selection state + props for buckets, isPending, time range). Define a typed props interface: `{ buckets: LogHistogramBucket[]; isPending: boolean; onRangeSelect: (from: Date, to: Date) => void }`. Imports come from `@everr/ui/components/chart`, `recharts`, and `../schemas`.

- [ ] **Step 3: Create `src/ui/log-filters.tsx`**

Extract `LogFiltersBar` plus the local filter state types. Take `services`, `repos`, `levels`, `query`, `traceId` as controlled props with `on*Change` callbacks. Import `FilterCombobox` from `@everr/ui/components/filter-combobox` (move it there in Task 11a if it doesn't exist — see below).

- [ ] **Step 3a: Move `FilterCombobox` to `@everr/ui` if not already shared**

Check: `grep -r "filter-combobox" packages/ui/src 2>/dev/null`. If absent, copy `packages/app/src/components/filter-combobox.tsx` to `packages/ui/src/components/filter-combobox.tsx`, update its imports to package-relative (`./button`, `./command`, `./popover`, `../lib/utils`), and re-export from there. Update the webapp's existing import sites to `@everr/ui/components/filter-combobox`.

If already shared, skip this step.

- [ ] **Step 4: Create `src/ui/log-row.tsx`**

Extract the virtuoso row renderer + the level badge. Props: `{ row: LogExplorerRow; isSelected: boolean; onSelect: (row: LogExplorerRow) => void }`. Uses `LOG_LEVEL_META` and `Ansi` from `ansi-to-react`.

- [ ] **Step 5: Create `src/ui/log-inspector.tsx`**

Extract `LogInspectorDetails`, `DetailSection`, `DetailItem`, `extractCiContext`, `severityLabel`. Replace the runs cross-link block (`logs.tsx:1192-1214`) with a call to a new `renderRunLink` prop:

```tsx
{ciFields.hasAny ? (
  <DetailSection title="CI/CD">
    {/* ... existing items ... */}
    {props.renderRunLink && detail.traceId && resolvedJobId && ciFields.stepNumber
      ? props.renderRunLink({
          traceId: detail.traceId,
          jobId: resolvedJobId,
          stepNumber: ciFields.stepNumber,
        })
      : null}
  </DetailSection>
) : null}
```

Drop the `useQuery({...runJobsOptions(...)})` call from this component — instead, accept a `resolveJobId?: (input: { traceId: string; jobName: string }) => string | undefined` prop with a default of returning `undefined`. The webapp passes an implementation that uses its `runJobsOptions`; desktop passes nothing.

- [ ] **Step 6: Create `src/ui/logs-explorer.tsx`**

Rename `LogsExplorerPage` to `LogsExplorer`. Move it into this file. Replace its `Route.useSearch()`/`Route.useNavigate()` usage with controlled props:

```tsx
export interface LogsExplorerSearch {
  q?: string;
  levels: LogLevel[];
  services: string[];
  repos: string[];
  traceId?: string;
  showVolume: boolean;
}

export interface LogsExplorerProps {
  repo: LogsRepository;
  timeRange: TimeRange;
  search: LogsExplorerSearch;
  onSearchChange: (next: LogsExplorerSearch) => void;
  renderRunLink?: (ctx: {
    traceId: string;
    jobId: string;
    stepNumber: string;
  }) => React.ReactNode;
  resolveJobId?: (input: {
    traceId: string;
    jobName: string;
  }) => string | undefined;
}

export function LogsExplorer(props: LogsExplorerProps) {
  /* body adapted from logs.tsx:139-1374 */
}
```

Replace direct calls to `logsExplorerInfiniteOptions(input)` etc. with `logsExplorerInfiniteOptions(props.repo, input)` per Task 10's signatures. Replace `Route.useNavigate()` calls with `props.onSearchChange(...)`. Replace `withTimeRange` usage with `props.timeRange`/`props.search`.

- [ ] **Step 7: Export from `src/index.ts`**

```ts
export { LogsExplorer } from "./ui/logs-explorer";
export type {
  LogsExplorerProps,
  LogsExplorerSearch,
} from "./ui/logs-explorer";
```

- [ ] **Step 8: Verify package typechecks in isolation**

Run: `pnpm --filter @everr/logs-explorer typecheck`
Expected: exit 0.

- [ ] **Step 9: Commit**

```bash
git add packages/logs-explorer/src/ui packages/logs-explorer/src/index.ts packages/ui/src/components/filter-combobox.tsx 2>/dev/null || true
git commit -m "feat(logs-explorer): move UI into shared package and split files"
```

---

## Task 12: Webapp — `ClickhouseSqlClient` + slim `server.ts`

**Files:**
- Create: `packages/app/src/data/logs-explorer/clickhouse-client.ts`
- Modify: `packages/app/src/data/logs-explorer/server.ts`
- Modify: `packages/app/src/data/logs-explorer/schemas.ts` (re-export from package)

- [ ] **Step 1: Add `@everr/logs-explorer` dependency**

Edit `packages/app/package.json`, add to `dependencies`:

```json
"@everr/logs-explorer": "workspace:*",
```

Run: `pnpm install`

- [ ] **Step 2: Create `src/data/logs-explorer/clickhouse-client.ts`**

```ts
import { query } from "@/lib/clickhouse";
import type { SqlClient } from "@everr/logs-explorer";

export const clickhouseSqlClient: SqlClient = {
  execute: <Row>(sql: string, params: Record<string, unknown>) =>
    query<Row>(sql, params),
};
```

- [ ] **Step 3: Replace `src/data/logs-explorer/schemas.ts` with a re-export**

```ts
export * from "@everr/logs-explorer";
```

- [ ] **Step 4: Rewrite `src/data/logs-explorer/server.ts`**

```ts
import {
  LogHistogramInputSchema,
  LogIdentitySchema,
  LogsExplorerInputSchema,
  LogsRepository,
  LogsTotalsInputSchema,
  TimeRangeSchema,
} from "@everr/logs-explorer";
import { z } from "zod";
import { createAuthenticatedServerFn } from "@/lib/serverFn";
import { clickhouseSqlClient } from "./clickhouse-client";

const repo = new LogsRepository(clickhouseSqlClient);

export const getLogsExplorer = createAuthenticatedServerFn({ method: "GET" })
  .inputValidator(LogsExplorerInputSchema)
  .handler(({ data }) => repo.explorer(data));

export const getLogsTotals = createAuthenticatedServerFn({ method: "GET" })
  .inputValidator(LogsTotalsInputSchema)
  .handler(({ data }) => repo.totals(data));

export const getLogDetail = createAuthenticatedServerFn({ method: "GET" })
  .inputValidator(LogIdentitySchema)
  .handler(({ data }) => repo.detail(data));

export const getLogsHistogram = createAuthenticatedServerFn({ method: "GET" })
  .inputValidator(LogHistogramInputSchema)
  .handler(({ data }) => repo.histogram(data));

export const getLogFilterOptions = createAuthenticatedServerFn({ method: "GET" })
  .inputValidator(z.object({ timeRange: TimeRangeSchema }))
  .handler(({ data }) => repo.filterOptions(data));
```

Note: this drops the per-handler `context: { clickhouse }`. If `createAuthenticatedServerFn` injects clickhouse via context for tenant scoping, instead change the constructor of the `clickhouseSqlClient` to a factory taking the per-request client:

```ts
// alt clickhouse-client.ts
import type { SqlClient } from "@everr/logs-explorer";
import type { Clickhouse } from "@/lib/clickhouse";

export function makeClickhouseSqlClient(ch: Clickhouse): SqlClient {
  return { execute: (sql, params) => ch.query(sql, params) };
}
```

…and adjust each handler:

```ts
.handler(({ data, context: { clickhouse } }) =>
  new LogsRepository(makeClickhouseSqlClient(clickhouse)).explorer(data),
);
```

Pick whichever matches the shape of `createAuthenticatedServerFn` in this repo (check `packages/app/src/lib/serverFn.ts`).

- [ ] **Step 5: Update `server.test.ts`**

The existing test asserts on call arguments to the mocked `query`. Update assertions to compare against the SQL strings produced by the package's builders (import `buildExplorerQuery`, etc., from `@everr/logs-explorer/src/sql/explorer` if needed — or simply assert the mocked client received any SQL containing key fragments like `FROM logs`, `LIMIT {limit:UInt32}`).

Run: `pnpm --filter @everr/app test -- src/data/logs-explorer/server.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/app/package.json packages/app/src/data/logs-explorer pnpm-lock.yaml
git commit -m "refactor(app): server fns delegate to LogsRepository"
```

---

## Task 13: Webapp — `RemoteSqlClient` + new `options.ts`

The webapp's frontend talks to the server fns over HTTP, not directly to ClickHouse. So we need a `SqlClient` whose `execute` calls a single server fn that runs *any* SQL — but that's unsafe (allows arbitrary SQL from the browser). Instead, the webapp keeps the existing per-query server fns and the frontend's `RemoteSqlClient` is **not used**; we keep using the per-query react-query factories pointed at server fns.

To still benefit from the package's option factories, we wire them to a thin `RemoteRepo` that calls server fns method-by-method.

**Files:**
- Create: `packages/app/src/data/logs-explorer/remote-repo.ts`
- Modify: `packages/app/src/data/logs-explorer/options.ts`

- [ ] **Step 1: Create `remote-repo.ts`**

```ts
import {
  type LogsRepository,
  type LogDetail,
  type LogFilterOptions,
  type LogHistogramBucket,
  type LogHistogramInput,
  type LogIdentity,
  type LogsExplorerInput,
  type LogsExplorerResult,
  type LogsTotalsInput,
  type LogsTotalsResult,
  type TimeRange,
} from "@everr/logs-explorer";
import {
  getLogDetail,
  getLogFilterOptions,
  getLogsExplorer,
  getLogsHistogram,
  getLogsTotals,
} from "./server";

// Implements the public surface of LogsRepository against server fns.
export const remoteRepo: Pick<
  LogsRepository,
  "explorer" | "totals" | "histogram" | "detail" | "filterOptions"
> = {
  explorer: (input: LogsExplorerInput): Promise<LogsExplorerResult> =>
    getLogsExplorer({ data: input }),
  totals: (input: LogsTotalsInput): Promise<LogsTotalsResult> =>
    getLogsTotals({ data: input }),
  histogram: (input: LogHistogramInput): Promise<LogHistogramBucket[]> =>
    getLogsHistogram({ data: input }),
  detail: (identity: LogIdentity): Promise<LogDetail> =>
    getLogDetail({ data: identity }),
  filterOptions: (input: { timeRange: TimeRange }): Promise<LogFilterOptions> =>
    getLogFilterOptions({ data: input }),
};
```

- [ ] **Step 2: Replace `options.ts`**

```ts
export {
  logDetailOptions,
  logRepoFilterOptions,
  logServiceFilterOptions,
  logsExplorerInfiniteOptions,
  logsHistogramOptions,
  logsTotalsOptions,
} from "@everr/logs-explorer";
export { remoteRepo } from "./remote-repo";
```

Note: `logsExplorerInfiniteOptions` etc. now take `(repo, input)`. Callers (only the `logs.tsx` route) update in Task 14.

- [ ] **Step 3: Verify**

Run: `pnpm --filter @everr/app typecheck`
Expected: errors only inside `routes/_authenticated/_dashboard/logs.tsx` (fixed in Task 14).

- [ ] **Step 4: Commit**

```bash
git add packages/app/src/data/logs-explorer
git commit -m "refactor(app): re-export logs-explorer options through @everr/logs-explorer"
```

---

## Task 14: Webapp — slim `/logs` route

**Files:**
- Modify: `packages/app/src/routes/_authenticated/_dashboard/logs.tsx`

- [ ] **Step 1: Replace the entire file with a thin shell**

```tsx
import { LogsExplorer, LogLevelSchema } from "@everr/logs-explorer";
import { useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { z } from "zod";
import { remoteRepo } from "@/data/logs-explorer/options";
import { runJobsOptions } from "@/data/runs/options";
import { TimeRangeSearchSchema, withTimeRange } from "@/lib/time-range";

const SearchSchema = TimeRangeSearchSchema.extend({
  q: z.string().optional(),
  levels: z.array(LogLevelSchema).default([]),
  services: z.array(z.string()).default([]),
  repos: z.array(z.string()).default([]),
  traceId: z.string().optional(),
  showVolume: z.boolean().default(true),
});

export const Route = createFileRoute("/_authenticated/_dashboard/logs")({
  staticData: { breadcrumb: "Logs", fullBleed: true },
  head: () => ({ meta: [{ title: "Everr - Logs" }] }),
  validateSearch: SearchSchema,
  component: LogsExplorerPage,
});

function LogsExplorerPage() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const queryClient = useQueryClient();
  const { showVolume: _show, ...rest } = search;
  const { timeRange, ...filters } = withTimeRange(rest);

  return (
    <LogsExplorer
      repo={remoteRepo as never}
      timeRange={timeRange}
      search={{
        q: filters.q,
        levels: filters.levels,
        services: filters.services,
        repos: filters.repos,
        traceId: filters.traceId,
        showVolume: search.showVolume,
      }}
      onSearchChange={(next) =>
        navigate({ search: (prev) => ({ ...prev, ...next }), replace: true })
      }
      resolveJobId={({ traceId, jobName }) => {
        const cached = queryClient.getQueryData(runJobsOptions(traceId).queryKey);
        return Array.isArray(cached)
          ? cached.find((j: { name: string }) => j.name === jobName)?.jobId
          : undefined;
      }}
      renderRunLink={({ traceId, jobId, stepNumber }) => (
        <Button
          variant="outline"
          size="sm"
          className="mt-1 w-fit"
          nativeButton={false}
          render={
            <Link
              to="/runs/$traceId/jobs/$jobId/steps/$stepNumber"
              params={{ traceId, jobId, stepNumber }}
            />
          }
        >
          <FileSearch data-icon="inline-start" />
          Open in CI View
        </Button>
      )}
    />
  );
}
```

Add the missing imports at the top:

```tsx
import { Button } from "@everr/ui/components/button";
import { FileSearch } from "lucide-react";
```

The cast `repo={remoteRepo as never}` is acceptable here: `remoteRepo` implements the same surface but isn't an instance of the class. If the option factories signature is too strict, change `LogsRepository` in the package to a structural type (interface) instead of a class; an alternative implementation is to add `export type LogsRepositoryLike = Pick<LogsRepository, "explorer" | "totals" | "histogram" | "detail" | "filterOptions">` and use that in the option factories' signatures.

**Decision:** change `data/options.ts` and `LogsExplorerProps` to take `LogsRepositoryLike` (the structural type), so both `new LogsRepository(client)` and `remoteRepo` satisfy it without casts.

- [ ] **Step 2: In the package, add the structural type**

Edit `packages/logs-explorer/src/data/repository.ts` — append:

```ts
export type LogsRepositoryLike = Pick<
  LogsRepository,
  "explorer" | "totals" | "histogram" | "detail" | "filterOptions"
>;
```

Update every `repo: LogsRepository` parameter in `data/options.ts` and `ui/logs-explorer.tsx` to `LogsRepositoryLike`. Re-export from `index.ts`:

```ts
export { LogsRepository, type LogsRepositoryLike } from "./data/repository";
```

Then remove the `as never` cast in the route.

- [ ] **Step 3: Verify**

Run: `pnpm --filter @everr/app typecheck && pnpm --filter @everr/app test`
Expected: all green.

- [ ] **Step 4: Smoke-test the webapp**

Run: `pnpm dev:web`
Open `http://localhost:<port>/logs`. Verify rows render, filters work, histogram brush selection works, inspector opens, "Open in CI View" still navigates.

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/routes/_authenticated/_dashboard/logs.tsx packages/logs-explorer/src
git commit -m "refactor(app): mount shared LogsExplorer from /logs route"
```

---

## Task 15: Desktop Rust — `telemetry_sql_query` Tauri command (TDD)

**Files:**
- Create: `packages/desktop-app/src-tauri/src/telemetry/query.rs`
- Modify: `packages/desktop-app/src-tauri/src/telemetry/mod.rs`
- Modify: `packages/desktop-app/src-tauri/src/lib.rs`
- Modify: `packages/desktop-app/src-tauri/capabilities/default.json`

The local SQL HTTP endpoint takes a plain SQL body (see `collector/extension/sqlhttp/handler.go` and `src-cli/src/telemetry/client.rs`). The command receives an already-substituted SQL string from the frontend (Task 16 owns substitution).

- [ ] **Step 1: Write the failing Rust test**

Create `packages/desktop-app/src-tauri/src/telemetry/query.rs`:

```rust
//! Tauri command `telemetry_sql_query` — posts SQL to the local collector.

use anyhow::{anyhow, Context, Result};
use reqwest::StatusCode;
use serde_json::Value;
use std::time::Duration;

use crate::telemetry::ports::SQL_HTTP_PORT;

pub async fn run_query(sql: String) -> Result<Vec<Value>> {
    let url = format!("http://127.0.0.1:{SQL_HTTP_PORT}/sql");
    post_sql(&url, &sql).await
}

async fn post_sql(url: &str, sql: &str) -> Result<Vec<Value>> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(15))
        .build()
        .context("build reqwest client")?;
    let resp = client
        .post(url)
        .header("content-type", "text/plain")
        .body(sql.to_string())
        .send()
        .await
        .with_context(|| format!("POST {url}"))?;
    let status = resp.status();
    let body = resp.text().await.unwrap_or_default();
    match status {
        StatusCode::OK => parse_ndjson(&body),
        StatusCode::SERVICE_UNAVAILABLE => {
            Err(anyhow!("telemetry collector is busy — try again in a moment"))
        }
        other => Err(anyhow!("unexpected status {other}: {body}")),
    }
}

fn parse_ndjson(body: &str) -> Result<Vec<Value>> {
    let mut out = Vec::new();
    for line in body.lines() {
        if line.is_empty() {
            continue;
        }
        out.push(serde_json::from_str(line).with_context(|| format!("parse row: {line}"))?);
    }
    Ok(out)
}

#[tauri::command]
pub async fn telemetry_sql_query(sql: String) -> Result<Vec<Value>, String> {
    run_query(sql).await.map_err(|e| format!("{e:#}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    use std::net::TcpListener;

    fn spawn_server(status: u16, body: &'static str) -> String {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut buf = [0u8; 4096];
            let _ = stream.read(&mut buf);
            let response = format!(
                "HTTP/1.1 {status} OK\r\ncontent-length: {}\r\ncontent-type: application/x-ndjson\r\n\r\n{body}",
                body.len()
            );
            let _ = stream.write_all(response.as_bytes());
        });
        format!("http://{addr}/sql")
    }

    #[tokio::test]
    async fn parses_ndjson_rows() {
        let url = spawn_server(200, "{\"a\":1}\n{\"a\":2}\n");
        let rows = post_sql(&url, "SELECT 1").await.unwrap();
        assert_eq!(rows.len(), 2);
    }

    #[tokio::test]
    async fn surfaces_unavailable() {
        let url = spawn_server(503, "");
        let err = post_sql(&url, "SELECT 1").await.unwrap_err();
        assert!(err.to_string().contains("busy"));
    }
}
```

- [ ] **Step 2: Wire module + command**

Edit `packages/desktop-app/src-tauri/src/telemetry/mod.rs`, add:

```rust
pub mod query;
```

Edit `packages/desktop-app/src-tauri/src/lib.rs` — locate the `tauri::Builder` setup (around `commands.rs` registration) and add `telemetry::query::telemetry_sql_query` to `.invoke_handler(tauri::generate_handler![...])`.

- [ ] **Step 3: Update capabilities**

Edit `packages/desktop-app/src-tauri/capabilities/default.json` to add `"telemetry_sql_query"` to the permitted command list (look for the existing list of `core:` plus custom commands and follow the same pattern).

- [ ] **Step 4: Run tests**

Run: `cargo test --manifest-path packages/desktop-app/src-tauri/Cargo.toml -p everr-desktop-app -- query`
Expected: 2 tests pass.

(If the package name differs, run `cargo test --manifest-path packages/desktop-app/src-tauri/Cargo.toml -- query`.)

- [ ] **Step 5: Commit**

```bash
git add packages/desktop-app/src-tauri
git commit -m "feat(desktop-app): add telemetry_sql_query Tauri command"
```

---

## Task 16: Desktop frontend — local SQL client + param substitution (TDD)

**Files:**
- Create: `packages/desktop-app/src/features/logs/param-substitute.ts`
- Create: `packages/desktop-app/src/features/logs/param-substitute.test.ts`
- Create: `packages/desktop-app/src/features/logs/local-sql-client.ts`

The package emits SQL with placeholders like `{fromTime:String}`, `{levels:Array(String)}`, `{limit:UInt32}`. The local `/sql` endpoint takes a literal SQL string, so the desktop client must substitute params before invoking the Tauri command.

- [ ] **Step 1: Write the failing test for substitution**

```ts
import { describe, expect, it } from "vitest";
import { substituteParams } from "./param-substitute";

describe("substituteParams", () => {
  it("substitutes a String param with quoted, escaped value", () => {
    const out = substituteParams(
      "WHERE x = {q:String}",
      { q: "hi 'there'" },
    );
    expect(out).toBe("WHERE x = 'hi \\'there\\''");
  });

  it("substitutes a UInt32 param with a number literal", () => {
    const out = substituteParams("LIMIT {limit:UInt32}", { limit: 50 });
    expect(out).toBe("LIMIT 50");
  });

  it("substitutes Array(String) with a tuple of quoted strings", () => {
    const out = substituteParams(
      "x IN {ids:Array(String)}",
      { ids: ["a", "b'c"] },
    );
    expect(out).toBe("x IN ['a','b\\'c']");
  });

  it("treats undefined as the empty string for String params", () => {
    const out = substituteParams("x = {q:String}", { q: undefined });
    expect(out).toBe("x = ''");
  });

  it("throws on unknown param type", () => {
    expect(() =>
      substituteParams("x = {q:Bogus}", { q: 1 }),
    ).toThrow(/unsupported parameter type/i);
  });

  it("throws when a referenced param is missing", () => {
    expect(() =>
      substituteParams("x = {q:String}", {}),
    ).toThrow(/missing parameter q/i);
  });
});
```

- [ ] **Step 2: Run, expect failure**

Run: `pnpm --filter @everr/desktop-app test -- param-substitute`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement `param-substitute.ts`**

```ts
const PLACEHOLDER = /\{(\w+):([A-Za-z0-9()]+)\}/g;

function escapeString(value: string): string {
  return `'${value.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
}

function renderValue(type: string, raw: unknown, name: string): string {
  if (type === "String") {
    if (raw === undefined || raw === null) return "''";
    if (typeof raw !== "string") {
      throw new Error(`param ${name}: expected string, got ${typeof raw}`);
    }
    return escapeString(raw);
  }
  if (type === "UInt32" || type === "UInt64" || type === "Int32" || type === "Int64") {
    if (typeof raw !== "number" || !Number.isFinite(raw)) {
      throw new Error(`param ${name}: expected number for ${type}`);
    }
    return String(Math.trunc(raw));
  }
  if (type === "Array(String)") {
    if (!Array.isArray(raw)) {
      throw new Error(`param ${name}: expected array for Array(String)`);
    }
    return `[${raw.map((v) => escapeString(String(v))).join(",")}]`;
  }
  throw new Error(`unsupported parameter type ${type} for param ${name}`);
}

export function substituteParams(
  sql: string,
  params: Record<string, unknown>,
): string {
  return sql.replace(PLACEHOLDER, (_match, name: string, type: string) => {
    if (!(name in params)) {
      throw new Error(`missing parameter ${name}`);
    }
    return renderValue(type, params[name], name);
  });
}
```

- [ ] **Step 4: Run tests, expect pass**

Run: `pnpm --filter @everr/desktop-app test -- param-substitute`
Expected: 6 tests green.

- [ ] **Step 5: Implement `local-sql-client.ts`**

```ts
import type { SqlClient } from "@everr/logs-explorer";
import { invokeCommand } from "@/lib/tauri";
import { substituteParams } from "./param-substitute";

export const localSqlClient: SqlClient = {
  execute: async <Row>(
    sql: string,
    params: Record<string, unknown>,
  ): Promise<Row[]> => {
    const finalSql = substituteParams(sql, params);
    return invokeCommand<Row[]>("telemetry_sql_query", { sql: finalSql });
  },
};
```

- [ ] **Step 6: Add `@everr/logs-explorer` dep**

Edit `packages/desktop-app/package.json`, add to `dependencies`:

```json
"@everr/logs-explorer": "workspace:*",
```

Run: `pnpm install`

- [ ] **Step 7: Verify typecheck**

Run: `pnpm --filter @everr/desktop-app exec tsc --noEmit`
Expected: exit 0.

- [ ] **Step 8: Commit**

```bash
git add packages/desktop-app/package.json packages/desktop-app/src/features/logs pnpm-lock.yaml
git commit -m "feat(desktop-app): add local SQL client with param substitution"
```

---

## Task 17: Desktop — `/logs` route + nav

**Files:**
- Create: `packages/desktop-app/src/features/logs/logs-page.tsx`
- Modify: `packages/desktop-app/src/router.ts`
- Modify: `packages/desktop-app/src/features/desktop-shell/app-shell.tsx`

- [ ] **Step 1: Create `logs-page.tsx`**

```tsx
import {
  LogLevelSchema,
  LogsExplorer,
  LogsRepository,
  type LogsExplorerSearch,
} from "@everr/logs-explorer";
import { DEFAULT_TIME_RANGE } from "@everr/ui/components/time-range-picker";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useMemo } from "react";
import { z } from "zod";
import { localSqlClient } from "./local-sql-client";

export const LogsSearchSchema = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
  q: z.string().optional(),
  levels: z.array(LogLevelSchema).default([]),
  services: z.array(z.string()).default([]),
  repos: z.array(z.string()).default([]),
  traceId: z.string().optional(),
  showVolume: z.boolean().default(true),
});

export type LogsSearch = z.infer<typeof LogsSearchSchema>;

export function LogsPage() {
  const search = useSearch({ strict: false }) as LogsSearch;
  const navigate = useNavigate();
  const repo = useMemo(() => new LogsRepository(localSqlClient), []);

  const timeRange = {
    from: search.from ?? DEFAULT_TIME_RANGE.from,
    to: search.to ?? DEFAULT_TIME_RANGE.to,
  };

  const explorerSearch: LogsExplorerSearch = {
    q: search.q,
    levels: search.levels,
    services: search.services,
    repos: search.repos,
    traceId: search.traceId,
    showVolume: search.showVolume,
  };

  return (
    <div className="h-full">
      <LogsExplorer
        repo={repo}
        timeRange={timeRange}
        search={explorerSearch}
        onSearchChange={(next) =>
          navigate({
            to: "/logs",
            search: (prev: LogsSearch) => ({ ...prev, ...next }),
            replace: true,
          })
        }
        // No CI run-detail route in desktop — leave links unrendered.
      />
    </div>
  );
}
```

- [ ] **Step 2: Register route in `router.ts`**

Add to imports:

```ts
import { LogsPage, LogsSearchSchema } from "./features/logs/logs-page";
```

Add a new route definition under the authenticated parent:

```ts
const logsRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: "/logs",
  validateSearch: LogsSearchSchema,
  component: LogsPage,
});
```

Add `logsRoute` to `authenticatedRoute.addChildren([...])`.

- [ ] **Step 3: Add sidebar link in `app-shell.tsx`**

In the `<nav>` block of `AppShell`, add (next to the existing `SidebarLink`s):

```tsx
import { ScrollText } from "lucide-react";
// ...
<SidebarLink to="/logs" label="Logs">
  <ScrollText className="size-[18px]" />
</SidebarLink>
```

- [ ] **Step 4: Verify build**

Run: `pnpm --filter @everr/desktop-app exec tsc --noEmit`
Expected: exit 0.

- [ ] **Step 5: Smoke-test desktop end-to-end**

Run a local collector first (`everr-dev telemetry start` or equivalent — confirm with `everr-dev telemetry status` shows the SQL HTTP port listening).

Run: `pnpm dev:desktop`
Open the desktop app → click the Logs sidebar item.
Verify: the page renders, rows appear if the local collector has any (you can generate some by running an instrumented command), filter chips for service/repo populate, the histogram shows buckets, clicking a row opens the inspector.

If empty, hit `everr-dev telemetry query 'SELECT count() FROM logs'` to confirm whether the local store has rows.

- [ ] **Step 6: Commit**

```bash
git add packages/desktop-app/src
git commit -m "feat(desktop-app): add /logs page wired to local telemetry"
```

---

## Final verification

- [ ] **Step 1: Run all tests**

Run from repo root:

```bash
pnpm --filter @everr/logs-explorer test
pnpm --filter @everr/app test
pnpm --filter @everr/desktop-app test
cargo test --manifest-path packages/desktop-app/src-tauri/Cargo.toml -- query
```

All green.

- [ ] **Step 2: Run biome check**

```bash
pnpm check
```

Expected: no findings; if any, run `pnpm check:fix` and re-verify.

- [ ] **Step 3: Smoke-test webapp**

`pnpm dev:web` → `/logs` works as before.

- [ ] **Step 4: Smoke-test desktop**

`pnpm dev:desktop` → `/logs` shows local logs.

- [ ] **Step 5: Final commit if anything was tweaked**

```bash
git status
# commit any small fixes
```

---

## Notes

- The `LogsRepositoryLike` structural type (Task 14 step 2) is what lets the webapp's `remoteRepo` (a plain object backed by server fns) and the desktop's `new LogsRepository(localSqlClient)` (a class instance) both satisfy the package's UI/options surface without any casts.
- The package contains *no* server-only code: no ClickHouse client, no auth, no tenancy. Tenancy stays in the webapp's row-level policy; chdb is single-user.
- If at Task 12 step 4 the `createAuthenticatedServerFn` signature requires `context: { clickhouse }`, switch to the factory variant shown in that step's "alt" — both forms are documented inline so the engineer can pick at coding time.
- Param substitution in the desktop client (Task 16) covers only the types this package actually uses (`String`, `UInt32`, `Array(String)`). New types added later will need an addition to `renderValue`.
