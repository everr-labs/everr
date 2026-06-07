# Multiple Queries Per Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a dashboard panel run multiple queries (the full Perses `queries` array) so execution, the panel editor, and all three visualizations honour every query instead of only `queries[0]`.

**Architecture:** The Perses zod schema already stores `panel.spec.queries` as an array — no schema change. We extract pure helpers for query-array editing, per-query variable resolution, combined query-state, time-series series-merging, and stat-tile computation, each unit-tested in isolation. A shared `usePanelQueries` hook runs all queries in parallel via TanStack `useQueries`, reusing the existing per-query `panelQueryOptions` cache and `runPanelQuery` server fn. The visualization data contract changes from `QueryResultRow[]` to `QueryResultRow[][]` (one result set per query). The editor becomes a stacked list of per-query SQL editors.

**Tech Stack:** React, TanStack Query (`useQueries`), TanStack Router, Zod, Vitest + jsdom + @testing-library/react, Recharts.

---

## File Structure

**New files:**
- `packages/app/src/components/dashboards/query-array.ts` — pure helpers to read/edit the panel's `queries` array.
- `packages/app/src/components/dashboards/query-array.test.ts`
- `packages/app/src/components/dashboards/use-panel-queries.ts` — `usePanelQueries` hook + pure helpers `buildPanelQueryRequests` / `combineQueryStates`.
- `packages/app/src/components/dashboards/use-panel-queries.test.ts`
- `packages/app/src/components/dashboards/visualizations/time-series-chart/time-series-data.ts` — `buildChartModel` (series merge across queries).
- `packages/app/src/components/dashboards/visualizations/time-series-chart/time-series-data.test.ts`
- `packages/app/src/components/dashboards/visualizations/stat-chart/stat-series.ts` — `computeStatTiles`.
- `packages/app/src/components/dashboards/visualizations/stat-chart/stat-series.test.ts`

**Modified files:**
- `packages/app/src/components/dashboards/query-editor.tsx` — stacked multi-query editor.
- `packages/app/src/components/dashboards/dashboard-panel.tsx` — adopt `usePanelQueries`, pass `QueryResultRow[][]`.
- `packages/app/src/components/dashboards/panel-edit-page.tsx` — adopt `usePanelQueries` for preview, per-query manual run, pass `QueryResultRow[][]`.
- `packages/app/src/components/dashboards/panel-preview.tsx` — `data?: QueryResultRow[][]`.
- `packages/app/src/components/dashboards/visualizations/index.tsx` — `data?: QueryResultRow[][]`.
- `packages/app/src/components/dashboards/visualizations/time-series-chart/time-series-chart-visualization.tsx` — call `buildChartModel`.
- `packages/app/src/components/dashboards/visualizations/table/table-visualization.tsx` — query selector.
- `packages/app/src/components/dashboards/visualizations/stat-chart/stat-chart-visualization.tsx` — one tile per series via `computeStatTiles`.
- `DASHBOARD_FEATURES.md` — drop the single-query limitation note.

**Commands** (run from `packages/app`):
- Single test file: `pnpm exec vitest run <path>`
- Typecheck: `pnpm typecheck`

---

## Task 1: Query-array editing helpers

Pure helpers for reading and mutating `panel.spec.queries`. This replaces the ad-hoc `getQueryText`/`setQueryText` currently inlined in `query-editor.tsx`.

**Files:**
- Create: `packages/app/src/components/dashboards/query-array.ts`
- Test: `packages/app/src/components/dashboards/query-array.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/app/src/components/dashboards/query-array.test.ts
import { describe, expect, it } from "vitest";
import type { Panel } from "@/data/dashboards/schema";
import {
  addQuery,
  getQueryTextAt,
  getQueryTexts,
  removeQueryAt,
  setQueryTextAt,
} from "./query-array";

function panelWith(queries: string[]): Panel {
  return {
    kind: "Panel",
    spec: {
      display: { name: "p" },
      plugin: { kind: "TimeSeriesChart", spec: {} },
      queries: queries.map((query) => ({
        kind: "ClickHouseSQL",
        spec: { plugin: { kind: "ClickHouseSQL", spec: { query } } },
      })),
    },
  };
}

describe("query-array", () => {
  it("reads query text by index, empty string when absent", () => {
    const panel = panelWith(["select 1"]);
    expect(getQueryTextAt(panel, 0)).toBe("select 1");
    expect(getQueryTextAt(panel, 1)).toBe("");
  });

  it("getQueryTexts returns all texts in order", () => {
    expect(getQueryTexts(panelWith(["a", "b"]))).toEqual(["a", "b"]);
    expect(getQueryTexts(panelWith([]))).toEqual([]);
  });

  it("sets query text at an index without touching siblings", () => {
    const next = setQueryTextAt(panelWith(["a", "b"]), 1, "b2");
    expect(getQueryTexts(next)).toEqual(["a", "b2"]);
  });

  it("appends a blank ClickHouseSQL query", () => {
    const next = addQuery(panelWith(["a"]));
    expect(getQueryTexts(next)).toEqual(["a", ""]);
    expect(next.spec.queries?.[1]?.kind).toBe("ClickHouseSQL");
  });

  it("adds the first query when queries is undefined", () => {
    const panel: Panel = {
      kind: "Panel",
      spec: { display: {}, plugin: { kind: "Table", spec: {} } },
    };
    expect(getQueryTexts(addQuery(panel))).toEqual([""]);
  });

  it("removes a query by index", () => {
    expect(getQueryTexts(removeQueryAt(panelWith(["a", "b", "c"]), 1))).toEqual([
      "a",
      "c",
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/components/dashboards/query-array.test.ts`
Expected: FAIL — `Cannot find module './query-array'`.

- [ ] **Step 3: Write the implementation**

```ts
// packages/app/src/components/dashboards/query-array.ts
import type { Panel, PanelQuery } from "@/data/dashboards/schema";

export function makeClickHouseQuery(query: string): PanelQuery {
  return {
    kind: "ClickHouseSQL",
    spec: { plugin: { kind: "ClickHouseSQL", spec: { query } } },
  };
}

export function getQueryTextAt(panel: Panel, index: number): string {
  const query = panel.spec.queries?.[index];
  if (!query) return "";
  const spec = query.spec.plugin.spec;
  return typeof spec.query === "string" ? spec.query : "";
}

export function getQueryTexts(panel: Panel): string[] {
  return (panel.spec.queries ?? []).map((_, i) => getQueryTextAt(panel, i));
}

export function setQueryTextAt(
  panel: Panel,
  index: number,
  query: string,
): Panel {
  const queries = [...(panel.spec.queries ?? [])];
  queries[index] = makeClickHouseQuery(query);
  return { ...panel, spec: { ...panel.spec, queries } };
}

export function addQuery(panel: Panel): Panel {
  const queries = [...(panel.spec.queries ?? []), makeClickHouseQuery("")];
  return { ...panel, spec: { ...panel.spec, queries } };
}

export function removeQueryAt(panel: Panel, index: number): Panel {
  const queries = (panel.spec.queries ?? []).filter((_, i) => i !== index);
  return { ...panel, spec: { ...panel.spec, queries } };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/components/dashboards/query-array.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/components/dashboards/query-array.ts packages/app/src/components/dashboards/query-array.test.ts
git commit -m "feat(dashboards): add query-array helpers for multi-query panels"
```

