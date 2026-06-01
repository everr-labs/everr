# Attribute Filters for Traces + Sidebar Layout — Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Add dynamic attribute filtering (Resource + Span sources) to the trace-search page and convert its horizontal filter bar into the logs-style vertical sidebar.

**Architecture:** Traces query the `app.traces` table with `ResourceAttributes` + `SpanAttributes` (no `log`/`scope`). Attribute filters are span-level row predicates injected into the inner candidate subquery of the existing two-pass search, giving "any-span match". Discovery reuses the shared builders, which gain a `timeColumn` option because the traces table uses `Timestamp` (not the logs table's `TimestampTime`). The filter UI moves into a 260px sidebar matching the logs layout.

**Tech Stack:** TypeScript, Zod, ClickHouse SQL, `@tanstack/react-query`, vitest + jsdom.

**Spec:** `docs/superpowers/specs/2026-06-01-attribute-filters-traces-errors-design.md`
**Branch:** `gio/attribute-filters-traces-errors` (Phases 0 + 1 already on it).

**Conventions:** telemetry-explorer commands from `packages/telemetry-explorer/`; app/desktop typecheck from repo root. Pre-commit = biome + `fallow` (treats `*.test.*` as entry points). No Claude/AI/Anthropic or `Co-Authored-By` in commits. Two commits; each must leave the repo typecheck-clean with no unused exports.

---

## File Structure (Phase 2)

**Shared module:**
- `src/attribute-filter/sql/keys.ts` + `sql/values.ts` (modify) — add optional `timeColumn` (default `"TimestampTime"`).

**traces domain:**
- `src/traces/sql/attribute-columns.ts` (new) — `TRACES_ATTRIBUTE_SOURCES = ["resource","span"]`, `tracesAttributeColumn`.
- `src/traces/data/repository.ts` (modify) — thread `attributes` into `search`'s `spanPreds`; add `attributeKeys`/`attributeValues` (timeColumn `"Timestamp"`); widen `TracesRepositoryLike`.
- `src/traces/data/schemas.ts` (modify) — add `attributes` to `TraceSearchParamsSchema` + `SearchTracesInputSchema`; re-export `AttributeFilterSchema` + types; add `TraceAttributeKeysInputSchema`/`TraceAttributeValuesInputSchema`.
- `src/traces/data/options.ts` (modify) — thread `attributes` through `tracesSearchInfiniteOptions`; add `traceAttributeKeysOptions`/`traceAttributeValuesOptions`.
- `src/traces/ui/trace-attribute-config.ts` (new) — promoted/excluded/sources.
- `src/traces/ui/trace-filters.tsx` (modify) — vertical sidebar + attribute section + repo/timeRange/attributes.
- `src/traces/ui/traces-search-page.tsx` (modify) — grid + `<aside>`/`<main>`; thread attributes.

**app + desktop:**
- `src/data/traces/server.ts` + `remote-repo.ts` (modify) — discovery server fns + wiring.
- `src/routes/_authenticated/_dashboard/traces.tsx` (modify) — thread `attributes`.
- `packages/desktop-app/src/features/traces/traces-page.tsx` (modify) — thread `attributes`.

---

## Task 1: Shared `timeColumn` + traces backend — one commit

### Step 1: Shared builders gain `timeColumn` (TDD)

In `src/attribute-filter/sql/keys.test.ts`, add a test:

```ts
it("uses an injected time column when provided", () => {
  const { sql } = buildAttributeKeysQuery(
    { timeRange: { from: "now-1h", to: "now" } },
    { tableName: "traces", sources: ["resource"], columnFor, timeColumn: "Timestamp" },
  );
  expect(sql).toContain("Timestamp >= parseDateTimeBestEffort({fromTime:String})");
  expect(sql).not.toContain("TimestampTime");
});
```

In `src/attribute-filter/sql/values.test.ts`, add:

```ts
it("uses an injected time column when provided", () => {
  const { sql } = buildAttributeValuesQuery(
    { timeRange: { from: "now-1h", to: "now" }, source: "span", key: "http.route" },
    { tableName: "traces", columnFor, timeColumn: "Timestamp" },
  );
  expect(sql).toContain("Timestamp >= parseDateTimeBestEffort({fromTime:String})");
  expect(sql).not.toContain("TimestampTime");
});
```

Run both — expect FAIL (option not honored).

Edit `src/attribute-filter/sql/keys.ts`: add `timeColumn?: string` to `opts`, and use it (default `"TimestampTime"`):

```ts
export function buildAttributeKeysQuery(
  input: { timeRange: TimeRange },
  opts: {
    tableName: string;
    sources: AttributeSource[];
    columnFor: (source: AttributeSource) => string;
    timeColumn?: string;
  },
): BuiltQuery {
  validateTableName(opts.tableName);
  const timeColumn = opts.timeColumn ?? "TimestampTime";
  const { fromISO, toISO } = resolveTimeRange(input.timeRange);
  const selects = opts.sources.map(
    (source) => `
        SELECT DISTINCT arrayJoin(mapKeys(${opts.columnFor(source)})) AS key, '${source}' AS source
        FROM ${opts.tableName}
        WHERE ${timeColumn} >= parseDateTimeBestEffort({fromTime:String})
          AND ${timeColumn} <= parseDateTimeBestEffort({toTime:String})`,
  );
  // ... rest unchanged
```

Edit `src/attribute-filter/sql/values.ts` similarly: add `timeColumn?: string` to `opts`, `const timeColumn = opts.timeColumn ?? "TimestampTime";`, and use `${timeColumn}` in the two WHERE lines.

Run the shared sql tests — expect PASS. The existing logs/errors callers omit `timeColumn`, so they keep `TimestampTime` (their tests must still pass).

### Step 2: Traces column mapping + search threading (TDD)

Create `src/traces/sql/attribute-columns.ts`:

```ts
import type { AttributeSource } from "../../attribute-filter/schemas";

const COLUMNS: Record<string, string> = {
  resource: "ResourceAttributes",
  span: "SpanAttributes",
};

export const TRACES_ATTRIBUTE_SOURCES: AttributeSource[] = ["resource", "span"];

export function tracesAttributeColumn(source: AttributeSource): string {
  const column = COLUMNS[source];
  if (!column) throw new Error(`Unknown traces attribute source: ${source}`);
  return column;
}
```

Create `src/traces/data/repository.test.ts` (or append) — a test that attribute filters land in the candidate subquery's span predicates:

```ts
import { describe, expect, it, vi } from "vitest";
import { TracesRepository } from "./repository";

function captureSql() {
  const calls: { sql: string; params: Record<string, unknown> }[] = [];
  const client = {
    execute: vi.fn(async (sql: string, params: Record<string, unknown>) => {
      calls.push({ sql, params });
      return [];
    }),
  };
  return { client, calls };
}

const base = {
  fromTs: "2026-06-01 00:00:00",
  toTs: "2026-06-01 01:00:00",
  namespace: [] as string[],
  service: [] as string[],
  name: "",
  status: "all" as const,
  limit: 50,
};

describe("trace search attribute filtering", () => {
  it("adds span-level attribute predicates to the candidate subquery", async () => {
    const { client, calls } = captureSql();
    const repo = new TracesRepository(client as never, { tableName: "traces" });
    await repo.search({
      ...base,
      attributes: [{ source: "span", key: "http.route", op: "in", values: ["/x"] }],
    });
    const { sql, params } = calls[0];
    expect(sql).toContain("SELECT DISTINCT TraceId");
    expect(sql).toContain("mapContains(SpanAttributes, {attrKey0:String})");
    expect(params.attrKey0).toBe("http.route");
    expect(params.attrVals0).toEqual(["/x"]);
  });

  it("adds no attribute predicates when none are given", async () => {
    const { client, calls } = captureSql();
    const repo = new TracesRepository(client as never, { tableName: "traces" });
    await repo.search({ ...base });
    expect(calls[0].params.attrKey0).toBeUndefined();
  });
});
```

Run — expect FAIL (`attributes` not on `SearchTracesInput` / not threaded).

Edit `src/traces/data/repository.ts`:
- Import: `import { buildAttributeClauses } from "../../attribute-filter/sql/where";` and `import { TRACES_ATTRIBUTE_SOURCES, tracesAttributeColumn } from "../sql/attribute-columns";` plus the shared key/value builders + decoders + types (mirror the errors repository).
- In `search`, after the existing `spanPreds` pushes (name/service/namespace) and before assembling `candidateFilter`, append attribute predicates:

```ts
    const attr = buildAttributeClauses(input.attributes ?? [], tracesAttributeColumn);
    spanPreds.push(...attr.clauses);
    Object.assign(params, attr.params);
```

This routes attribute filters into the `candidateFilter` subquery (it is built whenever `spanPreds.length > 0`), so a trace matches if it has a span satisfying the filters — the intended any-span semantics.

- Add the discovery methods to the class:

```ts
  async attributeKeys(input: AttributeKeysInput): Promise<AttributeKey[]> {
    validateTableName(this.tableName);
    const { sql, params } = buildAttributeKeysQuery(input, {
      tableName: this.tableName,
      sources: TRACES_ATTRIBUTE_SOURCES,
      columnFor: tracesAttributeColumn,
      timeColumn: "Timestamp",
    });
    const rows = await this.client.execute<AttributeKeyRowRaw>(sql, params);
    return decodeAttributeKeyRows(rows);
  }

  async attributeValues(input: AttributeValuesInput): Promise<string[]> {
    validateTableName(this.tableName);
    const { sql, params } = buildAttributeValuesQuery(input, {
      tableName: this.tableName,
      columnFor: tracesAttributeColumn,
      timeColumn: "Timestamp",
    });
    const rows = await this.client.execute<AttributeValueRowRaw>(sql, params);
    return decodeAttributeValueRows(rows);
  }
```

- Widen the interface:

```ts
export type TracesRepositoryLike = Pick<
  TracesRepository,
  "search" | "getTrace" | "listServiceIdentities" | "attributeKeys" | "attributeValues"
>;
```

### Step 3: Traces schemas

Edit `src/traces/data/schemas.ts`:
- Imports: `import { AttributeFilterSchema, AttributeSourceSchema } from "../../attribute-filter/schemas";` and `import { TimeRangeSchema } from "@everr/ui/lib/time-range";`.
- Re-export:

```ts
export { AttributeFilterSchema } from "../../attribute-filter/schemas";
export type {
  AttributeFilter,
  AttributeKey,
  AttributeOp,
  AttributeSource,
} from "../../attribute-filter/schemas";
```

- Add `attributes: z.array(AttributeFilterSchema).default([])` to `TraceSearchParamsSchema` and `SearchTracesInputSchema`. (`TraceDetailParamsSchema` extends `TraceSearchParamsSchema`, so it inherits it; `toTraceListSearch` keeps `attributes`.)
- Add discovery schemas:

```ts
export const TraceAttributeKeysInputSchema = z.object({
  timeRange: TimeRangeSchema,
});
export type TraceAttributeKeysInput = z.infer<typeof TraceAttributeKeysInputSchema>;

export const TraceAttributeValuesInputSchema = z.object({
  timeRange: TimeRangeSchema,
  source: AttributeSourceSchema,
  key: z.string().min(1),
});
export type TraceAttributeValuesInput = z.infer<typeof TraceAttributeValuesInputSchema>;
```

### Step 4: Traces options

Edit `src/traces/data/options.ts`:
- Imports: shared `attributeKeysOptions`/`attributeValuesOptions`, `AttributeSource`, `AttributeFilter` from `../../attribute-filter/...`.
- `TraceSearchOptionsInput`: add `attributes: AttributeFilter[]`.
- `tracesSearchInfiniteOptions`: `attributes` is already captured in `key` via `const { repo, refresh, ...key } = input` (it's part of input) — confirm it stays in the queryKey. Pass `attributes: input.attributes` into the `repo.search({...})` call.
- Add:

```ts
export function traceAttributeKeysOptions(
  repo: TracesRepositoryLike,
  input: { timeRange: TimeRange },
) {
  return attributeKeysOptions(repo, input, { domain: "traces" });
}

export function traceAttributeValuesOptions(
  repo: TracesRepositoryLike,
  input: { timeRange: TimeRange; source: AttributeSource; key: string },
) {
  return attributeValuesOptions(repo, input, { domain: "traces" });
}
```

Add a co-located test in `src/traces/data/options.test.ts` (create if absent) asserting the two factories' query keys (`["traces","attributeKeys",timeRange]` / `["traces","attributeValues",timeRange,source,key]`) so `fallow` sees them used before the UI consumes them.

### Step 5: App server fns + remote-repo

`packages/app/src/data/traces/server.ts` — import `TraceAttributeKeysInputSchema`/`TraceAttributeValuesInputSchema` and add:

```ts
export const getTraceAttributeKeys = createAuthenticatedServerFn({ method: "GET" })
  .inputValidator(TraceAttributeKeysInputSchema)
  .handler(({ data, context: { clickhouse } }) =>
    repoFromContext(clickhouse).attributeKeys(data),
  );

export const getTraceAttributeValues = createAuthenticatedServerFn({ method: "GET" })
  .inputValidator(TraceAttributeValuesInputSchema)
  .handler(({ data, context: { clickhouse } }) =>
    repoFromContext(clickhouse).attributeValues(data),
  );
```

`packages/app/src/data/traces/remote-repo.ts` — import the types (`AttributeKey`, `TraceAttributeKeysInput`, `TraceAttributeValuesInput` from `@everr/telemetry-explorer/traces`) and the two server fns, then add to `remoteTracesRepo`:

```ts
  attributeKeys: (input: TraceAttributeKeysInput): Promise<AttributeKey[]> =>
    getTraceAttributeKeys({ data: input }),
  attributeValues: (input: TraceAttributeValuesInput): Promise<string[]> =>
    getTraceAttributeValues({ data: input }),
```

(Confirm `@everr/telemetry-explorer/traces` re-exports these via the traces `index.ts` `export * from "./data/schemas"`; if the barrel doesn't use `export *`, add explicit exports.)

### Step 6: Verify + commit

- `pnpm vitest run` (telemetry-explorer) — green (incl. the new shared `timeColumn` tests and trace search tests; the logs/errors tests must still pass unchanged).
- `pnpm typecheck` — clean.
- `pnpm --filter @everr/app typecheck` (repo root) — clean.
- `git add -A && git commit -m "Add attribute filtering to the traces backend"`

---

## Task 2: Traces sidebar layout + attribute section + routes — one commit

### Step 1: Traces attribute config

Create `src/traces/ui/trace-attribute-config.ts`:

```ts
import type { AttributeSource } from "../../attribute-filter/schemas";
import type { PromotedAttribute } from "../../attribute-filter/ui/attribute-meta";

export const TRACES_ATTRIBUTE_SOURCES_UI: AttributeSource[] = ["resource", "span"];

export const TRACES_PROMOTED_ATTRIBUTES: PromotedAttribute[] = [
  { source: "span", key: "http.route" },
  { source: "span", key: "db.system" },
  { source: "resource", key: "deployment.environment" },
];

// service.name backs the Service filter; service.namespace backs the Namespace filter.
export const TRACES_EXCLUDED_KEYS: ReadonlySet<string> = new Set([
  "resource:service.name",
  "resource:service.namespace",
]);
```

### Step 2: `trace-filters.tsx` → vertical sidebar with attribute section

Read the file. Rework the top-level layout and props. Keep the `NameInput`, `DurationInput`, `dedupe`, `staticListOptions` helpers as-is.

- `FilterValue` gains `attributes: AttributeFilter[]` (import `AttributeFilter` from `../data/schemas`).
- `TraceFiltersProps` gains `repo: TracesRepositoryLike` and `timeRange: TimeRange`.
- Replace the outer `<div className="flex flex-wrap items-end gap-2">` with a sidebar `<aside>` mirroring the logs `LogFiltersBar` shell, ordered: header → Status (top) → Namespace + Service → Name + Min/Max → Attributes. Concretely:

```tsx
import { Separator } from "@everr/ui/components/separator";
import type { TimeRange } from "@everr/ui/lib/time-range";
import { ListFilter } from "lucide-react";
import { AttributeFilterSection } from "../../attribute-filter/ui/attribute-filter-section";
import type { TracesRepositoryLike } from "../data/repository";
import type { AttributeFilter } from "../data/schemas";
import {
  TRACES_ATTRIBUTE_SOURCES_UI,
  TRACES_EXCLUDED_KEYS,
  TRACES_PROMOTED_ATTRIBUTES,
} from "./trace-attribute-config";
```

```tsx
  return (
    <aside
      aria-label="Trace filters"
      className="bg-muted/15 flex h-full min-h-0 flex-col gap-3 overflow-auto border-b p-3 lg:border-r lg:border-b-0"
    >
      <div className="flex items-center gap-2 text-xs font-medium">
        <ListFilter className="text-muted-foreground size-3.5" />
        Filter
      </div>

      <div className="flex flex-col gap-1">
        <Label className="text-muted-foreground text-xs">Status</Label>
        <ToggleGroup
          value={[value.status]}
          variant="outline"
          size="lg"
          spacing={0}
          className="w-full"
          onValueChange={(next) => {
            const selected = next[0];
            if (selected === "ok" || selected === "error" || selected === "all") {
              onChange({ status: selected });
            }
          }}
          aria-label="Status"
        >
          <ToggleGroupItem value="all" className="flex-1">All</ToggleGroupItem>
          <ToggleGroupItem value="ok" className="flex-1">Ok</ToggleGroupItem>
          <ToggleGroupItem value="error" className="flex-1">Error</ToggleGroupItem>
        </ToggleGroup>
      </div>

      <Separator />

      <FilterCombobox
        label="Namespace"
        values={value.namespace}
        onChange={(next) => onChange({ namespace: next })}
        options={namespaceOptions}
        placeholder="All"
        searchPlaceholder="Search namespaces..."
        className="w-full"
      />
      <FilterCombobox
        label="Service"
        values={value.service}
        onChange={(next) => onChange({ service: next })}
        options={serviceOptions}
        placeholder="All"
        searchPlaceholder="Search services..."
        className="w-full"
      />

      <Separator />

      <NameInput value={value.name} onCommit={(name) => onChange({ name })} />
      <div className="flex gap-2">
        <DurationInput label="Min ms" value={value.minMs} onCommit={(minMs) => onChange({ minMs })} />
        <DurationInput label="Max ms" value={value.maxMs} onCommit={(maxMs) => onChange({ maxMs })} />
      </div>

      <Separator />

      <AttributeFilterSection
        repo={repo}
        domain="traces"
        timeRange={timeRange}
        attributes={value.attributes}
        promotedAttributes={TRACES_PROMOTED_ATTRIBUTES}
        excludedKeys={TRACES_EXCLUDED_KEYS}
        sources={TRACES_ATTRIBUTE_SOURCES_UI}
        onChange={(attributes) => onChange({ attributes })}
      />

      {hasFilters && (
        <button
          type="button"
          className="text-muted-foreground hover:text-foreground self-start text-xs underline"
          onClick={() =>
            onChange({
              namespace: [],
              service: [],
              name: "",
              minMs: undefined,
              maxMs: undefined,
              status: "all",
              attributes: [],
            })
          }
        >
          Clear filters
        </button>
      )}
    </aside>
  );
```

Update `hasFilters` to also consider `value.attributes.length > 0`. The `NameInput` width `w-56` should become `w-full` for the sidebar; change its wrapper `<div className="relative w-56">` to `<div className="relative w-full">`. `DurationInput` keeps `w-24` (two side by side). Keep the `Label` import.

### Step 3: `traces-search-page.tsx` → grid + aside/main; thread attributes

Read the file. Changes:
- `TraceSearchValue` gains `attributes: AttributeFilter[]` (import from `../data/schemas`).
- Pass `attributes: search.attributes` into `tracesSearchInfiniteOptions({...})`.
- Pass `repo`, `timeRange`, and `attributes` to `<TraceFilters>` (its `value` gains `attributes`, plus the new `repo`/`timeRange` props).
- Replace the outer `<div className="flex h-full min-h-0 flex-col gap-3 p-4">` wrapping filters+results with the logs-style grid:

```tsx
  return (
    <div className="grid min-h-0 flex-1 grid-cols-1 grid-rows-[auto_minmax(0,1fr)] lg:grid-cols-[260px_minmax(0,1fr)] lg:grid-rows-[minmax(0,1fr)]">
      <TraceFilters
        repo={repo}
        timeRange={timeRange}
        value={{
          namespace: search.namespace,
          service: search.service,
          name: search.name,
          minMs: search.minMs,
          maxMs: search.maxMs,
          status: search.status,
          attributes: search.attributes,
        }}
        identities={identitiesQuery.data ?? []}
        onChange={onSearchChange}
      />
      <main className="flex min-h-0 min-w-0 flex-col p-4">
        <TraceResultsList
          rows={rows}
          isPending={isPending}
          isError={isError}
          error={error}
          refetch={refetch}
          hasMore={hasNextPage}
          isLoadingMore={isFetchingNextPage}
          renderTraceLink={renderTraceLink}
          onLoadMore={() => fetchNextPage()}
          onClearFilters={() =>
            onSearchChange({
              namespace: [],
              service: [],
              name: "",
              minMs: undefined,
              maxMs: undefined,
              status: "all",
              attributes: [],
              limit: 50,
            })
          }
        />
      </main>
    </div>
  );
```

(Confirm the surrounding component still provides a flex/min-h-0 parent; the existing page took `h-full`. If the outer container needs `h-full min-h-0 flex flex-col`, preserve that on a wrapping element. Verify visually via the run step.)

### Step 4: Routes thread `attributes`

`packages/app/src/routes/_authenticated/_dashboard/traces.tsx`: read it; wherever it builds the `search` value passed to `<TracesSearch>` (from the validated search params), add `attributes: search.attributes`. The `validateSearch` already uses `TraceSearchParamsSchema` (now with `attributes`).

`packages/desktop-app/src/features/traces/traces-page.tsx`: read it; same — include `attributes` in the `search` value passed to `<TracesSearch>` (and in any `toTraceListSearch`/detail wiring as needed; `TraceDetailParamsSchema` inherits `attributes`).

### Step 5: Render test

Add `src/traces/ui/trace-filters.test.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { TracesRepositoryLike } from "../data/repository";
import { TraceFilters } from "./trace-filters";

describe("TraceFilters sidebar", () => {
  it("renders status, service, and the attribute section", () => {
    const repo = {
      attributeKeys: vi.fn().mockResolvedValue([]),
      attributeValues: vi.fn().mockResolvedValue([]),
    } as unknown as TracesRepositoryLike;
    render(
      <QueryClientProvider client={new QueryClient()}>
        <TraceFilters
          repo={repo}
          timeRange={{ from: "now-1h", to: "now" }}
          value={{ namespace: [], service: [], name: "", minMs: undefined, maxMs: undefined, status: "all", attributes: [] }}
          identities={[]}
          onChange={vi.fn()}
        />
      </QueryClientProvider>,
    );
    expect(screen.getByText("Status")).toBeInTheDocument();
    expect(screen.getByText("Service")).toBeInTheDocument();
    expect(screen.getByText("Attributes")).toBeInTheDocument();
  });
});
```

### Step 6: Verify + commit

- `pnpm vitest run` (telemetry-explorer) — green.
- `pnpm typecheck` — clean.
- `pnpm --filter @everr/app typecheck` (repo root) — clean.
- `cd packages/desktop-app && pnpm exec tsc --noEmit` — clean.
- `git add -A && git commit -m "Match the trace search filter layout to logs and add attribute filters"`

---

## Spec coverage (traces portion)
- Resource + Span sources, any-span match in the inner candidate subquery → Task 1 Step 2. ✓
- Discovery via shared builders with `timeColumn: "Timestamp"` → Task 1 Steps 1–2. ✓
- `attributes` on `TraceSearchParamsSchema` + `SearchTracesInputSchema` → Task 1 Step 3. ✓
- Repository/options/server/remote-repo wiring → Task 1 Steps 2,4,5. ✓
- Vertical sidebar matching logs (status on top → namespace/service → name/duration → attributes) → Task 2 Steps 2–3. ✓
- Both routes thread `attributes` → Task 2 Step 4. ✓
- Cross-package verification → Task 2 Step 6. ✓

## Out of scope
Trace detail page filtering; reordering result columns; changing the duration/status query semantics.
