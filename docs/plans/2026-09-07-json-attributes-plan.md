# JSON Attribute Columns Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The attribute columns of `app.logs` and `app.traces`, and of the local store, become `JSON` columns with typed values and a keys array each, exactly as the upstream ClickHouse exporter writes them, and every query surface reads them through one path form.

**Architecture:** The landing tables take upstream's JSON column set and the exporter runs with `json: true`. The views pass the columns through; the app table's column type carries the path limit and the retention `SKIP`. On the read side one helper module renders a path as a quoted identifier, because only that form reads a subcolumn, and one function flattens the nested object ClickHouse returns into the flat map the UI expects. The dashboard catalog and the repo's as-code resources are SQL text and get the same rewrite. Metrics keep their maps.

**Tech Stack:** ClickHouse 26.5 and chDB 26.5, upstream `clickhouseexporter` v0.160.0 and the fork in `collector/exporter/chdbexporter`, TypeScript with vitest and biome in `packages/telemetry-explorer` and `packages/app`, Go with `make lint` (`.tools/golangci-lint`) in the collector modules.

**Spec:** `docs/plans/2026-09-07-json-attributes.md`. The measurements, the ClickHouse facts and the decisions live there; this plan does not repeat them.

## Global Constraints

- Never mention Claude, Anthropic or AI assistance in commits, PR text or code comments. No `Co-Authored-By` trailers.
- Docs and comments use ASD-STE100 Simplified Technical English. No em dashes or en dashes anywhere in docs.
- No docker test suites locally. Container checks run on a throwaway container built from `clickhouse/Dockerfile`, never on the dev stack, and are removed afterwards.
- Work happens in the worktree `/Users/gio/.herdr/worktrees/everr/ttl-improvements` on branch `gio/json-attributes`, created on top of `ttl-improvements` so the change is reviewed in isolation as a stacked pull request. One commit per task, messages as given. Never switch branches, rebase or push from a task.
- Use `/usr/bin/grep` and `/bin/ls` in this shell: `grep` and `ls` are aliased to tools with other flags.
- `max_dynamic_paths = 256` on every JSON attribute column, cloud and local. The value stays an open decision until the production shadow table (Task 10) is read.
- Never run `everr apply` for the user. The `everr/` resources are committed; the user applies them after the cut-over.

## Facts the rewrite rests on, verified on 26.5

- **The key is an identifier, not a parameter.** `` col.`key` `` reads only that path's subcolumn. `getSubcolumn(col, {key:String})` reads the whole JSON column, with or without `optimize_functions_to_subcolumns`. So a generated query puts the key into the SQL text, escaped, and keeps values and the keys-array test as parameters. `has(colKeys, {key:String})` prunes through the bloom index like a literal does.
- **`toString()` around every read.** Values are typed, so `LogAttributes.status` is an `Int64` for one producer and a `String` for another. `toString(...)` makes every comparison string equality, which is what the Map gave, and reads the same subcolumn. Its result type is `String`, not `Nullable(String)`, and a missing path gives `''`. So `toString(col.`k`) = ''` and `!= ''` keep the Map's meaning, absence included, and `GROUP BY toString(...)` works. The raw path is `Dynamic`: `col.`k` IS NULL` is true for a missing key, a `GROUP BY` on it is refused, and a numeric comparison on it fails with `NO_COMMON_TYPE` when the rows it runs over hold both an `Int64` and a `String`. Verified with two tenants in one merged part, one storing numbers and one storing text: the number tenant's `col.`k` >= 500` works, because the tenant filter runs first and only its rows reach the comparison; the text tenant's fails, as `'500' >= 500` fails on any `String` column; a tenant whose own rows mix the two types fails too. Equality with a text literal works on both.
- **Numbers go through text.** `toUInt32OrZero(col.`k`)` fails on an `Int64` value; the `OrZero` family takes only strings. `toUInt32OrZero(toString(col.`k`))` and `toFloat64OrZero(toString(col.`k`))` give the same result whatever the stored type, and 0 when the key is missing. `toFloat64(col.`k`)` also works on mixed rows, but throws on text that is not a number. A typed subcolumn such as `col.`k`.:Int64` is `NULL` whenever the stored type is anything else.
- **Views use `getSubcolumn`.** Inside a UDF body or a view, the argument is a block already in memory, so reading the whole JSON value costs nothing on disk, and `getSubcolumn(x, 'path')` avoids the question of how a compound identifier resolves against a lambda parameter. `toString(getSubcolumn(...))` is a plain `String` in `CREATE TABLE ... AS SELECT`, so `tenant_id` keeps its type and its place in the sort key.
- **The `SKIP` on the app table applies on insert.** A `JSON(max_dynamic_paths = 256)` block from the landing table goes through the view into a `JSON(max_dynamic_paths = 256, SKIP `everr.retention.days`)` column and the path is dropped from the document. The keys array is a separate column and needs its own filter.
- **The UI gets a nested object.** ClickHouse returns a JSON column over `JSONEachRow` as `{"http":{"route":"/x"}}` for a key `http.route`, and there is no cast from JSON to a flat Map. `flattenAttributes()` joins the nesting with dots on the client. 64-bit integers arrive quoted, so every leaf is stringified without loss.
- **The dashboard catalog and the `everr/` resources are text.** Every attribute read there is `X['k']` in a value position, so one regular expression turns them into `` toString(X.`k`) `` with the same meaning.

## Names used across tasks

- `jsonPath(column, key)` renders `` column.`key` `` with backticks and backslashes in the key escaped.
- `attributeText(column, key)` renders `` toString(column.`key`) ``.
- `attributeKeysColumn(column)` renders `columnKeys`.
- `attributeExists(column, key)` renders `has(columnKeys, 'key')` with the key as an escaped literal.
- `flattenAttributes(value: unknown): Record<string, string>`.
- All five live in `packages/telemetry-explorer/src/sql/json-attributes.ts` and are exported from the package as `@everr/telemetry-explorer/sql`.
- ClickHouse UDFs in `clickhouse/init/05-create-retention-functions.sql`: `everrRetentionDaysJson(resourceAttributes)` and `everrStripRetentionKeys(keys)`. `everrRetentionDays` and `everrStripRetention` stay for the metrics views.
- ClickHouse UDF in `clickhouse/init/04-create-error-fingerprint-function.sql`: `errorFingerprint(serviceName, fingerprint, exceptionType, exceptionMessage)`, four text arguments instead of the map.

---

### Task 1: The path helpers in the explorer package

**Files:**
- Create: `packages/telemetry-explorer/src/sql/json-attributes.ts`
- Create: `packages/telemetry-explorer/src/sql/json-attributes.test.ts`
- Create: `packages/telemetry-explorer/src/sql/index.ts`
- Modify: `packages/telemetry-explorer/package.json` (the `exports` map)

**Interfaces:**
- Produces: the five functions listed under "Names used across tasks", importable inside the package from `../../sql/json-attributes` and from outside as `@everr/telemetry-explorer/sql`.

- [ ] **Step 1: Write the failing tests**

```ts
// packages/telemetry-explorer/src/sql/json-attributes.test.ts
import { describe, expect, it } from "vitest";
import {
  attributeExists,
  attributeKeysColumn,
  attributeText,
  flattenAttributes,
  jsonPath,
} from "./json-attributes";

describe("jsonPath", () => {
  it("renders the key as a quoted identifier after the column", () => {
    expect(jsonPath("LogAttributes", "http.route")).toBe(
      "LogAttributes.`http.route`",
    );
  });

  it("escapes backticks and backslashes inside the key", () => {
    expect(jsonPath("LogAttributes", "a`b")).toBe("LogAttributes.`a\\`b`");
    expect(jsonPath("LogAttributes", "a\\b")).toBe("LogAttributes.`a\\\\b`");
  });

  it("leaves quotes, spaces and dots as they are", () => {
    expect(jsonPath("SpanAttributes", "it's a key")).toBe(
      "SpanAttributes.`it's a key`",
    );
  });
});

describe("attributeText", () => {
  it("wraps the path in toString so comparisons are string equality", () => {
    expect(attributeText("LogAttributes", "status")).toBe(
      "toString(LogAttributes.`status`)",
    );
  });
});

describe("attributeKeysColumn and attributeExists", () => {
  it("names the keys column next to the attribute column", () => {
    expect(attributeKeysColumn("LogAttributes")).toBe("LogAttributesKeys");
  });

  it("tests presence on the keys column with an escaped literal", () => {
    expect(attributeExists("LogAttributes", "http.route")).toBe(
      "has(LogAttributesKeys, 'http.route')",
    );
    expect(attributeExists("LogAttributes", "it's")).toBe(
      "has(LogAttributesKeys, 'it\\'s')",
    );
  });
});

describe("flattenAttributes", () => {
  it("joins nested objects with dots and stringifies every leaf", () => {
    expect(
      flattenAttributes({
        http: { route: "/x", response: { status_code: 500 } },
        ok: true,
      }),
    ).toEqual({
      "http.route": "/x",
      "http.response.status_code": "500",
      ok: "true",
    });
  });

  it("returns an empty map for null, undefined, arrays and scalars", () => {
    expect(flattenAttributes(null)).toEqual({});
    expect(flattenAttributes(undefined)).toEqual({});
    expect(flattenAttributes(["a"])).toEqual({});
    expect(flattenAttributes("x")).toEqual({});
  });

  it("keeps array leaves as JSON text and skips null leaves", () => {
    expect(flattenAttributes({ tags: ["a", "b"], gone: null })).toEqual({
      tags: '["a","b"]',
    });
  });

  it("passes a flat map through unchanged", () => {
    expect(flattenAttributes({ "service.name": "api" })).toEqual({
      "service.name": "api",
    });
  });
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `cd packages/telemetry-explorer && pnpm vitest run src/sql/json-attributes.test.ts`
Expected: FAIL, the module does not exist.

- [ ] **Step 3: Write the module**

```ts
// packages/telemetry-explorer/src/sql/json-attributes.ts

// Attribute columns on logs and traces are ClickHouse JSON columns. A path is
// read as `column.`key``: that form reads only the path's subcolumn, while
// getSubcolumn(column, {key:String}) reads the whole column, so the key goes
// into the SQL text as an identifier and never into a parameter. Quoted
// identifiers and string literals both use backslash escapes.
function quoteIdentifier(name: string): string {
  return `\`${name.replace(/\\/g, "\\\\").replace(/`/g, "\\`")}\``;
}