---

## Task 2: Combined query-state helpers

Pure helpers behind `usePanelQueries`: resolve per-query variables (`buildPanelQueryRequests`) and fold per-query react-query states into one panel result (`combineQueryStates`). The hook itself (which needs React + a QueryClient) is wired in Task 6; here we build and test the pure core.

**Files:**
- Create: `packages/app/src/components/dashboards/use-panel-queries.ts`
- Test: `packages/app/src/components/dashboards/use-panel-queries.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/app/src/components/dashboards/use-panel-queries.test.ts
import { describe, expect, it } from "vitest";
import {
  buildPanelQueryRequests,
  combineQueryStates,
  type SingleQueryState,
} from "./use-panel-queries";

const ctx = {
  definedNames: new Set(["region"]),
  values: { region: "us" } as Record<string, string | string[]>,
  meta: {},
  pendingAllNames: [] as string[],
};

function state(partial: Partial<SingleQueryState>): SingleQueryState {
  return {
    sql: "select 1",
    missingName: undefined,
    isPending: false,
    isError: false,
    error: undefined,
    rows: [],
    ...partial,
  };
}

describe("buildPanelQueryRequests", () => {
  it("resolves variables per query independently", () => {
    const reqs = buildPanelQueryRequests(
      ["select $region", "select 1"],
      ctx,
    );
    expect(reqs[0]!.variables).toEqual({ region: "us" });
    expect(reqs[0]!.missingName).toBeUndefined();
    expect(reqs[1]!.variables).toBeUndefined();
  });

  it("flags a query whose variable has no value", () => {
    const reqs = buildPanelQueryRequests(["select $region"], {
      ...ctx,
      values: {},
    });
    expect(reqs[0]!.missingName).toBe("region");
  });

  it("flags a query waiting for all-expansion options", () => {
    const reqs = buildPanelQueryRequests(["select $region"], {
      ...ctx,
      pendingAllNames: ["region"],
    });
    expect(reqs[0]!.waitingForOptions).toBe(true);
  });
});

describe("combineQueryStates", () => {
  it("is success with one result set per non-empty query, in order", () => {
    const result = combineQueryStates([
      state({ sql: "a", rows: [{ x: 1 }] }),
      state({ sql: "b", rows: [{ x: 2 }] }),
    ]);
    expect(result.status).toBe("success");
    expect(result.data).toEqual([[{ x: 1 }], [{ x: 2 }]]);
  });

  it("ignores empty-sql queries entirely", () => {
    const result = combineQueryStates([
      state({ sql: "a", rows: [{ x: 1 }] }),
      state({ sql: "   ", rows: undefined, isPending: true }),
    ]);
    expect(result.status).toBe("success");
    expect(result.data).toEqual([[{ x: 1 }]]);
  });

  it("errors the whole panel when any query errors", () => {
    const result = combineQueryStates([
      state({ sql: "a", rows: [{ x: 1 }] }),
      state({ sql: "b", isError: true, error: new Error("boom") }),
    ]);
    expect(result.status).toBe("error");
    expect(result.errorMessage).toBe("boom");
  });

  it("errors with a variable hint when a query is missing a value", () => {
    const result = combineQueryStates([
      state({ sql: "select $region", missingName: "region", rows: undefined }),
    ]);
    expect(result.status).toBe("error");
    expect(result.errorMessage).toBe("Select a value for $region");
  });

  it("is pending while any active query has no rows yet", () => {
    const result = combineQueryStates([
      state({ sql: "a", rows: [{ x: 1 }] }),
      state({ sql: "b", isPending: true, rows: undefined }),
    ]);
    expect(result.status).toBe("pending");
  });

  it("is success with undefined data when no queries are active", () => {
    const result = combineQueryStates([state({ sql: "", rows: undefined })]);
    expect(result.status).toBe("success");
    expect(result.data).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/components/dashboards/use-panel-queries.test.ts`
Expected: FAIL — `Cannot find module './use-panel-queries'`.

- [ ] **Step 3: Write the implementation (pure helpers only for now)**

```ts
// packages/app/src/components/dashboards/use-panel-queries.ts
import { useQueries } from "@tanstack/react-query";
import { useMemo } from "react";
import {
  extractVariableTokens,
  type VariableMeta,
  type VariableValues,
} from "@/data/dashboards/interpolate";
import { panelQueryOptions } from "@/data/dashboards/options";
import type { Panel } from "@/data/dashboards/schema";
import { pickByNames } from "@/data/dashboards/variable-values";
import { getQueryTexts } from "./query-array";
import { useDashboardVariables } from "./use-dashboard-variables";
import type { QueryResultRow } from "./visualizations";

export interface PanelQueryRequest {
  sql: string;
  variables?: VariableValues;
  variableMeta?: VariableMeta;
  missingName?: string;
  waitingForOptions: boolean;
}

interface VariableContext {
  definedNames: Set<string>;
  values: VariableValues;
  meta: VariableMeta;
  pendingAllNames: string[];
}

export function buildPanelQueryRequests(
  sqls: string[],
  ctx: VariableContext,
): PanelQueryRequest[] {
  return sqls.map((sql) => {
    const usedNames = extractVariableTokens(sql).filter((n) =>
      ctx.definedNames.has(n),
    );
    const missingName = usedNames.find((n) => ctx.values[n] === undefined);
    const waitingForOptions = usedNames.some((n) =>
      ctx.pendingAllNames.includes(n),
    );
    return {
      sql,
      variables:
        usedNames.length > 0 ? pickByNames(ctx.values, usedNames) : undefined,
      variableMeta:
        usedNames.length > 0 ? pickByNames(ctx.meta, usedNames) : undefined,
      missingName,
      waitingForOptions,
    };
  });
}

export type PanelQueriesStatus = "pending" | "error" | "success";

export interface CombinedPanelResult {
  status: PanelQueriesStatus;
  data?: QueryResultRow[][];
  errorMessage?: string;
}

export interface SingleQueryState {
  sql: string;
  missingName?: string;
  isPending: boolean;
  isError: boolean;
  error?: unknown;
  rows?: QueryResultRow[];
}

export function combineQueryStates(
  states: SingleQueryState[],
): CombinedPanelResult {
  for (const s of states) {
    if (s.sql.trim().length === 0) continue;
    if (s.missingName !== undefined) {
      return {
        status: "error",
        errorMessage: `Select a value for $${s.missingName}`,
      };
    }
    if (s.isError) {
      return {
        status: "error",
        errorMessage:
          s.error instanceof Error ? s.error.message : String(s.error),
      };
    }
  }

  const active = states.filter((s) => s.sql.trim().length > 0);
  if (active.length === 0) return { status: "success", data: undefined };
  if (active.some((s) => s.isPending || s.rows === undefined)) {
    return { status: "pending" };
  }
  return { status: "success", data: active.map((s) => s.rows ?? []) };
}

export interface UsePanelQueriesOptions {
  from?: string;
  to?: string;
  /** Gate the entire panel (e.g. wait for the dashboard store to hydrate). */
  enabled?: boolean;
  /**
   * Per-query auto-run gate. The editor passes a predicate so only unmodified
   * (already-saved) query text auto-runs; modified text waits for a manual Run.
   * Defaults to always-enabled (dashboard view).
   */
  queryEnabled?: (sql: string, index: number) => boolean;
}

export function usePanelQueries(
  panel: Panel,
  opts: UsePanelQueriesOptions = {},
): CombinedPanelResult {
  const { variables, values, meta, pendingAllNames } = useDashboardVariables();
  const definedNames = useMemo(
    () => new Set(variables.map((v) => v.spec.name)),
    [variables],
  );
  const sqls = useMemo(() => getQueryTexts(panel), [panel]);
  const requests = useMemo(
    () =>
      buildPanelQueryRequests(sqls, {
        definedNames,
        values,
        meta,
        pendingAllNames,
      }),
    [sqls, definedNames, values, meta, pendingAllNames],
  );

  const results = useQueries({
    queries: requests.map((r, i) => ({
      ...panelQueryOptions(r.sql, opts.from, opts.to, r.variables, r.variableMeta),
      enabled:
        (opts.enabled ?? true) &&
        r.sql.trim().length > 0 &&
        r.missingName === undefined &&
        !r.waitingForOptions &&
        (opts.queryEnabled?.(r.sql, i) ?? true),
    })),
  });

  return useMemo(
    () =>
      combineQueryStates(
        requests.map((r, i) => ({
          sql: r.sql,
          missingName: r.missingName,
          isPending: results[i]?.isPending ?? false,
          isError: results[i]?.isError ?? false,
          error: results[i]?.error,
          rows: results[i]?.data?.rows,
        })),
      ),
    [requests, results],
  );
}
```

