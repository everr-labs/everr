# Dashboard Variables Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Perses-style dashboard variables: panel SQL references `$service`-style tokens, viewers pick values from a variable bar, definitions are edited in an edit-mode manager dialog, and values live in a `vars` URL search param.

**Architecture:** Pure logic (token interpolation, effective-value resolution) goes in small unit-tested modules under `packages/app/src/data/dashboards/`. Interpolation happens **server-side** in `runPanelQuery`; the client passes effective values + the per-variable metadata needed for "All" expansion. UI follows existing patterns: `OptionSelect`-style dropdowns, the zustand dirty-tracked store, react-query options factories.

**Tech Stack:** React 19, TanStack Start/Router, TanStack Query (`useQueries`), zustand, zod v4 (`import * as z` in data files, `import { z }` in the route file), `@everr/ui` kit, vitest.

**Spec:** `docs/superpowers/specs/2026-06-06-dashboard-variables-design.md` — read it first, especially "Context for implementers".

---

## Working conventions (read first)

- Workspace: `/Users/gio/workspace/everr-labs/everr`, branch `gio/dashboard-variables`. All paths relative to repo root.
- Tests: `cd packages/app && pnpm exec vitest run <path>`. Typecheck: `cd packages/app && pnpm typecheck`.
- NEVER use `tsx` to run anything. Never mention Claude/AI in commits, PRs, or comments.
- Commit messages: conventional commits (`feat(dashboards): …`, `test(dashboards): …`). NO co-author lines, NO AI attribution.
- lefthook pre-commit runs biome (may rewrite files — re-stage and retry) and `fallow dead-code`. Fallow treats `.test.ts` files as consumers (verified), so exports covered by tests in the same commit are safe. The task ordering below ensures every new export is consumed (by a test or a component) in the same commit — no `.fallowrc.jsonc` suppressions should be needed. If fallow still complains, fix by moving the export to the task that consumes it, not by suppressing.
- `packages/app/src/data/dashboards/schema.ts` exports are fully ignored by fallow (existing `.fallowrc.jsonc` entry).
- ClickHouse queries in server fns go through `context.clickhouse.query(sql, { from, to })` — org-scoped via row policy; never add tenant filters.
- Do NOT generate Drizzle migrations (no schema change needed here anyway — dashboard specs are jsonb).

---

### Task 1: Interpolation module (TDD)

**Files:**
- Create: `packages/app/src/data/dashboards/interpolate.ts`
- Test (create): `packages/app/src/data/dashboards/interpolate.test.ts`

Pure module. Token syntax: `$name`, `${name}`, `${name:raw}`. `$name` ends at the first char not in `[a-zA-Z0-9_]`. Single string → escaped SQL literal. Array → parenthesized list, empty array → `(NULL)`. All sentinel (`"__all"` as the sole value): `customAllValue` substituted **raw** if set, else expand loaded options as a parenthesized escaped list. `:raw` → verbatim (arrays joined with `,`). Unknown name → token left untouched.

- [ ] **Step 1: Write the failing test**

Create `packages/app/src/data/dashboards/interpolate.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  ALL_VALUE,
  extractVariableTokens,
  interpolateVariables,
  type VariableMeta,
  type VariableValues,
} from "./interpolate";

describe("interpolateVariables", () => {
  it("substitutes a single string value as an escaped SQL literal", () => {
    expect(
      interpolateVariables("SELECT * FROM logs WHERE service = $service", {
        service: "api",
      }),
    ).toBe("SELECT * FROM logs WHERE service = 'api'");
  });

  it("escapes single quotes and backslashes ClickHouse-style", () => {
    expect(interpolateVariables("$v", { v: "o'reilly" })).toBe("'o\\'reilly'");
    expect(interpolateVariables("$v", { v: "a\\b" })).toBe("'a\\\\b'");
  });

  it("supports ${name} braced syntax", () => {
    expect(interpolateVariables("WHERE s = ${service}", { service: "api" })).toBe(
      "WHERE s = 'api'",
    );
  });

  it("treats $var_suffix as one token but ${var}_suffix as token plus suffix", () => {
    const values: VariableValues = { service: "api", service_suffix: "x" };
    expect(interpolateVariables("$service_suffix", values)).toBe("'x'");
    expect(interpolateVariables("${service}_suffix", values)).toBe("'api'_suffix");
  });

  it("substitutes ${name:raw} verbatim without escaping", () => {
    expect(interpolateVariables("ORDER BY ${col:raw}", { col: "time DESC" })).toBe(
      "ORDER BY time DESC",
    );
  });

  it("joins array values with commas for :raw", () => {
    expect(interpolateVariables("${cols:raw}", { cols: ["a", "b"] })).toBe("a,b");
  });

  it("renders arrays as parenthesized escaped lists", () => {
    expect(
      interpolateVariables("env IN $env", { env: ["prod", "stag'ing"] }),
    ).toBe("env IN ('prod','stag\\'ing')");
  });

  it("renders an empty array as (NULL)", () => {
    expect(interpolateVariables("env IN $env", { env: [] })).toBe("env IN (NULL)");
  });

  it("expands the All sentinel to the loaded options list", () => {
    const meta: VariableMeta = { env: { options: ["prod", "staging"] } };
    expect(interpolateVariables("env IN $env", { env: ALL_VALUE }, meta)).toBe(
      "env IN ('prod','staging')",
    );
  });

  it("substitutes customAllValue raw when set, even with options loaded", () => {
    const meta: VariableMeta = { env: { customAllValue: "%", options: ["prod"] } };
    expect(interpolateVariables("env LIKE $env", { env: ALL_VALUE }, meta)).toBe(
      "env LIKE %",
    );
  });

  it("expands All to (NULL) when no options are available", () => {
    expect(interpolateVariables("env IN $env", { env: ALL_VALUE }, {})).toBe(
      "env IN (NULL)",
    );
  });

  it("leaves unknown tokens untouched", () => {
    expect(interpolateVariables("SELECT {from:DateTime64}, $unknown", {})).toBe(
      "SELECT {from:DateTime64}, $unknown",
    );
  });

  it("handles adjacent tokens", () => {
    expect(interpolateVariables("${a}${b}", { a: "x", b: "y" })).toBe("'x''y'");
  });
});

describe("extractVariableTokens", () => {
  it("returns unique token names in order of first appearance", () => {
    expect(
      extractVariableTokens("WHERE a = $x AND b = ${y} AND c = ${x:raw}"),
    ).toEqual(["x", "y"]);
  });

  it("returns an empty array when there are no tokens", () => {
    expect(extractVariableTokens("SELECT 1")).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd packages/app && pnpm exec vitest run src/data/dashboards/interpolate.test.ts`
Expected: FAIL — `Cannot find module './interpolate'` (or similar resolution error).

- [ ] **Step 3: Write the implementation**

Create `packages/app/src/data/dashboards/interpolate.ts`:

```ts
/**
 * Grafana-style variable interpolation for dashboard panel SQL.
 * Pure module — runs server-side in runPanelQuery, importable in tests.
 *
 * Token syntax: `$name`, `${name}`, `${name:raw}`. `$name` ends at the first
 * character outside [a-zA-Z0-9_]. Unknown names are left untouched (they may
 * be ClickHouse syntax such as dollar-quoted strings).
 */

/** Sentinel stored as the *sole* value when "All" is selected. */
export const ALL_VALUE = "__all";

/** Effective values keyed by variable name. */
export type VariableValues = Record<string, string | string[]>;

/** Per-variable metadata interpolation needs to expand the All sentinel. */
export interface VariableAllMeta {
  customAllValue?: string;
  options?: string[];
}

export type VariableMeta = Record<string, VariableAllMeta>;

const TOKEN_RE = /\$\{([a-zA-Z_][a-zA-Z0-9_]*)(?::(raw))?\}|\$([a-zA-Z_][a-zA-Z0-9_]*)/g;

/** Escape a string for use inside a ClickHouse single-quoted literal. */
function escapeSqlString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function sqlLiteral(value: string): string {
  return `'${escapeSqlString(value)}'`;
}

/** Empty lists become (NULL) so `IN (NULL)` deterministically matches nothing. */
function sqlList(values: string[]): string {
  if (values.length === 0) return "(NULL)";
  return `(${values.map(sqlLiteral).join(",")})`;
}

export function interpolateVariables(
  sql: string,
  values: VariableValues,
  meta: VariableMeta = {},
): string {
  return sql.replace(TOKEN_RE, (match, braced, modifier, bare) => {
    const name: string = braced ?? bare;
    if (!(name in values)) return match;
    const value = values[name]!;
    const raw = modifier === "raw";

    if (value === ALL_VALUE) {
      const allMeta = meta[name] ?? {};
      if (allMeta.customAllValue !== undefined) return allMeta.customAllValue;
      const options = allMeta.options ?? [];
      return raw ? options.join(",") : sqlList(options);
    }

    if (raw) return Array.isArray(value) ? value.join(",") : value;
    return Array.isArray(value) ? sqlList(value) : sqlLiteral(value);
  });
}

/** Unique variable names referenced by `sql`, in order of first appearance. */
export function extractVariableTokens(sql: string): string[] {
  const names: string[] = [];
  for (const match of sql.matchAll(TOKEN_RE)) {
    const name = match[1] ?? match[3];
    if (name && !names.includes(name)) names.push(name);
  }
  return names;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd packages/app && pnpm exec vitest run src/data/dashboards/interpolate.test.ts`
