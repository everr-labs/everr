# Attribute Filters for Errors — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Add dynamic OTel attribute filtering to the errors (exception issues) page, reusing the shared `attribute-filter` module built in Phase 0.

**Architecture:** Errors query the same logs table, so they use the `resource|log|scope` sources. Attribute filters thread into the exception-logs WHERE (used by both the issue-summary query and the service-facet query) via the shared `buildAttributeClauses`. Discovery (`attributeKeys`/`attributeValues`) is `timeRange`-based like logs. The errors filter sidebar already exists; we add the shared `AttributeFilterSection` to it.

**Tech Stack:** TypeScript, Zod, ClickHouse SQL, `@tanstack/react-query`, vitest + jsdom.

**Spec:** `docs/superpowers/specs/2026-06-01-attribute-filters-traces-errors-design.md`
**Branch:** `gio/attribute-filters-traces-errors` (Phase 0 already merged into it).

**Conventions:** All telemetry-explorer commands run from `packages/telemetry-explorer/`. App/desktop typecheck from repo root. Pre-commit runs biome + `fallow` (dead-code; treats `*.test.*` as entry points). No Claude/AI/Anthropic mentions or `Co-Authored-By` in commits. Two commits total; each must leave the repo with no unused exports and passing typecheck.

---

## File Structure (Phase 1)

**telemetry-explorer (errors domain):**
- `src/errors/sql/attribute-columns.ts` (new) — `ERRORS_ATTRIBUTE_SOURCES`, `errorsAttributeColumn`.
- `src/errors/sql/issues.ts` (modify) — thread `attributes` into the exception-logs CTE + services query.
- `src/errors/data/schemas.ts` (modify) — add `attributes` to the three search/input schemas; re-export `AttributeFilterSchema`; add `ErrorAttributeKeysInputSchema`/`ErrorAttributeValuesInputSchema`.
- `src/errors/data/repository.ts` (modify) — `attributeKeys`/`attributeValues`; widen `ErrorsRepositoryLike`; thread `attributes` into `searchIssues`/`listServices`.
- `src/errors/data/options.ts` (modify) — `errorAttributeKeysOptions`/`errorAttributeValuesOptions`; thread `attributes` into `errorIssuesInfiniteOptions` + `errorServicesOptions`.
- `src/errors/ui/error-attribute-config.ts` (new) — promoted/excluded/sources for errors.
- `src/errors/ui/error-filters.tsx` (modify) — render the shared `AttributeFilterSection`.
- `src/errors/ui/error-issues.tsx` (modify) — thread `attributes` + pass `repo`/`timeRange` to `ErrorFilters`.

**app:**
- `src/data/errors/server.ts` (modify) — `getErrorAttributeKeys`/`getErrorAttributeValues`.
- `src/data/errors/remote-repo.ts` (modify) — wire the two methods.
- `src/routes/_authenticated/_dashboard/errors.tsx` (modify) — thread `attributes`.

**desktop:**
- `src/features/errors/errors-page.tsx` (modify) — thread `attributes`.

---

## Task 1: Errors backend (SQL + schemas + repository + options + server) — one commit

**Files:** see "telemetry-explorer (errors domain)" minus the two UI files, plus app `server.ts` + `remote-repo.ts`.

### Step 1: Errors column mapping + SQL threading tests (write failing)

Create `src/errors/sql/attribute-columns.ts`:

```ts
import type { AttributeSource } from "../../attribute-filter/schemas";

const COLUMNS: Record<string, string> = {
  resource: "ResourceAttributes",
  log: "LogAttributes",
  scope: "ScopeAttributes",
};

export const ERRORS_ATTRIBUTE_SOURCES: AttributeSource[] = [
  "resource",
  "log",
  "scope",
];

export function errorsAttributeColumn(source: AttributeSource): string {
  const column = COLUMNS[source];
  if (!column) throw new Error(`Unknown errors attribute source: ${source}`);
  return column;
}
```