> Note: `combineQueryStates` reports `pending` for a query that is disabled-and-uncached (rows undefined). In the editor, a query whose SQL was edited but not yet Run therefore shows pending until Run populates the cache — an intentional change from v1's "keep showing the previous result".

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/components/dashboards/use-panel-queries.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 5: Typecheck (the hook references real modules)**

Run: `pnpm typecheck`
Expected: no errors. If `VariableMeta`/`VariableValues` are not re-exported from `interpolate`, import them from `@/data/dashboards/interpolate` directly (they are defined there at lines 14 and 22).

- [ ] **Step 6: Commit**

```bash
git add packages/app/src/components/dashboards/use-panel-queries.ts packages/app/src/components/dashboards/use-panel-queries.test.ts
git commit -m "feat(dashboards): add usePanelQueries hook and combine helpers"
```

---

## Task 3: Time-series series-merge across queries

Extract the chart-data transform out of the component into a pure `buildChartModel` that accepts `QueryResultRow[][]` and merges series from every query onto one time axis, namespacing each query's value keys so identical column names don't collide.

**Files:**
- Create: `packages/app/src/components/dashboards/visualizations/time-series-chart/time-series-data.ts`
- Test: `packages/app/src/components/dashboards/visualizations/time-series-chart/time-series-data.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/app/src/components/dashboards/visualizations/time-series-chart/time-series-data.test.ts
import { describe, expect, it } from "vitest";
import { buildChartModel } from "./time-series-data";

const TS_KEY = "__ts";

describe("buildChartModel", () => {
  it("keeps a single query's value keys unprefixed", () => {
    const model = buildChartModel(
      [[{ time: "2026-06-07T00:00:00", value: 5 }]],
      undefined,
    );
    expect(model.valueKeys).toEqual(["value"]);
    expect(model.chartData[0]?.[TS_KEY]).toBeTypeOf("number");
    expect(model.chartData[0]?.value).toBe(5);
  });

  it("namespaces colliding value keys across two queries and merges by time", () => {
    const model = buildChartModel(
      [
        [{ time: "2026-06-07T00:00:00", value: 1 }],
        [{ time: "2026-06-07T00:00:00", value: 2 }],
      ],
      undefined,
    );
    expect(model.valueKeys).toEqual(["q0__value", "q1__value"]);
    expect(model.chartData).toHaveLength(1);
    expect(model.chartData[0]?.q0__value).toBe(1);
    expect(model.chartData[0]?.q1__value).toBe(2);
  });

  it("assigns distinct colors to series across queries", () => {
    const model = buildChartModel(
      [
        [{ time: "2026-06-07T00:00:00", value: 1 }],
        [{ time: "2026-06-07T00:00:00", value: 2 }],
      ],
      undefined,
    );
    expect(model.chartConfig.q0__value?.color).not.toBe(
      model.chartConfig.q1__value?.color,
    );
  });

  it("returns an empty model for empty input", () => {
    expect(buildChartModel([], undefined)).toEqual({
      chartData: [],
      valueKeys: [],
      chartConfig: {},
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/components/dashboards/visualizations/time-series-chart/time-series-data.test.ts`
Expected: FAIL — `Cannot find module './time-series-data'`.

- [ ] **Step 3: Write the implementation**

Move the helper functions `getGroupKeys`, `sanitizeKey`, `pivotByGroup`, `detectInterval`, `fillAndClamp`, and the constants `COLORS`/`TS_KEY` out of `time-series-chart-visualization.tsx` into this new module, then add `buildChartModel`. (They are removed from the component in Task 6.)