Expected: PASS (15 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/data/dashboards/interpolate.ts packages/app/src/data/dashboards/interpolate.test.ts
git commit -m "feat(dashboards): add variable interpolation module"
```

---

### Task 2: Effective-value resolution module (TDD)

**Files:**
- Create: `packages/app/src/data/dashboards/variable-values.ts`
- Test (create): `packages/app/src/data/dashboards/variable-values.test.ts`

Pure helpers: `effective(name) = vars[name] ?? specDefault(name)`, with normalization (multi-select → arrays, single-select → strings, All only when `allowAllValue`, invalid shapes fall back to the default, empty text = missing). Also: typed readers for the two list plugin kinds, the All-meta builder used by the panel wiring, the name regex shared with the manager, and a pick-by-names helper.

- [ ] **Step 1: Write the failing test**

Create `packages/app/src/data/dashboards/variable-values.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { ALL_VALUE } from "./interpolate";
import type { ListVariable, TextVariable, Variable } from "./schema";
import {
  buildAllMeta,
  effectiveVariableValues,
  getListVariableSource,
  pickByNames,
  VARIABLE_NAME_RE,
} from "./variable-values";

function text(name: string, value: string): TextVariable {
  return { kind: "TextVariable", spec: { name, value } };
}

function list(
  name: string,
  spec: Partial<ListVariable["spec"]> = {},
): ListVariable {
  return {
    kind: "ListVariable",
    spec: {
      name,
      plugin: { kind: "StaticListVariable", spec: { values: ["a", "b"] } },
      ...spec,
    },
  };
}

describe("effectiveVariableValues", () => {
  it("URL value wins over the spec default", () => {
    const vars: Variable[] = [text("env", "prod"), list("svc", { defaultValue: "a" })];
    expect(
      effectiveVariableValues(vars, { env: "staging", svc: "b" }),
    ).toEqual({ env: "staging", svc: "b" });
  });

  it("falls back to spec defaults when the URL has no value", () => {
    const vars: Variable[] = [text("env", "prod"), list("svc", { defaultValue: "a" })];
    expect(effectiveVariableValues(vars, undefined)).toEqual({
      env: "prod",
      svc: "a",
    });
  });

  it("omits variables with no effective value (no URL value, no default, empty text)", () => {
    const vars: Variable[] = [text("env", ""), list("svc")];
    expect(effectiveVariableValues(vars, undefined)).toEqual({});
  });

  it("normalizes multi-select values to arrays (URL string and string default)", () => {
    const multi = list("svc", { allowMultiple: true, defaultValue: "a" });
    expect(effectiveVariableValues([multi], { svc: "b" })).toEqual({ svc: ["b"] });
    expect(effectiveVariableValues([multi], undefined)).toEqual({ svc: ["a"] });
  });

  it("keeps multi-select arrays as-is, including empty arrays", () => {
    const multi = list("svc", { allowMultiple: true });
    expect(effectiveVariableValues([multi], { svc: ["a", "b"] })).toEqual({
      svc: ["a", "b"],
    });
    expect(effectiveVariableValues([multi], { svc: [] })).toEqual({ svc: [] });
  });

  it("treats an array URL value for a single-select as invalid → default", () => {
    const single = list("svc", { defaultValue: "a" });
    expect(effectiveVariableValues([single], { svc: ["b"] })).toEqual({ svc: "a" });
  });

  it("treats an array URL value for a text variable as invalid → default", () => {
    expect(effectiveVariableValues([text("env", "prod")], { env: ["x"] })).toEqual({
      env: "prod",
    });
  });

  it("allows the All sentinel only when allowAllValue is set", () => {
    const withAll = list("svc", { allowAllValue: true, defaultValue: "a" });
    const withoutAll = list("svc", { defaultValue: "a" });
    expect(effectiveVariableValues([withAll], { svc: ALL_VALUE })).toEqual({
      svc: ALL_VALUE,
    });
    expect(effectiveVariableValues([withoutAll], { svc: ALL_VALUE })).toEqual({
      svc: "a",
    });
  });

  it("treats arrays containing the All sentinel as invalid → default", () => {
    const multi = list("svc", {
      allowMultiple: true,
      allowAllValue: true,
      defaultValue: ["a"],
    });
    expect(effectiveVariableValues([multi], { svc: [ALL_VALUE, "b"] })).toEqual({
      svc: ["a"],
    });
  });
});

describe("getListVariableSource", () => {
  it("reads StaticListVariable values", () => {
    expect(getListVariableSource(list("svc"))).toEqual({
      kind: "static",
      values: ["a", "b"],
    });
  });

  it("reads ClickHouseSQLVariable query", () => {
    const v = list("svc", {
      plugin: { kind: "ClickHouseSQLVariable", spec: { query: "SELECT s FROM t" } },
    });
    expect(getListVariableSource(v)).toEqual({
      kind: "query",
      query: "SELECT s FROM t",
    });
  });

  it("returns unknown for other plugin kinds or malformed specs", () => {
    const v = list("svc", { plugin: { kind: "PrometheusLabelValues", spec: {} } });
    expect(getListVariableSource(v)).toEqual({ kind: "unknown" });
    const malformed = list("svc", { plugin: { kind: "StaticListVariable", spec: {} } });
    expect(getListVariableSource(malformed)).toEqual({ kind: "unknown" });
  });
});

describe("buildAllMeta", () => {
  it("uses customAllValue when set, without needing options", () => {
    const v = list("svc", { allowAllValue: true, customAllValue: "%" });
    const { meta, pendingAllNames } = buildAllMeta([v], { svc: ALL_VALUE }, {});
    expect(meta).toEqual({ svc: { customAllValue: "%" } });
    expect(pendingAllNames).toEqual([]);
  });

  it("uses loaded options when no customAllValue", () => {
    const v = list("svc", { allowAllValue: true });
    const { meta, pendingAllNames } = buildAllMeta(
      [v],
      { svc: ALL_VALUE },
      { svc: { options: ["a", "b"] } },
    );
    expect(meta).toEqual({ svc: { options: ["a", "b"] } });
    expect(pendingAllNames).toEqual([]);
  });

  it("reports pending when All is selected but options are not loaded yet", () => {
    const v = list("svc", { allowAllValue: true });
    const { meta, pendingAllNames } = buildAllMeta([v], { svc: ALL_VALUE }, {});
    expect(meta).toEqual({});
    expect(pendingAllNames).toEqual(["svc"]);
  });

  it("ignores variables whose value is not the All sentinel", () => {
    const v = list("svc", { allowAllValue: true });
    const { meta, pendingAllNames } = buildAllMeta(
      [v],
      { svc: "a" },
      { svc: { options: ["a"] } },
    );
    expect(meta).toEqual({});
    expect(pendingAllNames).toEqual([]);
  });
});

describe("pickByNames", () => {
  it("picks only the requested names that exist", () => {
    expect(pickByNames({ a: "1", b: "2" }, ["a", "c"])).toEqual({ a: "1" });
  });
});

describe("VARIABLE_NAME_RE", () => {
  it("accepts valid names and rejects invalid ones", () => {
    expect(VARIABLE_NAME_RE.test("service_1")).toBe(true);
    expect(VARIABLE_NAME_RE.test("_svc")).toBe(true);
    expect(VARIABLE_NAME_RE.test("1svc")).toBe(false);
    expect(VARIABLE_NAME_RE.test("svc-name")).toBe(false);
    expect(VARIABLE_NAME_RE.test("")).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd packages/app && pnpm exec vitest run src/data/dashboards/variable-values.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `packages/app/src/data/dashboards/variable-values.ts`:

```ts
/**
 * Effective variable value resolution: URL `vars` param wins, spec defaults
 * apply otherwise. Normalization: multi-select variables always resolve to
 * arrays, single-select to strings; the All sentinel only when allowAllValue.
 * Invalid shapes fall back to the default. Pure module.
 */
import { ALL_VALUE, type VariableMeta, type VariableValues } from "./interpolate";
import type { ListVariable, Variable } from "./schema";

/** Valid variable names; also enforced by the variables manager. */
export const VARIABLE_NAME_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

export type VariableUrlValues = Record<string, string | string[]>;

export type ListVariableSource =
  | { kind: "static"; values: string[] }
  | { kind: "query"; query: string }
  | { kind: "unknown" };

/** Typed reader over the loose `plugin: { kind, spec }` of a ListVariable. */
export function getListVariableSource(variable: ListVariable): ListVariableSource {
  const { kind, spec } = variable.spec.plugin;
  if (kind === "StaticListVariable" && Array.isArray(spec.values)) {
    return {
      kind: "static",
      values: spec.values.filter((v): v is string => typeof v === "string"),
    };
  }
  if (kind === "ClickHouseSQLVariable" && typeof spec.query === "string") {
    return { kind: "query", query: spec.query };
  }
  return { kind: "unknown" };
}

function normalizeListValue(
  value: string | string[] | undefined,
  multi: boolean,
  allowAll: boolean,
): string | string[] | undefined {
  if (value === undefined) return undefined;
  if (typeof value === "string") {
    if (value === ALL_VALUE) return allowAll ? ALL_VALUE : undefined;
    if (value === "") return undefined;
    return multi ? [value] : value;
  }
  // Arrays are only valid for multi-select, and never contain the sentinel.
  if (!multi) return undefined;
  if (value.some((entry) => entry === ALL_VALUE)) return undefined;
  return value;
}

function effectiveValue(
  variable: Variable,
  urlValue: string | string[] | undefined,
): string | string[] | undefined {
  if (variable.kind === "TextVariable") {
    const candidate = typeof urlValue === "string" ? urlValue : undefined;
    const resolved = candidate !== undefined && candidate !== ""
      ? candidate
      : variable.spec.value;
    return resolved === "" ? undefined : resolved;
  }
  const multi = variable.spec.allowMultiple === true;
  const allowAll = variable.spec.allowAllValue === true;
  return (
    normalizeListValue(urlValue, multi, allowAll) ??
    normalizeListValue(variable.spec.defaultValue, multi, allowAll)
  );
}

/**
 * Resolve effective values for all variables. Variables with no effective
 * value (no URL value, no default, empty text) are omitted from the result.
 */
export function effectiveVariableValues(
  variables: Variable[],
  urlVars: VariableUrlValues | undefined,
): VariableValues {
  const result: VariableValues = {};
  for (const variable of variables) {
    const value = effectiveValue(variable, urlVars?.[variable.spec.name]);
    if (value !== undefined) result[variable.spec.name] = value;
  }
  return result;
}

/**
 * Build the interpolation metadata for variables currently set to All.
 * Query-backed variables without customAllValue need loaded options; until
 * those arrive their names are reported in `pendingAllNames` so panels can
 * hold off querying.
 */
export function buildAllMeta(
  variables: Variable[],
  values: VariableValues,
  optionsByName: Record<string, { options?: string[] } | undefined>,
): { meta: VariableMeta; pendingAllNames: string[] } {
  const meta: VariableMeta = {};
  const pendingAllNames: string[] = [];
  for (const variable of variables) {
    if (variable.kind !== "ListVariable") continue;
    const name = variable.spec.name;
    if (values[name] !== ALL_VALUE) continue;
    if (variable.spec.customAllValue !== undefined) {
      meta[name] = { customAllValue: variable.spec.customAllValue };
      continue;
    }
    const options = optionsByName[name]?.options;
    if (options) {
      meta[name] = { options };
    } else {
      pendingAllNames.push(name);
    }
  }
  return { meta, pendingAllNames };
}

/** Subset a record to the given keys (used to scope values/meta per panel). */
export function pickByNames<T>(
  record: Record<string, T>,
  names: string[],
): Record<string, T> {
  const result: Record<string, T> = {};
  for (const name of names) {
    if (name in record) result[name] = record[name]!;
  }
  return result;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd packages/app && pnpm exec vitest run src/data/dashboards/variable-values.test.ts`
Expected: PASS.

- [ ] **Step 5: Run both new test files together and typecheck**

Run: `cd packages/app && pnpm exec vitest run src/data/dashboards/ && pnpm typecheck`
Expected: all dashboards tests PASS, typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add packages/app/src/data/dashboards/variable-values.ts packages/app/src/data/dashboards/variable-values.test.ts
git commit -m "feat(dashboards): add effective variable value resolution"
```

---

### Task 3: Store action `updateVariables` (TDD)

**Files:**
- Modify: `packages/app/src/data/dashboards/dashboard-store.ts`
- Test (modify): `packages/app/src/data/dashboards/dashboard-store.test.ts`

Mirrors `updateLayout`: replaces `spec.variables`, marks dirty, noop without a dashboard.

- [ ] **Step 1: Write the failing test**

In `packages/app/src/data/dashboards/dashboard-store.test.ts`, add inside `describe("dashboard store dirty tracking", ...)` after the `updateLayout` test:

```ts
  it("updateVariables marks dirty and replaces spec.variables", () => {
    useDashboardStore.getState().setDashboard(makeDashboard());
    useDashboardStore.getState().updateVariables([
      { kind: "TextVariable", spec: { name: "env", value: "prod" } },
    ]);
    const state = useDashboardStore.getState();
    expect(state.isDirty).toBe(true);
    expect(state.dashboard?.spec.variables).toEqual([
      { kind: "TextVariable", spec: { name: "env", value: "prod" } },
    ]);
  });
```

And extend the existing `"noop actions when no dashboard loaded do not mark dirty"` test — add this line before the assertion:

```ts
  useDashboardStore.getState().updateVariables([]);
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd packages/app && pnpm exec vitest run src/data/dashboards/dashboard-store.test.ts`
Expected: FAIL — `updateVariables is not a function`.

- [ ] **Step 3: Implement**

In `packages/app/src/data/dashboards/dashboard-store.ts`:

Change the type import to include `Variable`:

```ts
import type { Dashboard, GridLayout, Panel, Variable } from "./schema";
```

Add to the `DashboardState` interface after `updateLayout`:

```ts
  updateVariables: (variables: Variable[]) => void;
```

Add to the store implementation after the `updateLayout` action:

```ts
  updateVariables: (variables) =>
    set((state) => {
      if (!state.dashboard) return state;
      return {
        isDirty: true,
        dashboard: {
          ...state.dashboard,
          spec: { ...state.dashboard.spec, variables },
        },
      };
    }),
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd packages/app && pnpm exec vitest run src/data/dashboards/dashboard-store.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/data/dashboards/dashboard-store.ts packages/app/src/data/dashboards/dashboard-store.test.ts
git commit -m "feat(dashboards): add updateVariables store action with dirty tracking"
```

---

### Task 4: Server functions — interpolation in `runPanelQuery` + new `runVariableOptionsQuery` (TDD)

**Files:**
- Modify: `packages/app/src/data/dashboards/server.ts` (bottom — `runPanelQuery` is the last fn)
- Test (modify): `packages/app/src/data/dashboards/server.test.ts`

`runPanelQuery` gains optional `variables` + `variableMeta` inputs; the handler interpolates before `context.clickhouse.query`. New `runVariableOptionsQuery`: runs an org-scoped query, returns `{ options, truncated }` — stringified first-column values, deduped, in query order, capped at 1000 with a `truncated` flag.

The clickhouse client is already mocked globally in `src/test-setup.ts` (`vi.mock("@/lib/clickhouse")` with a `query` vi.fn; the serverFn mock routes `context.clickhouse.query(sql, params)` to it with sql as the **first** argument). Assert on `mock.calls[0]![0]`.

- [ ] **Step 1: Write the failing tests**

In `packages/app/src/data/dashboards/server.test.ts`:

Add to the imports from `./server` (keep alphabetical order):

```ts
import {
  createDashboard,
  createFolder,
  generateDashboardSlug,
  moveFolder,
  renameFolder,
  runPanelQuery,
  runVariableOptionsQuery,
  saveDashboard,
  updateDashboardSettings,
} from "./server";
```

Add below the existing `import { db } from "@/db/client";` line:

```ts
import { query as clickhouseQuery } from "@/lib/clickhouse";
```

Add after `const mockedDb = vi.mocked(db);`:

```ts
const mockedClickhouse = vi.mocked(clickhouseQuery);
```

Append at the end of the file:

```ts
// ---------------------------------------------------------------------------
// runPanelQuery – variable interpolation
// ---------------------------------------------------------------------------

describe("runPanelQuery – variable interpolation", () => {
  it("interpolates variables into the SQL before executing", async () => {
    mockedClickhouse.mockResolvedValue([]);

    await runPanelQuery({
      data: {
        sql: "SELECT * FROM logs WHERE service = $service AND env IN $env",
        variables: { service: "api", env: ["prod", "staging"] },
      },
    });

    expect(mockedClickhouse).toHaveBeenCalledTimes(1);
    expect(mockedClickhouse.mock.calls[0]![0]).toBe(
      "SELECT * FROM logs WHERE service = 'api' AND env IN ('prod','staging')",
    );
  });

  it("expands the All sentinel using variableMeta options", async () => {
    mockedClickhouse.mockResolvedValue([]);

    await runPanelQuery({
      data: {
        sql: "SELECT * FROM logs WHERE env IN $env",
        variables: { env: "__all" },
        variableMeta: { env: { options: ["prod", "staging"] } },
      },
    });

    expect(mockedClickhouse.mock.calls[0]![0]).toBe(
      "SELECT * FROM logs WHERE env IN ('prod','staging')",
    );
  });

  it("runs the SQL unchanged when no variables are provided", async () => {
    mockedClickhouse.mockResolvedValue([]);

    await runPanelQuery({ data: { sql: "SELECT $notavar FROM logs" } });

    expect(mockedClickhouse.mock.calls[0]![0]).toBe("SELECT $notavar FROM logs");
  });
});

// ---------------------------------------------------------------------------
// runVariableOptionsQuery
// ---------------------------------------------------------------------------

describe("runVariableOptionsQuery", () => {
  it("returns stringified, deduped first-column values in query order", async () => {
    mockedClickhouse.mockResolvedValue([
      { service: "api", count: 10 },
      { service: "web", count: 20 },
      { service: "api", count: 30 },
      { service: 42, count: 40 },
    ]);

    const result = await runVariableOptionsQuery({
      data: { query: "SELECT service FROM logs GROUP BY service" },
    });

    expect(result).toEqual({ options: ["api", "web", "42"], truncated: false });
  });

  it("caps options at 1000 unique values and sets the truncated flag", async () => {
    mockedClickhouse.mockResolvedValue(
      Array.from({ length: 1100 }, (_, i) => ({ v: `service-${i}` })),
    );

    const result = await runVariableOptionsQuery({ data: { query: "q" } });

    expect(result.options).toHaveLength(1000);
    expect(result.options[0]).toBe("service-0");
    expect(result.options[999]).toBe("service-999");
    expect(result.truncated).toBe(true);
  });

  it("does not set truncated when exactly at the cap after dedup", async () => {
    const rows = [
      ...Array.from({ length: 1000 }, (_, i) => ({ v: `s-${i}` })),
      // duplicates beyond the cap do not count as new values
      { v: "s-0" },
      { v: "s-1" },
    ];
    mockedClickhouse.mockResolvedValue(rows);

    const result = await runVariableOptionsQuery({ data: { query: "q" } });

    expect(result.options).toHaveLength(1000);
    expect(result.truncated).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd packages/app && pnpm exec vitest run src/data/dashboards/server.test.ts`
Expected: FAIL — `runVariableOptionsQuery` not exported; interpolation tests fail with un-interpolated SQL.

- [ ] **Step 3: Implement**

In `packages/app/src/data/dashboards/server.ts`:

Add the import after the existing `./schema` imports:

```ts
import { interpolateVariables } from "./interpolate";
```

Replace the whole `runPanelQuery` definition (currently the last function) with:

```ts
export const runPanelQuery = createAuthenticatedServerFn({
  method: "POST",
})
  .inputValidator(
    z.object({
      sql: z.string().min(1),
      from: z.string().optional(),
      to: z.string().optional(),
      variables: z
        .record(z.string(), z.union([z.string(), z.array(z.string())]))
        .optional(),
      variableMeta: z
        .record(
          z.string(),
          z.object({
            customAllValue: z.string().optional(),
            options: z.array(z.string()).optional(),
          }),
        )
        .optional(),
    }),
  )
  .handler(async ({ data: { sql, from, to, variables, variableMeta }, context }) => {
    const { fromISO, toISO } = resolveTimeRange({
      from: from ?? DEFAULT_TIME_RANGE.from,
      to: to ?? DEFAULT_TIME_RANGE.to,
    });
    const interpolated = variables
      ? interpolateVariables(sql, variables, variableMeta ?? {})
      : sql;
    const rows = await context.clickhouse.query<QueryRow>(interpolated, {
      from: fromISO,
      to: toISO,
    });
    return { rows };
  });
```

Append below it:

```ts
const VARIABLE_OPTIONS_LIMIT = 1000;

export const runVariableOptionsQuery = createAuthenticatedServerFn({
  method: "POST",
})
  .inputValidator(
    z.object({
      query: z.string().min(1),
      from: z.string().optional(),
      to: z.string().optional(),
    }),
  )
  .handler(async ({ data: { query, from, to }, context }) => {
    const { fromISO, toISO } = resolveTimeRange({
      from: from ?? DEFAULT_TIME_RANGE.from,
      to: to ?? DEFAULT_TIME_RANGE.to,
    });
    const rows = await context.clickhouse.query<Record<string, unknown>>(query, {
      from: fromISO,
      to: toISO,
    });

    // Options are the stringified first column, deduplicated, in query order,
    // capped at VARIABLE_OPTIONS_LIMIT with an explicit truncation flag.
    const seen = new Set<string>();
    const options: string[] = [];
    let truncated = false;
    for (const row of rows) {
      const option = String(Object.values(row)[0]);
      if (seen.has(option)) continue;
      seen.add(option);
      if (options.length >= VARIABLE_OPTIONS_LIMIT) {
        truncated = true;
        break;
      }
      options.push(option);
    }
    return { options, truncated };
  });
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd packages/app && pnpm exec vitest run src/data/dashboards/server.test.ts && pnpm typecheck`
Expected: PASS, typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/data/dashboards/server.ts packages/app/src/data/dashboards/server.test.ts
git commit -m "feat(dashboards): interpolate variables in runPanelQuery and add runVariableOptionsQuery"
```

---

### Task 5: `vars` URL search param on the dashboard layout

**Files:**
- Modify: `packages/app/src/routes/_authenticated/_dashboard.tsx:31-34`

One `vars` param holding a JSON object (TanStack's default search serializer handles encoding). NOT added to `retainSearchParams` — values must drop when leaving the dashboard. No seeding on load. `.catch(undefined)` so malformed external URLs degrade to defaults instead of erroring the route.

- [ ] **Step 1: Extend the schema**

In `packages/app/src/routes/_authenticated/_dashboard.tsx`, replace:

```ts
const DashboardSearchSchema = TimeRangeSearchSchema.extend({
  github_install: z.string().optional(),
  reason: z.string().optional(),
});
```

with:

```ts
const DashboardSearchSchema = TimeRangeSearchSchema.extend({
  github_install: z.string().optional(),
  reason: z.string().optional(),
  // Dashboard variable values, e.g. ?vars={"env":"prod","svc":["a","b"]}.
  // Deliberately NOT retained across navigation — different dashboards have
  // different variables. Malformed values fall back to spec defaults.
  vars: z
    .record(z.string(), z.union([z.string(), z.array(z.string())]))
    .optional()
    .catch(undefined),
});
```

Do NOT touch `stripSearchParams` / `retainSearchParams` / the seeding effect in `$dashboardId.tsx`.

- [ ] **Step 2: Typecheck**

Run: `cd packages/app && pnpm typecheck`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add packages/app/src/routes/_authenticated/_dashboard.tsx
git commit -m "feat(dashboards): add vars search param for dashboard variable values"
```

---

### Task 6: Variable bar (options factory, shared hook, component, mount in grid)

**Files:**
- Modify: `packages/app/src/data/dashboards/options.ts` (add `variableOptionsQueryOptions`)
- Create: `packages/app/src/components/dashboards/use-dashboard-variables.ts`
- Create: `packages/app/src/components/dashboards/variable-bar.tsx`
- Modify: `packages/app/src/components/dashboards/dashboard-grid.tsx` (mount bar between toolbar and grid)

All four files in one commit so every new export has a consumer (fallow). Per spec §5: skip `display.hidden` variables (and constant text variables — they are fixed values, nothing to pick); Text → labeled Input committing on Enter/blur; single-select → dropdown; multi-select → checkbox items; "All" entry when `allowAllValue` (All clears individual selections and vice versa). Loading → disabled picker with spinner. Error → inline error state with the message as a tooltip (`title` attr — same pattern as `panel-shell.tsx:121`), not a toast. Label = `display.name ?? name`.

- [ ] **Step 1: Add `variableOptionsQueryOptions` to options.ts**

In `packages/app/src/data/dashboards/options.ts`, add `runVariableOptionsQuery` to the `./server` import list (alphabetical: after `runPanelQuery`), then add below `panelQueryOptions`:

```ts
export const variableOptionsQueryOptions = (
  query: string,
  from?: string,
  to?: string,
) =>
  queryOptions({
    queryKey: ["variable-options", query, from, to],
    queryFn: () => runVariableOptionsQuery({ data: { query, from, to } }),
    enabled: query.trim().length > 0,
  });
```

- [ ] **Step 2: Create the shared hook**

Create `packages/app/src/components/dashboards/use-dashboard-variables.ts`:

```ts
import { useQueries } from "@tanstack/react-query";
import { useSearch } from "@tanstack/react-router";
import { useDashboardStore } from "@/data/dashboards/dashboard-store";
import type { VariableMeta, VariableValues } from "@/data/dashboards/interpolate";
import { variableOptionsQueryOptions } from "@/data/dashboards/options";
import type { ListVariable, Variable } from "@/data/dashboards/schema";
import {
  buildAllMeta,
  effectiveVariableValues,
  getListVariableSource,
} from "@/data/dashboards/variable-values";

export interface VariableOptionsState {
  options?: string[];
  isPending: boolean;
  error?: string;
  truncated?: boolean;
}

export interface DashboardVariablesState {
  variables: Variable[];
  /** Effective values (URL wins, then spec defaults). Missing = absent key. */
  values: VariableValues;
  /** All-expansion metadata for variables currently set to the All sentinel. */
  meta: VariableMeta;
  /** Names set to All whose options have not loaded yet — hold panel queries. */
  pendingAllNames: string[];
  /** Per-list-variable option-loading state for the pickers. */
  optionsState: Record<string, VariableOptionsState>;
}

const EMPTY_VARIABLES: Variable[] = [];

export function useDashboardVariables(): DashboardVariablesState {
  const search = useSearch({ from: "/_authenticated/_dashboard" });
  const { from, to, vars } = search;
  const variables =
    useDashboardStore((s) => s.dashboard?.spec.variables) ?? EMPTY_VARIABLES;

  const queryBacked = variables.filter(
    (v): v is ListVariable =>
      v.kind === "ListVariable" && getListVariableSource(v).kind === "query",
  );
  const optionQueries = useQueries({
    queries: queryBacked.map((v) => {
      const source = getListVariableSource(v);
      return variableOptionsQueryOptions(
        source.kind === "query" ? source.query : "",
        from,
        to,
      );
    }),
  });

  const optionsState: Record<string, VariableOptionsState> = {};
  for (const variable of variables) {
    if (variable.kind !== "ListVariable") continue;
    const source = getListVariableSource(variable);
    if (source.kind === "static") {
      optionsState[variable.spec.name] = {
        options: source.values,
        isPending: false,
      };
    } else if (source.kind === "query") {
      const query = optionQueries[queryBacked.indexOf(variable)];
      optionsState[variable.spec.name] = {
        options: query?.data?.options,
        isPending: query?.isPending ?? true,
        error: query?.error
          ? query.error instanceof Error
            ? query.error.message
            : String(query.error)
          : undefined,
        truncated: query?.data?.truncated,
      };
    } else {
      optionsState[variable.spec.name] = { options: [], isPending: false };
    }
  }

  const values = effectiveVariableValues(variables, vars);
  const { meta, pendingAllNames } = buildAllMeta(variables, values, optionsState);

  return { variables, values, meta, pendingAllNames, optionsState };
}
```

- [ ] **Step 3: Create the variable bar component**

Create `packages/app/src/components/dashboards/variable-bar.tsx`:

```tsx
import { Button } from "@everr/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@everr/ui/components/dropdown-menu";
import { Input } from "@everr/ui/components/input";
import { Label } from "@everr/ui/components/label";
import { cn } from "@everr/ui/lib/utils";
import { useNavigate } from "@tanstack/react-router";
import { AlertCircle, ChevronDown, Loader2 } from "lucide-react";
import { useCallback } from "react";
import { ALL_VALUE } from "@/data/dashboards/interpolate";
import type { ListVariable, TextVariable, Variable } from "@/data/dashboards/schema";
import {
  useDashboardVariables,
  type VariableOptionsState,
} from "./use-dashboard-variables";

function variableLabel(variable: Variable): string {
  return variable.spec.display?.name ?? variable.spec.name;
}

function isVisible(variable: Variable): boolean {
  if (variable.spec.display?.hidden) return false;
  // Constant text variables are fixed values — nothing to pick.
  if (variable.kind === "TextVariable" && variable.spec.constant) return false;
  return true;
}

interface VariableBarProps {
  /** Compact styling for the panel editor header. */
  compact?: boolean;
}

export function VariableBar({ compact }: VariableBarProps) {
  const navigate = useNavigate();
  const { variables, values, optionsState } = useDashboardVariables();

  const setValue = useCallback(
    (name: string, value: string | string[]) => {
      navigate({
        to: ".",
        search: (prev: Record<string, unknown>) => ({
          ...prev,
          vars: {
            ...((prev.vars as Record<string, unknown> | undefined) ?? {}),
            [name]: value,
          },
        }),
        replace: false,
      });
    },
    [navigate],
  );

  const visible = variables.filter(isVisible);
  if (visible.length === 0) return null;

  return (
    <div
      className={cn(
        "flex flex-wrap items-end gap-3",
        compact ? "border-b px-4 py-2" : "mb-3",
      )}
    >
      {visible.map((variable) =>
        variable.kind === "TextVariable" ? (
          <TextVariableField
            key={variable.spec.name}
            variable={variable}
            value={
              typeof values[variable.spec.name] === "string"
                ? (values[variable.spec.name] as string)
                : ""
            }
            onCommit={(value) => setValue(variable.spec.name, value)}
          />
        ) : (
          <ListVariableField
            key={variable.spec.name}
            variable={variable}
            value={values[variable.spec.name]}
            optionsState={optionsState[variable.spec.name]}
            onChange={(value) => setValue(variable.spec.name, value)}
          />
        ),
      )}
    </div>
  );
}

function TextVariableField({
  variable,
  value,
  onCommit,
}: {
  variable: TextVariable;
  value: string;
  onCommit: (value: string) => void;
}) {
  const name = variable.spec.name;
  return (
    <div className="flex flex-col gap-1">
      <Label htmlFor={`var-${name}`} className="text-xs text-muted-foreground">
        {variableLabel(variable)}
      </Label>
      <Input
        id={`var-${name}`}
        key={value}
        defaultValue={value}
        className="h-8 w-40"
        onBlur={(e) => {
          if (e.target.value !== value) onCommit(e.target.value);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
        }}
      />
    </div>
  );
}

function ListVariableField({
  variable,
  value,
  optionsState,
  onChange,
}: {
  variable: ListVariable;
  value: string | string[] | undefined;
  optionsState: VariableOptionsState | undefined;
  onChange: (value: string | string[]) => void;
}) {
  const name = variable.spec.name;
  const multi = variable.spec.allowMultiple === true;
  const allowAll = variable.spec.allowAllValue === true;
  const { options, isPending, error, truncated } = optionsState ?? {
    isPending: false,
  };

  const isAll = value === ALL_VALUE;
  const selected = Array.isArray(value)
    ? value
    : typeof value === "string" && !isAll
      ? [value]
      : [];

  const triggerLabel = error
    ? "Error"
    : isPending
      ? "Loading…"
      : isAll
        ? "All"
        : selected.length === 0
          ? "Select…"
          : selected.join(", ");

  // Toggling an individual option clears All; selecting All clears individuals.
  const handleToggle = (option: string, checked: boolean) => {
    const base = isAll ? [] : selected;
    onChange(checked ? [...base, option] : base.filter((o) => o !== option));
  };

  return (
    <div className="flex flex-col gap-1">
      <Label htmlFor={`var-${name}`} className="text-xs text-muted-foreground">
        {variableLabel(variable)}
      </Label>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              id={`var-${name}`}
              variant="outline"
              size="sm"
              disabled={isPending}
              title={error}
              className={cn(
                "h-8 max-w-56 justify-between font-normal",
                error && "border-destructive text-destructive",
              )}
            />
          }
        >
          <span className="truncate">{triggerLabel}</span>
          {isPending ? (
            <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
          ) : error ? (
            <AlertCircle className="size-3.5" />
          ) : (
            <ChevronDown className="size-3.5 text-muted-foreground" />
          )}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="max-h-80 overflow-y-auto">
          {allowAll && (
            <>
              {multi ? (
                <DropdownMenuCheckboxItem
                  checked={isAll}
                  onCheckedChange={() => onChange(ALL_VALUE)}
                >
                  All
                </DropdownMenuCheckboxItem>
              ) : (
                <DropdownMenuItem onClick={() => onChange(ALL_VALUE)}>
                  All
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
            </>
          )}
          {(options ?? []).map((option) =>
            multi ? (
              <DropdownMenuCheckboxItem
                key={option}
                checked={!isAll && selected.includes(option)}
                closeOnClick={false}
                onCheckedChange={(checked) => handleToggle(option, checked)}
              >
                {option}
              </DropdownMenuCheckboxItem>
            ) : (
              <DropdownMenuItem key={option} onClick={() => onChange(option)}>
                {option}
              </DropdownMenuItem>
            ),
          )}
          {truncated && (
            <div className="px-2 py-1.5 text-xs text-muted-foreground">
              First 1000 shown
            </div>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
```

Note: `closeOnClick` is a Base UI `Menu.CheckboxItem` prop (`MenuPrimitive.CheckboxItem.Props`) — `DropdownMenuCheckboxItem` spreads props through, so it keeps the menu open while toggling multi-select values. If the typecheck rejects it, check the installed `@base-ui-components/react` Menu.CheckboxItem prop name and adjust (do not silently drop the keep-open behavior).

- [ ] **Step 4: Mount the bar in dashboard-grid.tsx**

In `packages/app/src/components/dashboards/dashboard-grid.tsx`:

Add the import (with the other `./` imports):

```ts
import { VariableBar } from "./variable-bar";
```

Insert `<VariableBar />` between the toolbar and the grid — i.e. between the closing `</div>` of the toolbar (the `"mb-3 flex items-center justify-end gap-2"` div) and `<div ref={containerRef}>`:

```tsx
      <VariableBar />

      <div ref={containerRef}>
```

- [ ] **Step 5: Typecheck and run the suite**

Run: `cd packages/app && pnpm typecheck && pnpm exec vitest run src/data/dashboards/`
Expected: clean, all PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/app/src/data/dashboards/options.ts packages/app/src/components/dashboards/use-dashboard-variables.ts packages/app/src/components/dashboards/variable-bar.tsx packages/app/src/components/dashboards/dashboard-grid.tsx
git commit -m "feat(dashboards): add variable bar with text, list and query-backed pickers"
```

---

### Task 7: Panel query wiring (grid panels + editor)

**Files:**
- Modify: `packages/app/src/data/dashboards/options.ts` (`panelQueryOptions` gains args)
- Modify: `packages/app/src/components/dashboards/dashboard-panel.tsx`
- Modify: `packages/app/src/components/dashboards/panel-edit-page.tsx`

Effective values + All-meta join the panel queryKey (scoped to the variables each panel's SQL actually references, so unrelated variable changes don't refetch every panel). Panels referencing a variable with **no effective value** render the existing error card with `Select a value for $name` — client-side via `enabled: false`, never sent to CH. Panels whose All-options are still loading stay in the pending skeleton. The editor's manual Run Query passes values/meta too, and the editor shows a compact variable bar under its header.

- [ ] **Step 1: Extend `panelQueryOptions`**

In `packages/app/src/data/dashboards/options.ts`, add the type import at the top:

```ts
import type { VariableMeta, VariableValues } from "./interpolate";
```

Replace `panelQueryOptions` with:

```ts
export const panelQueryOptions = (
  sql: string,
  from?: string,
  to?: string,
  variables?: VariableValues,
  variableMeta?: VariableMeta,
) =>
  queryOptions({
    queryKey: ["panel-query", sql, from, to, variables ?? null, variableMeta ?? null],
    queryFn: () => runPanelQuery({ data: { sql, from, to, variables, variableMeta } }),
    enabled: sql.trim().length > 0,
  });
```

- [ ] **Step 2: Wire dashboard-panel.tsx**

In `packages/app/src/components/dashboards/dashboard-panel.tsx`:

Add imports:

```ts
import { useCallback, useMemo } from "react";
import { extractVariableTokens } from "@/data/dashboards/interpolate";
import { pickByNames } from "@/data/dashboards/variable-values";
import { useDashboardVariables } from "./use-dashboard-variables";
```

(`useCallback` is already imported — extend that line with `useMemo`.)

Inside `DashboardPanel`, replace this block:

```ts
  const sql = getPanelQuerySql(panel);
  const {
    data: queryResult,
    isPending,
    isError,
    error,
  } = useQuery(panelQueryOptions(sql, from, to));
```

with:

```ts
  const sql = getPanelQuerySql(panel);

  const { variables, values, meta, pendingAllNames } = useDashboardVariables();
  const usedNames = useMemo(() => {
    const defined = new Set(variables.map((v) => v.spec.name));
    return extractVariableTokens(sql).filter((name) => defined.has(name));
  }, [sql, variables]);
  const missingName = usedNames.find((name) => values[name] === undefined);
  const waitingForOptions = usedNames.some((name) =>
    pendingAllNames.includes(name),
  );
  const panelVariables =
    usedNames.length > 0 ? pickByNames(values, usedNames) : undefined;
  const panelMeta = usedNames.length > 0 ? pickByNames(meta, usedNames) : undefined;

  const queryOpts = panelQueryOptions(sql, from, to, panelVariables, panelMeta);
  const {
    data: queryResult,
    isPending,
    isError,
    error,
  } = useQuery({
    ...queryOpts,
    enabled:
      sql.trim().length > 0 && missingName === undefined && !waitingForOptions,
  });
```

Then replace the `status` computation:

```ts
  const status = !sql
    ? "success"
    : isError
      ? "error"
      : isPending
        ? "pending"
        : "success";
```

with:

```ts
  const status = !sql
    ? "success"
    : missingName !== undefined
      ? "error"
      : isError
        ? "error"
        : isPending
          ? "pending"
          : "success";
```

And replace the `errorMessage` prop on `<PanelShell>`:

```tsx
        errorMessage={
          missingName !== undefined
            ? `Select a value for $${missingName}`
            : isError
              ? error instanceof Error
                ? error.message
                : String(error)
              : undefined
        }
```

(`waitingForOptions` intentionally leaves the panel in the pending skeleton: `enabled: false` keeps `isPending` true.)

- [ ] **Step 3: Wire panel-edit-page.tsx**

In `packages/app/src/components/dashboards/panel-edit-page.tsx`:

Add imports:

```ts
import { useCallback, useEffect, useMemo, useState } from "react";
import { extractVariableTokens } from "@/data/dashboards/interpolate";
import { pickByNames } from "@/data/dashboards/variable-values";
import { useDashboardVariables } from "./use-dashboard-variables";
import { VariableBar } from "./variable-bar";
```

(extend the existing react import with `useMemo`.)

After the `const [draft, setDraft] = useState<Panel | null>(panel);` block and its sync effect, add:

```ts
  const { variables, values, meta, pendingAllNames } = useDashboardVariables();
  const definedNames = useMemo(
    () => new Set(variables.map((v) => v.spec.name)),
    [variables],
  );
```

Replace the auto-query block:

```ts
  const savedSql = panel ? getQuerySql(panel) : "";
  const {
    data: autoResult,
    isError: autoIsError,
    error: autoError,
  } = useQuery(panelQueryOptions(savedSql, from, to));
```

with:

```ts
  const savedSql = panel ? getQuerySql(panel) : "";
  const savedUsedNames = useMemo(
    () => extractVariableTokens(savedSql).filter((name) => definedNames.has(name)),
    [savedSql, definedNames],
  );
  const savedMissingName = savedUsedNames.find(
    (name) => values[name] === undefined,
  );
  const savedWaitingForOptions = savedUsedNames.some((name) =>
    pendingAllNames.includes(name),
  );
  const savedVariables =
    savedUsedNames.length > 0 ? pickByNames(values, savedUsedNames) : undefined;
  const savedMeta =
    savedUsedNames.length > 0 ? pickByNames(meta, savedUsedNames) : undefined;
  const autoOpts = panelQueryOptions(savedSql, from, to, savedVariables, savedMeta);
  const {
    data: autoResult,
    isError: autoIsError,
    error: autoError,
  } = useQuery({
    ...autoOpts,
    // storeDashboard gate: on a direct editor URL load there is one render
    // where the fetched dashboard exists but the store (which
    // useDashboardVariables reads) is still null — without the gate the query
    // would fire once with un-resolved variables. The sync effect above sets
    // the store immediately after, so this only delays by one tick.
    enabled:
      storeDashboard !== null &&
      savedSql.trim().length > 0 &&
      savedMissingName === undefined &&
      !savedWaitingForOptions,
  });
```

Replace `handleRunQuery` with:

```ts
  const handleRunQuery = useCallback(
    async (sql: string) => {
      const usedNames = extractVariableTokens(sql).filter((name) =>
        definedNames.has(name),
      );
      const missingName = usedNames.find((name) => values[name] === undefined);
      if (missingName !== undefined) {
        setManualError(`Select a value for $${missingName}`);
        return;
      }
      const variables =
        usedNames.length > 0 ? pickByNames(values, usedNames) : undefined;
      const variableMeta =
        usedNames.length > 0 ? pickByNames(meta, usedNames) : undefined;
      setIsRunning(true);
      try {
        const result = await runPanelQuery({
          data: { sql, from, to, variables, variableMeta },
        });
        setManualResult(result.rows);
        setManualError(null);
        queryClient.setQueryData(
          panelQueryOptions(sql, from, to, variables, variableMeta).queryKey,
          result,
        );
      } catch (error) {
        setManualError(error instanceof Error ? error.message : "Query failed");
      } finally {
        setIsRunning(false);
      }
    },
    [queryClient, from, to, values, meta, definedNames],
  );
```

Replace the `queryErrorMessage` computation:

```ts
  const queryResult = manualResult ?? autoResult?.rows;
  const queryErrorMessage =
    manualError ??
    (savedMissingName !== undefined && !manualResult
      ? `Select a value for $${savedMissingName}`
      : autoIsError && !manualResult
        ? autoError instanceof Error
          ? autoError.message
          : String(autoError)
        : undefined);
```

Finally, render the compact variable bar directly under the header — after the closing `</div>` of the `"flex items-center justify-between border-b px-4 py-2"` header div and before `<ResizablePanelGroup className="min-h-0 flex-1">`:

```tsx
      <VariableBar compact />
```

- [ ] **Step 4: Typecheck and run the suite**

Run: `cd packages/app && pnpm typecheck && pnpm exec vitest run src/data/dashboards/`
Expected: clean, all PASS. Also run the desktop-app check (shared-type safety net): `cd ../desktop-app && pnpm exec tsc --noEmit` — expected clean (we touched no shared telemetry-explorer types, this is a guard).

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/data/dashboards/options.ts packages/app/src/components/dashboards/dashboard-panel.tsx packages/app/src/components/dashboards/panel-edit-page.tsx
git commit -m "feat(dashboards): pass variable values through panel queries"
```

---

### Task 8: Variables manager (edit mode)

**Files:**
- Create: `packages/app/src/components/dashboards/variables-manager.tsx`
- Modify: `packages/app/src/components/dashboards/dashboard-grid.tsx` ("Variables" button next to Add Panel)

Dialog with a list view (name, kind, flags, edit/delete with aria-labels) and an add/edit form (kind selector, per-kind fields, validation, query preview). All mutations go through `updateVariables` (dirty-tracked); saving uses the existing dashboard Save flow.

- [ ] **Step 1: Create the manager component**

Create `packages/app/src/components/dashboards/variables-manager.tsx`:

```tsx
import { Badge } from "@everr/ui/components/badge";
import { Button } from "@everr/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@everr/ui/components/dialog";
import { Input } from "@everr/ui/components/input";
import { Label } from "@everr/ui/components/label";
import { Switch } from "@everr/ui/components/switch";
import { Textarea } from "@everr/ui/components/textarea";
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@everr/ui/components/toggle-group";
import { useSearch } from "@tanstack/react-router";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { useDashboardStore } from "@/data/dashboards/dashboard-store";
import type { Variable } from "@/data/dashboards/schema";
import { runVariableOptionsQuery } from "@/data/dashboards/server";
import {
  getListVariableSource,
  VARIABLE_NAME_RE,
} from "@/data/dashboards/variable-values";

interface VariableDraft {
  kind: "TextVariable" | "ListVariable";
  name: string;
  label: string;
  hidden: boolean;
  // TextVariable
  value: string;
  constant: boolean;
  // ListVariable
  pluginKind: "StaticListVariable" | "ClickHouseSQLVariable";
  staticValues: string; // textarea, one value per line
  query: string;
  defaultValue: string; // comma-separated when allowMultiple
  allowMultiple: boolean;
  allowAllValue: boolean;
  customAllValue: string;
}

function emptyDraft(): VariableDraft {
  return {
    kind: "ListVariable",
    name: "",
    label: "",
    hidden: false,
    value: "",
    constant: false,
    pluginKind: "StaticListVariable",
    staticValues: "",
    query: "",
    defaultValue: "",
    allowMultiple: false,
    allowAllValue: false,
    customAllValue: "",
  };
}

function parseStaticValues(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function draftFromVariable(variable: Variable): VariableDraft {
  const base = {
    ...emptyDraft(),
    name: variable.spec.name,
    label: variable.spec.display?.name ?? "",
    hidden: variable.spec.display?.hidden === true,
  };
  if (variable.kind === "TextVariable") {
    return {
      ...base,
      kind: "TextVariable" as const,
      value: variable.spec.value,
      constant: variable.spec.constant === true,
    };
  }
  const source = getListVariableSource(variable);
  return {
    ...base,
    kind: "ListVariable" as const,
    pluginKind:
      source.kind === "query" ? "ClickHouseSQLVariable" : "StaticListVariable",
    staticValues: source.kind === "static" ? source.values.join("\n") : "",
    query: source.kind === "query" ? source.query : "",
    defaultValue: Array.isArray(variable.spec.defaultValue)
      ? variable.spec.defaultValue.join(", ")
      : (variable.spec.defaultValue ?? ""),
    allowMultiple: variable.spec.allowMultiple === true,
    allowAllValue: variable.spec.allowAllValue === true,
    customAllValue: variable.spec.customAllValue ?? "",
  };
}

function variableFromDraft(draft: VariableDraft): Variable {
  const name = draft.name.trim();
  const display =
    draft.label.trim() || draft.hidden
      ? {
          ...(draft.label.trim() ? { name: draft.label.trim() } : {}),
          ...(draft.hidden ? { hidden: true } : {}),
        }
      : undefined;
  if (draft.kind === "TextVariable") {
    return {
      kind: "TextVariable",
      spec: {
        name,
        ...(display ? { display } : {}),
        value: draft.value,
        ...(draft.constant ? { constant: true } : {}),
      },
    };
  }
  const defaults = draft.defaultValue
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const defaultValue = draft.allowMultiple
    ? defaults.length > 0
      ? defaults
      : undefined
    : defaults[0];
  return {
    kind: "ListVariable",
    spec: {
      name,
      ...(display ? { display } : {}),
      ...(defaultValue !== undefined ? { defaultValue } : {}),
      ...(draft.allowMultiple ? { allowMultiple: true } : {}),
      ...(draft.allowAllValue ? { allowAllValue: true } : {}),
      ...(draft.allowAllValue && draft.customAllValue
        ? { customAllValue: draft.customAllValue }
        : {}),
      plugin:
        draft.pluginKind === "StaticListVariable"
          ? {
              kind: "StaticListVariable",
              spec: { values: parseStaticValues(draft.staticValues) },
            }
          : { kind: "ClickHouseSQLVariable", spec: { query: draft.query } },
    },
  };
}

function validateDraft(draft: VariableDraft, takenNames: string[]): string | null {
  const name = draft.name.trim();
  if (!VARIABLE_NAME_RE.test(name)) {
    return "Name must start with a letter or underscore and contain only letters, digits and underscores";
  }
  if (takenNames.includes(name)) {
    return `A variable named "${name}" already exists`;
  }
  if (draft.kind === "ListVariable") {
    if (
      draft.pluginKind === "StaticListVariable" &&
      parseStaticValues(draft.staticValues).length === 0
    ) {
      return "Add at least one value (one per line)";
    }
    if (draft.pluginKind === "ClickHouseSQLVariable" && !draft.query.trim()) {
      return "Query is required";
    }
  }
  return null;
}

function variableKindLabel(variable: Variable): string {
  if (variable.kind === "TextVariable") return "Text";
  const source = getListVariableSource(variable);
  return source.kind === "query" ? "Query list" : "Static list";
}

type PreviewState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "success"; options: string[]; truncated: boolean };

interface VariablesManagerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function VariablesManager({ open, onOpenChange }: VariablesManagerProps) {
  const variables =
    useDashboardStore((s) => s.dashboard?.spec.variables) ?? [];
  const updateVariables = useDashboardStore((s) => s.updateVariables);
  const { from, to } = useSearch({ from: "/_authenticated/_dashboard" });

  // null = list view; -1 = adding; >= 0 = editing that index.
  const [editIndex, setEditIndex] = useState<number | null>(null);
  const [draft, setDraft] = useState<VariableDraft>(emptyDraft());
  const [formError, setFormError] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewState>({ status: "idle" });

  const openList = () => {
    setEditIndex(null);
    setFormError(null);
    setPreview({ status: "idle" });
  };

  const startAdd = () => {
    setDraft(emptyDraft());
    setEditIndex(-1);
    setFormError(null);
    setPreview({ status: "idle" });
  };

  const startEdit = (index: number) => {
    const variable = variables[index];
    if (!variable) return;
    setDraft(draftFromVariable(variable));
    setEditIndex(index);
    setFormError(null);
    setPreview({ status: "idle" });
  };

  const handleDelete = (index: number) => {
    updateVariables(variables.filter((_, i) => i !== index));
  };

  const handleSubmit = () => {
    const takenNames = variables
      .filter((_, i) => i !== editIndex)
      .map((v) => v.spec.name);
    const error = validateDraft(draft, takenNames);
    if (error) {
      setFormError(error);
      return;
    }
    const variable = variableFromDraft(draft);
    if (editIndex === -1) {
      updateVariables([...variables, variable]);
    } else if (editIndex !== null) {
      updateVariables(variables.map((v, i) => (i === editIndex ? variable : v)));
    }
    openList();
  };

  const handlePreview = async () => {
    setPreview({ status: "loading" });
    try {
      const result = await runVariableOptionsQuery({
        data: { query: draft.query, from, to },
      });
      setPreview({
        status: "success",
        options: result.options,
        truncated: result.truncated,
      });
    } catch (error) {
      setPreview({
        status: "error",
        message: error instanceof Error ? error.message : "Query failed",
      });
    }
  };

  const patch = (changes: Partial<VariableDraft>) =>
    setDraft((prev) => ({ ...prev, ...changes }));

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) openList();
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        {editIndex === null ? (
          <>
            <DialogHeader>
              <DialogTitle>Variables</DialogTitle>
              <DialogDescription>
                Reference variables in panel SQL as $name. Changes are saved
                with the dashboard.
              </DialogDescription>
            </DialogHeader>
            {variables.length === 0 ? (
              <p className="py-4 text-sm text-muted-foreground">
                No variables yet.
              </p>
            ) : (
              <ul className="flex flex-col divide-y">
                {variables.map((variable, index) => (
                  <li
                    key={variable.spec.name}
                    className="flex items-center gap-2 py-2"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">
                        {variable.spec.name}
                      </div>
                      <div className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
                        {variableKindLabel(variable)}
                        {variable.kind === "ListVariable" &&
                          variable.spec.allowMultiple && (
                            <Badge variant="secondary">multi</Badge>
                          )}
                        {variable.kind === "ListVariable" &&
                          variable.spec.allowAllValue && (
                            <Badge variant="secondary">all</Badge>
                          )}
                        {variable.spec.display?.hidden && (
                          <Badge variant="secondary">hidden</Badge>
                        )}
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      aria-label={`Edit variable ${variable.spec.name}`}
                      onClick={() => startEdit(index)}
                    >
                      <Pencil />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      aria-label={`Delete variable ${variable.spec.name}`}
                      onClick={() => handleDelete(index)}
                    >
                      <Trash2 />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
            <DialogFooter>
              <Button variant="ghost" onClick={() => onOpenChange(false)}>
                Close
              </Button>
              <Button onClick={startAdd}>
                <Plus data-icon="inline-start" />
                Add Variable
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>
                {editIndex === -1 ? "Add variable" : "Edit variable"}
              </DialogTitle>
              <DialogDescription>
                Perses `capturingRegexp` and `sort` are accepted in dashboard
                specs but not applied in v1.
              </DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <Label>Kind</Label>
                <ToggleGroup
                  value={[draft.kind]}
                  onValueChange={(next: string[]) => {
                    const kind = next[0];
                    if (kind === "TextVariable" || kind === "ListVariable") {
                      patch({ kind });
                    }
                  }}
                  variant="outline"
                  size="sm"
                >
                  <ToggleGroupItem value="TextVariable">Text</ToggleGroupItem>
                  <ToggleGroupItem value="ListVariable">List</ToggleGroupItem>
                </ToggleGroup>
              </div>

              <div className="flex flex-col gap-2">
                <Label htmlFor="variable-name">Name</Label>
                <Input
                  id="variable-name"
                  value={draft.name}
                  onChange={(e) => patch({ name: e.target.value })}
                  placeholder="service"
                />
              </div>

              <div className="flex flex-col gap-2">
                <Label htmlFor="variable-label">Label</Label>
                <Input
                  id="variable-label"
                  value={draft.label}
                  onChange={(e) => patch({ label: e.target.value })}
                  placeholder="Optional display name"
                />
              </div>

              {draft.kind === "TextVariable" ? (
                <>
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="variable-value">Value</Label>
                    <Input
                      id="variable-value"
                      value={draft.value}
                      onChange={(e) => patch({ value: e.target.value })}
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <Label htmlFor="variable-constant">
                      Constant (not editable on the dashboard)
                    </Label>
                    <Switch
                      id="variable-constant"
                      size="sm"
                      checked={draft.constant}
                      onCheckedChange={(checked) => patch({ constant: checked })}
                    />
                  </div>
                </>
              ) : (
                <>
                  <div className="flex flex-col gap-2">
                    <Label>Options</Label>
                    <ToggleGroup
                      value={[draft.pluginKind]}
                      onValueChange={(next: string[]) => {
                        const pluginKind = next[0];
                        if (
                          pluginKind === "StaticListVariable" ||
                          pluginKind === "ClickHouseSQLVariable"
                        ) {
                          patch({ pluginKind });
                        }
                      }}
                      variant="outline"
                      size="sm"
                    >
                      <ToggleGroupItem value="StaticListVariable">
                        Static list
                      </ToggleGroupItem>
                      <ToggleGroupItem value="ClickHouseSQLVariable">
                        ClickHouse query
                      </ToggleGroupItem>
                    </ToggleGroup>
                  </div>

                  {draft.pluginKind === "StaticListVariable" ? (
                    <div className="flex flex-col gap-2">
                      <Label htmlFor="variable-static-values">
                        Values (one per line)
                      </Label>
                      <Textarea
                        id="variable-static-values"
                        value={draft.staticValues}
                        onChange={(e) => patch({ staticValues: e.target.value })}
                        placeholder={"prod\nstaging\ndev"}
                        rows={4}
                      />
                    </div>
                  ) : (
                    <div className="flex flex-col gap-2">
                      <Label htmlFor="variable-query">SQL query</Label>
                      <Textarea
                        id="variable-query"
                        value={draft.query}
                        onChange={(e) => patch({ query: e.target.value })}
                        placeholder="SELECT DISTINCT ServiceName FROM logs WHERE Timestamp BETWEEN {from:DateTime64} AND {to:DateTime64}"
                        rows={4}
                        className="font-mono text-xs"
                      />
                      <div>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={
                            !draft.query.trim() || preview.status === "loading"
                          }
                          onClick={handlePreview}
                        >
                          {preview.status === "loading"
                            ? "Loading…"
                            : "Preview options"}
                        </Button>
                      </div>
                      {preview.status === "error" && (
                        <p className="text-xs text-destructive">
                          {preview.message}
                        </p>
                      )}
                      {preview.status === "success" && (
                        <div className="max-h-32 overflow-y-auto rounded-md border px-2 py-1 text-xs">
                          {preview.options.length === 0 ? (
                            <p className="text-muted-foreground">No options</p>
                          ) : (
                            preview.options.map((option) => (
                              <div key={option} className="truncate">
                                {option}
                              </div>
                            ))
                          )}
                          {preview.truncated && (
                            <p className="text-muted-foreground">
                              First 1000 shown
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  <div className="flex flex-col gap-2">
                    <Label htmlFor="variable-default">
                      Default value{draft.allowMultiple ? "s (comma-separated)" : ""}
                    </Label>
                    <Input
                      id="variable-default"
                      value={draft.defaultValue}
                      onChange={(e) => patch({ defaultValue: e.target.value })}
                    />
                  </div>

                  <div className="flex items-center justify-between">
                    <Label htmlFor="variable-multi">Allow multiple values</Label>
                    <Switch
                      id="variable-multi"
                      size="sm"
                      checked={draft.allowMultiple}
                      onCheckedChange={(checked) =>
                        patch({ allowMultiple: checked })
                      }
                    />
                  </div>

                  <div className="flex items-center justify-between">
                    <Label htmlFor="variable-all">Allow "All" value</Label>
                    <Switch
                      id="variable-all"
                      size="sm"
                      checked={draft.allowAllValue}
                      onCheckedChange={(checked) =>
                        patch({ allowAllValue: checked })
                      }
                    />
                  </div>

                  {draft.allowAllValue && (
                    <div className="flex flex-col gap-2">
                      <Label htmlFor="variable-custom-all">
                        Custom "All" value (substituted raw)
                      </Label>
                      <Input
                        id="variable-custom-all"
                        value={draft.customAllValue}
                        onChange={(e) =>
                          patch({ customAllValue: e.target.value })
                        }
                        placeholder="Leave empty to expand all options"
                      />
                    </div>
                  )}
                </>
              )}

              <div className="flex items-center justify-between">
                <Label htmlFor="variable-hidden">Hidden</Label>
                <Switch
                  id="variable-hidden"
                  size="sm"
                  checked={draft.hidden}
                  onCheckedChange={(checked) => patch({ hidden: checked })}
                />
              </div>

              {formError && <p className="text-sm text-destructive">{formError}</p>}
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={openList}>
                Cancel
              </Button>
              <Button onClick={handleSubmit}>
                {editIndex === -1 ? "Add" : "Update"}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
```

Note: check `@everr/ui/components/badge` exists (it does — `badge.tsx`). If `Badge` has no `variant="secondary"`, use the default variant.

- [ ] **Step 2: Add the "Variables" button to dashboard-grid.tsx**

In `packages/app/src/components/dashboards/dashboard-grid.tsx`:

Add imports: `SlidersHorizontal` to the `lucide-react` import list, and:

```ts
import { VariablesManager } from "./variables-manager";
```

Add state near the other dialog state (after `const [manageAction, setManageAction] = ...`):

```ts
const [showVariablesManager, setShowVariablesManager] = useState(false);
```

In the toolbar, inside the `{isEditing && (<>...</>)}` fragment, add **before** the Add Panel button:

```tsx
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowVariablesManager(true)}
            >
              <SlidersHorizontal data-icon="inline-start" />
              Variables
            </Button>
```

Render the dialog next to the other dialogs (e.g. after `<DashboardSettingsDialog ... />`):

```tsx
      <VariablesManager
        open={showVariablesManager}
        onOpenChange={setShowVariablesManager}
      />
```

- [ ] **Step 3: Typecheck and run the suite**

Run: `cd packages/app && pnpm typecheck && pnpm exec vitest run src/data/dashboards/`
Expected: clean, all PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/app/src/components/dashboards/variables-manager.tsx packages/app/src/components/dashboards/dashboard-grid.tsx
git commit -m "feat(dashboards): add edit-mode variables manager dialog"
```

---

### Task 9: Full verification

- [ ] **Step 1: Full test suite**

Run: `cd packages/app && pnpm exec vitest run`
Expected: ALL PASS — 504 pre-existing + the new tests (interpolate ~15, variable-values ~16, store +1, server +6). Zero failures.

- [ ] **Step 2: Typecheck both affected packages**

Run: `cd packages/app && pnpm typecheck && cd ../desktop-app && pnpm exec tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Lint + dead-code over the whole change**

Run: `cd /Users/gio/workspace/everr-labs/everr && pnpm biome check packages/app/src/data/dashboards packages/app/src/components/dashboards packages/app/src/routes/_authenticated/_dashboard.tsx && pnpm exec fallow dead-code --fail-on-issues --quiet`
Expected: clean. Fix anything reported before proceeding.

---

### Task 10: Browser verification (end-to-end)

Follow the protocol in the spec's "Browser verification protocol" section exactly:
- Reuse the dev server on `:5173` (a second instance fails auth with "Invalid origin"). If it's not running, start it: `cd packages/app && pnpm dev` (background).
- Drive with `playwright-core` installed in a tmp dir + cached headless shell at `~/Library/Caches/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-mac-arm64/chrome-headless-shell`. Use `waitUntil: "load"`, never `networkidle`.
- Create a throwaway account via `/auth/sign-up` (complete the org "Continue" step), save `storageState`, reuse it across scripts. Do NOT query the dev Postgres `user` table.
- shadcn Switch ids sit on a hidden checkbox — click `label[for=...]`.
- Grid panel errors appear only after react-query exhausts retries — wait for `text=Failed to load data`.
- Synthetic series: `SELECT now() - INTERVAL number MINUTE AS time, number AS value FROM numbers(30)`.

Verify each of the following (screenshot or assert on DOM text per step):

- [ ] **1. Create a dashboard, open Edit → Variables. Create three variables:**
  - Text `suffix` with value `_suffix_test`.
  - Static list `env`, values `e0`/`e1`/`e2` (one per line), default `e0`, allowMultiple + allowAllValue.
  - Query list `n` with query `SELECT toString(number % 3) FROM numbers(30)` (verify Preview options shows `0`, `1`, `2` — deduped), single-select, no default.
- [ ] **2. Dirty tracking:** after adding variables, the dashboard blocks navigation (unsaved-changes dialog appears when navigating away; Stay). Save the dashboard; navigation no longer blocked; reload → variables persist.
- [ ] **3. Variable bar renders** between toolbar and grid with all three pickers; labels correct. `n` shows "Select…" (no default), `env` shows `e0`.
- [ ] **4. Single-select + picker-driven refetch:** add a panel with SQL `SELECT now() - INTERVAL number MINUTE AS time, number AS value FROM numbers(30) WHERE toString(number % 3) = $n`. Pick `n=1` in the bar → chart renders ~10 points; switch to `n=2` → panel refetches (data changes).
- [ ] **5. Multi-select + All:** add a panel with SQL `SELECT now() - INTERVAL number MINUTE AS time, number AS value FROM numbers(30) WHERE concat('e', toString(number % 3)) IN $env` — default `e0` shows ~10 points; select `e0`+`e1` → ~20 points; select All → all 30 rows (and the All checkbox clears individual selections); picking an individual value clears All.
- [ ] **6. URL round-trip:** the `vars` search param appears in the URL after picking; reloading the URL restores the selection; browser Back steps through prior selections.
- [ ] **7. Missing value:** create variable `req` (static list, NO default), reference `$req` in a panel → panel shows error card with `Select a value for $req` and no CH request is fired; picking a value renders the panel.
- [ ] **8. Options-query error state:** edit `n`'s query to `SELECT broken syntax (` → the picker shows the inline error state (destructive styling + message in title tooltip), NOT a toast.
- [ ] **9. Editor:** open a panel in the editor → compact variable bar shows under the header; preview uses current values; Run Query respects values; changing a value in the editor bar refetches the preview.
- [ ] **10. Hidden variable:** mark `suffix` hidden → it disappears from the bar but `$suffix` still interpolates (e.g. panel SQL `SELECT concat('a', ${suffix:raw}) AS x` — or simpler, verify a panel using it still renders).

Fix any bugs found (with a failing test first where the bug is in pure logic), re-verify, and commit fixes as `fix(dashboards): …`.

---

### Task 11: Update DASHBOARD_FEATURES.md

**Files:**
- Modify: `DASHBOARD_FEATURES.md` (repo root)

- [ ] **Step 1: Update the variables line**

Read the file first. Replace the line:

```
- 🟡 Schema defines `variables`, `datasources` — **no UI or runtime support yet** (schema-only, for Perses compatibility)
```

with:

```
- 🟡 Schema defines `datasources` — **no UI or runtime support yet** (schema-only, for Perses compatibility)
- ✅ Dashboard variables: TextVariable + ListVariable (static + ClickHouse-query-backed options), multi-select, "All" (with optional raw `customAllValue`), Grafana-style `$name`/`${name}`/`${name:raw}` tokens interpolated server-side, value state in a `vars` URL param, edit-mode Variables manager (dirty-tracked). Not in v1: variable chaining, `capturingRegexp`, `sort`, `var-<name>` URL aliases (tracked follow-up).
```

Adjust to the file's actual structure/section if it differs — keep the content (what shipped, what's deferred).

- [ ] **Step 2: Commit**

```bash
git add DASHBOARD_FEATURES.md
git commit -m "docs: mark dashboard variables as implemented"
```

---

## Self-review notes (already applied)

- Spec §1–§7 each map to tasks 1–8; §8 (out of scope) is reflected in the manager's form note and the features doc; §9 test list is covered by tasks 1–4 + browser task 10.
- `panelQueryOptions(sql, from, to)` legacy call sites are all updated in task 7 (the only callers are `dashboard-panel.tsx` and `panel-edit-page.tsx`); `variables ?? null` keeps existing cache keys stable for panels without variables (callers pass `undefined` when no tokens are used).
- Type names are consistent across tasks: `VariableValues`/`VariableMeta`/`VariableAllMeta`/`ALL_VALUE` from `interpolate.ts`; `VARIABLE_NAME_RE`/`getListVariableSource`/`effectiveVariableValues`/`buildAllMeta`/`pickByNames` from `variable-values.ts`; `useDashboardVariables`/`VariableOptionsState` from `use-dashboard-variables.ts`.
- Fallow: every new export is consumed by a test or component in the same commit; schema.ts is already blanket-ignored.