function quoteLiteral(value: string): string {
  return `'${value.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
}

export function jsonPath(column: string, key: string): string {
  return `${column}.${quoteIdentifier(key)}`;
}

// Values are typed, so a read goes through toString: string equality whatever
// the producer sent, the same subcolumn read, and '' for a missing key, which
// is what the Map column gave.
export function attributeText(column: string, key: string): string {
  return `toString(${jsonPath(column, key)})`;
}

export function attributeKeysColumn(column: string): string {
  return `${column}Keys`;
}

// Presence is tested on the keys array, which the bloom index serves. A test
// on the value reads the subcolumn of every granule instead.
export function attributeExists(column: string, key: string): string {
  return `has(${attributeKeysColumn(column)}, ${quoteLiteral(key)})`;
}

// ClickHouse returns a JSON column as a nested object: a key `http.route`
// comes back as {"http":{"route":...}}. OTel attribute keys are flat, so the
// nesting is undone by joining with dots. Every leaf becomes text; 64-bit
// integers already arrive quoted.
export function flattenAttributes(value: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return out;
  }
  const walk = (node: Record<string, unknown>, prefix: string) => {
    for (const [name, leaf] of Object.entries(node)) {
      const key = prefix ? `${prefix}.${name}` : name;
      if (leaf === null || leaf === undefined) continue;
      if (Array.isArray(leaf)) {
        out[key] = JSON.stringify(leaf);
        continue;
      }
      if (typeof leaf === "object") {
        walk(leaf as Record<string, unknown>, key);
        continue;
      }
      out[key] = String(leaf);
    }
  };
  walk(value as Record<string, unknown>, "");
  return out;
}
```

```ts
// packages/telemetry-explorer/src/sql/index.ts
export {
  attributeExists,
  attributeKeysColumn,
  attributeText,
  flattenAttributes,
  jsonPath,
} from "./json-attributes";
```

In `packages/telemetry-explorer/package.json`, the `exports` map is alphabetical (`./errors`, `./filters`, `./logs`, `./runs`, `./styles.css`, `./traces`). Add between `./runs` and `./styles.css`:

```json
    "./sql": "./src/sql/index.ts",
```

- [ ] **Step 4: Run the tests and the type check**

Run: `cd packages/telemetry-explorer && pnpm vitest run src/sql/json-attributes.test.ts && pnpm typecheck`
Expected: 10 tests pass, `tsc` clean.

- [ ] **Step 5: Commit**

```bash
git add packages/telemetry-explorer/src/sql/json-attributes.ts packages/telemetry-explorer/src/sql/json-attributes.test.ts packages/telemetry-explorer/src/sql/index.ts packages/telemetry-explorer/package.json
git commit -m "feat(explorer): add the JSON attribute path helpers"
```

---

### Task 2: The shared attribute filter module

**Files:**
- Modify: `packages/telemetry-explorer/src/attribute-filter/sql/where.ts`
- Modify: `packages/telemetry-explorer/src/attribute-filter/sql/keys.ts:44`
- Modify: `packages/telemetry-explorer/src/attribute-filter/sql/values.ts:36-62`
- Test: `packages/telemetry-explorer/src/attribute-filter/sql/where.test.ts`, `keys.test.ts`, `values.test.ts`
- Test: `packages/telemetry-explorer/src/logs/sql/where.test.ts:59,79,90,102`, `packages/telemetry-explorer/src/errors/sql/issues.test.ts:32,47`, `packages/telemetry-explorer/src/traces/data/repository.test.ts:420,442`

**Interfaces:**
- Consumes: `attributeKeysColumn`, `attributeText` from Task 1.
- Produces: the same three exported functions with the same signatures. `columnFor(source)` keeps returning the attribute column name; the keys column is derived from it. The callers in `logs`, `traces` and `errors` need no change. There is no metrics caller (`/usr/bin/grep -rn 'buildAttribute' packages --include='*.ts'` shows only those three domains), which matters because metrics keep their maps.

- [ ] **Step 1: Update the tests to the JSON shapes**

In `where.test.ts`, replace the expected strings:

```ts
    // in
    expect(clauses[0]).toBe(
      "has(ResourceAttributesKeys, {attrKey0:String}) AND toString(ResourceAttributes.`deployment.environment`) IN {attrVals0:Array(String)}",
    );
    // not_in
    expect(clauses[0]).toBe(
      "(has(LogAttributesKeys, {attrKey0:String}) AND toString(LogAttributes.`http.method`) NOT IN {attrVals0:Array(String)})",
    );
    // exists
    expect(exists.clauses[0]).toBe("has(ScopeAttributesKeys, {attrKey0:String})");
    // missing
    expect(missing.clauses[0]).toBe("NOT has(SpanAttributesKeys, {attrKey0:String})");
    // startIndex
    expect(clauses[0]).toBe("has(ResourceAttributesKeys, {attrKey3:String})");
```

and add one test:

```ts
  it("escapes the key in the identifier and leaves the param as typed", () => {
    const { clauses, params } = buildAttributeClauses(
      [{ source: "log", key: "a`b", op: "in", values: ["x"] }],
      columnFor,
    );
    expect(clauses[0]).toBe(
      "has(LogAttributesKeys, {attrKey0:String}) AND toString(LogAttributes.`a\\`b`) IN {attrVals0:Array(String)}",
    );
    expect(params.attrKey0).toBe("a`b");
  });
```

In `keys.test.ts`, the first test:

```ts
    expect(sql).toContain("arrayJoin(ResourceAttributesKeys)");
    expect(sql).toContain("arrayJoin(SpanAttributesKeys)");
    expect(sql).not.toContain("mapKeys(");
```

In `values.test.ts`, the first two tests:

```ts
    expect(sql).toContain("toString(SpanAttributes.`http.route`) AS v");
    expect(sql).toContain("has(SpanAttributesKeys, {key:String})");
```

```ts
    expect(sql).toContain(
      "positionCaseInsensitive(toString(SpanAttributes.`http.route`), {valueSearch:String}) > 0",
    );
```

The domain tests assert the same strings through their own WHERE builders. Change them to the same shapes:

| File and line | New expected string |
|---|---|
| `logs/sql/where.test.ts:59` | `has(ResourceAttributesKeys, {attrKey0:String})` |
| `logs/sql/where.test.ts:79` | `` (has(LogAttributesKeys, {attrKey0:String}) AND toString(LogAttributes.`<the key the test uses>`) NOT IN {attrVals0:Array(String)}) `` |
| `logs/sql/where.test.ts:90` | `has(ScopeAttributesKeys, {attrKey0:String})` |
| `logs/sql/where.test.ts:102` | `NOT has(ResourceAttributesKeys, {attrKey0:String})` |
| `errors/sql/issues.test.ts:32` | `has(ResourceAttributesKeys, {attrKey0:String})` |
| `errors/sql/issues.test.ts:47` | `has(LogAttributesKeys, {attrKey0:String})` |
| `traces/data/repository.test.ts:420` | `has(SpanAttributesKeys, {attrKey0:String})` |
| `traces/data/repository.test.ts:442` | `has(SpanAttributesKeys,` |

- [ ] **Step 2: Run the test files to see them fail**

Run: `cd packages/telemetry-explorer && pnpm vitest run src/attribute-filter/sql src/logs/sql/where.test.ts src/errors/sql/issues.test.ts src/traces/data/repository.test.ts`
Expected: the updated assertions fail on the old `mapContains` and `[...]` strings.

- [ ] **Step 3: Rewrite `where.ts`**

```ts
import {
  attributeKeysColumn,
  attributeText,
} from "../../sql/json-attributes";
import type { AttributeFilter, AttributeSource } from "../schemas";

// Builds the attribute predicates shared by every domain's WHERE clause.
// `columnFor` maps a source to its JSON attribute column. The key goes into
// the SQL text as a quoted identifier, because only `col.`key`` reads that
// path's subcolumn, and into a parameter for the keys-array test, which the
// bloom index prunes. `startIndex` lets a caller that already has positional
// params avoid name collisions. Param names are `attrKey{i}` / `attrVals{i}`.
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
    const exists = `has(${attributeKeysColumn(column)}, {${keyParam}:String})`;
    const text = attributeText(column, filter.key);

    switch (filter.op) {
      case "in":
        if (filter.values.length === 0) return;
        params[keyParam] = filter.key;
        clauses.push(`${exists} AND ${text} IN {${valsParam}:Array(String)}`);
        params[valsParam] = filter.values;
        break;
      case "not_in":
        // Require the key to exist: "is not" means present with a different
        // value, not absent. The dedicated `missing` op covers absence, which
        // keeps the four operators a clean partition: in plus not_in equals
        // exists.
        if (filter.values.length === 0) return;
        params[keyParam] = filter.key;
        clauses.push(
          `(${exists} AND ${text} NOT IN {${valsParam}:Array(String)})`,
        );
        params[valsParam] = filter.values;
        break;
      case "exists":
        params[keyParam] = filter.key;
        clauses.push(exists);
        break;
      case "missing":
        params[keyParam] = filter.key;
        clauses.push(`NOT ${exists}`);
        break;
    }
  });

  return { clauses, params };
}
```

If the current file carries other comment lines above the function (the module header), keep them and change only what describes the map.

- [ ] **Step 4: Rewrite the one line in `keys.ts`**

Add the import `import { attributeKeysColumn } from "../../sql/json-attributes";` and change line 44 to:

```ts
          SELECT DISTINCT arrayJoin(${attributeKeysColumn(opts.columnFor(source))}) AS key, '${source}' AS source
```

Change the comment above `ATTRIBUTE_KEY_PER_SOURCE_LIMIT` so it says the list reads the keys array column, not the attribute column, which is why it costs a few MiB per source.

- [ ] **Step 5: Rewrite the value query in `values.ts`**

Add the import `import { attributeKeysColumn, attributeText } from "../../sql/json-attributes";` and replace the body from `const column = ...` to the `sql` template with:

```ts
  const column = opts.columnFor(input.source);
  const value = attributeText(column, input.key);
  const { fromISO, toISO } = resolveTimeRange(input.timeRange);
  const params: Record<string, unknown> = {
    fromTime: fromISO,
    toTime: toISO,
    key: input.key,
  };
  const filters = [
    `${timeColumn} >= ${timeBound("fromTime")}`,
    `${timeColumn} <= ${timeBound("toTime")}`,
    `has(${attributeKeysColumn(column)}, {key:String})`,
    `${value} != ''`,
  ];
  if (opts.rowPredicate) {
    filters.push(`(${opts.rowPredicate})`);
  }
  // Server-side substring match so high-cardinality values past the LIMIT
  // cutoff remain reachable: the user types and the matching slice is fetched.
  const search = input.search?.trim();
  if (search) {
    filters.push(
      `positionCaseInsensitive(${value}, {valueSearch:String}) > 0`,
    );
    params.valueSearch = search;
  }
  const sql = `
      SELECT DISTINCT ${value} AS v
      FROM ${opts.tableName}
      WHERE ${filters.join("\n        AND ")}
      ORDER BY v
      LIMIT ${VALUE_LIMIT}
      `;
  return { sql, params };
```

Keep the names `timeColumn`, `timeBound`, `resolveTimeRange` and `VALUE_LIMIT` as the file defines them. `input.key` stays in `params.key` for the `has()` test; the identifier form carries it a second time in the text.

- [ ] **Step 6: Run the package suite and the type check**

Run: `cd packages/telemetry-explorer && pnpm vitest run && pnpm typecheck`
Expected: pass.

- [ ] **Step 7: Commit**

```bash
git add packages/telemetry-explorer/src/attribute-filter packages/telemetry-explorer/src/logs/sql/where.test.ts packages/telemetry-explorer/src/errors/sql/issues.test.ts packages/telemetry-explorer/src/traces/data/repository.test.ts
git commit -m "feat(explorer): build attribute filters against the JSON columns"
```

---

### Task 3: The explorer's other readers and decoders

**Files:**
- Modify: `packages/telemetry-explorer/src/sql/resource-attributes.ts`
- Modify: `packages/telemetry-explorer/src/errors/sql/fingerprint.ts:8-17`
- Modify: `packages/telemetry-explorer/src/errors/sql/issues.ts:45-46,108-109,165-167`
- Modify: `packages/telemetry-explorer/src/errors/data/repository.ts:47-52,64-72`
- Modify: `packages/telemetry-explorer/src/logs/sql/detail.ts:15-17,58-60`
- Modify: `packages/telemetry-explorer/src/traces/data/repository.ts:34-41,49-59,364-389`
- Modify: `packages/telemetry-explorer/src/errors/ui/error-handoff-button.tsx:16`
- Test: `packages/telemetry-explorer/src/logs/sql/detail.test.ts`, `packages/telemetry-explorer/src/errors/data/repository.test.ts`, `packages/telemetry-explorer/src/traces/data/repository.test.ts:198,201,221,224,383`

**Interfaces:**
- Consumes: `attributeExists`, `attributeText`, `flattenAttributes` from Task 1.
- Produces: `ERROR_FINGERPRINT_SQL` with the four-argument UDF call that Task 6 defines: `` errorFingerprint(ServiceName, toString(LogAttributes.`error.fingerprint`), toString(LogAttributes.`exception.type`), toString(LogAttributes.`exception.message`)) ``. The `LogDetail`, `ErrorOccurrence` and `Span` types keep `Record<string, string>` attributes, so the UI and the desktop app do not change.

- [ ] **Step 1: Write the decoder tests**

In `logs/sql/detail.test.ts`, add:

```ts
  it("flattens the nested JSON attributes into dotted keys", () => {
    const detail = mapDetailRow({
      timestampRaw: "2026-09-07 10:00:00.000000000",
      level: "info",
      severityText: "INFO",
      severityNumber: 9,
      serviceName: "api",
      traceId: "",
      spanId: "",
      resourceAttributes: { service: { name: "api" } },
      logAttributes: { http: { response: { status_code: 500 } } },
      scopeAttributes: null,
    });
    expect(detail.resourceAttributes).toEqual({ "service.name": "api" });
    expect(detail.logAttributes).toEqual({
      "http.response.status_code": "500",
    });
    expect(detail.scopeAttributes).toEqual({});
  });
