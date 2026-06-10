# Alert Instances, Matcher Silences, And Alerts UI Split — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Per-row alert instances with state derived from ClickHouse events, Alertmanager-style matcher silences created from instance rows, and the Alerts UI split into list/detail routes with a notification-settings modal.

**Architecture:** Each bounded query result row maps to an instance (labels = string columns by default, `spec.instanceLabels` opt-in; fingerprint = sha256 of sorted labels). Instance state is derived from new `instance_fired`/`instance_resolved` events in `app.alert_events` (no Postgres instance table); the evaluator diffs the current rows against the derived firing set, writes events, updates rule aggregates, and notifies once per rule when new unsilenced instances fire or when the set empties. Silences stay rule-scoped in `alert_silences` and gain a `matchers` jsonb column evaluated against instance labels at delivery time and in the UI.

**Tech Stack:** TanStack Start/Router, Drizzle (schema only, NO migration generation), ClickHouse, Zod, Vitest, @everr/ui (Card/Dialog/DataTable/Badge/Select).

**Spec:** `docs/superpowers/specs/2026-06-11-alert-instances-ui-design.md`

**Conventions:**
- Run tests with `pnpm -F @everr/app test:ci <path>` from the repo root.
- Do NOT run `drizzle-kit generate`. Schema changes are Drizzle definitions only.
- No Claude/AI references in commits.

---

### Task 1: Matcher module (`data/alerts/matchers.ts`)

**Files:**
- Create: `packages/app/src/data/alerts/matchers.ts`
- Test: `packages/app/src/data/alerts/matchers.test.ts`

- [ ] **Step 1.1: Write the failing test**

```ts
// packages/app/src/data/alerts/matchers.test.ts
import { describe, expect, it } from "vitest";
import {
  findSilenceForInstance,
  type Matcher,
  MatchersSchema,
  matcherMatches,
  silenceMatchesInstance,
  validateMatchers,
} from "./matchers";

const m = (label: string, op: Matcher["op"], value: string): Matcher => ({
  label,
  op,
  value,
});

describe("matcherMatches", () => {
  it("matches equality and inequality", () => {
    expect(matcherMatches(m("route", "=", "/x"), { route: "/x" })).toBe(true);
    expect(matcherMatches(m("route", "=", "/x"), { route: "/y" })).toBe(false);
    expect(matcherMatches(m("route", "!=", "/x"), { route: "/y" })).toBe(true);
  });

  it("treats absent labels as empty string", () => {
    expect(matcherMatches(m("zone", "=", ""), { route: "/x" })).toBe(true);
    expect(matcherMatches(m("zone", "!=", "a"), {})).toBe(true);
  });

  it("anchors regex matchers", () => {
    expect(matcherMatches(m("route", "=~", "/api/.*"), { route: "/api/x" })).toBe(true);
    expect(matcherMatches(m("route", "=~", "api"), { route: "/api/x" })).toBe(false);
    expect(matcherMatches(m("route", "!~", "/api/.*"), { route: "/web" })).toBe(true);
  });
});

describe("silenceMatchesInstance", () => {
  it("requires all matchers to match", () => {
    const matchers = [m("route", "=", "/x"), m("code", "=", "500")];
    expect(silenceMatchesInstance(matchers, { route: "/x", code: "500" })).toBe(true);
    expect(silenceMatchesInstance(matchers, { route: "/x", code: "404" })).toBe(false);
  });

  it("matches everything with an empty matcher list", () => {
    expect(silenceMatchesInstance([], { anything: "v" })).toBe(true);
    expect(silenceMatchesInstance([], {})).toBe(true);
  });
});

describe("findSilenceForInstance", () => {
  it("returns the first matching silence", () => {
    const silences = [
      { id: "a", matchers: [m("route", "=", "/y")] },
      { id: "b", matchers: [m("route", "=", "/x")] },
    ];
    expect(findSilenceForInstance(silences, { route: "/x" })?.id).toBe("b");
    expect(findSilenceForInstance(silences, { route: "/z" })).toBeUndefined();
  });
});

describe("validateMatchers", () => {
  it("rejects invalid regex", () => {
    expect(() => validateMatchers([m("route", "=~", "(")])).toThrow(/invalid regex/);
    expect(() => validateMatchers([m("route", "=", "(")])).not.toThrow();
  });
});

describe("MatchersSchema", () => {
  it("accepts well-formed matchers and rejects unknown ops", () => {
    expect(MatchersSchema.safeParse([m("a", "=", "b")]).success).toBe(true);
    expect(MatchersSchema.safeParse([{ label: "a", op: "==", value: "b" }]).success).toBe(false);
    expect(MatchersSchema.safeParse([{ label: "", op: "=", value: "b" }]).success).toBe(false);
  });
});
```

- [ ] **Step 1.2: Run test to verify it fails**

Run: `pnpm -F @everr/app test:ci src/data/alerts/matchers.test.ts`
Expected: FAIL (module not found)

- [ ] **Step 1.3: Implement**

```ts
// packages/app/src/data/alerts/matchers.ts
import * as z from "zod";

export const MatcherSchema = z
  .object({
    label: z.string().min(1).max(200),
    op: z.enum(["=", "!=", "=~", "!~"]),
    value: z.string().max(1000),
  })
  .strict();

export const MatchersSchema = z.array(MatcherSchema).max(20);

export type Matcher = z.infer<typeof MatcherSchema>;

function compileAnchored(value: string): RegExp {
  return new RegExp(`^(?:${value})$`);
}

export function validateMatchers(matchers: readonly Matcher[]): void {
  for (const matcher of matchers) {
    if (matcher.op !== "=~" && matcher.op !== "!~") continue;
    try {
      compileAnchored(matcher.value);
    } catch {
      throw new Error(
        `invalid regex in matcher ${matcher.label}${matcher.op}"${matcher.value}"`,
      );
    }
  }
}

export function matcherMatches(
  matcher: Matcher,
  labels: Record<string, string>,
): boolean {
  const value = labels[matcher.label] ?? "";
  switch (matcher.op) {
    case "=":
      return value === matcher.value;
    case "!=":
      return value !== matcher.value;
    case "=~":
      return compileAnchored(matcher.value).test(value);
    case "!~":
      return !compileAnchored(matcher.value).test(value);
  }
}

export function silenceMatchesInstance(
  matchers: readonly Matcher[],
  labels: Record<string, string>,
): boolean {
  return matchers.every((matcher) => matcherMatches(matcher, labels));
}

export function findSilenceForInstance<S extends { matchers: Matcher[] }>(
  silences: readonly S[],
  labels: Record<string, string>,
): S | undefined {
  return silences.find((silence) =>
    silenceMatchesInstance(silence.matchers, labels),
  );
}
```

- [ ] **Step 1.4: Run test to verify it passes**

Run: `pnpm -F @everr/app test:ci src/data/alerts/matchers.test.ts`
Expected: PASS

- [ ] **Step 1.5: Commit**

```bash
git add packages/app/src/data/alerts/matchers.ts packages/app/src/data/alerts/matchers.test.ts
git commit -m "feat(alerts): add silence matcher module"
```

---

### Task 2: Instance identity and diff (`server/alerts/instances.ts`, pure parts)

**Files:**
- Create: `packages/app/src/server/alerts/instances.ts`
- Test: `packages/app/src/server/alerts/instances.test.ts`

- [ ] **Step 2.1: Write the failing test**

```ts
// packages/app/src/server/alerts/instances.test.ts
import { describe, expect, it } from "vitest";
import {
  diffInstances,
  extractInstanceLabels,
  instanceFingerprint,
  rowsToInstances,
} from "./instances";

describe("extractInstanceLabels", () => {
  it("uses string columns implicitly", () => {
    expect(
      extractInstanceLabels({ route: "/x", error_count: 7, ok: true, n: null }, []),
    ).toEqual({ route: "/x" });
  });

  it("uses explicit columns and stringifies values", () => {
    expect(
      extractInstanceLabels({ route: "/x", code: 500 }, ["route", "code"]),
    ).toEqual({ route: "/x", code: "500" });
  });

  it("maps absent explicit columns to empty string", () => {
    expect(extractInstanceLabels({ route: "/x" }, ["zone"])).toEqual({ zone: "" });
  });

  it("returns empty labels for rows with no string columns", () => {
    expect(extractInstanceLabels({ error_count: 7 }, [])).toEqual({});
  });
});

describe("instanceFingerprint", () => {
  it("is order independent and stable", () => {
    const a = instanceFingerprint({ a: "1", b: "2" });
    const b = instanceFingerprint({ b: "2", a: "1" });
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{16}$/);
  });

  it("differs for different labels", () => {
    expect(instanceFingerprint({ a: "1" })).not.toBe(instanceFingerprint({ a: "2" }));
    expect(instanceFingerprint({})).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe("rowsToInstances", () => {
  it("keeps the first row per fingerprint", () => {
    const instances = rowsToInstances(
      [
        { route: "/x", error_count: 9 },
        { route: "/x", error_count: 3 },
        { route: "/y", error_count: 1 },
      ],
      [],
    );
    expect(instances).toHaveLength(2);
    expect(instances[0].labels).toEqual({ route: "/x" });
    expect(instances[0].row).toEqual({ route: "/x", error_count: 9 });
  });
});

describe("diffInstances", () => {
  const inst = (route: string) => {
    const labels = { route };
    return { fingerprint: instanceFingerprint(labels), labels, row: { route } };
  };

  it("computes newlyFired, stillFiring, nowResolved", () => {
    const prevX = { fingerprint: instanceFingerprint({ route: "/x" }), labels: { route: "/x" } };
    const prevZ = { fingerprint: instanceFingerprint({ route: "/z" }), labels: { route: "/z" } };
    const diff = diffInstances([prevX, prevZ], [inst("/x"), inst("/y")]);
    expect(diff.stillFiring.map((i) => i.labels.route)).toEqual(["/x"]);
    expect(diff.newlyFired.map((i) => i.labels.route)).toEqual(["/y"]);
    expect(diff.nowResolved.map((i) => i.labels.route)).toEqual(["/z"]);
  });

  it("handles empty to empty", () => {
    const diff = diffInstances([], []);
    expect(diff.newlyFired).toEqual([]);
    expect(diff.stillFiring).toEqual([]);
    expect(diff.nowResolved).toEqual([]);
  });
});
```

