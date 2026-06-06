# Alerting System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build YAML-defined Grafana-style alerts with CLI test/upload, pg-boss evaluation, web visibility, routing lists, and desktop notifications.

**Architecture:** Everr-owned Postgres tables store alert definitions, routing lists, scheduling state, alert state, and alert events. `pg-boss` runs one recurring scanner plus distributed evaluation jobs; ClickHouse queries run through the existing tenant-scoped SQL API path. Desktop receives alert events over the existing SSE channel, with popup behavior only for critical firing events.

**Tech Stack:** TanStack Start, Drizzle, Postgres, pg-boss, ClickHouse SQL API, Vitest, Rust CLI, Tauri v2, React Query, YAML parsing through a direct TypeScript dependency and a Rust CLI parser kept in sync by shared fixtures.

---

## Scope Notes

This plan implements the alerting system described in `docs/superpowers/specs/2026-06-06-alerting-system-design.md`.

Do not generate Drizzle migrations in these tasks. Add schema definitions and tests first; migration generation is a separate user-approved step.

Because migrations are intentionally out of scope, alert runtime startup must be gated until the migration step is approved and applied. Add an environment flag named `EVERR_ALERTS_ENABLED`; default it to disabled. Task 6 wires the runtime through this flag so local/server startup remains safe before alert tables exist.

The implementation intentionally uses app-owned due-time scanning instead of one pg-boss cron schedule per alert. This keeps the 5,000-alerts-per-minute case bounded by scanner batch size and ClickHouse concurrency, not by thousands of runtime cron entries.

## File Structure

Create or modify these focused modules:

- `packages/app/src/server/alerts/schema.ts`: Zod schemas and TypeScript types for alert YAML, alert definitions, alert events, and routing lists.
- `packages/app/src/server/alerts/parser.ts`: YAML parse, validation, interval parsing, ClickHouse interval substitution, template validation, evidence bounding.
- `packages/app/src/server/alerts/parser.test.ts`: parser and validation tests.
- `packages/app/src/db/schema/app.ts`: alert table definitions and enum definitions.
- `packages/app/src/server/alerts/repository.ts`: Postgres reads/writes for alert definitions, routing lists, state, events, scanner claims, and cleanup.
- `packages/app/src/server/alerts/repository.test.ts`: repository SQL behavior with mocked pool.
- `packages/app/src/server/alerts/routing.ts`: built-in and custom routing-list resolution.
- `packages/app/src/server/alerts/routing.test.ts`: recipient resolution tests.
- `packages/app/src/server/alerts/evaluator.ts`: query execution, evidence bounding, state transitions, notification event emission.
- `packages/app/src/server/alerts/evaluator.test.ts`: firing, repeated firing, resolution, and failure tests.
- `packages/app/src/server/alerts/runtime.ts`: pg-boss startup, scanner worker, evaluation worker, queue options.
- `packages/app/src/server/alerts/runtime.test.ts`: pg-boss runtime tests with a mocked boss instance.
- `packages/app/src/env/alerts.ts`: alert feature flag.
- `packages/app/src/env/index.ts`: export alert environment.
- `packages/app/src/server.ts`: start alert runtime after database migration.
- `packages/app/src/routes/api/cli/alerts/test.ts`: cloud YAML test endpoint.
- `packages/app/src/routes/api/cli/alerts/upload.ts`: cloud YAML upload endpoint.
- `packages/app/src/routes/api/cli/alerts/*.test.ts`: route tests.
- `packages/app/src/data/alerts/schemas.ts`: web-facing alert list/detail schemas.
- `packages/app/src/data/alerts/server.ts`: authenticated server functions for alert rules, active alerts, history, routing lists.
- `packages/app/src/data/alerts/options.ts`: React Query option factories.
- `packages/app/src/routes/_authenticated/_dashboard/alerts.tsx`: alerts route shell.
- `packages/app/src/components/alerts/*`: web UI components.
- `packages/app/src/components/nav-main.tsx` and `packages/app/src/lib/navigation.ts`: navigation entry if current navigation source requires it.
- `packages/app/src/db/notify.ts`: discriminated notification payloads for workflow and alert events.
- `packages/app/src/db/notification-hub.ts`: dispatch alert payloads by tenant and recipient user.
- `packages/app/src/routes/api/events/stream.ts`: filter tenant stream to authenticated recipient for alert payloads.
- `packages/ui/src/lib/notification.ts`: desktop notification union types.
- `crates/everr-core/src/api.rs`: alert API client methods and Rust DTOs.
- `packages/desktop-app/src-cli/Cargo.toml`: add YAML parser dependency.
- `packages/desktop-app/src-cli/src/cli.rs`: add `alerts test` and `alerts upload`.
- `packages/desktop-app/src-cli/src/main.rs`: route alerts commands.
- `packages/desktop-app/src-cli/src/alerts.rs`: CLI alert parser, local/cloud test, upload.
- `packages/desktop-app/src-cli/tests/alerts_commands.rs`: CLI behavior tests.
- `packages/desktop-app/src-tauri/src/notifications.rs`: handle alert SSE payloads and enqueue only critical firing popups.
- `packages/desktop-app/src-tauri/src/commands.rs`: return notification union to frontend.
- `packages/desktop-app/src/features/notifications/notification-window.tsx`: render alert popup cards.
- `packages/desktop-app/src/features/notifications/notifications-page.tsx`: show alert history/list alongside CI run notifications.

## Shared Fixtures

Create these fixtures before parser work:

- `packages/app/src/server/alerts/__fixtures__/valid-alerts.yaml`
- `packages/app/src/server/alerts/__fixtures__/invalid-alerts.yaml`
- `packages/desktop-app/src-cli/tests/fixtures/alerts/valid-alerts.yaml`
- `packages/desktop-app/src-cli/tests/fixtures/alerts/invalid-alerts.yaml`

Use this valid fixture content in both locations:

```yaml
version: everr/v1
service: api
labels:
  team: platform

alerts:
  - name: high-5xx-routes
    severity: critical
    routing: admins
    evaluationInterval: 1m
    window: 5m
    summary: "{{ rows.length }} routes have elevated 5xxs in api"
    description: "Top route: {{ rows.0.route }} with {{ rows.0.error_count }} errors"
    query: |
      SELECT
        SpanAttributes['http.route'] AS route,
        countIf(StatusCode >= 500) AS error_count
      FROM traces
      WHERE Timestamp >= now() - INTERVAL {{ window }}
        AND ServiceName = 'api'
      GROUP BY route
      HAVING error_count >= 10
      ORDER BY error_count DESC
      LIMIT 20
```

Use this invalid fixture content in both locations:

```yaml
version: everr/v1
service: api
alerts:
  - name: too-fast
    severity: page
    routing: missing-list
    evaluationInterval: 30s
    window: 5m
    summary: ""
    query: "SELECT 1"
```

## Task 1: TypeScript Alert Parser And Validation

**Files:**
- Create: `packages/app/src/server/alerts/schema.ts`
- Create: `packages/app/src/server/alerts/parser.ts`
- Create: `packages/app/src/server/alerts/parser.test.ts`
- Create: fixture files under `packages/app/src/server/alerts/__fixtures__/`
- Modify: `packages/app/package.json`

- [x] **Step 1: Add the YAML dependency**

Modify `packages/app/package.json` and add a direct dependency:

```json
"yaml": "^2.9.0"
```

Keep the existing dependency ordering style.

- [x] **Step 2: Write parser tests first**

Create `packages/app/src/server/alerts/parser.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  boundEvidenceRows,
  parseAlertYaml,
  renderAlertQuery,
  validateTemplate,
} from "./parser";

const fixtureDir = join(__dirname, "__fixtures__");

describe("alert YAML parser", () => {
  it("parses a valid alert file", () => {
    const yaml = readFileSync(join(fixtureDir, "valid-alerts.yaml"), "utf8");

    const parsed = parseAlertYaml(yaml);

    expect(parsed.service).toBe("api");
    expect(parsed.alerts).toHaveLength(1);
    expect(parsed.alerts[0]).toMatchObject({
      name: "high-5xx-routes",
      severity: "critical",
      routing: "admins",
      evaluationIntervalSeconds: 60,
      windowSeconds: 300,
    });
  });

  it("rejects unsupported severity and sub-minute intervals", () => {
    const yaml = readFileSync(join(fixtureDir, "invalid-alerts.yaml"), "utf8");

    expect(() => parseAlertYaml(yaml)).toThrow(/severity|evaluationInterval/);
  });

  it("renders ClickHouse interval fragments from validated windows", () => {
    const yaml = readFileSync(join(fixtureDir, "valid-alerts.yaml"), "utf8");
    const parsed = parseAlertYaml(yaml);

    const query = renderAlertQuery(parsed.alerts[0]);

    expect(query).toContain("INTERVAL 5 MINUTE");
    expect(query).not.toContain("{{ window }}");
  });

  it("validates supported row templates", () => {
    expect(() =>
      validateTemplate("{{ rows.length }} failures in {{ service }}"),
    ).not.toThrow();
    expect(() => validateTemplate("{{ rows.0.route }}")).not.toThrow();
    expect(() => validateTemplate("{{ constructor.name }}")).toThrow(
      /unsupported template path/,
    );
  });

  it("bounds evidence rows by count and byte size", () => {
    const rows = Array.from({ length: 100 }, (_, i) => ({
      route: `/route-${i}`,
      value: "x".repeat(2048),
    }));

    const bounded = boundEvidenceRows(rows, { maxRows: 50, maxBytes: 64 * 1024 });

    expect(bounded.rows.length).toBeLessThanOrEqual(50);
    expect(bounded.truncated).toBe(true);
    expect(Buffer.byteLength(JSON.stringify(bounded.rows), "utf8")).toBeLessThanOrEqual(
      64 * 1024,
    );
  });
});
```

- [x] **Step 3: Run parser tests and confirm failure**

Run:

```bash
pnpm --filter @everr/app test -- src/server/alerts/parser.test.ts
```

Expected: fail because `./parser` does not exist.

- [x] **Step 4: Implement the parser**

Create `schema.ts` with exported Zod schemas for raw YAML and normalized definitions. Use fixed severities:

```ts
export const AlertSeveritySchema = z.enum(["critical", "warning"]);
export const AlertYamlVersionSchema = z.literal("everr/v1");
```

Create `parser.ts` with these exported functions and types:

```ts
export type ParsedAlertFile = {
  version: "everr/v1";
  service: string;
  labels: Record<string, string>;
  alerts: ParsedAlertDefinition[];
};

export type ParsedAlertDefinition = {
  service: string;
  name: string;
  severity: "critical" | "warning";
  routing: string;
  evaluationInterval: string;
  evaluationIntervalSeconds: number;
  window: string;
  windowSeconds: number;
  windowClickHouseInterval: string;
  summary: string;
  description: string | null;
  query: string;
  labels: Record<string, string>;
};

export function parseAlertYaml(rawYaml: string): ParsedAlertFile;
export function renderAlertQuery(alert: ParsedAlertDefinition): string;
export function validateTemplate(template: string): void;
export function boundEvidenceRows(
  rows: Array<Record<string, unknown>>,
  limits?: { maxRows: number; maxBytes: number },
): { rows: Array<Record<string, unknown>>; truncated: boolean };
```