```

Use the same `LogLevel` value and the same field set the file's other `mapDetailRow` tests use if they differ from the above.

In `traces/data/repository.test.ts`, add a test that goes through the repository with the file's mock client returning one span row whose `spanAttributes` is `{ http: { route: "/x" } }`, whose `resourceAttributes` is `{ service: { name: "api" } }`, whose `eventAttributes` is `[{ exception: { type: "E" } }]`, and whose `linkAttributes` is `[]`, and expects `spanAttributes` to equal `{ "http.route": "/x" }`, `resourceAttributes` to equal `{ "service.name": "api" }`, and `events[0].attributes` to equal `{ "exception.type": "E" }`. Follow the mock pattern the file already uses for the trace query.

In `errors/data/repository.test.ts`, the same for one occurrence row through the repository call that lists occurrences: `logAttributes: { exception: { type: "E" } }` decodes to `{ "exception.type": "E" }`.

Also change the lines that assert the namespace filter to the shapes the helpers produce: lines 198 and 221 to `has(ResourceAttributesKeys, 'service.namespace')`, lines 201 and 224 to `` toString(ResourceAttributes.`service.namespace`) IN {namespace:Array(String)} ``, line 383 to `` toString(ResourceAttributes.`service.namespace`) ``.

- [ ] **Step 2: Run them to see them fail**

Run: `cd packages/telemetry-explorer && pnpm vitest run src/logs/sql/detail.test.ts src/traces/data/repository.test.ts src/errors/data/repository.test.ts`
Expected: FAIL, the nested objects pass through unflattened and the namespace strings still carry the map form.

- [ ] **Step 3: Rewrite the readers**

`sql/resource-attributes.ts`:

```ts
import { attributeExists, attributeText } from "./json-attributes";

export function resourceAttribute(key: string): string {
  return attributeText("ResourceAttributes", key);
}

export function resourceAttributeKeyExists(key: string): string {
  return attributeExists("ResourceAttributes", key);
}
```

Keep the doc comments the file has on the two functions, with `` toString(ResourceAttributes.`key`) `` and `has(ResourceAttributesKeys, 'key')` in place of the map forms.

`errors/sql/fingerprint.ts`, the two constants:

```ts
import { attributeExists, attributeText } from "../../sql/json-attributes";

// Everr's stable identity for an Error. The expression lives in the
// `errorFingerprint` ClickHouse UDF
// (clickhouse/init/04-create-error-fingerprint-function.sql and the local
// collector's copy), so the web app, local collector, agents, and skills all
// group Errors identically instead of each carrying a copy of the SQL. Callers
// pass ServiceName and the three attributes the UDF reads, each as text, so
// the query reads three subcolumns and never the whole LogAttributes column.
export const ERROR_FINGERPRINT_SQL = `errorFingerprint(ServiceName, ${attributeText("LogAttributes", "error.fingerprint")}, ${attributeText("LogAttributes", "exception.type")}, ${attributeText("LogAttributes", "exception.message")})`;

export const EXCEPTION_LOG_FILTER_SQL = `
  ${attributeExists("ResourceAttributes", "service.name")}
  AND SeverityNumber >= 17
  AND (
    ${attributeExists("LogAttributes", "exception.type")}
    OR ${attributeExists("LogAttributes", "exception.message")}
  )
`;
```

`errors/sql/issues.ts`: replace `LogAttributes['exception.type']` with `` toString(LogAttributes.`exception.type`) `` and the same for `exception.message` and `exception.stacktrace` on lines 45, 46, 108, 109, 165, 166 and 167. Lines 69 to 71 and 168 to 170 keep selecting the whole columns.

`errors/data/repository.ts`:

```ts
type ErrorOccurrenceRow = Omit<
  ErrorOccurrence,
  "timestampRank" | "resourceAttributes" | "logAttributes" | "scopeAttributes"
> & {
  timestampRank?: string | number;
  resourceAttributes: unknown;
  logAttributes: unknown;
  scopeAttributes: unknown;
};
```

```ts
function mapOccurrence(row: ErrorOccurrenceRow): ErrorOccurrence {
  return {
    ...row,
    timestampRank:
      row.timestampRank === undefined ? 1 : Number(row.timestampRank),
    resourceAttributes: flattenAttributes(row.resourceAttributes),
    logAttributes: flattenAttributes(row.logAttributes),
    scopeAttributes: flattenAttributes(row.scopeAttributes),
  };
}
```

with `import { flattenAttributes } from "../../sql/json-attributes";`.

`logs/sql/detail.ts`: the three `DetailRowRaw` fields become `unknown`, and `mapDetailRow` uses `flattenAttributes(row.resourceAttributes)`, `flattenAttributes(row.logAttributes)` and `flattenAttributes(row.scopeAttributes)` in place of the `?? {}` lines. Import `flattenAttributes` from `"../../sql/json-attributes"`.

`traces/data/repository.ts`:

```ts
import { attributeText, flattenAttributes } from "../../sql/json-attributes";

type SpanRow = Omit<
  Span,
  "events" | "links" | "spanAttributes" | "resourceAttributes"
> & {
  spanAttributes: unknown;
  resourceAttributes: unknown;
  eventNames: string[];
  eventTimestamps: string[];
  eventAttributes: unknown[];
  linkTraceIds: string[];
  linkSpanIds: string[];
  linkAttributes: unknown[];
};
```

```ts
// The HTTP status code of the root span. `http.response.status_code` is the
// stable OpenTelemetry attribute. `http.status_code` is the name before version
// 1.23 that some SDKs still send.
//
// toString of a missing path is '' in ClickHouse, the same as a key absent
// from a Map. The second choice is therefore a test for an empty string, and
// no test for null is necessary. A span that is not an HTTP span gives ''.
const ROOT_HTTP_STATUS_CODE_SQL = `if(
  ${attributeText("SpanAttributes", "http.response.status_code")} != '',
  ${attributeText("SpanAttributes", "http.response.status_code")},
  ${attributeText("SpanAttributes", "http.status_code")}
)`;
```

```ts
function rowToSpan(row: SpanRow): Span {
  const {
    spanAttributes,
    resourceAttributes,
    eventNames,
    eventTimestamps,
    eventAttributes,
    linkTraceIds,
    linkSpanIds,
    linkAttributes,
    ...rest
  } = row;
  return {
    ...rest,
    spanAttributes: flattenAttributes(spanAttributes),
    resourceAttributes: flattenAttributes(resourceAttributes),
    events: eventNames.map((name, i) => ({
      name,
      timestamp: eventTimestamps[i] ?? "",
      attributes: flattenAttributes(eventAttributes[i]),
    })),
    links: linkTraceIds.map((traceId, i) => ({
      traceId,
      spanId: linkSpanIds[i] ?? "",
      attributes: flattenAttributes(linkAttributes[i]),
    })),
  };
}
```

`errors/ui/error-handoff-button.tsx` line 16 becomes:

```ts
    "  toString(LogAttributes.`exception.stacktrace`) AS stacktrace",
```

- [ ] **Step 4: Run the package suite, the type checks, and the desktop app's**

Run: `cd packages/telemetry-explorer && pnpm vitest run && pnpm typecheck && cd ../desktop-app && pnpm exec tsc --noEmit`
Expected: all pass. Where a test asserts an old string such as `LogAttributes['exception.type']`, update it to the new shape given above.

- [ ] **Step 5: Commit**

```bash
git add packages/telemetry-explorer/src
git commit -m "feat(explorer): read attributes from the JSON columns"
```

---

### Task 4: The app's run, workflow and repository queries

**Files:**
- Modify: `packages/app/src/data/run-query-helpers.ts`
- Modify: `packages/app/src/data/repo-detail/server.ts` (lines 27-35, 78-84, 122-124, 152-163, 199-212, 254-264)
- Modify: `packages/app/src/data/runs/server.ts` (lines 41, 46, 67, 108, 208-219, 281-291, 397-408)
- Modify: `packages/app/src/data/workflows/server.ts` (lines 40, 75, 106, 121, 202-204, 273-274, 310-320, 388, 423-424)
- Modify: `packages/app/src/data/resource-usage.ts` (lines 224-228 only)
- Modify: `packages/app/src/data/runs-list/server.ts` (lines 320-324)
- Modify: `packages/app/src/data/home/server.ts` (lines 194-196, 202-203)
- Modify: `packages/app/src/data/cost-analysis/server.ts` (lines 69, 139, 145, 242)
- Modify: `packages/app/src/data/dashboards/built-in/capabilities.ts` (lines 130-136, 220-222, 271)
- Test: `packages/app/src/data/run-query-helpers.test.ts:13,15,23`, `packages/app/src/data/dashboards/built-in/capabilities.test.ts:54,68`, `packages/app/src/data/logs-explorer/server.test.ts:65`, `packages/app/src/data/runs-list.test.ts:267,270`, `packages/app/src/data/cost-analysis/server.test.ts:31-71`

**Interfaces:**
- Consumes: `attributeExists`, `attributeText` from `@everr/telemetry-explorer/sql` (Task 1).
- Produces: nothing new. The helper names in `run-query-helpers.ts` stay.

The rewrite follows four rules. Every listed line matches one of them.

| Rule | Before | After |
|---|---|---|
| R1, a value read or compared | `ResourceAttributes['k']` | `` toString(ResourceAttributes.`k`) `` |
| R2, a presence test | `mapContains(ResourceAttributes, 'k')` | `has(ResourceAttributesKeys, 'k')` |
| R3, a number | `toUInt32OrZero(SpanAttributes['k'])` | `` toUInt32OrZero(toString(SpanAttributes.`k`)) `` |
| R4, a metrics table | `Attributes['k']` on `metrics_*` | unchanged, metrics keep their maps |

R1 covers `anyLast(...)`, `max(...)`, `argMaxIf(...)`, `uniqExact(...)`, `countIf(... = 'failure')`, `GROUP BY`, `!= ''`, `= ''`, `= {p:String}`, `IN {p:Array(String)}`, `LIKE` and `ILIKE`. `= ''` and `!= ''` keep their meaning because `toString` of a missing path is `''`. The same applies to `SpanAttributes`, `LogAttributes` and `ScopeAttributes`. R3 is required, not a style: `toUInt32OrZero` refuses an `Int64` argument.

- [ ] **Step 1: Update the tests**

`run-query-helpers.test.ts` lines 13, 15 and 23:

```ts
    expect(sql).toContain("toString(ResourceAttributes.`cicd.pipeline.result`)");
    expect(sql).toContain(
      "toString(ResourceAttributes.`cicd.pipeline.task.run.result`)",
    );
    ...
      groupByExpr: "toString(ResourceAttributes.`cicd.pipeline.run.id`)",