- [ ] **Step 2.2: Run test to verify it fails**

Run: `pnpm -F @everr/app test:ci src/server/alerts/instances.test.ts`
Expected: FAIL (module not found)

- [ ] **Step 2.3: Implement (pure functions plus the firing-set fetch used later)**

```ts
// packages/app/src/server/alerts/instances.ts
import { createHash } from "node:crypto";
import { query } from "@/lib/clickhouse";

export interface FiringInstance {
  fingerprint: string;
  labels: Record<string, string>;
}

export interface AlertInstance extends FiringInstance {
  row: Record<string, unknown>;
}

export interface InstanceDiff {
  newlyFired: AlertInstance[];
  stillFiring: AlertInstance[];
  nowResolved: FiringInstance[];
}

export function extractInstanceLabels(
  row: Record<string, unknown>,
  instanceLabelColumns: readonly string[],
): Record<string, string> {
  const labels: Record<string, string> = {};
  if (instanceLabelColumns.length > 0) {
    for (const column of instanceLabelColumns) {
      const value = row[column];
      labels[column] = value === undefined || value === null ? "" : String(value);
    }
    return labels;
  }
  for (const [key, value] of Object.entries(row)) {
    if (typeof value === "string") labels[key] = value;
  }
  return labels;
}

export function instanceFingerprint(labels: Record<string, string>): string {
  const canonical = Object.keys(labels)
    .sort()
    .map((key) => `${key}=${labels[key]}`)
    .join("\0");
  return createHash("sha256").update(canonical).digest("hex").slice(0, 16);
}

export function rowsToInstances(
  rows: readonly Record<string, unknown>[],
  instanceLabelColumns: readonly string[],
): AlertInstance[] {
  const instances: AlertInstance[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const labels = extractInstanceLabels(row, instanceLabelColumns);
    const fingerprint = instanceFingerprint(labels);
    if (seen.has(fingerprint)) continue;
    seen.add(fingerprint);
    instances.push({ fingerprint, labels, row });
  }
  return instances;
}

export function diffInstances(
  previous: readonly FiringInstance[],
  current: readonly AlertInstance[],
): InstanceDiff {
  const previousByFingerprint = new Set(previous.map((i) => i.fingerprint));
  const currentFingerprints = new Set(current.map((i) => i.fingerprint));
  return {
    newlyFired: current.filter((i) => !previousByFingerprint.has(i.fingerprint)),
    stillFiring: current.filter((i) => previousByFingerprint.has(i.fingerprint)),
    nowResolved: previous.filter((i) => !currentFingerprints.has(i.fingerprint)),
  };
}

function parseLabels(json: string): Record<string, string> {
  try {
    const parsed: unknown = JSON.parse(json);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return Object.fromEntries(
        Object.entries(parsed as Record<string, unknown>).map(([k, v]) => [
          k,
          String(v),
        ]),
      );
    }
  } catch {
    // fall through to empty labels
  }
  return {};
}

// Derives the currently firing instance set from instance transition events:
// the latest instance event per fingerprint wins. Safe because evaluations for
// one definition never run concurrently (per-org Graphile queue) and event
// inserts use wait_for_async_insert=1.
export async function fetchFiringInstances(def: {
  id: string;
  organizationId: string;
  repoid: string;
  slug: string;
}): Promise<FiringInstance[]> {
  const rows = await query<{ fingerprint: string; labelsJson: string }>(
    `
      SELECT
        instance_fingerprint AS fingerprint,
        argMax(instance_labels_json, event_time) AS labelsJson,
        argMax(event_type, event_time) AS lastEventType
      FROM app.alert_events
      WHERE organization_id = {organizationId:String}
        AND repoid = {repoid:String}
        AND slug = {slug:String}
        AND alert_definition_id = {alertDefinitionId:String}
        AND event_type IN ('instance_fired', 'instance_resolved')
      GROUP BY instance_fingerprint
      HAVING lastEventType = 'instance_fired'
    `,
    def.organizationId,
    {
      organizationId: def.organizationId,
      repoid: def.repoid,
      slug: def.slug,
      alertDefinitionId: def.id,
    },
  );
  return rows.map((row) => ({
    fingerprint: row.fingerprint,
    labels: parseLabels(row.labelsJson),
  }));
}
```

- [ ] **Step 2.4: Run test to verify it passes**

Run: `pnpm -F @everr/app test:ci src/server/alerts/instances.test.ts`
Expected: PASS

- [ ] **Step 2.5: Commit**

```bash
git add packages/app/src/server/alerts/instances.ts packages/app/src/server/alerts/instances.test.ts
git commit -m "feat(alerts): instance labels, fingerprints, diff, firing-set derivation"
```

---

### Task 3: ClickHouse DDL + `AlertEventRow` + instance event builders

**Files:**
- Modify: `clickhouse/init/12-create-alert-events.sql`
- Modify: `packages/app/src/lib/clickhouse.ts:195-208` (AlertEventRow)
- Modify: `packages/app/src/server/alerts/events.ts`
- Test: `packages/app/src/server/alerts/events.test.ts` (add cases)

- [ ] **Step 3.1: Add failing test for instance event builder**

Append to `packages/app/src/server/alerts/events.test.ts`:

```ts
import { buildInstanceEvent } from "./events"; // merge into existing imports

describe("buildInstanceEvent", () => {
  const def = { id: "d1", organizationId: "org-1", repoid: "r1", slug: "s1" };

  it("builds instance_fired with labels and source row", () => {
    const event = buildInstanceEvent({
      def,
      eventType: "instance_fired",
      scheduledFor: new Date("2026-06-11T10:00:00.000Z"),
      fingerprint: "abc123",
      labels: { route: "/x" },
      row: { route: "/x", error_count: 9 },
    });
    expect(event.event_type).toBe("instance_fired");
    expect(event.instance_fingerprint).toBe("abc123");
    expect(JSON.parse(event.instance_labels_json ?? "")).toEqual({ route: "/x" });
    expect(JSON.parse(event.evidence_json ?? "")).toEqual({ route: "/x", error_count: 9 });
    expect(event.row_count).toBe(1);
  });

  it("builds instance_resolved without a row", () => {
    const event = buildInstanceEvent({
      def,
      eventType: "instance_resolved",
      scheduledFor: new Date("2026-06-11T10:00:00.000Z"),
      fingerprint: "abc123",
      labels: { route: "/x" },
    });
    expect(event.event_type).toBe("instance_resolved");
    expect(event.evidence_json).toBe("{}");
    expect(event.row_count).toBe(0);
  });

  it("caps oversized labels json", () => {
    const event = buildInstanceEvent({
      def,
      eventType: "instance_fired",
      scheduledFor: new Date("2026-06-11T10:00:00.000Z"),
      fingerprint: "abc123",
      labels: { big: "x".repeat(70 * 1024) },
      row: { big: "x".repeat(70 * 1024) },
    });
    expect(event.instance_labels_json).toBe("{}");
    expect(event.evidence_json).toBe("{}");
  });
});
```

- [ ] **Step 3.2: Run test to verify it fails**

Run: `pnpm -F @everr/app test:ci src/server/alerts/events.test.ts`
Expected: FAIL (`buildInstanceEvent` not exported)

- [ ] **Step 3.3: Implement**

In `packages/app/src/lib/clickhouse.ts`, extend `AlertEventRow`:

```ts
export interface AlertEventRow {
  organization_id: string;
  alert_definition_id: string;
  repoid: string;
  slug: string;
  event_type:
    | "firing"
    | "resolved"
    | "evaluation_failed"
    | "delivery_attempt"
    | "instance_fired"
    | "instance_resolved";
  evaluation_scheduled_at?: string;
  row_count?: number;
  evidence_truncated?: 0 | 1;
  evidence_json?: string;
  delivery_target_type?: "" | "email" | "telegram";
  delivery_outcome?: "" | "sent" | "failed" | "silenced";
  silence_id?: string;
  instance_fingerprint?: string;
  instance_labels_json?: string;
}
```

In `packages/app/src/server/alerts/events.ts`, add after `buildEvaluationEvent`:

```ts
function boundJson(value: unknown): string {
  const json = JSON.stringify(value);
  return Buffer.byteLength(json, "utf8") > MAX_EVIDENCE_BYTES ? "{}" : json;
}

export function buildInstanceEvent(opts: {
  def: { id: string; organizationId: string; repoid: string; slug: string };
  eventType: "instance_fired" | "instance_resolved";
  scheduledFor: Date;
  fingerprint: string;
  labels: Record<string, string>;
  row?: Record<string, unknown>;
}): AlertEventRow {
  return {
    organization_id: opts.def.organizationId,
    alert_definition_id: opts.def.id,
    repoid: opts.def.repoid,
    slug: opts.def.slug,
    event_type: opts.eventType,
    evaluation_scheduled_at: clickhouseDateTime64(opts.scheduledFor),
    instance_fingerprint: opts.fingerprint,
    instance_labels_json: boundJson(opts.labels),
    evidence_json: opts.row ? boundJson(opts.row) : "{}",
    row_count: opts.row ? 1 : 0,
  };
}
```