Rules:

- Use `yaml` package `parse`.
- Accept duration units `m`, `h`, and `d`.
- Reject `evaluationInterval` below 60 seconds.
- Convert `5m` to `5 MINUTE`, `2h` to `2 HOUR`, and `1d` to `1 DAY`.
- Require non-empty `summary`, `query`, `service`, `name`, and `routing`.
- Template paths must be `rows.length`, `service`, `name`, `severity`, `routing`, or `rows.<number>.<identifier>`.

- [x] **Step 5: Run parser tests and commit**

Run:

```bash
pnpm --filter @everr/app test -- src/server/alerts/parser.test.ts
```

Expected: pass.

Commit:

```bash
git add packages/app/package.json packages/app/src/server/alerts
git commit -m "Add alert YAML parser"
```

## Task 2: Alert Postgres Schema

**Files:**
- Modify: `packages/app/src/db/schema/app.ts`
- Test: `packages/app/src/db/schema/index.ts`

- [x] **Step 1: Add alert table definitions**

In `packages/app/src/db/schema/app.ts`, add enums:

```ts
export const alertSeverityEnum = pgEnum("alert_severity", [
  "critical",
  "warning",
]);

export const alertStateStatusEnum = pgEnum("alert_state_status", [
  "inactive",
  "firing",
  "resolved",
]);

export const alertEventTypeEnum = pgEnum("alert_event_type", [
  "firing",
  "resolved",
  "evaluation_failed",
]);
```

Add these table exports with Drizzle column names matching the database column names shown here:

```ts
export const alertDefinitions = pgTable(
  "alert_definitions",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    organizationId: text("organization_id").notNull(),
    service: text("service").notNull(),
    name: text("name").notNull(),
    severity: alertSeverityEnum("severity").notNull(),
    routingSlug: text("routing_slug").notNull(),
    evaluationIntervalSeconds: integer("evaluation_interval_seconds").notNull(),
    windowSeconds: integer("window_seconds").notNull(),
    nextEvaluationAt: timestamp("next_evaluation_at", { withTimezone: true }).notNull(),
    scheduleJitterSeconds: integer("schedule_jitter_seconds").notNull().default(0),
    lastEnqueuedAt: timestamp("last_enqueued_at", { withTimezone: true }),
    rawYaml: text("raw_yaml").notNull(),
    query: text("query").notNull(),
    summaryTemplate: text("summary_template").notNull(),
    descriptionTemplate: text("description_template"),
    sourceUrl: text("source_url").notNull(),
    sourceRepo: text("source_repo"),
    sourceBranch: text("source_branch"),
    sourceCommitSha: text("source_commit_sha"),
    sourceRemote: text("source_remote"),
    sourcePath: text("source_path"),
    active: boolean("active").notNull().default(true),
    validationStatus: text("validation_status").notNull().default("valid"),
    lastEvaluationStatus: text("last_evaluation_status"),
    lastEvaluationError: text("last_evaluation_error"),
    createdByUserId: text("created_by_user_id").notNull(),
    updatedByUserId: text("updated_by_user_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("alert_definitions_org_service_name_uq").on(table.organizationId, table.service, table.name),
    index("alert_definitions_due_idx").on(table.organizationId, table.active, table.nextEvaluationAt),
    index("alert_definitions_source_idx").on(table.organizationId, table.sourceUrl, table.service),
  ],
);

export const alertRoutingLists = pgTable(
  "alert_routing_lists",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    organizationId: text("organization_id").notNull(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("alert_routing_lists_org_slug_uq").on(table.organizationId, table.slug),
  ],
);

export const alertRoutingListMembers = pgTable(
  "alert_routing_list_members",
  {
    routingListId: bigint("routing_list_id", { mode: "number" }).notNull(),
    userId: text("user_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("alert_routing_list_members_list_user_uq").on(table.routingListId, table.userId),
  ],
);

export const alertStates = pgTable(
  "alert_states",
  {
    alertDefinitionId: bigint("alert_definition_id", { mode: "number" }).primaryKey(),
    organizationId: text("organization_id").notNull(),
    status: alertStateStatusEnum("status").notNull().default("inactive"),
    firstFiredAt: timestamp("first_fired_at", { withTimezone: true }),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    lastEvaluatedAt: timestamp("last_evaluated_at", { withTimezone: true }),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    rowCount: integer("row_count").notNull().default(0),
    evidence: jsonb("evidence").$type<Array<Record<string, unknown>>>().notNull().default(sql`'[]'::jsonb`),
    evidenceTruncated: boolean("evidence_truncated").notNull().default(false),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
);

export const alertEvents = pgTable(
  "alert_events",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    alertDefinitionId: bigint("alert_definition_id", { mode: "number" }).notNull(),
    organizationId: text("organization_id").notNull(),
    type: alertEventTypeEnum("type").notNull(),
    evaluationScheduledFor: timestamp("evaluation_scheduled_for", { withTimezone: true }).notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
    summary: text("summary").notNull(),
    description: text("description"),
    rowCount: integer("row_count").notNull().default(0),
    evidence: jsonb("evidence").$type<Array<Record<string, unknown>>>().notNull().default(sql`'[]'::jsonb`),
    evidenceTruncated: boolean("evidence_truncated").notNull().default(false),
    errorMessage: text("error_message"),
  },
  (table) => [
    uniqueIndex("alert_events_definition_scheduled_type_uq").on(table.alertDefinitionId, table.evaluationScheduledFor, table.type),
    index("alert_events_org_occurred_idx").on(table.organizationId, sql`occurred_at DESC`),
  ],
);
```