```ts
// packages/app/src/components/dashboards/visualizations/time-series-chart/time-series-data.ts
import type { ChartConfig } from "@everr/ui/components/chart";
import { detectTimeKey, getValueKeys, toTimestamp } from "../data-utils";
import type { QueryResultRow } from "../index";

export const TS_KEY = "__ts";

export const COLORS = [
  "hsl(217, 91%, 60%)",
  "hsl(142, 71%, 45%)",
  "hsl(0, 84%, 60%)",
  "hsl(280, 68%, 60%)",
  "hsl(35, 92%, 50%)",
  "hsl(190, 90%, 50%)",
];

function getGroupKeys(row: QueryResultRow, timeKey: string): string[] {
  return Object.keys(row).filter(
    (k) => k !== timeKey && typeof row[k] === "string",
  );
}

function sanitizeKey(name: string): string {
  return name.replace(/[^a-zA-Z0-9]/g, "_");
}

function pivotByGroup(
  rows: QueryResultRow[],
  timeKey: string,
  groupKey: string,
  valueKey: string,
): {
  pivoted: QueryResultRow[];
  seriesKeys: string[];
  labelMap: Map<string, string>;
} {
  const byTimestamp = new Map<string | number, QueryResultRow>();
  const seriesSet = new Set<string>();
  const labelMap = new Map<string, string>();

  for (const row of rows) {
    const ts = row[timeKey];
    const group = String(row[groupKey]);
    const key = sanitizeKey(group);
    const raw = row[valueKey];
    const value = typeof raw === "string" ? Number(raw) : raw;
    seriesSet.add(key);
    labelMap.set(key, group);

    let entry = byTimestamp.get(ts as string | number);
    if (!entry) {
      entry = { [timeKey]: ts };
      byTimestamp.set(ts as string | number, entry);
    }
    entry[key] = value;
  }

  const seriesKeys = [...seriesSet].sort();
  const pivoted = [...byTimestamp.values()];
  return { pivoted, seriesKeys, labelMap };
}

function detectInterval(timestamps: number[]): number | null {
  if (timestamps.length < 2) return null;
  const diffs: number[] = [];
  for (let i = 1; i < timestamps.length; i++) {
    diffs.push(timestamps[i]! - timestamps[i - 1]!);
  }
  diffs.sort((a, b) => a - b);
  return diffs[Math.floor(diffs.length / 2)]!;
}

function fillAndClamp(
  rows: Array<Record<string, unknown>>,
  valueKeys: string[],
  domain: [number, number],
  interval: number,
): Array<Record<string, unknown>> {
  const byTs = new Map<number, Record<string, unknown>>();
  for (const row of rows) {
    const ts = row[TS_KEY] as number;
    if (ts >= domain[0] && ts <= domain[1]) {
      byTs.set(ts, row);
    }
  }

  const first = Math.ceil(domain[0] / interval) * interval;
  const result: Array<Record<string, unknown>> = [];
  for (let t = first; t <= domain[1]; t += interval) {
    const existing = byTs.get(t);
    if (existing) {
      result.push(existing);
    } else {
      const empty: Record<string, unknown> = { [TS_KEY]: t };
      for (const k of valueKeys) {
        empty[k] = null;
      }
      result.push(empty);
    }
  }
  return result;
}

export interface ChartModel {
  chartData: Array<Record<string, unknown>>;
  valueKeys: string[];
  chartConfig: ChartConfig;
}

export function buildChartModel(
  dataSets: QueryResultRow[][],
  domain: [number, number] | undefined,
): ChartModel {
  const chartConfig: ChartConfig = {};
  const valueKeys: string[] = [];
  const byTs = new Map<number, Record<string, unknown>>();
  let colorIndex = 0;
  const multi = dataSets.length > 1;

  dataSets.forEach((data, setIndex) => {
    if (!data || data.length === 0) return;
    const tk = detectTimeKey(data);
    if (!tk) return;

    const groupKeys = getGroupKeys(data[0]!, tk);
    const rawValueKeys = getValueKeys(data[0]!, tk);

    let rows: QueryResultRow[];
    let vk: string[];
    let labels: Map<string, string> | undefined;

    if (groupKeys.length >= 1 && rawValueKeys.length === 1) {
      const compositeKey = "__group__";
      const keyed = data.map((row) => ({
        ...row,
        [compositeKey]: groupKeys.map((k) => row[k]).join(" · "),
      }));
      const piv = pivotByGroup(keyed, tk, compositeKey, rawValueKeys[0]!);
      rows = piv.pivoted;
      vk = piv.seriesKeys;
      labels = piv.labelMap;
    } else {
      rows = data;
      vk = rawValueKeys;
    }

    const prefix = multi ? `q${setIndex}__` : "";
    for (const key of vk) {
      const nsKey = `${prefix}${key}`;
      valueKeys.push(nsKey);
      chartConfig[nsKey] = {
        label: labels?.get(key) ?? key,
        color: COLORS[colorIndex % COLORS.length],
      };
      colorIndex++;
    }

    for (const row of rows) {
      const ts = toTimestamp(row[tk]);
      let entry = byTs.get(ts);
      if (!entry) {
        entry = { [TS_KEY]: ts };
        byTs.set(ts, entry);
      }
      for (const key of vk) {
        entry[`${prefix}${key}`] = row[key];
      }
    }
  });

  const mapped = [...byTs.values()].sort(
    (a, b) => (a[TS_KEY] as number) - (b[TS_KEY] as number),
  );

  const timestamps = mapped.map((r) => r[TS_KEY] as number);
  const interval = detectInterval(timestamps);

  let filled: Array<Record<string, unknown>>;
  if (domain && interval && interval > 0) {
    filled = fillAndClamp(mapped, valueKeys, domain, interval);
  } else if (domain) {
    filled = mapped.filter((r) => {
      const ts = r[TS_KEY] as number;
      return ts >= domain[0] && ts <= domain[1];
    });
  } else {
    filled = mapped;
  }

  return { chartData: filled, valueKeys, chartConfig };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/components/dashboards/visualizations/time-series-chart/time-series-data.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/components/dashboards/visualizations/time-series-chart/time-series-data.ts packages/app/src/components/dashboards/visualizations/time-series-chart/time-series-data.test.ts
git commit -m "feat(dashboards): extract time-series series-merge for multi-query"
```

---

## Task 4: Stat-tile computation across queries

Extract a pure `computeStatTiles` that turns `QueryResultRow[][]` into one tile per numeric value column per query, each reduced via the panel's calculation.

**Files:**
- Create: `packages/app/src/components/dashboards/visualizations/stat-chart/stat-series.ts`
- Test: `packages/app/src/components/dashboards/visualizations/stat-chart/stat-series.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/app/src/components/dashboards/visualizations/stat-chart/stat-series.test.ts
import { describe, expect, it } from "vitest";
import { computeStatTiles } from "./stat-series";

describe("computeStatTiles", () => {
  it("reduces a single time series to one tile", () => {
    const tiles = computeStatTiles(
      [
        [
          { time: "2026-06-07T00:00:00", value: 1 },
          { time: "2026-06-07T00:01:00", value: 3 },
        ],
      ],
      "last",
    );
    expect(tiles).toHaveLength(1);
    expect(tiles[0]!.value).toBe(3);
    expect(tiles[0]!.label).toBe("value");
    expect(tiles[0]!.points).toHaveLength(2);
  });

  it("produces one tile per query", () => {
    const tiles = computeStatTiles(
      [
        [{ ts: "2026-06-07T00:00:00", value: 10 }],
        [{ ts: "2026-06-07T00:00:00", value: 20 }],
      ],
      "last",
    );
    expect(tiles.map((t) => t.value)).toEqual([10, 20]);
  });

  it("produces one tile per numeric column within a query", () => {
    const tiles = computeStatTiles(
      [[{ ts: "2026-06-07T00:00:00", a: 1, b: 2 }]],
      "last",
    );
    expect(tiles.map((t) => t.label)).toEqual(["a", "b"]);
  });

  it("handles value-only rows with no time column", () => {
    const tiles = computeStatTiles([[{ value: 7 }]], "last");
    expect(tiles[0]!.value).toBe(7);
    expect(tiles[0]!.points).toEqual([]);
  });

  it("skips empty result sets", () => {
    expect(computeStatTiles([[]], "last")).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/components/dashboards/visualizations/stat-chart/stat-series.test.ts`
Expected: FAIL — `Cannot find module './stat-series'`.

- [ ] **Step 3: Write the implementation**