In `clickhouse/init/12-create-alert-events.sql`:
1. Add to the CREATE TABLE column list after `silence_id String DEFAULT ''`:

```sql
  ,
  instance_fingerprint String DEFAULT '',
  instance_labels_json String DEFAULT '{}'
```

2. In the MV `LogAttributes` map, add after `'alert.evidence_json', evidence_json`:

```sql
    ,
    'alert.instance_fingerprint', instance_fingerprint,
    'alert.instance_labels', instance_labels_json
```

3. Because the table/MV use `IF NOT EXISTS`, add idempotent upgrade statements at the end of the file (before the MV, replacing it):

```sql
ALTER TABLE app.alert_events ADD COLUMN IF NOT EXISTS instance_fingerprint String DEFAULT '';
ALTER TABLE app.alert_events ADD COLUMN IF NOT EXISTS instance_labels_json String DEFAULT '{}';
DROP VIEW IF EXISTS app.alert_events_logs_mv;
```

Order in file: CREATE TABLE (with new columns) → GRANTs/policy → ALTER/DROP upgrade statements → `CREATE MATERIALIZED VIEW IF NOT EXISTS app.alert_events_logs_mv` (with new attributes).

- [ ] **Step 3.4: Run tests**

Run: `pnpm -F @everr/app test:ci src/server/alerts/events.test.ts src/lib/clickhouse.test.ts`
Expected: PASS

- [ ] **Step 3.5: Commit**

```bash
git add clickhouse/init/12-create-alert-events.sql packages/app/src/lib/clickhouse.ts packages/app/src/server/alerts/events.ts packages/app/src/server/alerts/events.test.ts
git commit -m "feat(alerts): instance event types and columns in alert_events"
```

---

### Task 4: Drizzle schema columns

**Files:**
- Modify: `packages/app/src/db/schema/alerts.ts`

- [ ] **Step 4.1: Add columns (no migration generation)**

In `alertDefinitions`, after `lastEvidenceSnapshot`:

```ts
    firingInstanceCount: integer("firing_instance_count").notNull().default(0),
    instanceLabelColumns: jsonb("instance_label_columns")
      .notNull()
      .default(sql`'[]'::jsonb`)
      .$type<string[]>(),
```

Add above `alertSilences`:

```ts
export type AlertSilenceMatcher = {
  label: string;
  op: "=" | "!=" | "=~" | "!~";
  value: string;
};
```

In `alertSilences`, after `reason`:

```ts
    matchers: jsonb("matchers")
      .notNull()
      .default(sql`'[]'::jsonb`)
      .$type<AlertSilenceMatcher[]>(),
```

- [ ] **Step 4.2: Typecheck**

Run: `pnpm -F @everr/app typecheck`
Expected: PASS (schema-only change)

- [ ] **Step 4.3: Commit**

```bash
git add packages/app/src/db/schema/alerts.ts
git commit -m "feat(alerts): schema for firing instance count, instance label columns, silence matchers"
```

---

### Task 5: YAML `spec.instanceLabels` + apply persistence/validation

**Files:**
- Modify: `packages/app/src/data/alerts/schema.ts`
- Modify: `packages/app/src/data/alerts/apply.server.ts`
- Test: `packages/app/src/data/alerts/schema.test.ts`, `packages/app/src/data/alerts/apply.server.test.ts` (add cases)

- [ ] **Step 5.1: Failing schema test**

Append to `packages/app/src/data/alerts/schema.test.ts` (match existing test style — a valid rule fixture exists there; reuse it via spread):

```ts
it("accepts optional spec.instanceLabels", () => {
  const result = AlertRuleYamlSchema.safeParse({
    ...validRule,
    spec: { ...validRule.spec, instanceLabels: ["route"] },
  });
  expect(result.success).toBe(true);
});

it("rejects empty instanceLabels arrays and entries", () => {
  expect(
    AlertRuleYamlSchema.safeParse({
      ...validRule,
      spec: { ...validRule.spec, instanceLabels: [] },
    }).success,
  ).toBe(false);
  expect(
    AlertRuleYamlSchema.safeParse({
      ...validRule,
      spec: { ...validRule.spec, instanceLabels: [""] },
    }).success,
  ).toBe(false);
});
```

(If the existing test file names its fixture differently, adapt the fixture name, not the assertions.)

- [ ] **Step 5.2: Failing apply test**

Append to `packages/app/src/data/alerts/apply.server.test.ts` (the file mocks `querySqlApiWithMeta` and the db; follow its existing fixtures for a resource entry):

```ts
it("rejects instanceLabels columns the query does not return", async () => {
  // copy the existing happy-path resource fixture, add
  // spec.instanceLabels: ["missing"] and keep the mocked query result
  // columns at ["route"]; expect applyAlertSpecs to reject with
  // /instanceLabels.*missing/.
});

it("persists instanceLabelColumns on create", async () => {
  // existing create-path fixture plus spec.instanceLabels: ["route"];
  // assert the inserted values include instanceLabelColumns: ["route"].
});
```

Write these as real tests against the file's existing mock helpers (the file already asserts inserted values for creates).

- [ ] **Step 5.3: Run to verify failures**

Run: `pnpm -F @everr/app test:ci src/data/alerts/schema.test.ts src/data/alerts/apply.server.test.ts`
Expected: FAIL

- [ ] **Step 5.4: Implement**

`schema.ts` — in `spec`:

```ts
        query: nonEmptyString,
        instanceLabels: z.array(nonEmptyString).min(1).optional(),
```

`apply.server.ts`:
- `DesiredAlert` and `ExistingAlert` gain `instanceLabelColumns: string[]`.
- In `buildDesiredAlerts`, after `validateTopColumns` checks:

```ts
    const instanceLabelColumns = parsed.rule.spec.instanceLabels ?? [];
    const columnNames = new Set(result.columns);
    for (const column of instanceLabelColumns) {
      if (!columnNames.has(column)) {
        throw validationError(
          parsed.path,
          `instanceLabels references column "${column}" which the query does not return`,
        );
      }
    }
```

- Include `instanceLabelColumns` in the `out.push({...})` object.
- `needsUpdate` adds:

```ts
    JSON.stringify(existing.instanceLabelColumns) !==
      JSON.stringify(desired.instanceLabelColumns) ||
```

- `activeValues` includes `instanceLabelColumns: desired.instanceLabelColumns`.
- The `existing` select adds `instanceLabelColumns: alertDefinitions.instanceLabelColumns`.

- [ ] **Step 5.5: Run tests**

Run: `pnpm -F @everr/app test:ci src/data/alerts/schema.test.ts src/data/alerts/apply.server.test.ts`
Expected: PASS

- [ ] **Step 5.6: Commit**

```bash
git add packages/app/src/data/alerts/schema.ts packages/app/src/data/alerts/schema.test.ts packages/app/src/data/alerts/apply.server.ts packages/app/src/data/alerts/apply.server.test.ts
git commit -m "feat(alerts): spec.instanceLabels with apply-time validation"
```

---

### Task 6: Instance-aware delivery

**Files:**
- Modify: `packages/app/src/server/alerts/delivery.ts`
- Test: `packages/app/src/server/alerts/delivery.test.ts` (rewrite affected cases)

- [ ] **Step 6.1: Write failing tests**

Update `packages/app/src/server/alerts/delivery.test.ts`. Keep its existing mock structure (db select chains for settings + silences, mailer, telegram, insertAlertEvents). New/changed behavior to cover:

```ts
const instances = (routes: string[]) =>
  routes.map((route) => ({ fingerprint: route, labels: { route } }));

// 1. firing with no silences sends and lists instances
//    deliverAlertNotification({ def, kind: "firing", summary: "s", description: "",
//      firingCount: 2, instances: instances(["/a", "/b"]) })
//    expect telegram/mailer called with text containing "Firing instances: 2"
//    and "route=/a"

// 2. matcher silence suppresses fully matched delivery:
//    silences mock returns [{ id: "sil-1", matchers: [{ label: "route", op: "=", value: "/a" }] }]
//    instances(["/a"]) -> no send; insertAlertEvents called with
//    delivery_outcome "silenced" and silence_id "sil-1"

// 3. partial silence excludes matched instances but still sends:
//    same silence, instances(["/a", "/b"]) -> send happens, text contains
//    "route=/b" and NOT "route=/a"

// 4. legacy whole-rule silence (matchers: []) still suppresses everything

// 5. resolved + notifyOnResolved=false -> no send (existing case, new input shape)
```

Write these as concrete tests mirroring the existing file's mocking. The silences db mock must now return an array (all active silences), not `.limit(1)` — check the implementation below for the query shape.

- [ ] **Step 6.2: Run to verify failures**

Run: `pnpm -F @everr/app test:ci src/server/alerts/delivery.test.ts`
Expected: FAIL

- [ ] **Step 6.3: Implement**

Rewrite `deliverAlertNotification` in `packages/app/src/server/alerts/delivery.ts`:

```ts
import { and, eq, gt, isNull, lte } from "drizzle-orm";
import { findSilenceForInstance } from "@/data/alerts/matchers";
import { db } from "@/db/client";
import { alertSettings, alertSilences } from "@/db/schema";
import { type AlertEventRow, insertAlertEvents } from "@/lib/clickhouse";
import { mailer } from "@/lib/mailer.server";
import { sendTelegramMessage } from "@/lib/telegram.server";
import { exceptionAttributes, serverLogger } from "@/telemetry/logger";
import type { FiringInstance } from "./instances";
import { buildDeliveryEvent } from "./events";

const MAX_LISTED_INSTANCES = 10;

export interface DeliveryInput {
  def: { id: string; organizationId: string; repoid: string; slug: string };
  kind: "firing" | "resolved";
  summary: string;
  description: string;
  // Current firing instance count after this evaluation.
  firingCount: number;
  // newlyFired for "firing", nowResolved for "resolved".
  instances: FiringInstance[];
}

function formatLabels(labels: Record<string, string>): string {
  const entries = Object.entries(labels).sort(([a], [b]) => a.localeCompare(b));
  if (entries.length === 0) return "(no labels)";
  return entries.map(([key, value]) => `${key}=${value}`).join(", ");
}

function buildText(input: DeliveryInput, listed: FiringInstance[]): string {
  const lines = [input.summary];
  if (input.description) lines.push("", input.description);
  if (input.kind === "firing") {
    lines.push("", `Firing instances: ${input.firingCount}`);
  } else {
    lines.push("", "All instances resolved");
  }
  for (const instance of listed.slice(0, MAX_LISTED_INSTANCES)) {
    lines.push(`- ${formatLabels(instance.labels)}`);
  }
  if (listed.length > MAX_LISTED_INSTANCES) {
    lines.push(`… and ${listed.length - MAX_LISTED_INSTANCES} more`);
  }
  return lines.join("\n");
}

export async function deliverAlertNotification(
  input: DeliveryInput,
): Promise<void> {
  const { def, kind } = input;

  const [settings] = await db
    .select()
    .from(alertSettings)
    .where(eq(alertSettings.organizationId, def.organizationId))
    .limit(1);
  const delivery = settings?.delivery;
  if (!delivery) return;
  if (kind === "resolved" && !delivery.notifyOnResolved) return;

  const now = new Date();
  const silences = await db
    .select({
      id: alertSilences.id,
      matchers: alertSilences.matchers,
    })
    .from(alertSilences)
    .where(
      and(
        eq(alertSilences.organizationId, def.organizationId),
        eq(alertSilences.alertDefinitionId, def.id),
        lte(alertSilences.startsAt, now),
        gt(alertSilences.endsAt, now),
        isNull(alertSilences.cancelledAt),
      ),
    );

  const targets: ("email" | "telegram")[] = [];
  if (delivery.email?.enabled && delivery.email.to.length > 0) {
    targets.push("email");
  }
  if (delivery.telegram?.enabled && delivery.telegram.chatIds.length > 0) {
    targets.push("telegram");
  }
  if (targets.length === 0) return;

  const unsilenced: FiringInstance[] = [];
  let suppressingSilenceId = "";
  for (const instance of input.instances) {
    const silence = findSilenceForInstance(silences, instance.labels);
    if (silence) {
      suppressingSilenceId = suppressingSilenceId || silence.id;
    } else {
      unsilenced.push(instance);
    }
  }

  const events: AlertEventRow[] = [];
  if (unsilenced.length === 0) {
    for (const target of targets) {
      events.push(
        buildDeliveryEvent({
          def,
          target,
          outcome: "silenced",
          silenceId: suppressingSilenceId,
        }),
      );
    }
    await recordDeliveryEvents(events);
    return;
  }

  const subject = `[${kind}] ${def.slug}`;
  const text = buildText(input, unsilenced);

  // email + telegram sending and event recording unchanged from current file
  // (same try/catch blocks, same buildDeliveryEvent outcomes, same
  // recordDeliveryEvents at the end), with `text` as built above.
  ...
}
```

Keep `recordDeliveryEvents` and the email/telegram send blocks exactly as they are today.

Note: `instances` is never empty when called (the evaluator only calls on newlyFired non-empty or on resolve with nowResolved non-empty); if it is empty anyway, `unsilenced` is empty and `silences` may be empty too — guard: when `input.instances.length === 0`, treat as unsilenced delivery with an empty list (skip the silenced branch). Add `if (input.instances.length > 0 && unsilenced.length === 0)` as the silenced condition.

- [ ] **Step 6.4: Run tests**

Run: `pnpm -F @everr/app test:ci src/server/alerts/delivery.test.ts`
Expected: PASS

- [ ] **Step 6.5: Commit**

```bash
git add packages/app/src/server/alerts/delivery.ts packages/app/src/server/alerts/delivery.test.ts
git commit -m "feat(alerts): matcher-aware notification delivery with instance lists"
```

---

### Task 7: Evaluator rewrite on instance diffs

**Files:**
- Modify: `packages/app/src/server/alerts/evaluate.ts`
- Delete: `packages/app/src/server/alerts/transitions.ts`, `packages/app/src/server/alerts/transitions.test.ts`
- Test: `packages/app/src/server/alerts/evaluate.test.ts` (rewrite)

- [ ] **Step 7.1: Rewrite the test file**

Replace the describe body of `packages/app/src/server/alerts/evaluate.test.ts`. Keep the existing mock prelude, and add a mock for `./instances`' `fetchFiringInstances` (mock the module but keep the pure functions real):

```ts
const fetchFiring = vi.fn();
vi.mock("./instances", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./instances")>();
  return {
    ...actual,
    fetchFiringInstances: (...args: unknown[]) => fetchFiring(...args),
  };
});
```

`baseDef` gains `instanceLabelColumns: []`, `firingInstanceCount: 0`.

Test cases (use `instanceFingerprint` from the real module to build expected fingerprints):

```ts
import { instanceFingerprint } from "./instances";

const fp = (route: string) => instanceFingerprint({ route });
const firing = (route: string) => ({ fingerprint: fp(route), labels: { route } });

it("fires new instances and notifies", async () => {
  definitionRows.mockReturnValue([baseDef]);
  fetchFiring.mockResolvedValue([]);
  sqlApi.mockResolvedValue({ rows: [{ route: "/x" }], columns: ["route"] });

  await evaluateAlert({ alertDefinitionId, scheduledFor: "2026-06-10T12:00:00.000Z" });

  const inserted = insertEvents.mock.calls[0][0] as Record<string, unknown>[];
  expect(inserted.map((e) => e.event_type)).toEqual(["instance_fired", "firing"]);
  expect(inserted[0]).toMatchObject({ instance_fingerprint: fp("/x") });
  expect(updates.some((u) => (u as { currentState?: string }).currentState === "firing")).toBe(true);
  expect(updates.some((u) => (u as { firingInstanceCount?: number }).firingInstanceCount === 1)).toBe(true);
  expect(deliver).toHaveBeenCalledWith(
    expect.objectContaining({ kind: "firing", firingCount: 1 }),
  );
});

it("re-notifies when a new instance joins an already firing rule", async () => {
  definitionRows.mockReturnValue([{ ...baseDef, currentState: "firing" }]);
  fetchFiring.mockResolvedValue([firing("/x")]);
  sqlApi.mockResolvedValue({ rows: [{ route: "/x" }, { route: "/y" }], columns: ["route"] });

  await evaluateAlert({ alertDefinitionId, scheduledFor: "2026-06-10T12:00:00.000Z" });

  const inserted = insertEvents.mock.calls[0][0] as Record<string, unknown>[];
  expect(inserted.map((e) => e.event_type)).toEqual(["instance_fired", "firing"]);
  expect(deliver).toHaveBeenCalledWith(
    expect.objectContaining({
      kind: "firing",
      firingCount: 2,
      instances: [expect.objectContaining({ fingerprint: fp("/y") })],
    }),
  );
});

it("does not notify or write events when the firing set is unchanged", async () => {
  definitionRows.mockReturnValue([{ ...baseDef, currentState: "firing" }]);
  fetchFiring.mockResolvedValue([firing("/x")]);
  sqlApi.mockResolvedValue({ rows: [{ route: "/x" }], columns: ["route"] });

  await evaluateAlert({ alertDefinitionId, scheduledFor: "2026-06-10T12:00:00.000Z" });

  expect(insertEvents).not.toHaveBeenCalled();
  expect(deliver).not.toHaveBeenCalled();
  expect(updates.length).toBeGreaterThan(0); // lastSeenAt / evidence refresh
});

it("resolves instances and the rule when the result empties", async () => {
  definitionRows.mockReturnValue([{ ...baseDef, currentState: "firing" }]);
  fetchFiring.mockResolvedValue([firing("/x")]);
  sqlApi.mockResolvedValue({ rows: [], columns: ["route"] });

  await evaluateAlert({ alertDefinitionId, scheduledFor: "2026-06-10T12:00:00.000Z" });

  const inserted = insertEvents.mock.calls[0][0] as Record<string, unknown>[];
  expect(inserted.map((e) => e.event_type)).toEqual(["instance_resolved", "resolved"]);
  expect(deliver).toHaveBeenCalledWith(
    expect.objectContaining({ kind: "resolved", firingCount: 0 }),
  );
});

it("resolves part of the set without a rule-level resolved event", async () => {
  definitionRows.mockReturnValue([{ ...baseDef, currentState: "firing" }]);
  fetchFiring.mockResolvedValue([firing("/x"), firing("/y")]);
  sqlApi.mockResolvedValue({ rows: [{ route: "/x" }], columns: ["route"] });

  await evaluateAlert({ alertDefinitionId, scheduledFor: "2026-06-10T12:00:00.000Z" });

  const inserted = insertEvents.mock.calls[0][0] as Record<string, unknown>[];
  expect(inserted.map((e) => e.event_type)).toEqual(["instance_resolved"]);
  expect(deliver).not.toHaveBeenCalled();
});

it("records evaluation_failed when the firing-set read fails", async () => {
  definitionRows.mockReturnValue([{ ...baseDef, currentState: "firing" }]);
  sqlApi.mockResolvedValue({ rows: [{ route: "/x" }], columns: ["route"] });
  fetchFiring.mockRejectedValue(new Error("ch down"));

  await evaluateAlert({ alertDefinitionId, scheduledFor: "2026-06-10T12:00:00.000Z" });

  expect(updates.some((u) => (u as { currentState?: string }).currentState !== undefined)).toBe(false);
  expect(insertEvents).toHaveBeenCalledWith([
    expect.objectContaining({ event_type: "evaluation_failed" }),
  ]);
  expect(deliver).not.toHaveBeenCalled();
});
```