```

`capabilities.test.ts` lines 54 and 68:

```ts
        "has(SpanAttributesKeys, 'faas.trigger') LIMIT 1\n)",
        ...
        "has(LogAttributesKeys, 'browser.web_vital.value') LIMIT 1\n)",
```

`logs-explorer/server.test.ts` line 65:

```ts
    expect(sql).not.toContain("ResourceAttributes.`vcs.ref.head.name`");
```

`runs-list.test.ts` lines 267 and 270:

```ts
      "toString(ResourceAttributes.`cicd.pipeline.run.id`) LIKE {pattern:String}",
      ...
      "toString(ResourceAttributes.`cicd.pipeline.name`) ILIKE {pattern:String}",
```

`cost-analysis/server.test.ts` lines 31 to 71: every `mapContains(ResourceAttributes, 'x')` becomes `has(ResourceAttributesKeys, 'x')` with the same `x`.

- [ ] **Step 2: Run the app's data tests to see them fail**

Run: `cd packages/app && pnpm test:ci src/data`
Expected: the five files fail on the new strings.

- [ ] **Step 3: Rewrite `run-query-helpers.ts`**

```ts
import {
  attributeExists,
  attributeText,
} from "@everr/telemetry-explorer/sql";

interface RunSummarySubqueryOptions {
  whereClause: string;
  groupByExpr: string;
  groupByAlias: string;
  includeRunAttempt?: boolean;
  includeDuration?: boolean;
  includeSender?: boolean;
  includeHeadSha?: boolean;
  includeJobCount?: boolean;
}

/** Text of a resource attribute: `toString(ResourceAttributes.`key`)`. */
export function resourceAttribute(key: string): string {
  return attributeText("ResourceAttributes", key);
}

const PIPELINE_RESULT = resourceAttribute("cicd.pipeline.result");
const TASK_RESULT = resourceAttribute("cicd.pipeline.task.run.result");

export const CONCLUSION_EXPR = `coalesce(nullIf(argMaxIf(${PIPELINE_RESULT}, Timestamp, ${PIPELINE_RESULT} != ''), ''), argMaxIf(${TASK_RESULT}, Timestamp, ${TASK_RESULT} != ''))`;

/**
 * Presence + non-empty check for a resource attribute. The `has` term on the
 * keys array lets the `idx_res_attr_keys` bloom skip index prune granules
 * that lack the key before the value is read.
 */
export function nonEmptyResourceAttribute(key: string): string {
  return `${attributeExists("ResourceAttributes", key)} AND ${resourceAttribute(key)} != ''`;
}

/** Equality on a resource attribute, key-index-prunable via the keys array. */
export function resourceAttributeEquals(key: string, param: string): string {
  return `${attributeExists("ResourceAttributes", key)} AND ${resourceAttribute(key)} = {${param}:String}`;
}
```

In `runSummarySubquery`, the selects become:

```ts
  const selects: string[] = [
    `${groupByExpr} as ${groupByAlias}`,
    `anyLast(${resourceAttribute("cicd.pipeline.run.id")}) as run_id`,
    `anyLast(${resourceAttribute("cicd.pipeline.name")}) as workflowName`,
    `anyLast(${resourceAttribute("vcs.repository.name")}) as repo`,
    `anyLast(${resourceAttribute("vcs.ref.head.name")}) as branch`,
    `${CONCLUSION_EXPR} as conclusion`,
    "max(Timestamp) as timestamp",
  ];

  if (includeRunAttempt) {
    selects.push(
      `anyLast(toUInt32OrZero(${resourceAttribute("everr.github.workflow_job.run_attempt")})) as run_attempt`,
    );
  }
  if (includeDuration) {
    selects.push(`max(Duration) / 1000000 as duration`);
  }
  if (includeSender) {
    selects.push(
      `max(${resourceAttribute("cicd.pipeline.task.run.sender.login")}) as sender`,
    );
  }
  if (includeHeadSha) {
    selects.push(
      `anyLast(${resourceAttribute("vcs.ref.head.revision")}) as headSha`,
    );
  }
```

The rest of the function does not change.

- [ ] **Step 4: Rewrite the listed lines in the other eight files**

Apply the rules line by line. Three shapes deserve the exact text.

The job-level span test (R1 on `= ''`), in `repo-detail/server.ts` 34, 124, 162, 212, 263; `workflows/server.ts` 40, 320, 388; `runs-list/server.ts` 322; `cost-analysis/server.ts` 69, 145, 242:

```sql
AND toString(SpanAttributes.`everr.github.workflow_job_step.number`) = ''
```

The first failing step in `runs/server.ts` 212-215:

```sql
minIf(
  toUInt32OrZero(toString(SpanAttributes.`everr.github.workflow_job_step.number`)),
  toString(SpanAttributes.`everr.github.workflow_job_step.number`) != ''
    AND lowerUTF8(StatusMessage) IN ('failure', 'failed')
) as firstFailingStep
```

The home page's run subquery, `home/server.ts` 194-196 and 202-203:

```sql
SELECT
  toString(ResourceAttributes.`cicd.pipeline.run.id`) AS run_id,
  max(toString(ResourceAttributes.`everr.git.pull_requests.url`)) AS pr,
  max(toString(ResourceAttributes.`cicd.pipeline.task.run.result`)) AS result,
  ...
  AND has(ResourceAttributesKeys, 'cicd.pipeline.run.id')
  AND toString(ResourceAttributes.`cicd.pipeline.run.id`) != ''
```

`capabilities.ts` line 271:

```ts
        `SELECT ${key} AS key FROM ${signal} WHERE ${window} AND has(${attributes}Keys, '${match}') LIMIT 1`,
```

and the doc comment lines 130 to 136 and 220 to 222 show the same `has(...Keys, ...)` form in place of `mapContains(..., ...)`.

`resource-usage.ts`: only the traces query on lines 224 to 228 changes (R1). Lines 246 to 269 read `metrics_*` tables and stay (R4).

- [ ] **Step 5: Run the data tests and the type check**

Run: `cd packages/app && pnpm test:ci src/data && pnpm typecheck`
Expected: pass. Then `/usr/bin/grep -rnE "Attributes\['|mapContains\(" packages/app/src --include='*.ts'` lists only `resource-usage.ts` lines 246 to 269.

- [ ] **Step 6: Commit**

```bash
git add packages/app/src/data
git commit -m "feat(app): read run and workflow attributes from the JSON columns"
```

---

### Task 5: The built-in dashboard catalog and the repo's as-code resources

**Files:**
- Modify: `packages/app/src/data/dashboards/built-in/catalog/application/http-endpoints.yaml`
- Modify: `packages/app/src/data/dashboards/built-in/catalog/application/rpc-services.yaml`
- Modify: `packages/app/src/data/dashboards/built-in/catalog/application/server-functions.yaml`
- Modify: `packages/app/src/data/dashboards/built-in/catalog/application/serverless-functions.yaml`
- Modify: `packages/app/src/data/dashboards/built-in/catalog/browser/product-analytics.yaml`
- Modify: `packages/app/src/data/dashboards/built-in/catalog/browser/web-vitals.yaml`
- Modify: `everr/cloud-query.alert.yaml`, `everr/cloud-query.dashboard.yaml`, `everr/cloud-query.runbook.yaml`, `everr/collector-oom.runbook.yaml`, `everr/eventloop-delay.runbook.yaml`
- Test: `packages/app/src/data/dashboards` (the existing manifest and capabilities tests)

**Interfaces:**
- Consumes: nothing from earlier tasks. The catalog is SQL text the app sends as it is.
- Produces: the built-in dashboards that run against the JSON tables, and the repo's own alert, dashboard and runbook queries that the user applies after the cut-over (Task 10).

The six catalog files query only `traces` and `logs`; every attribute read in them is `X['k']` in a value position (`!= ''`, `= 'v'`, `IN (...)`, `nullIf(...)`, `uniqExact(...)`, `toFloat64OrZero(...)`, `toUInt16OrZero(...)`, `domain(...)`, `position(...)`, `GROUP BY`). The other ten catalog files read `metrics_*` tables and stay. In `everr/`, `SpanAttributes` appears only on `traces`; every `ResourceAttributes['k8s...']` there is on `metrics_gauge` and stays. Do not add a test that checks YAML text.

- [ ] **Step 1: Rewrite the reads**

```bash
perl -pi -e 's/\b(Span|Log|Resource|Scope)Attributes\[\x27([^\x27]+)\x27\]/toString(${1}Attributes.`$2`)/g' \
  packages/app/src/data/dashboards/built-in/catalog/application/http-endpoints.yaml \
  packages/app/src/data/dashboards/built-in/catalog/application/rpc-services.yaml \
  packages/app/src/data/dashboards/built-in/catalog/application/server-functions.yaml \
  packages/app/src/data/dashboards/built-in/catalog/application/serverless-functions.yaml \
  packages/app/src/data/dashboards/built-in/catalog/browser/product-analytics.yaml \
  packages/app/src/data/dashboards/built-in/catalog/browser/web-vitals.yaml
perl -pi -e 's/\bSpanAttributes\[\x27([^\x27]+)\x27\]/toString(SpanAttributes.`$1`)/g' \
  everr/cloud-query.alert.yaml everr/cloud-query.dashboard.yaml everr/cloud-query.runbook.yaml \
  everr/collector-oom.runbook.yaml everr/eventloop-delay.runbook.yaml
```

- [ ] **Step 2: Check the result**

```bash
/usr/bin/grep -rnE "(Span|Log|Scope)Attributes\['" packages/app/src/data/dashboards/built-in/catalog everr   # nothing
/usr/bin/grep -rnE "ResourceAttributes\['" packages/app/src/data/dashboards/built-in/catalog/application packages/app/src/data/dashboards/built-in/catalog/browser   # nothing
/usr/bin/grep -cE "toString\((Span|Log|Resource)Attributes\." packages/app/src/data/dashboards/built-in/catalog/browser/web-vitals.yaml   # 111
git diff --stat
```

Read the diff of `web-vitals.yaml` once: `toFloat64OrZero(LogAttributes['browser.web_vital.value'])` must now read `` toFloat64OrZero(toString(LogAttributes.`browser.web_vital.value`)) `` and `GROUP BY LogAttributes['session.id']` in `product-analytics.yaml` must read `` GROUP BY toString(LogAttributes.`session.id`) ``.

Run: `cd packages/app && pnpm test:ci src/data/dashboards`
Expected: pass; the manifest still loads every catalog file.

- [ ] **Step 3: Commit**

```bash
git add packages/app/src/data/dashboards/built-in/catalog everr
git commit -m "feat(dashboards): read span and log attributes from the JSON columns"
```

---

### Task 6: The ClickHouse schema

**Files:**
- Modify: `clickhouse/init/03-create-otel-tables.sql:15-61`
- Modify: `clickhouse/init/04-create-error-fingerprint-function.sql`
- Modify: `clickhouse/init/05-create-retention-functions.sql`
- Modify: `clickhouse/init/10-create-mvs.sql` (header comment, `app.traces` 20-110, `app.logs` 164-250)
- Modify: `clickhouse/init/12-create-alert-events.sql:62-104`
- Modify: `collector/exporter/chdbexporter/internal/sqltemplates/create_error_fingerprint_function.sql` (the same UDF body as `init/04`)

**Interfaces:**
- Consumes: nothing.
- Produces: the columns and UDFs every other task reads. `errorFingerprint` takes four text arguments from here on; Task 3 already calls it that way and Task 9 documents it.

- [ ] **Step 1: The landing tables, `init/03`**

Replace the two tables:

```sql
CREATE TABLE IF NOT EXISTS otel.otel_traces (
    Timestamp DateTime64(9),
    TraceId String,
    SpanId String,
    ParentSpanId String,
    TraceState String,
    SpanName LowCardinality(String),
    SpanKind LowCardinality(String),
    ServiceName LowCardinality(String),
    ResourceAttributes JSON(max_dynamic_paths = 256),
    ResourceAttributesKeys Array(LowCardinality(String)),
    ScopeName String,
    ScopeVersion String,
    SpanAttributes JSON(max_dynamic_paths = 256),
    SpanAttributesKeys Array(LowCardinality(String)),
    Duration UInt64,
    StatusCode LowCardinality(String),
    StatusMessage String,
    Events Nested (
        Timestamp DateTime64(9),
        Name LowCardinality(String),
        Attributes JSON(max_dynamic_paths = 256)
    ),
    Links Nested (
        TraceId String,
        SpanId String,
        TraceState String,
        Attributes JSON(max_dynamic_paths = 256)
    )
) ENGINE = Null;