- [x] **Step 2: Run typecheck**

Run:

```bash
pnpm --filter @everr/app typecheck
```

Expected: pass.

- [x] **Step 3: Commit**

```bash
git add packages/app/src/db/schema/app.ts
git commit -m "Add alert database schema"
```

## Task 3: Alert Repository And Routing Resolution

**Files:**
- Create: `packages/app/src/server/alerts/repository.ts`
- Create: `packages/app/src/server/alerts/repository.test.ts`
- Create: `packages/app/src/server/alerts/routing.ts`
- Create: `packages/app/src/server/alerts/routing.test.ts`

- [ ] **Step 1: Write routing tests**

Create `routing.test.ts` with mocked `pool.query` rows and these assertions:

```ts
expect(await resolveRoutingRecipients({ organizationId: "org1", slug: "everyone" }))
  .toEqual(["user1", "user2", "owner1"]);

expect(await resolveRoutingRecipients({ organizationId: "org1", slug: "admins" }))
  .toEqual(["admin1", "owner1"]);

expect(await resolveRoutingRecipients({ organizationId: "org1", slug: "owners" }))
  .toEqual(["owner1"]);
```

Mock `pool.query` rows from `member` and custom routing tables.

- [ ] **Step 2: Implement routing**

Export:

```ts
export async function resolveRoutingRecipients(input: {
  organizationId: string;
  slug: string;
}): Promise<string[]>;

export async function routingListExists(input: {
  organizationId: string;
  slug: string;
}): Promise<boolean>;
```

Built-ins:

- `everyone`: all members in org.
- `admins`: member roles `admin` and `owner`.
- `owners`: member role `owner`.

Custom routing lists read `alert_routing_lists` and `alert_routing_list_members`.

- [ ] **Step 3: Write repository tests**

Create `repository.test.ts` with one test per behavior:

- `upsertAlertDefinitions` writes by `(organization_id, service, name)`.
- upload deactivates omitted definitions from the same `(organization_id, service, source_url)`.
- `claimDueAlertDefinitions` advances `next_evaluation_at` and returns a bounded batch.
- `deleteExpiredAlertEvents` removes events older than seven days.

- [ ] **Step 4: Implement repository**

Export these functions:

```ts
export async function upsertAlertDefinitions(input: UpsertAlertDefinitionsInput): Promise<void>;
export async function listAlertRules(input: { organizationId: string }): Promise<AlertRuleRow[]>;
export async function getAlertDefinitionForEvaluation(input: { alertDefinitionId: number }): Promise<AlertDefinitionEvaluationRow | null>;
export async function claimDueAlertDefinitions(input: { limit: number; now: Date }): Promise<ClaimedAlertDefinition[]>;
export async function updateAlertState(input: AlertStateTransitionInput): Promise<AlertStateTransitionResult>;
export async function createAlertEvent(input: CreateAlertEventInput): Promise<AlertEventRow>;
export async function deleteExpiredAlertEvents(input: { olderThan: Date; limit: number }): Promise<number>;
```

Use raw `pool.query` for scanner claim SQL so `FOR UPDATE SKIP LOCKED` is explicit.

- [ ] **Step 5: Run tests and commit**

```bash
pnpm --filter @everr/app test -- src/server/alerts/routing.test.ts src/server/alerts/repository.test.ts
git add packages/app/src/server/alerts/routing.ts packages/app/src/server/alerts/routing.test.ts packages/app/src/server/alerts/repository.ts packages/app/src/server/alerts/repository.test.ts
git commit -m "Add alert repository"
```

## Task 4: Cloud Test And Upload API Routes

**Files:**
- Create: `packages/app/src/routes/api/cli/alerts/test.ts`
- Create: `packages/app/src/routes/api/cli/alerts/test.test.ts`
- Create: `packages/app/src/routes/api/cli/alerts/upload.ts`
- Create: `packages/app/src/routes/api/cli/alerts/upload.test.ts`

- [ ] **Step 1: Write route tests**

For `/api/cli/alerts/test`:

- missing YAML returns 400.
- valid YAML runs each query once.
- returned JSON includes `filters: { target: "cloud" }`.
- firing result includes bounded evidence.

For `/api/cli/alerts/upload`:

- unknown routing slug returns 400.
- SQL execution failure returns 400.
- firing rows do not reject upload.
- successful upload calls `upsertAlertDefinitions`.

- [ ] **Step 2: Implement `POST /api/cli/alerts/test`**

Request JSON:

```ts
{
  rawYaml: string;
}
```

Response JSON:

```ts
{
  filters: { target: "cloud" };
  alerts: Array<{
    service: string;
    name: string;
    severity: "critical" | "warning";
    routing: string;
    firing: boolean;
    rowCount: number;
    evidence: Array<Record<string, unknown>>;
    truncated: boolean;
  }>;
}
```

Run queries with `querySqlApi` and `renderAlertQuery`.

- [ ] **Step 3: Implement `POST /api/cli/alerts/upload`**

Request JSON:

```ts
{
  rawYaml: string;
  sourceUrl: string;
  git?: {
    repo?: string;
    branch?: string;
    commitSha?: string;
    remote?: string;
    path?: string;
  };
}
```

Response JSON:

```ts
{
  uploaded: number;
  deactivated: number;
  sourceUrl: string;
}
```

Validate routing lists, run each query once, then call `upsertAlertDefinitions`.

- [ ] **Step 4: Run tests and commit**

```bash
pnpm --filter @everr/app test -- src/routes/api/cli/alerts/test.test.ts src/routes/api/cli/alerts/upload.test.ts
git add packages/app/src/routes/api/cli/alerts
git commit -m "Add alert CLI API routes"
```

## Task 5: Evaluator And State Transitions

**Files:**
- Create: `packages/app/src/server/alerts/evaluator.ts`
- Create: `packages/app/src/server/alerts/evaluator.test.ts`

- [ ] **Step 1: Write evaluator tests**

Test these transitions:

- resolved or missing state + non-empty rows creates `firing`.
- firing + non-empty rows updates `last_seen_at` without duplicate firing event for the same scheduled time.
- firing + empty rows creates `resolved`.
- SQL error records `evaluation_failed` and does not change firing/resolved state.
- inactive definition exits without query execution.

- [ ] **Step 2: Implement evaluator**

Export:

```ts
export async function evaluateAlertJob(input: {
  alertDefinitionId: number;
  scheduledFor: string;
}): Promise<void>;
```

Implementation order:

1. Load definition with `getAlertDefinitionForEvaluation`.
2. Exit if missing or inactive.
3. Render query.
4. Run `querySqlApi` with the definition organization ID.
5. Bound evidence to 50 rows and 64 KiB.
6. Call repository transition function.
7. Resolve recipients with `resolveRoutingRecipients`.
8. Emit alert notification with `notifyAlertUpdate`.

- [ ] **Step 3: Run tests and commit**

```bash
pnpm --filter @everr/app test -- src/server/alerts/evaluator.test.ts
git add packages/app/src/server/alerts/evaluator.ts packages/app/src/server/alerts/evaluator.test.ts
git commit -m "Add alert evaluator"
```

## Task 6: pg-boss Runtime

**Files:**
- Create: `packages/app/src/server/alerts/runtime.ts`
- Create: `packages/app/src/server/alerts/runtime.test.ts`
- Create: `packages/app/src/env/alerts.ts`
- Modify: `packages/app/src/env/index.ts`
- Modify: `packages/app/src/server.ts`

- [ ] **Step 1: Write runtime tests**

Mock `pg-boss` like `packages/app/src/server/github-events/runtime.test.ts`.

Assert:

- runtime creates `alert-scan`, `alert-evaluate`, and `alert-dead-letter`.
- scanner worker calls `claimDueAlertDefinitions`.
- scanner enqueues one evaluation job per claimed alert.
- evaluation worker calls `evaluateAlertJob`.
- runtime start is idempotent.
- server startup does not start the alert runtime when `EVERR_ALERTS_ENABLED` is unset or false.

- [ ] **Step 2: Implement runtime**

Use the existing `pg-boss` adapter pattern:

```ts
const boss = new PgBoss({
  db: {
    executeSql: (text: string, values?: unknown[]) =>
      pool.query(text, values as unknown[]),
  },
  migrate: true,
});
```

Queue options:

```ts
{
  retryLimit: 3,
  retryBackoff: true,
  expireInSeconds: 60,
  heartbeatSeconds: 30,
  deleteAfterSeconds: 7 * 24 * 60 * 60,
  retentionSeconds: 7 * 24 * 60 * 60,
}
```

Use one recurring schedule for `alert-scan` and no per-alert schedules.

- [ ] **Step 3: Add alert runtime feature gate**

Create `packages/app/src/env/alerts.ts`:

```ts
import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

export const alertEnv = createEnv({
  server: {
    EVERR_ALERTS_ENABLED: z
      .string()
      .optional()
      .transform((value) =>
        ["true", "1", "yes", "on"].includes(value?.toLowerCase() ?? ""),
      ),
  },
  runtimeEnv: process.env,
});
```

Export it from `packages/app/src/env/index.ts`.

- [ ] **Step 4: Start runtime from server startup when enabled**

Modify `packages/app/src/server.ts` to call `await startAlertRuntime()` after database migration only when `alertEnv.EVERR_ALERTS_ENABLED` is true. Log errors through existing telemetry logger and fail startup if runtime creation fails while enabled.

- [ ] **Step 5: Run tests and commit**

```bash
pnpm --filter @everr/app test -- src/server/alerts/runtime.test.ts
git add packages/app/src/server/alerts/runtime.ts packages/app/src/server/alerts/runtime.test.ts packages/app/src/env/alerts.ts packages/app/src/env/index.ts packages/app/src/server.ts
git commit -m "Add alert pg-boss runtime"
```

## Task 7: Alert Notifications And SSE Filtering

**Files:**
- Modify: `packages/app/src/db/notify.ts`
- Modify: `packages/app/src/db/notification-hub.ts`
- Modify: `packages/app/src/db/notification-hub.test.ts`
- Modify: `packages/app/src/routes/api/events/stream.ts`
- Modify: `packages/app/src/routes/api/events/stream.test.ts`

- [ ] **Step 1: Update payload types**

Change workflow payload to a discriminated union:

```ts
export type WorkflowNotifyPayload = {
  kind: "workflow";
  tenantId: string;
  traceId: string;
  runId: string;
  sha: string;
  repo: string;
  branch: string;
  authorEmail: string | null;
  workflowName: string;
  name: string;
  type: "run" | "job";
  status: string;
  conclusion: string | null;
  jobId: number | null;
};

export type AlertNotifyPayload = {
  kind: "alert";
  tenantId: string;
  recipientUserIds: string[];
  alertDefinitionId: number;
  alertEventId: number;
  service: string;
  name: string;
  severity: "critical" | "warning";
  status: "firing" | "resolved" | "evaluation_failed";
  summary: string;
  description: string | null;
  occurredAt: string;
  sourceUrl: string;
  rowCount: number;
};

export type NotifyPayload = WorkflowNotifyPayload | AlertNotifyPayload;
```

Keep `type: "run" | "job"` inside workflow payload for compatibility with current CLI parsing.

- [ ] **Step 2: Add `notifyAlertUpdate`**

Export:

```ts
export async function notifyAlertUpdate(
  db: NodePgDatabase<Record<string, never>>,
  payload: AlertNotifyPayload,
): Promise<void>;
```

Use the same `pg_notify('workflows', payloadJson)` channel for v1.

- [ ] **Step 3: Filter alert SSE delivery by recipient**

In `/api/events/stream`, wrap `sse.sendEvent`:

```ts
function canSendPayload(payload: NotifyPayload, userId: string): boolean {
  if (payload.kind !== "alert") return true;
  return payload.recipientUserIds.includes(userId);
}
```

For tenant scope, only send alert payloads where the authenticated user is in `recipientUserIds`.

- [ ] **Step 4: Run tests and commit**

```bash
pnpm --filter @everr/app test -- src/db/notification-hub.test.ts src/routes/api/events/stream.test.ts
git add packages/app/src/db/notify.ts packages/app/src/db/notification-hub.ts packages/app/src/db/notification-hub.test.ts packages/app/src/routes/api/events/stream.ts packages/app/src/routes/api/events/stream.test.ts
git commit -m "Add alert notification payloads"
```

## Task 8: Web Alerts And Routing Lists

**Files:**
- Create: `packages/app/src/data/alerts/schemas.ts`
- Create: `packages/app/src/data/alerts/server.ts`
- Create: `packages/app/src/data/alerts/options.ts`
- Create: `packages/app/src/data/alerts/server.test.ts`
- Create: `packages/app/src/routes/_authenticated/_dashboard/alerts.tsx`
- Create: `packages/app/src/components/alerts/alerts-page.tsx`
- Create: `packages/app/src/components/alerts/alerts-page.test.tsx`
- Modify: `packages/app/src/lib/navigation.ts`

- [ ] **Step 1: Implement data schemas**

Define:

```ts
export type AlertRuleListItem = {
  id: number;
  service: string;
  name: string;
  severity: "critical" | "warning";
  routingSlug: string;
  evaluationIntervalSeconds: number;
  windowSeconds: number;
  active: boolean;
  sourceUrl: string;
  lastEvaluationStatus: string | null;
  lastEvaluationError: string | null;
};
```

- [ ] **Step 2: Add server functions**

Export:

```ts
export const getAlertRules = createAuthenticatedServerFn({ method: "GET" })
  .inputValidator(z.object({ active: z.boolean().optional() }))
  .handler(async ({ data, context: { session } }) => {
    return listAlertRules({
      organizationId: session.session.activeOrganizationId,
      active: data.active,
    });
  });

export const getActiveAlerts = createAuthenticatedServerFn({ method: "GET" })
  .inputValidator(z.object({}))
  .handler(async ({ context: { session } }) => {
    return listActiveAlertStates({
      organizationId: session.session.activeOrganizationId,
    });
  });

export const getAlertEvents = createAuthenticatedServerFn({ method: "GET" })
  .inputValidator(z.object({ limit: z.number().int().min(1).max(100).default(50) }))
  .handler(async ({ data, context: { session } }) => {
    return listAlertEvents({
      organizationId: session.session.activeOrganizationId,
      limit: data.limit,
    });
  });

export const getRoutingLists = createAuthenticatedServerFn({ method: "GET" })
  .inputValidator(z.object({}))
  .handler(async ({ context: { session } }) => {
    return listRoutingLists({
      organizationId: session.session.activeOrganizationId,
    });
  });

export const saveRoutingList = createAuthenticatedServerFn({ method: "POST" })
  .inputValidator(SaveRoutingListInputSchema)
  .handler(async ({ data, context: { session } }) => {
    return saveCustomRoutingList({
      organizationId: session.session.activeOrganizationId,
      actorUserId: session.user.id,
      slug: data.slug,
      name: data.name,
      userIds: data.userIds,
    });
  });

export const deactivateAlertRule = createAuthenticatedServerFn({ method: "POST" })
  .inputValidator(z.object({ id: z.number().int().positive() }))
  .handler(async ({ data, context: { session } }) => {
    return deactivateAlertDefinition({
      organizationId: session.session.activeOrganizationId,
      actorUserId: session.user.id,
      id: data.id,
    });
  });
```

Only admins and owners may save routing lists or deactivate rules from web UI.

- [ ] **Step 3: Add Alerts page UI**

Use tabs:

- Rules
- Active alerts
- History
- Routing lists

Keep the first version data-dense: tables, badges, source links, and routing-list forms. Do not add YAML editing in web UI.

- [ ] **Step 4: Add navigation**

Add an Alerts direct navigation item with a `Bell` or `BellRing` lucide icon.