Keep the existing `evaluation_failed` (query error), inactive no-op, and malformed-payload tests, updating `baseDef` as above.

- [ ] **Step 7.2: Run to verify failures**

Run: `pnpm -F @everr/app test:ci src/server/alerts/evaluate.test.ts`
Expected: FAIL

- [ ] **Step 7.3: Implement**

Replace the post-query portion of `evaluateAlert` in `packages/app/src/server/alerts/evaluate.ts` (imports: drop `computeTransition`/`AlertState`, add `diffInstances`, `fetchFiringInstances`, `rowsToInstances`, `type FiringInstance` from `./instances`, `buildInstanceEvent` from `./events`):

```ts
  const evidence = boundEvidence(rows);

  let previous: FiringInstance[];
  try {
    previous = await fetchFiringInstances(def);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await db
      .update(alertDefinitions)
      .set({
        lastEvaluationStatus: "error",
        lastEvaluationError: message,
        lastEvaluatedAt: now,
      })
      .where(eq(alertDefinitions.id, def.id));
    await insertAlertEvents([
      buildEvaluationEvent({ def, eventType: "evaluation_failed", scheduledFor }),
    ]);
    serverLogger.error("alerts.evaluate.firing_set_read_failed", {
      ...exceptionAttributes(error),
      "alert.definition_id": def.id,
    });
    return;
  }

  const current = rowsToInstances(evidence.rows, def.instanceLabelColumns ?? []);
  const diff = diffInstances(previous, current);
  const wasFiring = previous.length > 0;
  const isFiring = current.length > 0;

  const summary = renderMessage(def.summaryTemplate, {
    rowCount: evidence.rowCount,
    firstRow: evidence.firstRow,
  });
  const description = def.descriptionTemplate
    ? renderMessage(def.descriptionTemplate, {
        rowCount: evidence.rowCount,
        firstRow: evidence.firstRow,
      })
    : "";

  await db
    .update(alertDefinitions)
    .set({
      lastEvaluationStatus: "ok",
      lastEvaluationError: "",
      lastEvaluatedAt: now,
      lastRowCount: evidence.rowCount,
      lastEvidenceSnapshot: evidence.rows,
      currentState: isFiring ? "firing" : "resolved",
      firingInstanceCount: current.length,
      ...(isFiring ? { lastSeenAt: now } : {}),
      ...(diff.newlyFired.length > 0 && !wasFiring ? { lastFiredAt: now } : {}),
      ...(wasFiring && !isFiring ? { lastResolvedAt: now } : {}),
    })
    .where(eq(alertDefinitions.id, def.id));

  const events = [
    ...diff.newlyFired.map((instance) =>
      buildInstanceEvent({
        def,
        eventType: "instance_fired",
        scheduledFor,
        fingerprint: instance.fingerprint,
        labels: instance.labels,
        row: instance.row,
      }),
    ),
    ...diff.nowResolved.map((instance) =>
      buildInstanceEvent({
        def,
        eventType: "instance_resolved",
        scheduledFor,
        fingerprint: instance.fingerprint,
        labels: instance.labels,
      }),
    ),
  ];
  if (diff.newlyFired.length > 0) {
    events.push(
      buildEvaluationEvent({ def, eventType: "firing", scheduledFor, evidence }),
    );
  }
  if (wasFiring && !isFiring) {
    events.push(
      buildEvaluationEvent({ def, eventType: "resolved", scheduledFor, evidence }),
    );
  }
  if (events.length > 0) await insertAlertEvents(events);

  if (diff.newlyFired.length > 0) {
    await deliverAlertNotification({
      def,
      kind: "firing",
      summary,
      description,
      firingCount: current.length,
      instances: diff.newlyFired.map(({ fingerprint, labels }) => ({
        fingerprint,
        labels,
      })),
    });
  } else if (wasFiring && !isFiring) {
    await deliverAlertNotification({
      def,
      kind: "resolved",
      summary,
      description,
      firingCount: 0,
      instances: diff.nowResolved,
    });
  }
```

Delete `transitions.ts` and `transitions.test.ts`; remove their imports.

- [ ] **Step 7.4: Run tests**

Run: `pnpm -F @everr/app test:ci src/server/alerts/`
Expected: PASS

- [ ] **Step 7.5: Commit**

```bash
git add -A packages/app/src/server/alerts
git commit -m "feat(alerts): evaluate per-row instances with diff-driven events and notifications"
```

---

### Task 8: Data layer (`data/alerts/server.ts`)

**Files:**
- Modify: `packages/app/src/data/alerts/server.ts`
- Test: `packages/app/src/data/alerts/server.test.ts` (add/adjust cases)

Changes:

1. **`AlertSummary`**: replace `activeSilence` with `firingInstanceCount: number` and `activeSilenceCount: number`. Drop `AlertSummaryRow` silence fields. `alertListColumns` drops the four `silence*` columns, adds `firingInstanceCount: alertDefinitions.firingInstanceCount` and:

```ts
import { sql } from "drizzle-orm";

const activeSilenceCount = sql<number>`(
  select count(*)::int
  from alert_silences s
  where s.alert_definition_id = ${alertDefinitions.id}
    and s.starts_at <= now()
    and s.ends_at > now()
    and s.cancelled_at is null
)`.as("active_silence_count");
```

`listAlerts` and `getAlertRow` drop the `leftJoin(alertSilences, ...)` (multiple active silences would duplicate rows) and select `activeSilenceCount`. `toAlertSummary` maps the two new fields (`activeSilenceCount: Number(row.activeSilenceCount)`).

2. **`listAlertEvents`**: add to the WHERE clause:

```sql
            AND event_type NOT IN ('instance_fired', 'instance_resolved')
```

3. **New `listAlertInstances`**:

```ts
export type AlertInstanceSummary = {
  fingerprint: string;
  labels: Record<string, string>;
  state: "firing" | "resolved";
  lastFiredAt: string | null;
  lastResolvedAt: string | null;
  lastRow: Record<string, unknown>;
  silenced: boolean;
};

export const listAlertInstances = createAuthenticatedServerFn({ method: "GET" })
  .inputValidator(alertIdInput)
  .handler(async ({ data: { alertId }, context: { session, clickhouse } }) => {
    const organizationId = session.session.activeOrganizationId;
    const alert = await getAlertRow(alertId, organizationId);
    if (!alert) throw new Error("Alert not found");

    const now = new Date();
    const silences = await db
      .select({ id: alertSilences.id, matchers: alertSilences.matchers })
      .from(alertSilences)
      .where(
        and(
          eq(alertSilences.organizationId, organizationId),
          eq(alertSilences.alertDefinitionId, alertId),
          lte(alertSilences.startsAt, now),
          gt(alertSilences.endsAt, now),
          isNull(alertSilences.cancelledAt),
        ),
      );

    const rows = await clickhouse.query<{
      fingerprint: string;
      lastEventType: string;
      labelsJson: string;
      lastFiredEvidenceJson: string;
      lastFiredAt: string;
      lastResolvedAt: string;
    }>(
      `
        SELECT
          instance_fingerprint AS fingerprint,
          argMax(event_type, event_time) AS lastEventType,
          argMax(instance_labels_json, event_time) AS labelsJson,
          argMaxIf(evidence_json, event_time, event_type = 'instance_fired') AS lastFiredEvidenceJson,
          if(countIf(event_type = 'instance_fired') = 0, '', ${clickhouseIsoMillis("maxIf(event_time, event_type = 'instance_fired')")}) AS lastFiredAt,
          if(countIf(event_type = 'instance_resolved') = 0, '', ${clickhouseIsoMillis("maxIf(event_time, event_type = 'instance_resolved')")}) AS lastResolvedAt
        FROM app.alert_events
        WHERE organization_id = {organizationId:String}
          AND repoid = {repoid:String}
          AND slug = {slug:String}
          AND alert_definition_id = {alertDefinitionId:String}
          AND event_type IN ('instance_fired', 'instance_resolved')
        GROUP BY instance_fingerprint
        ORDER BY (lastEventType = 'instance_fired') DESC, max(event_time) DESC
        LIMIT 500
      `,
      {
        organizationId,
        repoid: alert.repoid,
        slug: alert.slug,
        alertDefinitionId: alert.id,
      },
    );

    return rows.map((row) => {
      const labels = parseJsonRecord(row.labelsJson);
      return {
        fingerprint: row.fingerprint,
        labels,
        state: row.lastEventType === "instance_fired" ? "firing" : "resolved",
        lastFiredAt: row.lastFiredAt || null,
        lastResolvedAt: row.lastResolvedAt || null,
        lastRow: parseJsonObject(row.lastFiredEvidenceJson),
        silenced: Boolean(findSilenceForInstance(silences, labels)),
      } satisfies AlertInstanceSummary;
    });
  });
```

With small local helpers:

```ts
function parseJsonObject(json: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(json);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // ignore malformed snapshots
  }
  return {};
}

function parseJsonRecord(json: string): Record<string, string> {
  return Object.fromEntries(
    Object.entries(parseJsonObject(json)).map(([k, v]) => [k, String(v)]),
  );
}
```