```ts
// packages/app/src/components/dashboards/visualizations/stat-chart/stat-series.ts
import { detectTimeKey, getValueKeys, toTimestamp } from "../data-utils";
import type { QueryResultRow } from "../index";
import { calculate, type CalculationType } from "./stat-calculations";

export interface StatTile {
  label: string;
  value: number | undefined;
  values: number[];
  points: { ts: number; value: number }[];
}

export function computeStatTiles(
  dataSets: QueryResultRow[][],
  calculation: CalculationType,
): StatTile[] {
  const tiles: StatTile[] = [];

  for (const rows of dataSets) {
    const first = rows[0];
    if (!first) continue;

    const timeKey = detectTimeKey(rows);
    const valueKeys = getValueKeys(first, timeKey ?? "");

    for (const valueKey of valueKeys) {
      if (!timeKey) {
        const values = rows
          .map((row) => row[valueKey])
          .filter((v): v is number => typeof v === "number");
        tiles.push({
          label: valueKey,
          value: calculate(values, calculation),
          values,
          points: [],
        });
        continue;
      }

      const points = rows
        .filter((row) => typeof row[valueKey] === "number")
        .map((row) => ({
          ts: toTimestamp(row[timeKey]),
          value: row[valueKey] as number,
        }))
        .sort((a, b) => a.ts - b.ts);
      const values = points.map((p) => p.value);
      tiles.push({
        label: valueKey,
        value: calculate(values, calculation),
        values,
        points,
      });
    }
  }

  return tiles;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/components/dashboards/visualizations/stat-chart/stat-series.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/components/dashboards/visualizations/stat-chart/stat-series.ts packages/app/src/components/dashboards/visualizations/stat-chart/stat-series.test.ts
git commit -m "feat(dashboards): extract stat-tile computation for multi-query"
```

---

## Task 5: Stacked multi-query editor

Rewrite `QueryEditor` from a single SQL editor into a stacked list of per-query editors with add/remove and a per-query Run button. Stable render-time ids key each row so removing a middle query doesn't mis-associate the uncontrolled `SqlEditor`. `onRunQuery` now receives the query index.

**Files:**
- Modify: `packages/app/src/components/dashboards/query-editor.tsx`
- Test: `packages/app/src/components/dashboards/query-editor.test.tsx` (create)

- [ ] **Step 1: Write the failing test**

```tsx
// packages/app/src/components/dashboards/query-editor.test.tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import type { Panel } from "@/data/dashboards/schema";
import { QueryEditor } from "./query-editor";

vi.mock("./sql-editor", () => ({
  SqlEditor: ({
    defaultValue,
    onChange,
  }: {
    defaultValue: string;
    onChange: (t: string) => void;
  }) => (
    <textarea
      aria-label="sql"
      defaultValue={defaultValue}
      onChange={(e) => onChange(e.target.value)}
    />
  ),
}));

function panelWith(queries: string[]): Panel {
  return {
    kind: "Panel",
    spec: {
      display: { name: "p" },
      plugin: { kind: "Table", spec: {} },
      queries: queries.map((query) => ({
        kind: "ClickHouseSQL",
        spec: { plugin: { kind: "ClickHouseSQL", spec: { query } } },
      })),
    },
  };
}

function Harness({ initial }: { initial: Panel }) {
  const [draft, setDraft] = useState(initial);
  return (
    <QueryEditor draft={draft} onChange={setDraft} onRunQuery={() => {}} />
  );
}

describe("QueryEditor", () => {
  it("renders one editor per query", () => {
    render(<Harness initial={panelWith(["a", "b"])} />);
    expect(screen.getAllByLabelText("sql")).toHaveLength(2);
  });

  it("adds a query", async () => {
    render(<Harness initial={panelWith(["a"])} />);
    await userEvent.click(screen.getByRole("button", { name: /add query/i }));
    expect(screen.getAllByLabelText("sql")).toHaveLength(2);
  });

  it("removes a query", async () => {
    render(<Harness initial={panelWith(["a", "b"])} />);
    await userEvent.click(
      screen.getAllByRole("button", { name: /remove query/i })[0]!,
    );
    expect(screen.getAllByLabelText("sql")).toHaveLength(1);
  });

  it("calls onRunQuery with the query's index", async () => {
    const onRun = vi.fn();
    render(
      <QueryEditor
        draft={panelWith(["a", "b"])}
        onChange={() => {}}
        onRunQuery={onRun}
      />,
    );
    await userEvent.click(
      screen.getAllByRole("button", { name: /run query/i })[1]!,
    );
    expect(onRun).toHaveBeenCalledWith(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/components/dashboards/query-editor.test.tsx`
Expected: FAIL — current `QueryEditor` renders a single editor and `onRunQuery` takes a string, so the index and add/remove assertions fail.

- [ ] **Step 3: Rewrite the component**

```tsx
// packages/app/src/components/dashboards/query-editor.tsx
import { Button } from "@everr/ui/components/button";
import { Label } from "@everr/ui/components/label";
import { Play, Plus, Trash2 } from "lucide-react";
import { useRef } from "react";
import type { Panel } from "@/data/dashboards/schema";
import {
  addQuery,
  getQueryTextAt,
  getQueryTexts,
  removeQueryAt,
  setQueryTextAt,
} from "./query-array";
import { SqlEditor } from "./sql-editor";

interface QueryEditorProps {
  draft: Panel;
  onChange: (panel: Panel) => void;
  onRunQuery: (index: number) => void;
  runningIndex?: number | null;
}

const QUERY_LABELS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

function queryLabel(index: number): string {
  return QUERY_LABELS[index] ?? String(index + 1);
}

export function QueryEditor({
  draft,
  onChange,
  onRunQuery,
  runningIndex,
}: QueryEditorProps) {
  const texts = getQueryTexts(draft);
  // Stable ids per row so removing a middle query doesn't remount the wrong
  // uncontrolled SqlEditor. Grown lazily; we never shrink it, we just index in.
  const idsRef = useRef<number[]>([]);
  const nextIdRef = useRef(0);
  while (idsRef.current.length < texts.length) {
    idsRef.current.push(nextIdRef.current++);
  }

  const queries = texts.length > 0 ? texts : [""];
  // If the panel had no queries at all, seed index 0 lazily on first edit.

  return (
    <div className="flex h-full flex-col gap-4 overflow-auto">
      {queries.map((text, index) => (
        <div key={idsRef.current[index]} className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <Label>Query {queryLabel(index)} · ClickHouse SQL</Label>
            <div className="flex items-center gap-1">
              <Button
                variant="outline"
                size="sm"
                disabled={runningIndex === index || !text.trim()}
                onClick={() => onRunQuery(index)}
              >
                <Play data-icon="inline-start" />
                {runningIndex === index ? "Running…" : "Run Query"}
              </Button>
              {texts.length > 1 && (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Remove query"
                  onClick={() => {
                    idsRef.current.splice(index, 1);
                    onChange(removeQueryAt(draft, index));
                  }}
                >
                  <Trash2 />
                </Button>
              )}
            </div>
          </div>
          <SqlEditor
            defaultValue={getQueryTextAt(draft, index)}
            onChange={(value) => onChange(setQueryTextAt(draft, index, value))}
            className="min-h-32"
          />
        </div>
      ))}
      <Button
        variant="outline"
        size="sm"
        className="self-start"
        onClick={() => onChange(addQuery(draft))}
      >
        <Plus data-icon="inline-start" />
        Add query
      </Button>
    </div>
  );
}
```