- [ ] **Step 5: Run tests and commit**

```bash
pnpm --filter @everr/app test -- src/data/alerts/server.test.ts src/components/alerts/alerts-page.test.tsx
pnpm --filter @everr/app typecheck
git add packages/app/src/data/alerts packages/app/src/components/alerts packages/app/src/routes/_authenticated/_dashboard/alerts.tsx packages/app/src/lib/navigation.ts
git commit -m "Add alerts web views"
```

## Task 9: Rust CLI Alert Commands

**Files:**
- Modify: `packages/desktop-app/src-cli/Cargo.toml`
- Modify: `crates/everr-core/src/api.rs`
- Modify: `packages/desktop-app/src-cli/src/cli.rs`
- Modify: `packages/desktop-app/src-cli/src/main.rs`
- Create: `packages/desktop-app/src-cli/src/alerts.rs`
- Create: `packages/desktop-app/src-cli/tests/alerts_commands.rs`
- Modify: `packages/desktop-app/src-cli/tests/help_output.rs`

- [ ] **Step 1: Add Rust YAML dependency**

Add:

```toml
serde_yaml = "0.9"
```

to `packages/desktop-app/src-cli/Cargo.toml`.

- [ ] **Step 2: Add CLI args**

In `cli.rs` add:

```rust
/// Test and upload YAML alert definitions
Alerts(AlertsArgs),
```

Define:

```rust
#[derive(Args, Debug)]
pub struct AlertsArgs {
    #[command(subcommand)]
    pub command: AlertsSubcommand,
}

#[derive(Subcommand, Debug)]
pub enum AlertsSubcommand {
    /// Test alert YAML against cloud telemetry by default, or local telemetry with --local
    Test(AlertTestArgs),
    /// Upload alert YAML to Everr Cloud
    Upload(AlertUploadArgs),
}

#[derive(Args, Debug)]
pub struct AlertTestArgs {
    pub path: String,
    #[arg(long)]
    pub local: bool,
}

#[derive(Args, Debug)]
pub struct AlertUploadArgs {
    pub path: String,
    #[arg(long)]
    pub source_url: String,
}
```

- [ ] **Step 3: Add API client methods**

In `crates/everr-core/src/api.rs` add:

```rust
pub async fn test_alerts(&self, raw_yaml: &str) -> Result<AlertsTestResponse>;
pub async fn upload_alerts(&self, request: AlertsUploadRequest) -> Result<AlertsUploadResponse>;
```

Use `POST /api/cli/alerts/test` and `POST /api/cli/alerts/upload`.

- [ ] **Step 4: Implement CLI local test**

In `alerts.rs`:

- read YAML file.
- for cloud test, call `ApiClient::test_alerts`.
- for local test, parse YAML with `serde_yaml`, substitute `{{ window }}`, and run each query through `telemetry::client::QueryClient`.
- print JSON with top-level `filters`.

Local JSON shape:

```json
{
  "filters": { "target": "local" },
  "alerts": [
    {
      "service": "api",
      "name": "high-5xx-routes",
      "severity": "critical",
      "routing": "admins",
      "firing": true,
      "rowCount": 1,
      "evidence": [{ "route": "/api" }],
      "truncated": false
    }
  ]
}
```

- [ ] **Step 5: Run CLI tests and commit**

```bash
cargo test -p everr-cli alerts_commands
cargo test -p everr-cli help_output
git add packages/desktop-app/src-cli crates/everr-core/src/api.rs Cargo.lock
git commit -m "Add alert CLI commands"
```

## Task 10: Desktop Alert Notifications

**Files:**
- Modify: `packages/ui/src/lib/notification.ts`
- Modify: `crates/everr-core/src/api.rs`
- Modify: `packages/desktop-app/src-tauri/src/notifications.rs`
- Modify: `packages/desktop-app/src-tauri/src/commands.rs`
- Modify: `packages/desktop-app/src/features/notifications/notification-window.tsx`
- Modify: `packages/desktop-app/src/features/notifications/notifications-page.tsx`
- Create: `packages/desktop-app/src/features/notifications/notification-window.test.tsx`
- Modify: `packages/desktop-app/src/App.test.tsx` if route-level notification rendering changes.

- [ ] **Step 1: Add shared notification union**

In `packages/ui/src/lib/notification.ts`:

```ts
export type DesktopFailureNotification = FailureNotification & {
  kind: "workflow";
};

export type DesktopAlertNotification = {
  kind: "alert";
  dedupeKey: string;
  alertDefinitionId: number;
  alertEventId: number;
  service: string;
  name: string;
  severity: "critical" | "warning";
  status: "firing" | "resolved" | "evaluation_failed";
  summary: string;
  description: string | null;
  occurredAt: string;
  detailsUrl: string;
  rowCount: number;
};

export type DesktopNotification =
  | DesktopFailureNotification
  | DesktopAlertNotification;
```

- [ ] **Step 2: Update Rust DTOs and notifier**

Add these Rust DTOs in `crates/everr-core/src/api.rs`:

```rust
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AlertNotifyPayload {
    pub kind: String,
    pub tenant_id: String,
    pub recipient_user_ids: Vec<String>,
    pub alert_definition_id: i64,
    pub alert_event_id: i64,
    pub service: String,
    pub name: String,
    pub severity: String,
    pub status: String,
    pub summary: String,
    pub description: Option<String>,
    pub occurred_at: String,
    pub source_url: String,
    pub row_count: i64,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum DesktopNotification {
    #[serde(rename = "workflow")]
    Workflow(FailureNotification),
    #[serde(rename = "alert")]
    Alert(AlertDesktopNotification),
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AlertDesktopNotification {
    pub dedupe_key: String,
    pub alert_definition_id: i64,
    pub alert_event_id: i64,
    pub service: String,
    pub name: String,
    pub severity: String,
    pub status: String,
    pub summary: String,
    pub description: Option<String>,
    pub occurred_at: String,
    pub details_url: String,
    pub row_count: i64,
}
```