Add to `src/errors/sql/issues.test.ts` (create if it doesn't exist; otherwise append) tests that the summary and services queries embed attribute clauses:

```ts
import { describe, expect, it } from "vitest";
import { buildServicesQuery, buildSummaryQuery } from "./issues";

const base = {
  fromTs: "2026-06-01 00:00:00",
  toTs: "2026-06-01 01:00:00",
  q: "",
  service: [] as string[],
  fingerprint: "",
  sort: "lastSeen" as const,
  limit: 50,
  offset: 0,
};

describe("error attribute filtering", () => {
  it("threads attribute clauses into the summary CTE with bound params", () => {
    const { sql, params } = buildSummaryQuery(
      {
        ...base,
        attributes: [
          { source: "resource", key: "deployment.environment", op: "in", values: ["prod"] },
        ],
      },
      "logs",
    );
    expect(sql).toContain("mapContains(ResourceAttributes, {attrKey0:String})");
    expect(params.attrKey0).toBe("deployment.environment");
    expect(params.attrVals0).toEqual(["prod"]);
  });

  it("threads attribute clauses into the services query", () => {
    const { sql } = buildServicesQuery(
      {
        ...base,
        attributes: [{ source: "log", key: "http.method", op: "exists", values: [] }],
      },
      "logs",
    );
    expect(sql).toContain("mapContains(LogAttributes, {attrKey0:String})");
  });

  it("omits attribute clauses when none are given", () => {
    const { params } = buildSummaryQuery({ ...base }, "logs");
    expect(params.attrKey0).toBeUndefined();
  });
});
```

Run `pnpm vitest run src/errors/sql/issues.test.ts` — expect FAIL (attributes not threaded; `buildServicesQuery` doesn't accept `attributes`).

### Step 2: Thread `attributes` through `src/errors/sql/issues.ts`

Read the current file first. Make these changes:

1. Import the shared builder + columns at the top:

```ts
import { buildAttributeClauses } from "../../attribute-filter/sql/where";
import type { AttributeFilter } from "../../attribute-filter/schemas";
import { errorsAttributeColumn } from "./attribute-columns";
```

2. `buildExceptionLogsCte` — widen its input to include `attributes` and append the clauses. Change its signature param type to `Pick<SearchErrorIssuesInput, "fromTs" | "toTs" | "q" | "service" | "attributes">` and inside, after building `filters` and `params`:

```ts
  const attr = buildAttributeClauses(input.attributes ?? [], errorsAttributeColumn);
  filters.push(...attr.clauses);
  Object.assign(params, attr.params);
```

(Place this after the existing `q`/`service` filter pushes, before the `return`.)

3. `buildSummaryQuery` already forwards `input` to `buildExceptionLogsCte` — since `input` is `SearchErrorIssuesInput` (which will gain `attributes` in Step 3), no extra change beyond ensuring `attributes` flows. Confirm `buildExceptionLogsCte(input, tableName)` passes `input.attributes` through (it will, since `input` includes it).

4. `buildOccurrencesQuery` calls `buildExceptionLogsCte({ ...input, q: "" }, tableName)`. The occurrences view is unfiltered by attributes (the user has drilled into an issue). Pass `attributes: []` explicitly: `buildExceptionLogsCte({ ...input, q: "", attributes: [] }, tableName)`.

5. `buildServicesQuery` — widen its input to `Pick<SearchErrorIssuesInput, "fromTs" | "toTs" | "attributes">` and append attribute clauses to its WHERE. Current it builds a fixed WHERE with `timePredicateSql()` + `EXCEPTION_LOG_FILTER_SQL`. Refactor to assemble a filters array and merge attribute params:

```ts
export function buildServicesQuery(
  input: Pick<SearchErrorIssuesInput, "fromTs" | "toTs" | "attributes">,
  tableName: string,
): BuiltQuery {
  validateTableName(tableName);
  const params: Record<string, unknown> = {
    fromTs: input.fromTs,
    toTs: input.toTs,
  };
  const filters = [timePredicateSql(), EXCEPTION_LOG_FILTER_SQL];
  const attr = buildAttributeClauses(input.attributes ?? [], errorsAttributeColumn);
  filters.push(...attr.clauses);
  Object.assign(params, attr.params);
  return {
    params,
    sql: `
    SELECT DISTINCT ServiceName AS serviceName
    FROM ${tableName}
    WHERE ${filters.join("\n      AND ")}
    ORDER BY serviceName
  `,
  };
}
```

Run `pnpm vitest run src/errors/sql/issues.test.ts` — expect PASS.

### Step 3: Errors schemas (`src/errors/data/schemas.ts`)

Read the file. Add the import + re-export at top:

```ts
import { TimeRangeSchema } from "@everr/ui/lib/time-range";
import {
  AttributeFilterSchema,
  AttributeSourceSchema,
} from "../../attribute-filter/schemas";

export { AttributeFilterSchema } from "../../attribute-filter/schemas";
export type {
  AttributeFilter,
  AttributeKey,
  AttributeOp,
  AttributeSource,
} from "../../attribute-filter/schemas";
```

(Including `AttributeKey` so `remote-repo.ts` can import it from `@everr/telemetry-explorer/errors`.)

(Confirm the exact import path depth: from `src/errors/data/schemas.ts` the shared module is `../../attribute-filter/schemas`. Also confirm `@everr/ui/lib/time-range` exports `TimeRangeSchema` — it is used by the logs schemas the same way.)

Add `attributes: z.array(AttributeFilterSchema).default([])` to:
- `ErrorIssueSearchSchema` (the validateSearch schema)
- `SearchErrorIssuesInputSchema`
- `ListErrorServicesInputSchema`

Add the discovery input schemas at the end:

```ts
export const ErrorAttributeKeysInputSchema = z.object({
  timeRange: TimeRangeSchema,
});
export type ErrorAttributeKeysInput = z.infer<typeof ErrorAttributeKeysInputSchema>;

export const ErrorAttributeValuesInputSchema = z.object({
  timeRange: TimeRangeSchema,
  source: AttributeSourceSchema,
  key: z.string().min(1),
});
export type ErrorAttributeValuesInput = z.infer<typeof ErrorAttributeValuesInputSchema>;
```

### Step 4: Errors repository (`src/errors/data/repository.ts`)

Read the file. Add imports:

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
import type {
  AttributeKey,
  AttributeKeysInput,
  AttributeValuesInput,
} from "../../attribute-filter/schemas";
import {
  ERRORS_ATTRIBUTE_SOURCES,
  errorsAttributeColumn,
} from "../sql/attribute-columns";
```

Add the two methods to the `ErrorsRepository` class (alongside the existing ones; the existing methods carry `// fallow-ignore-next-line unused-class-member` — these new ones are reached via the widened `ErrorsRepositoryLike` + remote-repo, so they do NOT need that comment, but if `fallow` flags them, add it consistently with the file's pattern):

```ts
  async attributeKeys(input: AttributeKeysInput): Promise<AttributeKey[]> {
    const { sql, params } = buildAttributeKeysQuery(input, {
      tableName: this.tableName,
      sources: ERRORS_ATTRIBUTE_SOURCES,
      columnFor: errorsAttributeColumn,
    });
    const rows = await this.client.execute<AttributeKeyRowRaw>(sql, params);
    return decodeAttributeKeyRows(rows);
  }

  async attributeValues(input: AttributeValuesInput): Promise<string[]> {
    const { sql, params } = buildAttributeValuesQuery(input, {
      tableName: this.tableName,
      columnFor: errorsAttributeColumn,
    });
    const rows = await this.client.execute<AttributeValueRowRaw>(sql, params);
    return decodeAttributeValueRows(rows);
  }
```

Widen the interface:

```ts
export type ErrorsRepositoryLike = Pick<
  ErrorsRepository,
  "searchIssues" | "getIssue" | "listServices" | "attributeKeys" | "attributeValues"
>;
```

`searchIssues`/`listServices` already forward their full input to the SQL builders; since `SearchErrorIssuesInput`/`ListErrorServicesInput` now include `attributes`, the attribute filters flow through automatically. Confirm `listServices` passes `attributes` to `buildServicesQuery` — currently it calls `buildServicesQuery({ fromTs: input.fromTs, toTs: input.toTs }, this.tableName)`. Change it to pass attributes:

```ts
    const { sql, params } = buildServicesQuery(
      { fromTs: input.fromTs, toTs: input.toTs, attributes: input.attributes },
      this.tableName,
    );
```

### Step 5: Errors options (`src/errors/data/options.ts`) + tests

Read the file. Add imports:

```ts
import {
  attributeKeysOptions,
  attributeValuesOptions,
} from "../../attribute-filter/options";
import type { AttributeSource } from "../../attribute-filter/schemas";
import type { AttributeFilter } from "../../attribute-filter/schemas";
```

Thread `attributes` through the existing options:
- `ErrorIssuesInfiniteInput` type: add `attributes: AttributeFilter[]`.
- `errorIssuesInfiniteOptions`: add `attributes: input.attributes` to the `queryKey` object and to the `repo.searchIssues({...})` call.
- `errorServicesOptions`: change its input to `{ timeRange: TimeRange; refresh: string; attributes: AttributeFilter[] }`, add `attributes` to the `queryKey`, and pass `attributes: input.attributes` into `repo.listServices({...})`.

Add the discovery option factories:

```ts
export function errorAttributeKeysOptions(
  repo: ErrorsRepositoryLike,
  input: { timeRange: TimeRange },
) {
  return attributeKeysOptions(repo, input, { domain: "errors" });
}

export function errorAttributeValuesOptions(
  repo: ErrorsRepositoryLike,
  input: { timeRange: TimeRange; source: AttributeSource; key: string },
) {
  return attributeValuesOptions(repo, input, { domain: "errors" });
}
```

(`ErrorsRepositoryLike` now structurally satisfies `AttributeRepositoryLike`.)

Add tests to `src/errors/data/options.test.ts` (create if absent) so these factories have a consumer for `fallow`:

```ts
import { describe, expect, it } from "vitest";
import {
  errorAttributeKeysOptions,
  errorAttributeValuesOptions,
} from "./options";
import type { ErrorsRepositoryLike } from "./repository";

const repo = {} as ErrorsRepositoryLike;
const timeRange = { from: "now-1h", to: "now" };

describe("error attribute options", () => {
  it("namespaces keys query under the errors domain", () => {
    expect(errorAttributeKeysOptions(repo, { timeRange }).queryKey).toEqual([
      "errors",
      "attributeKeys",
      timeRange,
    ]);
  });
  it("namespaces values query by source and key", () => {
    expect(
      errorAttributeValuesOptions(repo, { timeRange, source: "log", key: "http.method" }).queryKey,
    ).toEqual(["errors", "attributeValues", timeRange, "log", "http.method"]);
  });
});
```

### Step 6: App server fns + remote-repo

`packages/app/src/data/errors/server.ts` — add imports `ErrorAttributeKeysInputSchema`, `ErrorAttributeValuesInputSchema` from `@everr/telemetry-explorer/errors`, and add:

```ts
export const getErrorAttributeKeys = createAuthenticatedServerFn({ method: "GET" })
  .inputValidator(ErrorAttributeKeysInputSchema)
  .handler(({ data, context: { clickhouse } }) =>
    repoFromContext(clickhouse).attributeKeys(data),
  );

export const getErrorAttributeValues = createAuthenticatedServerFn({ method: "GET" })
  .inputValidator(ErrorAttributeValuesInputSchema)
  .handler(({ data, context: { clickhouse } }) =>
    repoFromContext(clickhouse).attributeValues(data),
  );
```

`packages/app/src/data/errors/remote-repo.ts` — add imports for `AttributeKey`, `ErrorAttributeKeysInput`, `ErrorAttributeValuesInput` types from `@everr/telemetry-explorer/errors` and `getErrorAttributeKeys`/`getErrorAttributeValues` from `./server`, then add to `remoteErrorsRepo`:

```ts
  attributeKeys: (input: ErrorAttributeKeysInput): Promise<AttributeKey[]> =>
    getErrorAttributeKeys({ data: input }),
  attributeValues: (input: ErrorAttributeValuesInput): Promise<string[]> =>
    getErrorAttributeValues({ data: input }),
```

(`AttributeKey` is exported from `@everr/telemetry-explorer/errors` via the schemas re-export added in Step 3; if not, export it there.)

### Step 7: Verify + commit

- `pnpm vitest run` (telemetry-explorer) — green.
- `pnpm typecheck` (telemetry-explorer) — clean.
- From repo root: `pnpm --filter @everr/app typecheck` — clean.
- `git add -A && git commit -m "Add attribute filtering to the errors backend"`

If `fallow` flags `errorAttribute*Options` despite the tests, confirm the test file imports them; if it flags the repository methods, add `// fallow-ignore-next-line unused-class-member` consistent with the file. Report any block.

---

## Task 2: Errors UI + routes — one commit

**Files:** `error-attribute-config.ts` (new), `error-filters.tsx`, `error-issues.tsx`, app `errors.tsx`, desktop `errors-page.tsx`.

### Step 1: Errors attribute config

Create `src/errors/ui/error-attribute-config.ts`:

```ts
import type { AttributeSource } from "../../attribute-filter/schemas";
import type { PromotedAttribute } from "../../attribute-filter/ui/attribute-meta";

export const ERRORS_ATTRIBUTE_SOURCES_UI: AttributeSource[] = [
  "resource",
  "log",
  "scope",
];

export const ERRORS_PROMOTED_ATTRIBUTES: PromotedAttribute[] = [
  { source: "resource", key: "vcs.repository.name" },
  { source: "resource", key: "deployment.environment" },
  { source: "resource", key: "host.name" },
];

// service.name backs the dedicated Service filter.
export const ERRORS_EXCLUDED_KEYS: ReadonlySet<string> = new Set([
  "resource:service.name",
]);
```

### Step 2: `error-filters.tsx` — render the shared section

Read the file. `ErrorFiltersValue` gains `attributes: AttributeFilter[]` (import `AttributeFilter` from `../data/schemas`). `ErrorFilters` gains `repo: ErrorsRepositoryLike` and `timeRange: TimeRange` props. Inside the `<aside>`, after the Service `FilterCombobox` (and before or after the Order toggle — place after Service, before Order to mirror logs' filter→attributes flow), add a `<Separator />` and the shared section:

```tsx
import { Separator } from "@everr/ui/components/separator";
import type { TimeRange } from "@everr/ui/lib/time-range";
import { AttributeFilterSection } from "../../attribute-filter/ui/attribute-filter-section";
import type { ErrorsRepositoryLike } from "../data/repository";
import type { AttributeFilter } from "../data/schemas";
import {
  ERRORS_ATTRIBUTE_SOURCES_UI,
  ERRORS_EXCLUDED_KEYS,
  ERRORS_PROMOTED_ATTRIBUTES,
} from "./error-attribute-config";
```

```tsx
      <Separator />
      <AttributeFilterSection
        repo={repo}
        domain="errors"
        timeRange={timeRange}
        attributes={value.attributes}
        promotedAttributes={ERRORS_PROMOTED_ATTRIBUTES}
        excludedKeys={ERRORS_EXCLUDED_KEYS}
        sources={ERRORS_ATTRIBUTE_SOURCES_UI}
        onChange={(attributes) => onChange({ attributes })}
      />
```

(Confirm `@everr/ui/components/separator` is the correct import — check how `log-filters.tsx` imports `Separator`.)

### Step 3: `error-issues.tsx` — thread `attributes` + pass repo/timeRange

Read the file. `ErrorIssuesSearchValue` gains `attributes: AttributeFilter[]` (import from `../data/schemas`). Pass `attributes: search.attributes` into `errorIssuesInfiniteOptions(...)` and `errorServicesOptions(...)`. Pass `repo={repo}` and `timeRange={timeRange}` to `<ErrorFilters>` (which now needs them).

### Step 4: Routes — thread `attributes`

`packages/app/src/routes/_authenticated/_dashboard/errors.tsx`: destructure `attributes` from `withTimeRange(search)` and pass it in `search={{ q, service, fingerprint, sort, attributes }}`.

`packages/desktop-app/src/features/errors/errors-page.tsx`: same — destructure `attributes` and pass `search={{ q, service, fingerprint, sort, attributes }}` to `<ErrorIssues>`.

### Step 5: Render test

Add `src/errors/ui/error-filters.test.tsx` verifying the attribute section appears:

```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ErrorsRepositoryLike } from "../data/repository";
import { ErrorFilters } from "./error-filters";

describe("ErrorFilters", () => {
  it("renders the attribute section alongside the service filter", () => {
    const repo = {
      attributeKeys: vi.fn().mockResolvedValue([]),
      attributeValues: vi.fn().mockResolvedValue([]),
    } as unknown as ErrorsRepositoryLike;
    render(
      <QueryClientProvider client={new QueryClient()}>
        <ErrorFilters
          repo={repo}
          timeRange={{ from: "now-1h", to: "now" }}
          value={{ q: "", service: [], fingerprint: "", sort: "lastSeen", attributes: [] }}
          services={[]}
          onChange={vi.fn()}
        />
      </QueryClientProvider>,
    );
    expect(screen.getByText("Attributes")).toBeInTheDocument();
    expect(screen.getByText("Filter")).toBeInTheDocument();
  });
});
```

### Step 6: Verify + commit

- `pnpm vitest run` (telemetry-explorer) — green.
- `pnpm typecheck` — clean.
- From repo root: `pnpm --filter @everr/app typecheck` — clean.
- `cd packages/desktop-app && pnpm exec tsc --noEmit` — clean.
- `git add -A && git commit -m "Add the attribute filter section to the errors page"`

---

## Spec coverage (errors portion)

- Attribute filtering threads into summary + services WHERE (occurrences unfiltered) → Task 1 Step 2. ✓
- `attributes` on the three schemas → Task 1 Step 3. ✓
- Repository `attributeKeys`/`attributeValues` + widened interface → Task 1 Step 4. ✓
- Options + server fns + remote-repo wiring → Task 1 Steps 5–6. ✓
- Shared section added to the existing errors sidebar (additive, no layout restructure) → Task 2 Steps 1–3. ✓
- Both routes (web + desktop) thread `attributes` → Task 2 Step 4. ✓
- Cross-package verification (app + desktop) → Task 2 Step 6. ✓

## Out of scope
Filtering occurrences within an already-selected issue; any errors layout restructure (it already has a sidebar).