> The previous single editor filled its pane (`min-h-0 flex-1`); stacked editors use a fixed `min-h-32` each inside a scrollable column. `onRunQuery` changed from `(sql)` to `(index)` — Task 6 updates `PanelEditPage` to match.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/components/dashboards/query-editor.test.tsx`
Expected: PASS (4 tests). The repo lint/format (`pnpm exec biome check --write src/components/dashboards/query-editor.tsx`) may reorder imports — run it if the pre-commit hook complains.

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/components/dashboards/query-editor.tsx packages/app/src/components/dashboards/query-editor.test.tsx
git commit -m "feat(dashboards): stacked multi-query panel editor"
```

> After this commit the app still compiles only once Task 6 updates `PanelEditPage` (which currently calls `onRunQuery` with a string and reads `getQuerySql`). Do Task 6 next without pausing the app on this intermediate state.

---

## Task 6: Wire the data contract end-to-end

Flip `VisualizationProps.data` to `QueryResultRow[][]`, update all three visualizations to consume it via the Task 3/4 helpers + a table selector, and switch both call sites to `usePanelQueries`. This is the integration commit — keep the steps in order so the tree compiles at the end.

**Files:**
- Modify: `packages/app/src/components/dashboards/visualizations/index.tsx`
- Modify: `packages/app/src/components/dashboards/visualizations/time-series-chart/time-series-chart-visualization.tsx`
- Modify: `packages/app/src/components/dashboards/visualizations/table/table-visualization.tsx`
- Modify: `packages/app/src/components/dashboards/visualizations/stat-chart/stat-chart-visualization.tsx`
- Modify: `packages/app/src/components/dashboards/panel-preview.tsx`
- Modify: `packages/app/src/components/dashboards/dashboard-panel.tsx`
- Modify: `packages/app/src/components/dashboards/panel-edit-page.tsx`
- Test: `packages/app/src/components/dashboards/visualizations/table/table-visualization.test.tsx` (create)

- [ ] **Step 1: Change the visualization data contract**

In `packages/app/src/components/dashboards/visualizations/index.tsx`, change the `data` field type:

```ts
export interface VisualizationProps {
  plugin: PanelPlugin;
  data?: QueryResultRow[][];
  timeRange?: ResolvedTimeRange;
  onTimeRangeChange?: (range: ResolvedTimeRange) => void;
}
```

(No other change in this file — `PanelVisualization` just forwards `data`.)

- [ ] **Step 2: Update the time-series visualization to use `buildChartModel`**

In `time-series-chart-visualization.tsx`:
1. Delete the now-moved helpers/constants: `COLORS`, `TS_KEY` (local const), `getGroupKeys`, `sanitizeKey`, `pivotByGroup`, `detectInterval`, `fillAndClamp`. Keep `createTickFormatter`, `TICK_INTERVALS`, `generateTicks`, `getPlotArea`, `pxToTimestamp`.
2. Add imports:

```ts
import { buildChartModel, TS_KEY } from "./time-series-data";
```

3. Replace the `const { chartData, valueKeys, chartConfig } = useMemo(() => { … }, [data, domain]);` block (the large transform, ~lines 251-317) with:

```ts
  const { chartData, valueKeys, chartConfig } = useMemo(
    () => buildChartModel(data ?? [], domain),
    [data, domain],
  );
```

4. The empty-state guard stays `if (!data || chartData.length === 0)`. Everything else (axes, lines over `valueKeys`, tooltip, brushing) is unchanged because it already keys off `valueKeys`/`chartConfig`/`TS_KEY`.

- [ ] **Step 3: Add the table query selector**

Rewrite `table-visualization.tsx`:

```tsx
// packages/app/src/components/dashboards/visualizations/table/table-visualization.tsx
import { type Column, DataTable } from "@everr/ui/components/data-table";
import { ToggleGroup, ToggleGroupItem } from "@everr/ui/components/toggle-group";
import { TableIcon } from "lucide-react";
import { useState } from "react";
import type { QueryResultRow, VisualizationProps } from "../index";

const QUERY_LABELS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

function buildColumns(rows: QueryResultRow[]): Column<QueryResultRow>[] {
  const first = rows[0];
  if (!first) return [];
  return Object.keys(first).map((key) => ({
    header: key,
    cell: (row: QueryResultRow) => {
      const val = row[key];
      if (val == null)
        return <span className="text-muted-foreground">NULL</span>;
      return String(val);
    },
  }));
}

export function TableVisualization({ plugin, data }: VisualizationProps) {
  const sets = data ?? [];
  const [selected, setSelected] = useState(0);

  if (sets.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground">
        <TableIcon className="size-8" />
        <p className="text-sm">No data — run a query to see results</p>
      </div>
    );
  }

  const index = Math.min(selected, sets.length - 1);
  const rows = sets[index] ?? [];
  const columns = buildColumns(rows);

  return (
    <div className="flex h-full flex-col border-t border-border">
      {sets.length > 1 && (
        <div className="border-b border-border p-1">
          <ToggleGroup
            value={String(index)}
            onValueChange={(v) => v && setSelected(Number(v))}
            size="sm"
          >
            {sets.map((_, i) => (
              <ToggleGroupItem
                // biome-ignore lint/suspicious/noArrayIndexKey: query order is stable within a render
                key={i}
                value={String(i)}
              >
                Query {QUERY_LABELS[i] ?? i + 1}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-auto overscroll-none">
        {rows.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            No rows
          </div>
        ) : (
          <DataTable
            data={rows}
            columns={columns}
            rowKey={(_, i) => String(i)}
            stickyHeader={plugin.spec.stickyHeader === true}
            bordered
          />
        )}
      </div>
    </div>
  );
}
```

> Verify the import path/exports for `ToggleGroup`/`ToggleGroupItem`. If the UI package exposes them differently (e.g. a `Tabs` primitive), use that primitive instead with the same value/label wiring — a segmented selector over query indices. Grep: `grep -rn "ToggleGroup\|export.*Tabs" packages/ui/src/components/` before writing.

- [ ] **Step 4: Update the stat visualization to render one tile per series**

Rewrite the body of `stat-chart-visualization.tsx` to map over tiles:

```tsx
// packages/app/src/components/dashboards/visualizations/stat-chart/stat-chart-visualization.tsx
import { ChartContainer } from "@everr/ui/components/chart";
import { Hash } from "lucide-react";
import { useMemo } from "react";
import { Area, AreaChart } from "recharts";
import type { VisualizationProps } from "../index";
import {
  formatStatValue,
  isCalculationType,
  resolveThresholdColor,
  type ThresholdsSpec,
} from "./stat-calculations";
import { computeStatTiles } from "./stat-series";

const SPARKLINE_COLOR = "hsl(217, 91%, 60%)";

export function StatChartVisualization({ plugin, data }: VisualizationProps) {
  const spec = plugin.spec;
  const calculation = isCalculationType(spec.calculation)
    ? spec.calculation
    : "last";
  const unit = typeof spec.unit === "string" ? spec.unit : "";
  const showSparkline = spec.sparkline === true;
  const thresholds = (spec.thresholds ?? undefined) as
    | ThresholdsSpec
    | undefined;

  const tiles = useMemo(
    () => (data ? computeStatTiles(data, calculation) : []),
    [data, calculation],
  );
  const renderable = tiles.filter((t) => t.value !== undefined);

  if (!data || renderable.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground">
        <Hash className="size-8" />
        <p className="text-sm">
          {!data ? "Configure a query to see results" : "No numeric data"}
        </p>
      </div>
    );
  }

  const multi = renderable.length > 1;

  return (
    <div className="flex h-full flex-wrap items-stretch justify-center gap-4">
      {renderable.map((tile, i) => {
        const value = tile.value as number;
        const seriesMax = tile.values.length > 0 ? Math.max(...tile.values) : 0;
        const color = resolveThresholdColor(value, thresholds, seriesMax);
        return (
          <div
            // biome-ignore lint/suspicious/noArrayIndexKey: tile order is stable within a render
            key={i}
            className="flex min-w-24 flex-1 flex-col"
          >
            <div className="flex min-h-0 flex-1 flex-col items-center justify-center">
              {multi && (
                <p className="text-xs text-muted-foreground">{tile.label}</p>
              )}
              <p
                className="text-4xl font-semibold tabular-nums"
                style={color ? { color } : undefined}
              >
                {formatStatValue(value)}
                {unit && (
                  <span className="ml-1 text-2xl text-muted-foreground">
                    {unit}
                  </span>
                )}
              </p>
            </div>
            {showSparkline && tile.points.length > 1 && (
              <div className="h-1/3 max-h-24 w-full">
                <ChartContainer
                  config={{
                    value: { label: "value", color: color ?? SPARKLINE_COLOR },
                  }}
                  className="aspect-auto h-full w-full"
                >
                  <AreaChart
                    data={tile.points}
                    margin={{ top: 2, left: 0, right: 0, bottom: 0 }}
                  >
                    <Area
                      dataKey="value"
                      type="monotone"
                      stroke="var(--color-value)"
                      fill="var(--color-value)"
                      fillOpacity={0.2}
                      strokeWidth={1.5}
                      dot={false}
                      isAnimationActive={false}
                    />
                  </AreaChart>
                </ChartContainer>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 5: Update `panel-preview.tsx`**

Change the prop type only:

```tsx
interface PanelPreviewProps {
  panel: Panel;
  panelKey: string;
  data?: QueryResultRow[][];
  errorMessage?: string;
  timeRange?: ResolvedTimeRange;
  onTimeRangeChange?: (range: ResolvedTimeRange) => void;
}
```

(The `<PanelVisualization data={data} … />` call is unchanged.)

- [ ] **Step 6: Update `dashboard-panel.tsx` to use `usePanelQueries`**

Replace the query plumbing. Remove `getPanelQuerySql`, the `useDashboardVariables`/`pickByNames`/`extractVariableTokens` usage, and the inline `useQuery`. New top of the component body:

```tsx
import { Button } from "@everr/ui/components/button";
import { resolveTimeRange, withTimeRange } from "@everr/ui/lib/time-range";
import { cn } from "@everr/ui/lib/utils";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { Copy, Pencil, Trash2 } from "lucide-react";
import { useCallback } from "react";
import type { Panel } from "@/data/dashboards/schema";
import { PanelShell } from "../panel-shell";
import { usePanelQueries } from "./use-panel-queries";
import { getVisualizationInset, PanelVisualization } from "./visualizations";

// …props interface unchanged…