Imports add `findSilenceForInstance` and `MatchersSchema, validateMatchers, type Matcher` from `./matchers`.

4. **New `listAlertSilences`**:

```ts
export type AlertSilenceSummary = {
  id: string;
  startsAt: Date;
  endsAt: Date;
  reason: string;
  createdByUserId: string;
  matchers: Matcher[];
};

export const listAlertSilences = createAuthenticatedServerFn({ method: "GET" })
  .inputValidator(alertIdInput)
  .handler(async ({ data: { alertId }, context: { session } }) => {
    const organizationId = session.session.activeOrganizationId;
    const alert = await getAlertRow(alertId, organizationId);
    if (!alert) throw new Error("Alert not found");
    const now = new Date();
    const rows = await db
      .select({
        id: alertSilences.id,
        startsAt: alertSilences.startsAt,
        endsAt: alertSilences.endsAt,
        reason: alertSilences.reason,
        createdByUserId: alertSilences.createdByUserId,
        matchers: alertSilences.matchers,
      })
      .from(alertSilences)
      .where(
        and(
          eq(alertSilences.organizationId, organizationId),
          eq(alertSilences.alertDefinitionId, alertId),
          gt(alertSilences.endsAt, now),
          isNull(alertSilences.cancelledAt),
        ),
      )
      .orderBy(desc(alertSilences.endsAt));
    return rows satisfies AlertSilenceSummary[];
  });
```

5. **`createSilence`**: input gains `matchers: MatchersSchema.default([])`; handler calls `validateMatchers(matchers)` before inserting and adds `matchers` to `.values({...})` and `.returning({... matchers: alertSilences.matchers})`.

- [ ] **Step 8.1: Add failing tests**