CREATE TABLE IF NOT EXISTS otel.otel_logs (
    Timestamp DateTime64(9),
    TraceId String,
    SpanId String,
    TraceFlags UInt8,
    SeverityText LowCardinality(String),
    SeverityNumber UInt8,
    ServiceName LowCardinality(String),
    Body String,
    ResourceSchemaUrl LowCardinality(String),
    ResourceAttributes JSON(max_dynamic_paths = 256),
    ResourceAttributesKeys Array(LowCardinality(String)),
    ScopeSchemaUrl LowCardinality(String),
    ScopeName String,
    ScopeVersion LowCardinality(String),
    ScopeAttributes JSON(max_dynamic_paths = 256),
    ScopeAttributesKeys Array(LowCardinality(String)),
    LogAttributes JSON(max_dynamic_paths = 256),
    LogAttributesKeys Array(LowCardinality(String)),
    EventName String
) ENGINE = Null;
```

Add to the file's header comment, after the sentence about the upstream schema: "Logs and traces carry the JSON column set the exporter writes with `json: true`, typed values and one keys array per attribute column; the metrics tables keep their maps because the attribute map is the series key there. `max_dynamic_paths = 256` is the guard against a tenant with thousands of distinct keys, the same value on every JSON column here, in `10-create-mvs.sql` and in the local store's templates."

- [ ] **Step 2: The UDFs, `init/04`, `init/05` and the chDB copy**

`init/04` and the chDB copy `create_error_fingerprint_function.sql` get the same new body. Only the signature and the three reads change:

```sql
CREATE OR REPLACE FUNCTION errorFingerprint AS (serviceName, fingerprint, exceptionType, exceptionMessage) ->
  if(
    fingerprint != '',
    fingerprint,
    toString(cityHash64(
      serviceName,
      exceptionType,
      substring(
        replaceRegexpAll(
          replaceRegexpAll(
            replaceRegexpAll(
              trim(BOTH ' ' FROM exceptionMessage),
              '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}',
              '<uuid>'
            ),
            '\\b[0-9]{6,}\\b|0x[0-9a-fA-F]+',
            '<id>'
          ),
          '''[^'']{16,}''|"[^"]{16,}"',
          '<quoted>'
        ),
        1,
        300
      ),
      ''
    ))
  )
```

Keep the rest of the body exactly as the file has it today (the regular expressions above are copied from it; if the file differs, the file wins). Update the comment above: callers pass the three attributes as text, `` toString(LogAttributes.`error.fingerprint`) `` and the two exception paths, so a query reads three subcolumns and never the whole column; `toString` of a missing path is `''`, the same as the map gave.

`init/05`, append after `everrStripRetention`:

```sql
-- The JSON forms for app.logs and app.traces. getSubcolumn on a block that
-- is already in memory costs nothing on disk, and it avoids the question of
-- how `x.`path`` resolves against a lambda parameter. toString accepts the
-- stamp as a string or as a number and gives '' for a missing path, so the
-- guard below is the same test as in everrRetentionDays. The strip of the
-- document itself is the SKIP on the app table's column type; only the keys
-- array needs a filter.
CREATE OR REPLACE FUNCTION everrRetentionDaysJson AS (resourceAttributes) ->
  toUInt16OrZero(toString(getSubcolumn(resourceAttributes, 'everr.retention.days')))
    + throwIf(
        toUInt16OrZero(toString(getSubcolumn(resourceAttributes, 'everr.retention.days'))) = 0,
        'everr.retention.days resource attribute missing or not a positive number of days'
      );

CREATE OR REPLACE FUNCTION everrStripRetentionKeys AS (keys) ->
  arrayFilter(k -> k != 'everr.retention.days', keys);
```

- [ ] **Step 3: `app.traces` and `app.logs` in `init/10`**

In the `CREATE TABLE ... AS SELECT` of both tables, the tenant expression becomes:

```sql
  toString(getSubcolumn(ResourceAttributes, 'everr.tenant.id')) AS tenant_id,
```

In the `ADD INDEX` block of `app.traces`, replace the four `idx_*_attr_key` and `idx_*_attr_value` lines with:

```sql
  ADD INDEX IF NOT EXISTS idx_res_attr_keys ResourceAttributesKeys TYPE bloom_filter(0.01) GRANULARITY 1,
  ADD INDEX IF NOT EXISTS idx_span_attr_keys SpanAttributesKeys TYPE bloom_filter(0.01) GRANULARITY 1,
```

and in `app.logs` the six with:

```sql
  ADD INDEX IF NOT EXISTS idx_res_attr_keys ResourceAttributesKeys TYPE bloom_filter(0.01) GRANULARITY 1,
  ADD INDEX IF NOT EXISTS idx_scope_attr_keys ScopeAttributesKeys TYPE bloom_filter(0.01) GRANULARITY 1,
  ADD INDEX IF NOT EXISTS idx_log_attr_keys LogAttributesKeys TYPE bloom_filter(0.01) GRANULARITY 1,
```

Replace the comment paragraph that begins "The map indexes stay bloom_filter on purpose" with: "The keys arrays carry the only skip indexes on attributes. A filter on one key reads that key's own subcolumn, so a value index has nothing to add; the keys index serves the exists filter and the key list of the filter UI. The metrics tables below keep their map indexes, measured in PR #426: `bloom_filter` reads the same rows as upstream's `text()` for the two predicates the app emits at 500 times less storage."

In the `MODIFY COLUMN` block of `app.traces`, replace the `ResourceAttributes` and `SpanAttributes` lines with:

```sql
  MODIFY COLUMN `ResourceAttributes` JSON(max_dynamic_paths = 256, SKIP `everr.retention.days`) CODEC(ZSTD(1)),
  MODIFY COLUMN `ResourceAttributesKeys` CODEC(ZSTD(1)),
  MODIFY COLUMN `SpanAttributes` JSON(max_dynamic_paths = 256) CODEC(ZSTD(1)),
  MODIFY COLUMN `SpanAttributesKeys` CODEC(ZSTD(1)),
```

and in `app.logs` the three attribute lines with:

```sql
  MODIFY COLUMN `ResourceAttributes` JSON(max_dynamic_paths = 256, SKIP `everr.retention.days`) CODEC(ZSTD(1)),
  MODIFY COLUMN `ResourceAttributesKeys` CODEC(ZSTD(1)),
  MODIFY COLUMN `ScopeAttributes` JSON(max_dynamic_paths = 256) CODEC(ZSTD(1)),
  MODIFY COLUMN `ScopeAttributesKeys` CODEC(ZSTD(1)),
  MODIFY COLUMN `LogAttributes` JSON(max_dynamic_paths = 256) CODEC(ZSTD(1)),
  MODIFY COLUMN `LogAttributesKeys` CODEC(ZSTD(1)),
```

The comment above the first `MODIFY COLUMN` block says `03-create-otel-tables.sql` is the only place a column type is written. Change it: the attribute columns of `app.traces` and `app.logs` are the one exception, because the `SKIP` of `everr.retention.days` is part of the column type and belongs to the app table only; the landing table keeps the path so the view can read it.

The two views:

```sql
CREATE MATERIALIZED VIEW IF NOT EXISTS app.traces_mv
TO app.traces
AS
SELECT
  * EXCEPT (ResourceAttributesKeys),
  everrStripRetentionKeys(ResourceAttributesKeys) AS ResourceAttributesKeys
FROM
(
  SELECT
    *,
    toString(getSubcolumn(ResourceAttributes, 'everr.tenant.id')) AS tenant_id,
    everrRetentionDaysJson(ResourceAttributes) AS retention_days
  FROM otel.otel_traces
);
```

```sql
CREATE MATERIALIZED VIEW IF NOT EXISTS app.logs_mv
TO app.logs
AS
SELECT
  * EXCEPT (ResourceAttributesKeys),
  everrStripRetentionKeys(ResourceAttributesKeys) AS ResourceAttributesKeys
FROM
(
  SELECT
    *,
    toString(getSubcolumn(ResourceAttributes, 'everr.tenant.id')) AS tenant_id,
    everrRetentionDaysJson(ResourceAttributes) AS retention_days
  FROM otel.otel_logs
);
```

In the header comment of `init/10`, after the sentence about `everrStripRetention`, add: "On `app.logs` and `app.traces` the attributes are JSON columns. The strip of `everr.retention.days` from the document is the `SKIP` on the column type, applied when the view's rows land in the table, so the view only filters the keys array, and the stamp reads the path with `getSubcolumn`. `everr.tenant.id` stays in the document and in the keys, as it does with the maps."

The cut-over script `clickhouse/migrations/2026-09-03-direct-ingest.sh` reads `ResourceAttributes['everr.retention.days']` in its guard. That guard runs against the old Map tables before anything is dropped, and stays as it is.

- [ ] **Step 4: The alert events view, `init/12`**

Replace the three attribute expressions and add the keys arrays:

```sql
  CAST(map(
    'everr.tenant.id', tenant_id,
    'deployment.environment', if(preview = '', 'production', preview)
  ), 'JSON(max_dynamic_paths = 256)') AS ResourceAttributes,
  CAST(['everr.tenant.id', 'deployment.environment'], 'Array(LowCardinality(String))') AS ResourceAttributesKeys,
  '' AS ScopeSchemaUrl,
  'everr.alerting' AS ScopeName,
  '' AS ScopeVersion,
  CAST(map(), 'JSON(max_dynamic_paths = 256)') AS ScopeAttributes,
  CAST([], 'Array(LowCardinality(String))') AS ScopeAttributesKeys,
  CAST(map(
    'alert.slug', slug,
    'alert.preview', preview,
    'alert.event_type', event_type,
    'alert.delivery_targets', toJSONString(delivery_targets),
    'alert.silenced', if(silence_id = '', 'false', 'true'),
    'alert.row_count', toString(row_count),
    'alert.evidence_truncated', toString(evidence_truncated),
    'alert.evidence_json', evidence_json,
    'alert.instance_fingerprint', instance_fingerprint,
    'alert.instance_labels', instance_labels_json
  ), 'JSON(max_dynamic_paths = 256)') AS LogAttributes,
  CAST(['alert.slug', 'alert.preview', 'alert.event_type', 'alert.delivery_targets', 'alert.silenced', 'alert.row_count', 'alert.evidence_truncated', 'alert.evidence_json', 'alert.instance_fingerprint', 'alert.instance_labels'], 'Array(LowCardinality(String))') AS LogAttributesKeys,
```

The values stay strings, as the alert rows write them today. Keep the two existing comments (the preview service and the env facet) and add one above the block: the keys arrays list the same keys as the documents because the filter UI and the exists index read them.

- [ ] **Step 5: Verify on a throwaway container**

```bash
docker build -t everr-ch-json clickhouse/
docker rm -f ch-json >/dev/null 2>&1; docker run -d --name ch-json \
  -e CLICKHOUSE_USER=default -e CLICKHOUSE_PASSWORD=x -e CLICKHOUSE_DEFAULT_ACCESS_MANAGEMENT=1 \
  -e COLLECTOR_RW_PASSWORD=c -e APP_RO_PASSWORD=a -e WEB_APP_ADMIN_PASSWORD=w everr-ch-json
ch() { docker exec -i ch-json clickhouse-client --password x --database app "$@"; }
for i in $(seq 1 90); do ch --query "SELECT 1" >/dev/null 2>&1 && break; sleep 1; done
docker logs ch-json 2>&1 | /usr/bin/grep -iE 'exception|error' | head   # must print nothing
```

```bash
ch --query "SELECT count() FROM system.tables WHERE database = 'app' AND engine = 'MaterializedView'"   # 9
ch --query "SHOW CREATE TABLE app.logs" | /usr/bin/grep -oE 'JSON\([^)]*\)|idx_[a-z_]*_keys' | sort -u
# three JSON(...) forms with max_dynamic_paths = 256, the ResourceAttributes one with SKIP, and idx_log_attr_keys, idx_res_attr_keys, idx_scope_attr_keys
ch --query "INSERT INTO otel.otel_logs (Timestamp, ServiceName, Body, ResourceAttributes, ResourceAttributesKeys, ScopeAttributes, ScopeAttributesKeys, LogAttributes, LogAttributesKeys) VALUES
 (now64(9), 'svc', 'typed', '{\"everr.tenant.id\":\"t1\",\"everr.retention.days\":30,\"service.name\":\"svc\"}', ['everr.tenant.id','everr.retention.days','service.name'], '{}', [], '{\"http.route\":\"/x\",\"status\":500}', ['http.route','status']),
 (now64(9), 'svc', 'string', '{\"everr.tenant.id\":\"t1\",\"everr.retention.days\":\"30\",\"service.name\":\"svc\"}', ['everr.tenant.id','everr.retention.days','service.name'], '{}', [], '{\"http.route\":\"/y\",\"status\":\"503\"}', ['http.route','status'])"
ch --query "SELECT tenant_id, retention_days, toJSONString(ResourceAttributes) AS res, ResourceAttributesKeys, toString(LogAttributes.status) AS status, dynamicType(LogAttributes.status) AS status_type, toString(LogAttributes.missing) = '' AS missing_is_empty, has(LogAttributesKeys, 'http.route') AS has_route FROM app.logs ORDER BY Body FORMAT PrettyCompact"
```

Expected: two rows, `tenant_id = t1`, `retention_days = 30`, the document without `everr.retention.days` and with `everr.tenant.id`, the keys array without `everr.retention.days`, `status` `503` of type `String` on one row and `500` of type `Int64` on the other, `missing_is_empty = 1`, `has_route = 1`.

```bash
ch --query "INSERT INTO otel.otel_logs (Timestamp, ServiceName, Body, ResourceAttributes, ResourceAttributesKeys, ScopeAttributes, ScopeAttributesKeys, LogAttributes, LogAttributesKeys) VALUES (now64(9), 'svc', 'no retention', '{\"everr.tenant.id\":\"t1\"}', ['everr.tenant.id'], '{}', [], '{}', [])" 2>&1 | /usr/bin/grep -o 'everr.retention.days resource attribute missing[^)]*'
```

Expected: the message prints, the insert is refused.

```bash
ch --query "INSERT INTO otel.otel_traces (Timestamp, TraceId, SpanId, SpanName, ServiceName, ResourceAttributes, ResourceAttributesKeys, SpanAttributes, SpanAttributesKeys, Duration, Events.Timestamp, Events.Name, Events.Attributes) VALUES (now64(9), 'abc', '1', 'root', 'svc', '{\"everr.tenant.id\":\"t1\",\"everr.retention.days\":30}', ['everr.tenant.id','everr.retention.days'], '{\"everr.github.workflow_job_step.number\":3}', ['everr.github.workflow_job_step.number'], 10, [now64(9)], ['ev'], ['{\"exception.type\":\"E\"}'])"
ch --query "SELECT tenant_id, retention_days, toString(SpanAttributes.\`everr.github.workflow_job_step.number\`) AS step, toUInt32OrZero(toString(SpanAttributes.\`everr.github.workflow_job_step.number\`)) AS step_number, dynamicType(SpanAttributes.\`everr.github.workflow_job_step.number\`) AS step_type, toString(Events.Attributes[1].\`exception.type\`) AS ev, (SELECT count() FROM app.traces_trace_id_ts WHERE TraceId = 'abc') AS lookup_rows FROM app.traces FORMAT PrettyCompact"
```

Expected: `t1`, `30`, `3`, `3`, `Int64`, `E`, `1`.

```bash
ch --query "SELECT errorFingerprint('svc', '', 'TypeError', 'id 123456789 failed') = errorFingerprint('svc', '', 'TypeError', 'id 987654321 failed') AS same_after_normalization, errorFingerprint('svc', 'fp-1', 'x', 'y') AS explicit"
```

Expected: `1` and `fp-1`.

```bash
ch --query "INSERT INTO app.alert_events (tenant_id, alert_definition_id, repoid, slug, event_type, retention_days) VALUES ('t1', 'def-1', 'repo', 'cpu-high', 'firing', 30)"
ch --query "SELECT ServiceName, toString(LogAttributes.\`alert.slug\`) AS slug, has(LogAttributesKeys, 'alert.event_type') AS has_type, toString(ResourceAttributes.\`deployment.environment\`) AS env FROM app.logs WHERE ServiceName = 'alert' FORMAT PrettyCompact"
```

Expected: one row, `cpu-high`, `1`, `production`. If `app.alert_events` has more required columns than the insert names, take them from the table's `SHOW CREATE TABLE` and give them any value.

```bash
ch --query "SHOW CREATE TABLE app.metrics_gauge" | /usr/bin/grep -c "Map(LowCardinality(String), String)"   # at least 2
docker rm -f ch-json
```

If `SHOW CREATE TABLE app.logs` does not show the `SKIP`, the `MODIFY COLUMN` did not apply the type. Stop and report; do not fall back to a view-side strip.

- [ ] **Step 6: Commit**

```bash
git add clickhouse/init collector/exporter/chdbexporter/internal/sqltemplates/create_error_fingerprint_function.sql
git commit -m "feat(clickhouse): store log and span attributes as JSON columns"
```

---

### Task 7: The cloud exporter writes JSON

**Files:**
- Modify, local only: `collector/config.yml:122-127`. The file is gitignored (`.gitignore`, pattern `config.yml`) and is each developer's copy of the example with secrets filled in (`CONTRIBUTING.md`). It is never committed; the edit stays on disk for the smoke.
- Modify: `collector/config.example.yml:114-119`
- Modify: `clickhouse/migrations/2026-09-03-direct-ingest.sh` (the header comment only)

**Interfaces:**
- Consumes: the landing tables of Task 6.
- Produces: the dev stack writes JSON attributes. Production follows through `everr-deploy`, listed in Task 10.

- [ ] **Step 1: Switch the dev exporter**

In `collector/config.yml`, after `create_schema: false`:

```yaml
    # Logs and traces write JSON attribute columns with typed values and one
    # keys array per attribute column; the landing tables in
    # clickhouse/init/03 declare that column set. A Map exporter against those
    # tables fails every insert, and the reverse too, so this flag and the
    # schema move together.
    json: true
```

The same line and comment in `collector/config.example.yml` after its `create_schema: false`.

- [ ] **Step 2: Note the ordering in the cut-over script**

In the header comment of `2026-09-03-direct-ingest.sh`, after the sentence that says to run it after the app and the collector are deployed, add: "The collector that runs `json: true` deploys right after this script, not before: its JSON inserts fail against the Map landing tables, and the old collector's Map inserts fail against the JSON ones. The exporter's queue retries what falls in between. The guard below reads the Map form on purpose: it runs against the old tables." And, added by the final review: "Between the app deploy and the end of this script the app's reads fail, because its queries use the JSON form against the Map columns: the runs list and detail, workflows, repo detail, cost analysis, the home CI panel, the explorers and the built-in dashboards. Run the three steps, app, this script, collector, back to back in one window."

- [ ] **Step 3: Smoke on the dev stack**

The dev ClickHouse image builds from `clickhouse/` and runs `init/` only on an empty volume, so the stack has to start from a fresh ClickHouse volume for the JSON tables to exist. The volume is the bind mount `./volumes/clickhouse`:

```bash
docker compose stop clickhouse collector
docker compose rm -f clickhouse collector
rm -rf volumes/clickhouse
docker compose up -d --build clickhouse collector
docker compose logs collector 2>&1 | /usr/bin/grep -i 'error' | head    # nothing about columns or types
```

Then `cd packages/app && pnpm dev` and, with the credentials from `.auth` on the main worktree, open the logs explorer, pick an attribute in the filter, pick a value, and open one log's detail; then open the traces explorer and one trace; then the built-in HTTP endpoints dashboard. The key list, the value list, the detail's attributes, the span's attributes and the dashboard's panels must show. Then:

```bash
everr-dev cloud query --format table "SELECT LogAttributesKeys, toJSONString(LogAttributes) AS attrs FROM logs ORDER BY Timestamp DESC LIMIT 2"
```

Expected: keys arrays and documents, not maps. If no telemetry arrives, send one span through the local everr instance or trigger a CI webhook as the dev stack normally receives; the smoke needs at least one log row and one span.

- [ ] **Step 4: Commit**

```bash
git add collector/config.example.yml clickhouse/migrations/2026-09-03-direct-ingest.sh
git commit -m "feat(collector): write log and span attributes as JSON"
```

`collector/config.yml` is not in the add list: it is gitignored and carries local secrets. Never `git add -f` it.

---

### Task 8: The local store follows

**Files:**
- Modify: `collector/exporter/chdbexporter/internal/sqltemplates/logs_json_table.sql`
- Modify: `collector/exporter/chdbexporter/internal/sqltemplates/traces_json_table.sql`
- Modify: `collector/exporter/chdbexporter/schema_version_test.go:26` (`shapedTemplatesDigest`)
- Modify: `collector/exporter/chdbexporter/EVERR_CHANGES.md` (new section at the end)
- Modify: `collector/internal/localgateway/config/config.go:77`
- Test: `collector/exporter/chdbexporter/exporter_chdb_roundtrip_test.go`, `collector/internal/localgateway/config/config_test.go:38-45`

**Interfaces:**
- Consumes: the `errorFingerprint` copy already changed in Task 6.
- Produces: a local store with the same column set and limits as the cloud, so the explorer queries run unchanged against it.

- [ ] **Step 1: Write the failing tests**

In `config_test.go`, after line 45:

```go
	require.Equal(t, true, chdb["json"], "the local store writes JSON attribute columns like the cloud")
```

In `exporter_chdb_roundtrip_test.go`, after `TestChDBRoundTripKeepsLogTimestampNanoseconds`:

```go
func TestChDBRoundTripStoresTypedJSONAttributes(t *testing.T) {
	handle := openRealChDB(t)
	cfg := withDefaultConfig(func(c *Config) { c.JSON = true })
	exp := newLogsJSONExporter(zaptest.NewLogger(t), cfg, handle)
	require.NoError(t, exp.start(t.Context(), nil))
	t.Cleanup(func() { _ = exp.shutdown(context.Background()) })

	ld := plog.NewLogs()
	record := ld.ResourceLogs().AppendEmpty().ScopeLogs().AppendEmpty().LogRecords().AppendEmpty()
	record.SetTimestamp(pcommon.NewTimestampFromTime(roundTripTime))
	record.Body().SetStr("typed attributes")
	record.Attributes().PutInt("everr.github.workflow_job_step.number", 3)
	record.Attributes().PutStr("http.route", "/x")
	require.NoError(t, exp.pushLogsData(t.Context(), ld))

	rows := queryJSONRows(t, handle,
		"SELECT toString(LogAttributes.`everr.github.workflow_job_step.number`) AS step,"+
			" dynamicType(LogAttributes.`everr.github.workflow_job_step.number`) AS stepType,"+
			" toString(LogAttributes.`http.route`) AS route,"+
			" has(LogAttributesKeys, 'http.route') AS hasRoute"+
			` FROM "`+cfg.database()+`"."`+cfg.LogsTableName+`"`)
	require.Len(t, rows, 1)
	require.Equal(t, "3", rows[0]["step"])
	require.Equal(t, "Int64", rows[0]["stepType"], "an integer attribute is stored as a number, not as text")
	require.Equal(t, "/x", rows[0]["route"])
	require.Equal(t, float64(1), rows[0]["hasRoute"])
}
```

`newLogsJSONExporter(logger *zap.Logger, cfg *Config, handles ...*chdb.Handle)` is the signature in `exporter_logs_json.go`; `withDefaultConfig(fns ...func(*Config))` is in `config_test.go`. If the `Config` field for the flag is not `JSON`, use the field `factory.go` reads.

- [ ] **Step 2: Run them to see them fail**

Run: `cd collector/internal/localgateway/config && go test ./... && cd ../../../exporter/chdbexporter && go test ./... -run 'TestChDBRoundTripStoresTypedJSONAttributes'`
Expected: the config test fails on a missing `json` key. The round-trip test may already pass, because the JSON template exists; that is fine, it pins the behavior for the template change that follows.

- [ ] **Step 3: Change the templates and the config**

`logs_json_table.sql`: the three `JSON` types become `JSON(max_dynamic_paths = 256)`; replace `INDEX idx_body Body TYPE tokenbf_v1(32768, 3, 0) GRANULARITY 8` with the two indexes the Map template carries:

```sql
    INDEX idx_trace_id TraceId TYPE bloom_filter(0.001) GRANULARITY 1,
    INDEX idx_lower_body lower(Body) TYPE tokenbf_v1(32768, 3, 0) GRANULARITY 8
```

`traces_json_table.sql`: the four `JSON` types become `JSON(max_dynamic_paths = 256)`; add `INDEX idx_trace_id TraceId TYPE bloom_filter(0.001) GRANULARITY 1,` before `idx_res_attr_keys`.

`config.go` line 77, inside the `"chdb"` map, before `"ttl"`:

```go
				// The same JSON attribute columns as the cloud tables, so the
				// shared explorer queries run unchanged.
				"json": true,
```

`EVERR_CHANGES.md`, new section:

```markdown
## JSON attribute columns

- The local store runs the exporter's `json` mode, the cloud's choice: typed
  values, one `*Keys Array(LowCardinality(String))` per attribute column, and
  a `bloom_filter` index on each keys array. The Map templates stay in the
  tree for a `json: false` config but nothing in Everr uses them.
- Every JSON column is `JSON(max_dynamic_paths = 256)`, the same guard as the
  cloud tables in `clickhouse/init`. Upstream's default of 1024 let every
  mixed-tenant part carry a thousand path columns and made merges fail.
- `logs_json` and `traces_json` carry `idx_trace_id` and `logs_json` carries
  `idx_lower_body`, as the Map templates do; upstream's JSON templates have
  neither.
- `errorFingerprint` takes the three attributes as text arguments instead of
  the map, so a query reads three subcolumns and not the whole column.
```

- [ ] **Step 4: Run the tests, take the new digest, run lint**

Run: `cd collector/exporter/chdbexporter && go test ./... -run 'TestSchemaTemplatesMatchVersion'`
Expected: FAIL with the new digest in the message. Put that value into `shapedTemplatesDigest` and bump `localSchemaVersion` to 2 in `schema_version.go`, with a comment that says why: a store built at version 1 holds Map `logs` and `traces` tables under the same names, `CREATE TABLE IF NOT EXISTS` would keep them, and the rebuild replaces them. The `EVERR_CHANGES.md` section gets one bullet saying the same. (The plan first said to keep version 1 because it had not shipped to users; the final review pointed out that every store built from this stack is stamped 1, so the bump is required.)

Run: `go test ./... && make lint && cd ../../internal/localgateway/config && go test ./...`
Expected: pass, lint clean.

- [ ] **Step 5: Commit**

```bash
git add collector/exporter/chdbexporter collector/internal/localgateway/config
git commit -m "feat(chdb): store attributes as JSON columns in the local store"
```

---

### Task 9: Skills and docs

**Files:**
- Modify: `crates/everr-core/assets/skills/everr-use-telemetry/SKILL.md:74,165-179`
- Modify: `crates/everr-core/assets/skills/everr-use-telemetry/rules/browser-events.md:76-78,91-92,105,120-128`
- Modify: `crates/everr-core/assets/skills/everr-setup-telemetry/rules/validation.md:44-45,94-95,109-110`
- Modify: `crates/everr-core/assets/skills/everr-setup-telemetry/rules/electron.md:195-196`
- Modify: `crates/everr-core/assets/skills/everr-setup-telemetry/rules/tauri.md:370-372`
- Modify: `crates/everr-core/assets/skills/everr-working-with-ci/SKILL.md:76-86,96-105`
- Modify: `crates/everr-core/assets/skills/everr-setup-resources/rules/geomap.md:43,47`
- Modify: `crates/everr-core/assets/skills/everr-setup-resources/rules/alerts.md:65-81`
- Modify: `crates/everr-core/assets/skills/everr-setup-resources/rules/treemap.md:32,36`
- Modify: `crates/everr-core/assets/skills/everr-setup-resources/rules/dashboards.md:142`
- Create: `packages/docs/content/docs/reference/attributes.mdx`
- Modify: `packages/docs/content/docs/reference/meta.json`
- Modify: `packages/docs/src/components/agents-compare.tsx:172`
- Modify: `docs/clickhouse-retention-rollout.md:327` (untracked, the user's rollout notes)

**Interfaces:**
- Consumes: the syntax from Tasks 1 to 6.
- Produces: the documentation users and agents read. `reference/alert-queries.mdx` line 57 reads `metrics_gauge` and stays a map.

- [ ] **Step 1: Rewrite the skill lines**

Rules for the skill files, applied to every listed line:

| Before | After |
|---|---|
| `Column['key']` in any position | `` toString(Column.`key`) `` |
| `mapContains(Column, 'key')` | `has(ColumnKeys, 'key')` |
| `toFloat64(Column['key'])` | `` toFloat64OrZero(toString(Column.`key`)) `` |

`everr-use-telemetry/SKILL.md` line 74 becomes:

> `SpanAttributes`, `LogAttributes`, and `ResourceAttributes` are JSON columns with typed values. Read a key as text with `` toString(Column.`key`) `` (backticks around the key, dots included): a missing key gives `''`. Read a number with `` toFloat64OrZero(toString(Column.`key`)) ``. Test presence with `has(ColumnKeys, 'key')`, which is indexed. Never compare the raw `` Column.`key` `` without a conversion: it is a `Dynamic` value, refused in `GROUP BY` and in a comparison across mixed types. The `metrics_*` tables keep maps: `Attributes['key']`. **Before assuming attribute names** (like `` SpanAttributes.`http.route` `` or `` SpanAttributes.`db.statement` ``), discover what exists with `SELECT DISTINCT arrayJoin(SpanAttributesKeys)` over a short window, or by sampling a few rows. OTel attribute naming conventions vary across languages and frameworks.

Lines 165 to 179, the exception example, take `has(ResourceAttributesKeys, 'service.name')`, `has(LogAttributesKeys, 'exception.type')`, `has(LogAttributesKeys, 'exception.message')` and `` toString(LogAttributes.`exception.stacktrace`) AS stacktrace ``.

`everr-working-with-ci/SKILL.md` line 86 stays an empty-string test: `` AND toString(SpanAttributes.`everr.github.workflow_job_step.number`) = '' ``. Line 98: `` anyLast(toString(LogAttributes.`everr.github.workflow_job_step.number`)) AS step ``. Line 97 reads `ScopeAttributes` the same way.

`browser-events.md` line 78: `` quantile(0.75)(toFloat64OrZero(toString(LogAttributes.`browser.web_vital.value`))) AS p75 ``.

`dashboards.md` line 142: replace `` (`SpanAttributes['http.route']`, etc.) `` with `` (`toString(SpanAttributes.`http.route`)`, etc.) ``.

`alerts.md` lines 65 to 67 are prose with inline code: `` toString(LogAttributes.`alert.slug`) = '<alert-slug>' `` and `` toString(LogAttributes.`alert.event_type`) ``; lines 73 to 81 follow the table.

- [ ] **Step 2: Write the docs page**

`packages/docs/content/docs/reference/attributes.mdx`:

````mdx
---
title: Attribute columns
description: How to read span, log and resource attributes in SQL.
---

Logs and traces store their attributes in JSON columns: `LogAttributes`, `ScopeAttributes` and `ResourceAttributes` on `logs`, and `SpanAttributes` and `ResourceAttributes` on `traces`. Each column keeps the type the SDK sent, so an integer attribute is a number and a boolean is a boolean. Next to each column, an array named after it with the suffix `Keys` lists the keys present on the row, for example `LogAttributesKeys`.

The metrics tables keep their maps: read `Attributes['key']` there.

## Reading a key

Put the key in backticks after the column and wrap the read in `toString`. Dots are part of the key. A missing key reads as an empty string.

```sql
SELECT toString(SpanAttributes.`http.route`) AS route, count()
FROM traces
WHERE Timestamp > now() - INTERVAL 1 HOUR
GROUP BY route
```

## Comparing

`toString` makes every comparison a text comparison, whatever type the SDK sent. For a number, convert the text.

```sql
WHERE toString(SpanAttributes.`http.request.method`) = 'POST'
WHERE toUInt16OrZero(toString(SpanAttributes.`http.response.status_code`)) >= 500
```

A numeric comparison on the raw path, `` SpanAttributes.`http.response.status_code` >= 500 ``, works while every row it runs over holds a number. It fails with `NO_COMMON_TYPE` when a row holds text, which is what a `String` column does too. A query runs over your own rows only. Another tenant's types do not affect you. Two versions of your own SDK that disagree on the type do. The converted form works in every case. A typed read such as `` SpanAttributes.`k`.:Int64 `` is the one form to avoid: it returns `NULL` for every row whose stored type is different, silently.

## Presence

Test presence on the keys array; it is indexed. An empty-string test on the value also works but reads the value of every row in the window.

```sql
WHERE has(LogAttributesKeys, 'exception.type')
WHERE NOT has(SpanAttributesKeys, 'everr.github.workflow_job_step.number')
```

## Listing keys

```sql
SELECT DISTINCT arrayJoin(LogAttributesKeys) AS key
FROM logs
WHERE Timestamp > now() - INTERVAL 1 HOUR
ORDER BY key
```

## Moving from the map syntax

| Before | After |
|---|---|
| `LogAttributes['k']` | `` toString(LogAttributes.`k`) `` |
| `mapContains(LogAttributes, 'k')` | `has(LogAttributesKeys, 'k')` |
| `toFloat64OrZero(LogAttributes['k'])` | `` toFloat64OrZero(toString(LogAttributes.`k`)) `` |
| `mapKeys(LogAttributes)` | `LogAttributesKeys` |

A map read on a JSON column is an error, not an empty result, so a saved query that still uses it fails loudly.
````

In `meta.json`, add `"attributes"` after `"retention"` in `pages`.

`agents-compare.tsx` line 172 becomes:

```tsx
            sql="SELECT toString(ResourceAttributes.`service.version`) AS version, count() FROM traces WHERE ServiceName = 'checkout' AND StatusCode = 'Error' GROUP BY version"
```

`docs/clickhouse-retention-rollout.md` line 327: `countIf(has(ResourceAttributesKeys, 'everr.retention.days')) AS leaked`.

- [ ] **Step 3: Check nothing Map-shaped is left on logs or traces**

Run: `/usr/bin/grep -rnE "Attributes\['|mapContains\(|mapKeys\(" crates/everr-core/assets/skills packages/docs/content packages/docs/src docs/clickhouse-retention-rollout.md --include='*.md' --include='*.mdx' --include='*.tsx'`
Expected: only `reference/alert-queries.mdx` line 57 on `metrics_gauge`, and any skill line that reads a `metrics_*` table.

Run: `cd packages/docs && pnpm types:check`
Expected: the new page compiles into the content index.

- [ ] **Step 4: Commit**

```bash
git add crates/everr-core/assets/skills packages/docs
git commit -m "docs: teach the JSON attribute syntax"
```

---

### Task 10: The pull request, the rollout and the production gate

**Files:**
- Create: a pull request from `gio/json-attributes` with base `ttl-improvements` (through `gh pr create --base ttl-improvements --body-file`)
- The shadow table statements stay in this plan for the user to run

**Interfaces:**
- Consumes: everything above.
- Produces: the stacked pull request and the merge checklist. PR #426's description is not edited here: it takes the bullet below when this branch merges into `ttl-improvements`.

- [ ] **Step 1: The pull request**

Write the body to `"$CLAUDE_JOB_DIR/tmp/pr-json-attributes.md"` and open the PR with `gh pr create --base ttl-improvements --title "feat(clickhouse): store log and span attributes as JSON columns" --body-file "$CLAUDE_JOB_DIR/tmp/pr-json-attributes.md"`. The body has five sections.

"What changes":

> **Log and span attributes are JSON columns**, exactly as upstream's exporter writes them with `json: true`: typed values and a `*Keys` array per attribute column with a `bloom_filter` index. A filter on one key, the key list of the filter UI and the values of one key read one column instead of the whole map. Measured on 26.5 with 4M rows: 4 to 7 ms against 24 to 32 on a filter, 9 against 36 on the key list and 42 against 312 at 1.3M rows, 10 to 16 against 37 to 80 on a value list. The one loss is the full-row fetch, 46 ms against 15. Every JSON column is `JSON(max_dynamic_paths = 256)`; the value is measured on production before the cut-over, see below. The strip of `everr.retention.days` is a `SKIP` on the column type. `errorFingerprint` takes the three attributes as text. Metrics keep their maps: the map is the series key there. Users of `/sql` and of as-code dashboards and alerts get a syntax change, documented in `reference/attributes`; the built-in dashboards and the resources under `everr/` are rewritten.

"Read form", a short table with the four shapes from `reference/attributes.mdx` (value, presence, number, key list) and the two traps (raw comparison across mixed types, typed subcolumns that read `NULL`).

"Rollout", which replaces step 3 of #426's rollout once merged:

> Run `clickhouse/migrations/2026-09-03-direct-ingest.sh`, then deploy the collector with `json: true`, in that order: the JSON exporter's inserts fail against Map landing tables and the reverse too; the exporter's queue retries what falls in between. From the app deploy until this script ends, the app's reads fail (its queries use the JSON form against the Map columns): the runs list and detail, workflows, repo detail, cost analysis, the home CI panel, the explorers and the built-in dashboards. The three steps run back to back in one window. The script refuses to start if unstamped rows arrived in the last 10 minutes, drops every view, landing table and `app.*` table, re-runs `init/03`, `init/04`, `init/05`, `init/10` and `init/12`, creates the per-org policy on the lookup table for every `sql_api_org_*` user, drops the dictionary and checks all nine views came back. Then `everr apply ./everr` for the repo's own alert, dashboard and runbook queries.

"Open before merge":

> - `everr-deploy`: `json: true` on the ClickHouse exporter in `infra-v2/config/otel-collector-config.yaml`, deployed right after the cut-over.
> - The shadow table on production for 24 hours (statements in the branch's plan), read for merge memory, merge duration and files per part. That reading confirms or changes `max_dynamic_paths = 256` before the cut-over.
> - PR #426's description takes the "What changes" bullet and the rollout step when this branch merges.

"Verified": one bullet per task's test run, the container checks of Task 6 and the round-trip test of Task 8, with the numbers as observed.

- [ ] **Step 2: The shadow table on production**

The user runs these on the production service as the admin user, before the cut-over, while `otel.otel_logs` is still a MergeTree with maps. First the cast check, which must return one row:

```sql
SELECT CAST(LogAttributes, 'JSON(max_dynamic_paths = 256)') AS j, mapKeys(LogAttributes) AS k
FROM otel.otel_logs ORDER BY Timestamp DESC LIMIT 1;
```

Then the shadow:

```sql
CREATE TABLE app.logs_json_shadow (
  Timestamp DateTime64(9) CODEC(Delta(8), ZSTD(1)),
  TraceId String CODEC(ZSTD(1)),
  SpanId String CODEC(ZSTD(1)),
  TraceFlags UInt8,
  SeverityText LowCardinality(String) CODEC(ZSTD(1)),
  SeverityNumber UInt8,
  ServiceName LowCardinality(String) CODEC(ZSTD(1)),
  Body String CODEC(ZSTD(1)),
  ResourceAttributes JSON(max_dynamic_paths = 256) CODEC(ZSTD(1)),
  ResourceAttributesKeys Array(LowCardinality(String)) CODEC(ZSTD(1)),
  ScopeAttributes JSON(max_dynamic_paths = 256) CODEC(ZSTD(1)),
  ScopeAttributesKeys Array(LowCardinality(String)) CODEC(ZSTD(1)),
  LogAttributes JSON(max_dynamic_paths = 256) CODEC(ZSTD(1)),
  LogAttributesKeys Array(LowCardinality(String)) CODEC(ZSTD(1)),
  INDEX idx_res_attr_keys ResourceAttributesKeys TYPE bloom_filter(0.01) GRANULARITY 1,
  INDEX idx_scope_attr_keys ScopeAttributesKeys TYPE bloom_filter(0.01) GRANULARITY 1,
  INDEX idx_log_attr_keys LogAttributesKeys TYPE bloom_filter(0.01) GRANULARITY 1
) ENGINE = MergeTree
PARTITION BY toDate(Timestamp)
ORDER BY (ServiceName, Timestamp)
TTL toDate(Timestamp) + INTERVAL 2 DAY
SETTINGS index_granularity = 8192, ttl_only_drop_parts = 1;

CREATE MATERIALIZED VIEW app.logs_json_shadow_mv TO app.logs_json_shadow AS
SELECT
  Timestamp, TraceId, SpanId, TraceFlags, SeverityText, SeverityNumber, ServiceName, Body,
  CAST(ResourceAttributes, 'JSON(max_dynamic_paths = 256)') AS ResourceAttributes,
  mapKeys(ResourceAttributes) AS ResourceAttributesKeys,
  CAST(ScopeAttributes, 'JSON(max_dynamic_paths = 256)') AS ScopeAttributes,
  mapKeys(ScopeAttributes) AS ScopeAttributesKeys,
  CAST(LogAttributes, 'JSON(max_dynamic_paths = 256)') AS LogAttributes,
  mapKeys(LogAttributes) AS LogAttributesKeys
FROM otel.otel_logs;
```

The shadow has no tenant column, so it is not exposed to any user and needs no policy. After 24 hours:

```sql
-- merges: memory and duration, shadow against app.logs, same day
SELECT table, count() AS merges, formatReadableSize(max(peak_memory_usage)) AS peak, max(duration_ms) AS max_ms, round(avg(duration_ms)) AS avg_ms, max(rows) AS largest
FROM system.part_log
WHERE database = 'app' AND table IN ('logs', 'logs_json_shadow') AND event_type = 'MergeParts' AND event_time > now() - INTERVAL 1 DAY AND error = 0
GROUP BY table;

SELECT table, error, count() FROM system.part_log
WHERE database = 'app' AND table = 'logs_json_shadow' AND event_type = 'MergeParts' AND event_time > now() - INTERVAL 1 DAY AND error != 0
GROUP BY table, error;

-- parts and size
SELECT table, count() AS parts, sum(rows) AS rows, formatReadableSize(sum(bytes_on_disk)) AS size, countIf(part_type = 'Wide') AS wide
FROM system.parts WHERE database = 'app' AND table IN ('logs', 'logs_json_shadow') AND active GROUP BY table;

-- paths that got a column of their own against the shared store
SELECT length(JSONDynamicPaths(LogAttributes)) AS own_columns, length(JSONSharedDataPaths(LogAttributes)) AS shared FROM app.logs_json_shadow LIMIT 1;

-- the three UI reads, last 6 hours, on the shadow
SELECT DISTINCT arrayJoin(LogAttributesKeys) AS k FROM app.logs_json_shadow WHERE Timestamp > now() - INTERVAL 6 HOUR ORDER BY k LIMIT 200;
SELECT DISTINCT toString(LogAttributes.`everr.github.workflow_job_step.number`) AS v FROM app.logs_json_shadow WHERE Timestamp > now() - INTERVAL 6 HOUR AND has(LogAttributesKeys, 'everr.github.workflow_job_step.number') ORDER BY v LIMIT 100;
SELECT count() FROM app.logs_json_shadow WHERE Timestamp > now() - INTERVAL 6 HOUR AND toString(LogAttributes.`everr.github.workflow_job_step.number`) = '3';
```

Read the last three from `system.query_log` (`query_duration_ms`, `read_bytes`, `memory_usage`) next to the same three on `app.logs` with the map syntax. Keeper request rates come from the Cloud console's metrics for the same day. Then:

```sql
DROP VIEW app.logs_json_shadow_mv;
DROP TABLE app.logs_json_shadow;
```

If a merge failed on memory or the merge peak is above a quarter of the service's RAM, lower `max_dynamic_paths` to 128 in `init/03`, `init/10`, `init/12` and the two chDB templates, rebuild the throwaway container of Task 6, and re-run the query pairs of the 2026-09-06 benchmark at that limit before the cut-over. Record the outcome in the spec's open decision.

- [ ] **Step 3: Push and CI**

```bash
git push
```

Watch `gh pr checks 426` until every check passes.

---

## Self-review notes

- Spec coverage: schema (Task 6), ingest cloud (Task 7) and local (Task 8), the filter module (Task 2), the other readers and the decoders (Task 3), the app (Task 4), the dashboard catalog and the `everr/` resources (Task 5), skills and docs (Task 9), the gate and rollout (Task 10). Three surfaces were not in the spec and were found while writing this plan: the `errorFingerprint` UDF reads the map inside its body (Tasks 3, 6 and 9), the alert events view writes map literals (Task 6), and the built-in dashboard catalog plus the `everr/` resources are SQL text with 300 map reads (Task 5). The spec's "Query surfaces" section lists them now.
- Facts corrected against a 26.5 container while writing: `toString` of a missing path is `''` and typed `String`, not `NULL`; `toUInt32OrZero` refuses a `Dynamic` argument; a raw path comparison fails across mixed types. The "Facts" section and every task follow those.
- Placeholder scan: every code step shows the code; the two decoder tests in Task 3 describe the mock shape rather than repeating the file's mock helper, which the executor reads in place.
- Type consistency: `attributeText`, `attributeExists`, `attributeKeysColumn`, `jsonPath`, `flattenAttributes`, `everrRetentionDaysJson`, `everrStripRetentionKeys`, the four-argument `errorFingerprint`, and `newLogsJSONExporter(logger, cfg, handle)` are the same names in every task that uses them.