export function DashboardPanel({
  panel,
  panelKey,
  dashboardId,
  isEditing,
  onRemove,
  onDuplicate,
}: DashboardPanelProps) {
  const { display, plugin } = panel.spec;
  const navigate = useNavigate();
  const search = useSearch({ from: "/_authenticated/_dashboard" });
  const { from, to } = search;
  const { data, status, errorMessage } = usePanelQueries(panel, { from, to });
  const { fromDate, toDate } = resolveTimeRange(withTimeRange(search));

  const handleTimeRangeChange = useCallback(
    (range: { from: Date; to: Date }) => {
      navigate({
        to: ".",
        search: (prev: Record<string, unknown>) => ({
          ...prev,
          from: range.from.toISOString(),
          to: range.to.toISOString(),
        }),
        replace: false,
      });
    },
    [navigate],
  );
```

Then the JSX: replace the `status`/`errorMessage` computation and the `PanelShell`/`PanelVisualization` props:

```tsx
      <PanelShell
        title={display.name ?? panelKey}
        description={display.description}
        status={status}
        errorMessage={errorMessage}
        className={cn("h-full", isEditing && "pointer-events-none")}
        inset={getVisualizationInset(plugin.kind)}
      >
        <PanelVisualization
          plugin={plugin}
          data={data}
          timeRange={{ from: fromDate, to: toDate }}
          onTimeRangeChange={handleTimeRangeChange}
        />
      </PanelShell>
```

> `usePanelQueries` returns `status` as `"pending" | "error" | "success"`, which matches `PanelShell`'s existing `status` prop values used today.

- [ ] **Step 7: Update `panel-edit-page.tsx`**

Replace the single-query preview plumbing with `usePanelQueries` over the **draft**, auto-running only unmodified queries, and a per-index manual Run.

Remove: `getQuerySql`, the `savedSql`/`savedUsedNames`/`autoOpts`/`autoResult` block, the `manualResult` state, and the `queryResult`/`queryErrorMessage` derivation. Replace with:

```tsx
import { useQueryClient } from "@tanstack/react-query";
// keep existing imports; add:
import { extractVariableTokens } from "@/data/dashboards/interpolate";
import { panelQueryOptions } from "@/data/dashboards/options";
import { pickByNames } from "@/data/dashboards/variable-values";
import { getQueryTextAt, getQueryTexts } from "./query-array";
import { usePanelQueries } from "./use-panel-queries";
import { useDashboardVariables } from "./use-dashboard-variables";
```

Inside the component, after `draft` is established:

```tsx
  const { values, meta, variables } = useDashboardVariables();
  const definedNames = useMemo(
    () => new Set(variables.map((v) => v.spec.name)),
    [variables],
  );
  const savedSqls = useMemo(
    () => (panel ? getQueryTexts(panel) : []),
    [panel],
  );

  // Preview the draft. A query auto-runs only while its text matches the saved
  // text (unmodified); once edited it waits for a manual Run, which primes the
  // shared cache that useQueries reads.
  const preview = usePanelQueries(draft ?? panel ?? EMPTY_PANEL, {
    from,
    to,
    enabled: storeDashboard !== null,
    queryEnabled: (sql, i) => sql.trim() === (savedSqls[i] ?? "").trim(),
  });

  const [manualError, setManualError] = useState<string | null>(null);
  const [runningIndex, setRunningIndex] = useState<number | null>(null);

  const handleRunQuery = useCallback(
    async (index: number) => {
      if (!draft) return;
      const sql = getQueryTextAt(draft, index);
      if (!sql.trim()) return;
      const usedNames = extractVariableTokens(sql).filter((name) =>
        definedNames.has(name),
      );
      const missingName = usedNames.find(
        (name) => values[name] === undefined,
      );
      if (missingName !== undefined) {
        setManualError(`Select a value for $${missingName}`);
        return;
      }
      const variableValues =
        usedNames.length > 0 ? pickByNames(values, usedNames) : undefined;
      const variableMeta =
        usedNames.length > 0 ? pickByNames(meta, usedNames) : undefined;
      setManualError(null);
      setRunningIndex(index);
      try {
        const result = await runPanelQuery({
          data: { sql, from, to, variables: variableValues, variableMeta },
        });
        queryClient.setQueryData(
          panelQueryOptions(sql, from, to, variableValues, variableMeta)
            .queryKey,
          result,
        );
      } catch (error) {
        setManualError(error instanceof Error ? error.message : "Query failed");
      } finally {
        setRunningIndex(null);
      }
    },
    [draft, queryClient, from, to, values, meta, definedNames],
  );

  const previewError = manualError ?? preview.errorMessage;
```

Add a module-level constant near the top of the file (after imports):

```tsx
const EMPTY_PANEL: Panel = {
  kind: "Panel",
  spec: { display: {}, plugin: { kind: "TimeSeriesChart", spec: {} } },
};
```

Update the `PanelPreview` usage:

```tsx
                <PanelPreview
                  panel={draft}
                  panelKey={panelKey}
                  data={preview.data}
                  errorMessage={previewError ?? undefined}
                  timeRange={{ from: fromDate, to: toDate }}
                  onTimeRangeChange={handleTimeRangeChange}
                />
```

Update the `QueryEditor` usage (note `onRunQuery` now takes an index, and `runningIndex` replaces `isRunning`):

```tsx
                <QueryEditor
                  draft={draft}
                  onChange={setDraft}
                  onRunQuery={handleRunQuery}
                  runningIndex={runningIndex}
                />
```

Delete the now-unused `QueryResultRow` import if nothing else uses it, and remove the old `savedMissingName`/`savedWaitingForOptions`/`autoIsError` references.

- [ ] **Step 8: Write the table-selector component test**

```tsx
// packages/app/src/components/dashboards/visualizations/table/table-visualization.test.tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TableVisualization } from "./table-visualization";

const plugin = { kind: "Table", spec: {} };

describe("TableVisualization", () => {
  it("shows no selector for a single query", () => {
    render(
      <TableVisualization plugin={plugin} data={[[{ a: 1 }]]} />,
    );
    expect(screen.queryByText("Query B")).toBeNull();
    expect(screen.getByText("1")).toBeInTheDocument();
  });

  it("shows a selector with one entry per query", () => {
    render(
      <TableVisualization
        plugin={plugin}
        data={[[{ a: 1 }], [{ a: 2 }]]}
      />,
    );
    expect(screen.getByText("Query A")).toBeInTheDocument();
    expect(screen.getByText("Query B")).toBeInTheDocument();
  });
});
```

- [ ] **Step 9: Typecheck, run the new tests, lint**

Run: `pnpm typecheck`
Expected: no errors. Fix any leftover references to removed symbols (`getQuerySql`, `manualResult`, `isRunning`, old `onRunQuery` string signature).

Run: `pnpm exec vitest run src/components/dashboards/visualizations/table/table-visualization.test.tsx`
Expected: PASS (2 tests).

Run: `pnpm exec vitest run src/components/dashboards`
Expected: PASS (all dashboard tests).

Run (if pre-commit complains): `pnpm exec biome check --write src/components/dashboards`

- [ ] **Step 10: Commit**

```bash
git add packages/app/src/components/dashboards
git commit -m "feat(dashboards): run and render multiple queries per panel"
```

---

## Task 7: Update feature docs

**Files:**
- Modify: `DASHBOARD_FEATURES.md`

- [ ] **Step 1: Update the data-model limitation line**

Replace line 47:

```
- 🟡 Single query per panel (`queries[0]`), query plugin hardcoded to `ClickHouseSQL`
```

with:

```
- ✅ Multiple queries per panel (full `queries[]` array); query plugin still hardcoded to `ClickHouseSQL`
```

- [ ] **Step 2: Update the JSON-section caveat (line 64)**

In the long line 64, replace the clause:

```
`queries[]` beyond index 0 are parsed but unused;
```

with:

```
all `queries[]` entries run (time-series merges their series; table offers a per-query selector; stat shows one tile per series);
```

- [ ] **Step 3: Commit**

```bash
git add DASHBOARD_FEATURES.md
git commit -m "docs: panels now support multiple queries"
```

---

## Task 8: Browser verification

Manually verify a real multi-query panel end-to-end (see the `verifying-everr-app-in-browser` memory: reuse the dev server on :5173, Playwright via cached Chrome, `waitUntil: "load"`).

- [ ] **Step 1: Build a two-query panel**

In a dashboard, edit a panel, add a second query (e.g. two different metrics over the same time bucket), set the visualization to **Time series**. Confirm both series render with distinct colors on one axis.

- [ ] **Step 2: Switch the panel to Table**

Confirm a "Query A / Query B" selector appears and switching changes the displayed rows.

- [ ] **Step 3: Switch the panel to Stat**

Confirm two tiles render, each reduced via the calculation, each labelled.

- [ ] **Step 4: Error + persistence**

Break one query's SQL → confirm the whole panel shows the error. Fix it, Apply, Save, reload → confirm both queries persist and render.

- [ ] **Step 5: Final full test + typecheck**

Run from `packages/app`:

```bash
pnpm typecheck && pnpm exec vitest run src/components/dashboards src/data/dashboards
```

Expected: typecheck clean, all tests pass.

---

## Self-Review Notes

- **Spec coverage:** schema (no change, Task 6 removes `[0]` usage) ✓; parallel `useQueries` execution (Task 2/6) ✓; whole-panel error (Task 2 `combineQueryStates`) ✓; per-query variable resolution (Task 2) ✓; `QueryResultRow[][]` contract (Task 6) ✓; time-series merge with namespacing (Task 3) ✓; table selector (Task 6) ✓; stat one-tile-per-series (Task 4/6) ✓; stacked editor with stable ids (Task 5) ✓; docs (Task 7) ✓; browser verify (Task 8) ✓.
- **Out-of-scope confirmed untouched:** no transforms/joins, no per-query datasource, no non-ClickHouseSQL kinds, no partial-failure rendering.
- **Type consistency:** `usePanelQueries` returns `{ data, status, errorMessage }` used identically in Task 6 call sites; `onRunQuery(index: number)` defined in Task 5 and called in Task 6; `buildChartModel`/`computeStatTiles`/`combineQueryStates` signatures match their consumers.