In `notifications.rs`, handle SSE payloads:

- workflow payloads keep existing CI failure logic.
- alert payloads enqueue only when `severity == "critical"` and `status == "firing"`.
- warning and resolved alert payloads emit the checked event but do not open popup.

- [ ] **Step 3: Render alert popup**

In `notification-window.tsx`, switch on `notification.kind`.

Alert popup should show:

- `Everr - Critical alert`
- `service / name`
- `summary`
- `rowCount`
- occurred time
- Open button

Do not show auto-fix prompt for alerts.

- [ ] **Step 4: Run tests and commit**

```bash
cargo test -p everr-tauri notifications
pnpm --filter @everr/desktop-app test -- src/features/notifications/notification-window
git add packages/ui/src/lib/notification.ts crates/everr-core/src/api.rs packages/desktop-app/src-tauri/src/notifications.rs packages/desktop-app/src-tauri/src/commands.rs packages/desktop-app/src/features/notifications
git commit -m "Add desktop alert notifications"
```

## Task 11: Retention Cleanup

**Files:**
- Modify: `packages/app/src/server/alerts/repository.ts`
- Modify: `packages/app/src/server/alerts/runtime.ts`
- Modify: `packages/app/src/server/alerts/repository.test.ts`
- Modify: `packages/app/src/server/alerts/runtime.test.ts`

- [ ] **Step 1: Add cleanup repository test**

Test that:

```ts
await deleteExpiredAlertEvents({ olderThan: new Date("2026-06-01T00:00:00Z"), limit: 1000 });
```

executes a bounded delete against `alert_events` and leaves current `alert_states`.

- [ ] **Step 2: Add cleanup scanner job**

Add a recurring `alert-cleanup` queue/schedule in `runtime.ts` that runs hourly.

Cleanup deletes:

- alert events older than 7 days.
- old evidence snapshots attached only to deleted events.

Do not delete current `alert_states`.

- [ ] **Step 3: Run tests and commit**

```bash
pnpm --filter @everr/app test -- src/server/alerts/repository.test.ts src/server/alerts/runtime.test.ts
git add packages/app/src/server/alerts/repository.ts packages/app/src/server/alerts/repository.test.ts packages/app/src/server/alerts/runtime.ts packages/app/src/server/alerts/runtime.test.ts
git commit -m "Add alert retention cleanup"
```

## Task 12: Scale And Integration Verification

**Files:**
- Create: `packages/app/src/server/alerts/scale.test.ts`
- Modify: `docs/superpowers/specs/2026-06-06-alerting-system-design.md` only if implementation discovers a required design correction.

- [ ] **Step 1: Add scanner scale test**

Create a test that simulates 5,000 due alert IDs and verifies scanner batching enqueues only the configured batch size in one pass.

Use constants:

```ts
const SCANNER_BATCH_SIZE = 500;
const DUE_ALERT_COUNT = 5_000;
```

Assert that the first scan enqueues 500 jobs and advances only claimed rows.

- [ ] **Step 2: Add two-worker idempotency test**

Mock two scanner invocations sharing the same claimed rows. Assert the repository layer returns each due alert once through row-lock semantics by testing the SQL includes:

```sql
FOR UPDATE SKIP LOCKED
```

and by unit-testing duplicate evaluation scheduled times are ignored by state transition idempotency.

- [ ] **Step 3: Run final checks**

Run:

```bash
pnpm --filter @everr/app test -- src/server/alerts src/routes/api/cli/alerts src/data/alerts src/components/alerts
pnpm --filter @everr/app typecheck
pnpm --filter @everr/desktop-app test
cargo test -p everr-cli alerts_commands
cargo test -p everr-tauri notifications
```

Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add packages/app/src/server/alerts/scale.test.ts docs/superpowers/specs/2026-06-06-alerting-system-design.md
git commit -m "Verify alerting scale behavior"
```

## Self-Review

Spec coverage:

- YAML-only definitions: Tasks 1, 4, and 9.
- CLI local/cloud test and upload: Tasks 4 and 9.
- Source URL and git metadata: Tasks 4 and 9.
- pg-boss with Postgres: Task 6.
- Due-alert scanner instead of per-alert schedules: Tasks 3, 6, and 12.
- 5,000 alerts/minute scale posture: Tasks 6 and 12.
- Routing lists with built-ins: Tasks 3 and 8.
- Desktop critical popup and warning non-popup: Tasks 7 and 10.
- Web visibility: Task 8.
- 7-day retention: Tasks 2, 6, and 11.
- No Drizzle migration generation: scope note and Task 2.

Placeholder scan:

- No unresolved placeholders are intentionally left in this plan.
- Each task has concrete file targets, commands, and expected behavior.

Type consistency:

- TypeScript payloads use `kind` for new workflow/alert discrimination.
- Existing workflow payload keeps the inner `type: "run" | "job"` field to avoid breaking current CLI watch behavior.
- Alert identity remains `(organization_id, service, name)`.
- Evaluation idempotency uses `(alert_definition_id, evaluation_scheduled_for)`.