Append to `packages/app/src/data/alerts/server.test.ts` following its existing mocking style: cases for (a) `createSilence` rejecting invalid regex matchers, (b) `createSilence` persisting matchers, (c) `listAlertEvents` SQL containing `NOT IN ('instance_fired', 'instance_resolved')`. (If the file's mocks make these impractical, test at least matcher validation through the exported input schema behavior.)

- [ ] **Step 8.2: Run to verify failures, implement, re-run**

Run: `pnpm -F @everr/app test:ci src/data/alerts/server.test.ts`
Expected: FAIL → implement → PASS

- [ ] **Step 8.3: Typecheck (route files still reference the old types — expected to fail)**

Run: `pnpm -F @everr/app typecheck`
Expected: errors ONLY in `routes/_authenticated/_dashboard/alerts.tsx` (fixed in Task 9). If other files error, fix them now.

- [ ] **Step 8.4: Commit**

```bash
git add packages/app/src/data/alerts/server.ts packages/app/src/data/alerts/server.test.ts
git commit -m "feat(alerts): instance and silence data loaders, matcher-aware createSilence"
```

---

### Task 9: List route rewrite + settings modal

**Files:**
- Create: `packages/app/src/routes/_authenticated/_dashboard/-alerts-shared.tsx`
- Rewrite: `packages/app/src/routes/_authenticated/_dashboard/alerts.tsx`

- [ ] **Step 9.1: Create shared helpers**

```tsx
// packages/app/src/routes/_authenticated/_dashboard/-alerts-shared.tsx
import { Badge } from "@everr/ui/components/badge";

export function formatDate(value: Date | string | null) {
  if (!value) return "-";
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export function formatInterval(seconds: number) {
  if (seconds % 3600 === 0) return `${seconds / 3600}h`;
  if (seconds % 60 === 0) return `${seconds / 60}m`;
  return `${seconds}s`;
}

export function stateVariant(state: "unknown" | "resolved" | "firing") {
  if (state === "firing") return "destructive" as const;
  if (state === "resolved") return "secondary" as const;
  return "outline" as const;
}

export function AlertStateBadges({
  state,
  active,
  firingInstanceCount,
  silenced,
}: {
  state: "unknown" | "resolved" | "firing";
  active: boolean;
  firingInstanceCount: number;
  silenced: boolean;
}) {
  return (
    <div className="flex items-center gap-2">
      <Badge variant={stateVariant(state)}>
        {state === "firing" && firingInstanceCount > 0
          ? `firing · ${firingInstanceCount}`
          : state}
      </Badge>
      {!active && <Badge variant="outline">inactive</Badge>}
      {silenced && <Badge variant="secondary">silenced</Badge>}
    </div>
  );
}

export function formatLabels(labels: Record<string, string>) {
  const entries = Object.entries(labels).sort(([a], [b]) => a.localeCompare(b));
  if (entries.length === 0) return "(no labels)";
  return entries.map(([key, value]) => `${key}=${value}`).join(", ");
}
```

- [ ] **Step 9.2: Rewrite the list route**

```tsx
// packages/app/src/routes/_authenticated/_dashboard/alerts.tsx
import { Button } from "@everr/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@everr/ui/components/card";
import { type Column, DataTable } from "@everr/ui/components/data-table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@everr/ui/components/dialog";
import { Label } from "@everr/ui/components/label";
import { Skeleton } from "@everr/ui/components/skeleton";
import { Textarea } from "@everr/ui/components/textarea";
import {
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Settings } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  type AlertSummary,
  getAlertSettings,
  listAlerts,
  updateAlertSettings,
} from "@/data/alerts/server";
import {
  AlertStateBadges,
  formatDate,
  formatInterval,
} from "./-alerts-shared";

const alertsQueryOptions = () =>
  queryOptions({ queryKey: ["alerts"], queryFn: () => listAlerts() });

const alertSettingsQueryOptions = () =>
  queryOptions({
    queryKey: ["alerts", "settings"],
    queryFn: () => getAlertSettings(),
  });

export const Route = createFileRoute("/_authenticated/_dashboard/alerts")({
  staticData: { breadcrumb: "Alerts", hideTimeRangePicker: true },
  head: () => ({ meta: [{ title: "Everr - Alerts" }] }),
  loader: async ({ context: { queryClient } }) => {
    await Promise.all([
      queryClient.prefetchQuery(alertsQueryOptions()),
      queryClient.prefetchQuery(alertSettingsQueryOptions()),
    ]);
  },
  component: AlertsPage,
});

function splitList(value: string) {
  return value
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function AlertsPage() {
  const alerts = useQuery(alertsQueryOptions());
  const [settingsOpen, setSettingsOpen] = useState(false);

  const columns = useMemo<Column<AlertSummary>[]>(
    () => [
      {
        header: "Alert",
        cell: (row) => (
          <Link
            to="/alerts/$alertId"
            params={{ alertId: row.id }}
            className="font-mono underline-offset-4 hover:underline"
          >
            {row.slug}
          </Link>
        ),
      },
      { header: "Repo", cell: (row) => row.repoid },
      {
        header: "State",
        cell: (row) => (
          <AlertStateBadges
            state={row.currentState}
            active={row.active}
            firingInstanceCount={row.firingInstanceCount}
            silenced={row.activeSilenceCount > 0}
          />
        ),
      },
      { header: "Last eval", cell: (row) => formatDate(row.lastEvaluatedAt) },
      {
        header: "Interval",
        cell: (row) => formatInterval(row.evaluationIntervalSeconds),
      },
      { header: "Window", cell: (row) => row.window },
      {
        header: "Source",
        cell: (row) =>
          row.sourceLink ? (
            <a className="underline" href={row.sourceLink}>
              source
            </a>
          ) : (
            row.configFilePath || "-"
          ),
      },
    ],
    [],
  );

  return (
    <div className="flex w-full flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Alerts</h1>
          <p className="text-muted-foreground">
            Alert rules applied for this organization.
          </p>
        </div>
        <Button variant="outline" onClick={() => setSettingsOpen(true)}>
          <Settings data-icon="inline-start" />
          Notification settings
        </Button>
      </div>

      <Card inset="flush-content">
        <CardHeader>
          <CardTitle>Rules</CardTitle>
          <CardDescription>
            One row per rule. Open a rule to see its alert instances.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {alerts.isPending ? (
            <div className="flex flex-col gap-2 px-3 py-2">
              {Array.from({ length: 5 }).map((_, index) => (
                <Skeleton key={index} className="h-8 w-full" />
              ))}
            </div>
          ) : (
            <DataTable
              data={alerts.data ?? []}
              columns={columns}
              rowKey={(row) => row.id}
              emptyState={
                <div className="px-3 py-8 text-center text-muted-foreground">
                  No alerts have been applied for this organization.
                </div>
              }
            />
          )}
        </CardContent>
      </Card>

      <NotificationSettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
      />
    </div>
  );
}

function NotificationSettingsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const settings = useQuery({ ...alertSettingsQueryOptions(), enabled: open });
  const [emailEnabled, setEmailEnabled] = useState(false);
  const [emailTo, setEmailTo] = useState("");
  const [telegramEnabled, setTelegramEnabled] = useState(false);
  const [telegramChatIds, setTelegramChatIds] = useState("");
  const [notifyOnResolved, setNotifyOnResolved] = useState(true);

  useEffect(() => {
    const delivery = settings.data?.delivery;
    if (!delivery) return;
    setEmailEnabled(delivery.email.enabled);
    setEmailTo(delivery.email.to.join("\n"));
    setTelegramEnabled(delivery.telegram.enabled);
    setTelegramChatIds(delivery.telegram.chatIds.join("\n"));
    setNotifyOnResolved(delivery.notifyOnResolved);
  }, [settings.data]);

  const update = useMutation({
    mutationFn: () =>
      updateAlertSettings({
        data: {
          delivery: {
            email: { enabled: emailEnabled, to: splitList(emailTo) },
            telegram: {
              enabled: telegramEnabled,
              chatIds: splitList(telegramChatIds),
            },
            notifyOnResolved,
          },
        },
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["alerts", "settings"] });
      onOpenChange(false);
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Notification settings</DialogTitle>
          <DialogDescription>
            Organization-level delivery for alert notifications.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={emailEnabled}
                onChange={(event) => setEmailEnabled(event.target.checked)}
              />
              Email
            </Label>
            <Textarea
              aria-label="Email recipients"
              placeholder="team@example.com"
              value={emailTo}
              onChange={(event) => setEmailTo(event.target.value)}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={telegramEnabled}
                onChange={(event) => setTelegramEnabled(event.target.checked)}
              />
              Telegram
            </Label>
            <Textarea
              aria-label="Telegram chat IDs"
              placeholder="-1001234567890"
              value={telegramChatIds}
              onChange={(event) => setTelegramChatIds(event.target.value)}
            />
          </div>
          <Label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={notifyOnResolved}
              onChange={(event) => setNotifyOnResolved(event.target.checked)}
            />
            Notify when resolved
          </Label>
          {update.error && (
            <p className="text-destructive" role="alert">
              {update.error.message}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={update.isPending}
          >
            Cancel
          </Button>
          <Button disabled={update.isPending} onClick={() => update.mutate()}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

Note: `@everr/ui` has no Switch/Checkbox component; native checkboxes inside `Label` are the deliberate choice. Verify the exact `Dialog` subcomponent names against `packages/ui/src/components/dialog.tsx` before writing (standard shadcn names assumed).

- [ ] **Step 9.3: Commit (typecheck still red until the detail route exists)**

```bash
git add packages/app/src/routes/_authenticated/_dashboard/alerts.tsx packages/app/src/routes/_authenticated/_dashboard/-alerts-shared.tsx
git commit -m "feat(alerts): alerts list route with notification settings modal"
```

---

### Task 10: Detail route with instances, silences, history

**Files:**
- Create: `packages/app/src/routes/_authenticated/_dashboard/alerts_.$alertId.tsx`

- [ ] **Step 10.1: Create the route**

```tsx
// packages/app/src/routes/_authenticated/_dashboard/alerts_.$alertId.tsx
import { Badge } from "@everr/ui/components/badge";
import { Button } from "@everr/ui/components/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@everr/ui/components/card";
import { DataTable } from "@everr/ui/components/data-table";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@everr/ui/components/select";
import { Skeleton } from "@everr/ui/components/skeleton";
import { Textarea } from "@everr/ui/components/textarea";
import {
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { BellOff, CircleStop, Plus, X } from "lucide-react";
import { useState } from "react";
import type { Matcher } from "@/data/alerts/matchers";
import {
  type AlertInstanceSummary,
  cancelSilence,
  createSilence,
  deactivateAlert,
  getAlert,
  listAlertEvents,
  listAlertInstances,
  listAlertSilences,
} from "@/data/alerts/server";
import {
  AlertStateBadges,
  formatDate,
  formatInterval,
  formatLabels,
  stateVariant,
} from "./-alerts-shared";

const alertDetailQueryOptions = (alertId: string) =>
  queryOptions({
    queryKey: ["alerts", alertId],
    queryFn: () => getAlert({ data: { alertId } }),
  });

const alertInstancesQueryOptions = (alertId: string) =>
  queryOptions({
    queryKey: ["alerts", alertId, "instances"],
    queryFn: () => listAlertInstances({ data: { alertId } }),
  });

const alertSilencesQueryOptions = (alertId: string) =>
  queryOptions({
    queryKey: ["alerts", alertId, "silences"],
    queryFn: () => listAlertSilences({ data: { alertId } }),
  });

const alertEventsQueryOptions = (alertId: string) =>
  queryOptions({
    queryKey: ["alerts", alertId, "events"],
    queryFn: () => listAlertEvents({ data: { alertId, limit: 50 } }),
  });

export const Route = createFileRoute(
  "/_authenticated/_dashboard/alerts_/$alertId",
)({
  staticData: { breadcrumb: "Alert", hideTimeRangePicker: true },
  head: () => ({ meta: [{ title: "Everr - Alert detail" }] }),
  loader: async ({ context: { queryClient }, params }) => {
    await Promise.all([
      queryClient.prefetchQuery(alertDetailQueryOptions(params.alertId)),
      queryClient.prefetchQuery(alertInstancesQueryOptions(params.alertId)),
      queryClient.prefetchQuery(alertSilencesQueryOptions(params.alertId)),
      queryClient.prefetchQuery(alertEventsQueryOptions(params.alertId)),
    ]);
  },
  component: AlertDetailPage,
});

function AlertDetailPage() {
  const { alertId } = Route.useParams();
  const queryClient = useQueryClient();
  const alert = useQuery(alertDetailQueryOptions(alertId));
  const instances = useQuery(alertInstancesQueryOptions(alertId));
  const silences = useQuery(alertSilencesQueryOptions(alertId));
  const events = useQuery(alertEventsQueryOptions(alertId));
  const [silenceTarget, setSilenceTarget] =
    useState<AlertInstanceSummary | null>(null);

  const deactivate = useMutation({
    mutationFn: () => deactivateAlert({ data: { alertId } }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["alerts"] });
    },
  });

  if (alert.isPending) {
    return <Skeleton className="h-96 w-full" />;
  }
  if (alert.isError || !alert.data) {
    return (
      <div className="flex flex-col items-start gap-4">
        <p className="text-muted-foreground">Alert not found.</p>
        <Button variant="outline" asChild>
          <Link to="/alerts">Back to alerts</Link>
        </Button>
      </div>
    );
  }
  const detail = alert.data;

  return (
    <div className="flex w-full flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-3">
            <h1 className="font-mono text-xl font-bold tracking-tight">
              {detail.slug}
            </h1>
            <AlertStateBadges
              state={detail.currentState}
              active={detail.active}
              firingInstanceCount={detail.firingInstanceCount}
              silenced={detail.activeSilenceCount > 0}
            />
          </div>
          <p className="text-muted-foreground">
            {detail.repoid}
            {detail.sourceLink && (
              <>
                {" · "}
                <a className="underline" href={detail.sourceLink}>
                  source
                </a>
              </>
            )}
          </p>
        </div>
        <Button
          variant="destructive"
          size="sm"
          disabled={!detail.active || deactivate.isPending}
          onClick={() => deactivate.mutate()}
        >
          <CircleStop data-icon="inline-start" />
          Deactivate
        </Button>
      </div>

      <Card inset="flush-content">
        <CardHeader>
          <CardTitle>Instances</CardTitle>
          <CardDescription>
            One row per alert instance. Silence an instance to pause its
            notifications.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {instances.isPending ? (
            <Skeleton className="m-3 h-36 w-full" />
          ) : (
            <DataTable
              data={instances.data ?? []}
              columns={[
                {
                  header: "Labels",
                  cell: (row) => (
                    <span className="font-mono text-xs">
                      {formatLabels(row.labels)}
                    </span>
                  ),
                },
                {
                  header: "State",
                  cell: (row) => (
                    <div className="flex items-center gap-2">
                      <Badge variant={stateVariant(row.state)}>
                        {row.state}
                      </Badge>
                      {row.silenced && (
                        <Badge variant="secondary">silenced</Badge>
                      )}
                    </div>
                  ),
                },
                { header: "Fired", cell: (row) => formatDate(row.lastFiredAt) },
                {
                  header: "Resolved",
                  cell: (row) =>
                    row.state === "resolved"
                      ? formatDate(row.lastResolvedAt)
                      : "-",
                },
                {
                  header: "",
                  cell: (row) => (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setSilenceTarget(row)}
                    >
                      <BellOff data-icon="inline-start" />
                      Silence
                    </Button>
                  ),
                },
              ]}
              rowKey={(row) => row.fingerprint}
              emptyState={
                <div className="px-3 py-8 text-center text-muted-foreground">
                  No alert instances recorded yet.
                </div>
              }
            />
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Definition</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-2 gap-2 text-xs">
              <dt className="text-muted-foreground">Interval</dt>
              <dd>{formatInterval(detail.evaluationIntervalSeconds)}</dd>
              <dt className="text-muted-foreground">Window</dt>
              <dd>{detail.window}</dd>
              <dt className="text-muted-foreground">Validation</dt>
              <dd>{detail.validationStatus}</dd>
              <dt className="text-muted-foreground">Last status</dt>
              <dd>{detail.lastEvaluationStatus || "-"}</dd>
              <dt className="text-muted-foreground">Last evaluated</dt>
              <dd>{formatDate(detail.lastEvaluatedAt)}</dd>
            </dl>
            {detail.lastEvaluationError && (
              <pre className="mt-3 max-h-32 overflow-auto rounded bg-muted/30 p-2 text-xs text-destructive">
                {detail.lastEvaluationError}
              </pre>
            )}
            <pre className="mt-3 max-h-72 overflow-auto rounded bg-muted/30 p-2 text-xs">
              {detail.parsedQuery}
            </pre>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Active silences</CardTitle>
            <CardDescription>
              Created from instances; matching instances stop notifying.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {silences.isPending ? (
              <Skeleton className="h-24 w-full" />
            ) : (silences.data?.length ?? 0) === 0 ? (
              <p className="text-muted-foreground">No active silences.</p>
            ) : (
              <div className="flex flex-col gap-3">
                {silences.data?.map((silence) => (
                  <SilenceRow
                    key={silence.id}
                    silence={silence}
                    alertId={alertId}
                  />
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card inset="flush-content">
        <CardHeader>
          <CardTitle>History</CardTitle>
        </CardHeader>
        <CardContent>
          {events.isPending ? (
            <Skeleton className="m-3 h-36 w-full" />
          ) : (
            <DataTable
              data={events.data ?? []}
              columns={[
                { header: "Time", cell: (row) => formatDate(row.eventTime) },
                { header: "Type", cell: (row) => row.eventType },
                { header: "Rows", cell: (row) => row.rowCount },
                {
                  header: "Delivery",
                  cell: (row) =>
                    row.deliveryTargetType
                      ? `${row.deliveryTargetType}: ${row.deliveryOutcome || "-"}`
                      : "-",
                },
              ]}
              rowKey={(row) => row.eventId}
              emptyState={
                <div className="px-3 py-6 text-center text-muted-foreground">
                  No alert events yet.
                </div>
              }
            />
          )}
        </CardContent>
      </Card>

      <SilenceDialog
        alertId={alertId}
        instance={silenceTarget}
        onClose={() => setSilenceTarget(null)}
      />
    </div>
  );
}

function SilenceRow({
  silence,
  alertId,
}: {
  silence: NonNullable<
    Awaited<ReturnType<typeof listAlertSilences>>
  >[number];
  alertId: string;
}) {
  const queryClient = useQueryClient();
  const cancel = useMutation({
    mutationFn: () => cancelSilence({ data: { silenceId: silence.id } }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["alerts"] });
    },
  });
  return (
    <div className="flex items-start justify-between gap-2 rounded-md border bg-muted/30 p-3">
      <div className="flex flex-col gap-1">
        <span className="font-mono text-xs">
          {silence.matchers.length === 0
            ? "(all instances)"
            : silence.matchers
                .map((m) => `${m.label}${m.op}"${m.value}"`)
                .join(" ")}
        </span>
        <span className="text-xs text-muted-foreground">
          Until {formatDate(silence.endsAt)}
          {silence.reason ? ` · ${silence.reason}` : ""}
        </span>
      </div>
      <Button
        variant="ghost"
        size="sm"
        disabled={cancel.isPending}
        onClick={() => cancel.mutate()}
      >
        <X data-icon="inline-start" />
        Cancel
      </Button>
    </div>
  );
}

const MATCHER_OPS = ["=", "!=", "=~", "!~"] as const;

function SilenceDialog({
  alertId,
  instance,
  onClose,
}: {
  alertId: string;
  instance: AlertInstanceSummary | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [matchers, setMatchers] = useState<Matcher[]>([]);
  const [hours, setHours] = useState("2");
  const [reason, setReason] = useState("");
  const [initializedFor, setInitializedFor] = useState<string | null>(null);

  if (instance && initializedFor !== instance.fingerprint) {
    setMatchers(
      Object.entries(instance.labels).map(([label, value]) => ({
        label,
        op: "=" as const,
        value,
      })),
    );
    setHours("2");
    setReason("");
    setInitializedFor(instance.fingerprint);
  }

  const create = useMutation({
    mutationFn: () => {
      const parsedHours = Number(hours);
      const endsAt = new Date(
        Date.now() + Math.max(parsedHours || 1, 1) * 60 * 60 * 1000,
      ).toISOString();
      return createSilence({ data: { alertId, endsAt, reason, matchers } });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["alerts"] });
      onClose();
      setInitializedFor(null);
    },
  });

  return (
    <Dialog
      open={instance !== null}
      onOpenChange={(open) => {
        if (!open) {
          onClose();
          setInitializedFor(null);
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Silence instances</DialogTitle>
          <DialogDescription>
            Notifications are paused for instances matching all matchers.
            Evaluation continues.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label>Matchers</Label>
            {matchers.length === 0 && (
              <p className="text-xs text-muted-foreground">
                No matchers: silences every instance of this rule.
              </p>
            )}
            {matchers.map((matcher, index) => (
              <div
                key={index}
                className="grid grid-cols-[1fr_90px_1fr_32px] items-center gap-2"
              >
                <Input
                  aria-label="Label"
                  value={matcher.label}
                  onChange={(event) =>
                    setMatchers((prev) =>
                      prev.map((m, i) =>
                        i === index ? { ...m, label: event.target.value } : m,
                      ),
                    )
                  }
                />
                <Select
                  value={matcher.op}
                  onValueChange={(op) =>
                    setMatchers((prev) =>
                      prev.map((m, i) =>
                        i === index ? { ...m, op: op as Matcher["op"] } : m,
                      ),
                    )
                  }
                >
                  <SelectTrigger aria-label="Operator">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {MATCHER_OPS.map((op) => (
                      <SelectItem key={op} value={op}>
                        {op}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input
                  aria-label="Value"
                  value={matcher.value}
                  onChange={(event) =>
                    setMatchers((prev) =>
                      prev.map((m, i) =>
                        i === index ? { ...m, value: event.target.value } : m,
                      ),
                    )
                  }
                />
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Remove matcher"
                  onClick={() =>
                    setMatchers((prev) => prev.filter((_, i) => i !== index))
                  }
                >
                  <X />
                </Button>
              </div>
            ))}
            <Button
              variant="outline"
              size="sm"
              className="self-start"
              onClick={() =>
                setMatchers((prev) => [
                  ...prev,
                  { label: "", op: "=", value: "" },
                ])
              }
            >
              <Plus data-icon="inline-start" />
              Add matcher
            </Button>
          </div>
          <div className="grid grid-cols-[120px_1fr] items-center gap-2">
            <Label htmlFor="silence-hours">Hours</Label>
            <Input
              id="silence-hours"
              type="number"
              min="1"
              value={hours}
              onChange={(event) => setHours(event.target.value)}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="silence-reason">Reason</Label>
            <Textarea
              id="silence-reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </div>
          {create.error && (
            <p className="text-destructive" role="alert">
              {create.error.message}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={create.isPending || matchers.some((m) => !m.label)}
            onClick={() => create.mutate()}
          >
            <BellOff data-icon="inline-start" />
            Create silence
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 10.2: Regenerate route tree and typecheck**

The TanStack Router plugin regenerates `src/routeTree.gen.ts` when Vite runs. Start the dev server briefly (or run the build) to regenerate:

Run: `pnpm -F @everr/app dev` (wait for ready, then stop) or check whether `routeTree.gen.ts` regenerates via the vitest/vite pipeline.
Then: `pnpm -F @everr/app typecheck`
Expected: PASS

- [ ] **Step 10.3: Full test suite + lint**

Run: `pnpm -F @everr/app test:ci`
Run: repo lint (check root `package.json` for the lint script, e.g. `pnpm lint`)
Expected: PASS

- [ ] **Step 10.4: Commit**

```bash
git add packages/app/src/routes/_authenticated/_dashboard/alerts_.\$alertId.tsx packages/app/src/routeTree.gen.ts
git commit -m "feat(alerts): alert detail route with instances, silences, history"
```

---

### Task 11: Dev-environment sync + manual verification

**Files:** none (operational)

- [ ] **Step 11.1: Sync dev Postgres columns (no migration files)**

Apply the new columns directly to the dev database (find connection settings in `packages/app/.env` / `docker-compose`):

```sql
ALTER TABLE alert_definitions ADD COLUMN IF NOT EXISTS firing_instance_count integer NOT NULL DEFAULT 0;
ALTER TABLE alert_definitions ADD COLUMN IF NOT EXISTS instance_label_columns jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE alert_silences ADD COLUMN IF NOT EXISTS matchers jsonb NOT NULL DEFAULT '[]'::jsonb;
```

- [ ] **Step 11.2: Sync dev ClickHouse**

```sql
ALTER TABLE app.alert_events ADD COLUMN IF NOT EXISTS instance_fingerprint String DEFAULT '';
ALTER TABLE app.alert_events ADD COLUMN IF NOT EXISTS instance_labels_json String DEFAULT '{}';
DROP VIEW IF EXISTS app.alert_events_logs_mv;
```

Then re-run the MV CREATE from `clickhouse/init/12-create-alert-events.sql`.

- [ ] **Step 11.3: Manual verification (per project CONSTITUTION)**

Use credentials from `.auth` (skip if absent). With `pnpm -F @everr/app dev` running:
1. `/alerts` renders the rules list; "Notification settings" opens the modal, saves, and closes.
2. Clicking a rule slug navigates to `/alerts/<id>`; instances, definition, silences, and history sections render.
3. If an applied alert exists and fires (use the everr-dev CLI apply flow or an existing dev alert), confirm instance rows appear and "Silence" pre-fills matchers from the instance labels.
4. Create and cancel a silence; the silenced badge appears/disappears.

- [ ] **Step 11.4: Final full check and commit any straggling generated files**

```bash
pnpm -F @everr/app test:ci && pnpm -F @everr/app typecheck
git status
```

Commit anything intentional that remains (e.g. regenerated `routeTree.gen.ts`).

---

## Self-Review Notes

- Spec coverage: instance identity (Task 2), CH storage/derivation (Tasks 2-3), evaluation flow + notification trigger (Task 7), matcher silences model + delivery (Tasks 1, 4, 6, 8), creation-from-instance UI (Task 10), list/detail split + settings modal (Tasks 9-10), `instanceLabels` YAML + apply validation + persistence (Tasks 4-5), `firing_instance_count` (Tasks 4, 7, 8), instance events excluded from history (Task 8).
- Spec deviation (documented): `alert_definitions.instance_label_columns` added — the spec omitted persisting `spec.instanceLabels`, but the evaluator needs it at runtime.
- Spec deviation (documented): `AlertSummary.activeSilence` becomes `activeSilenceCount` because multiple active silences per rule are now expected and the old leftJoin would duplicate list rows.
- `@everr/ui` has no Switch component; the settings modal uses native checkboxes with `Label`.
