# Alerting Pipeline Integration Tests Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run the real alerting pipeline against a real PostgreSQL inside vitest, so the SQL that drives alerting is tested instead of mocked.

**Architecture:** PGlite (PostgreSQL compiled to WebAssembly) runs in the vitest process. The drizzle and graphile-worker migrations are applied to it, `@/db/client` is redirected at it through a lazy proxy, and a hand-written job driver dispatches rows from `graphile_worker._private_jobs` to the real handlers in `alertTaskList`. ClickHouse and outbound HTTP are doubles. One virtual clock drives JavaScript and PostgreSQL together.

**Tech Stack:** vitest, `@electric-sql/pglite`, `drizzle-orm/pglite`, graphile-worker 0.16.6.

**Spec:** `todo/issues/alerting-pipeline-tests/01-pipeline-integration-tests.md`

## Global Constraints

- All work lands on branch `gio/alerting-integration-tests`, already created from `gio/better-alerting`.
- Never write `Co-Authored-By: Claude`, "Generated with Claude Code", or any mention of Claude, Anthropic or AI assistance in a commit message, a PR body, or a code comment.
- Never use em dashes or en dashes in documentation or comments. Use commas, colons, parentheses, or separate sentences.
- Run a scoped test from `packages/app` with `pnpm exec vitest run <path>`. `pnpm -r --filter @everr/app test:ci -- <path>` does NOT scope: it runs the whole 196-file suite. Use `pnpm -r --filter @everr/app test:ci` (no path) only for the full-suite check. Do not use `tsx`.
- Do not run docker suites. Everything in this plan runs in process.
- Do not regenerate drizzle migrations. The schema does not change.
- New integration test files start with `// @vitest-environment node`, which several server tests already use (`src/server/worker/jobs.test.ts`).
- **When a new test fails, it may be a real defect, not a wrong test.** Ticket 41 records one latent bug that no test reaches today, and this suite is expected to reach it. Do not weaken an assertion to make it pass. Stop, report the failure with the evidence, and propose the fix before changing anything.
- Comments explain constraints, not narration. Do not add file-describing banner headers.

## File Structure

**Created**

| File | Responsibility |
|---|---|
| `src/server/alerting/testing/db-proxy.ts` | The lazy `db` stand-in that `vi.mock("@/db/client")` returns, plus `setTestDatabase` and a copy of `runInTransaction` |
| `src/server/alerting/testing/pglite-database.ts` | Builds a PGlite instance, applies both migration sets, truncates between tests |
| `src/server/alerting/testing/clickhouse-double.ts` | Scripted `querySqlApiWithMeta` results and captured `insertAdminRows` rows |
| `src/server/alerting/testing/job-driver.ts` | Reads due rows from `graphile_worker`, dispatches them to `alertTaskList`, applies retry rules |
| `src/server/alerting/testing/harness.ts` | Ties the four together and exposes one object to a test file |
| `src/server/alerting/testing/fixtures.ts` | Insert helpers for rules, channels, receivers, routes, silences, inhibitions |
| `src/server/alerting/pipeline-lifecycle.integration.test.ts` | Task 6 |
| `src/server/alerting/pipeline-suppression.integration.test.ts` | Task 7 |
| `src/server/alerting/pipeline-delivery.integration.test.ts` | Task 8 |
| `src/server/alerting/pipeline-capacity.integration.test.ts` | Task 9 |
| `src/server/alerting/pipeline-routing.integration.test.ts` | Task 10 |
| `src/server/alerting/pipeline-invariants.integration.test.ts` | Task 11 |

**Modified**

| File | Change |
|---|---|
| `src/server/worker/jobs.ts` | `addWorkerJob` runs the `add_job` statement through `db`; `makeWorkerUtils` and the `pool` import are removed |
| `src/server/worker/jobs.test.ts` | Rewritten for the new implementation |
| `packages/app/package.json` | `@electric-sql/pglite` added to devDependencies |

---

### Task 1: One enqueue statement

Both enqueue paths become one SQL statement through the `db` executor, so `addWorkerJob` can reach PGlite and the two paths cannot drift.

**Files:**
- Modify: `src/server/worker/jobs.ts`
- Test: `src/server/worker/jobs.test.ts` (rewrite)

**Interfaces:**
- Consumes: `db`, `Transaction`, `DbExecutor` from `@/db/client`.
- Produces: `addWorkerJob(identifier: string, payload: unknown, spec?: TaskSpec): Promise<void>` and `addWorkerJobInTransaction(tx: Transaction, identifier: string, payload: unknown, spec?: TaskSpec): Promise<void>`, both unchanged in signature. Callers do not change.

- [ ] **Step 1: Write the failing test**

Replace the whole of `src/server/worker/jobs.test.ts`:

```ts
// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
}));

vi.mock("@/db/client", () => ({
  db: { execute: mocks.execute },
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.execute.mockResolvedValue({ rows: [] });
});

describe("addWorkerJob", () => {
  it("enqueues through the same statement the transactional path uses", async () => {
    const { addWorkerJob, addWorkerJobInTransaction } = await import("./jobs");
    const tx = { execute: vi.fn().mockResolvedValue({ rows: [] }) };

    await addWorkerJob("task", { a: 1 }, { jobKey: "k" });
    await addWorkerJobInTransaction(tx as never, "task", { a: 1 }, {
      jobKey: "k",
    });

    const viaPool = mocks.execute.mock.calls[0][0];
    const viaTx = tx.execute.mock.calls[0][0];
    expect(viaPool.queryChunks).toEqual(viaTx.queryChunks);
  });

  it("defaults the spec the same way on both paths", async () => {
    const { addWorkerJob } = await import("./jobs");

    await addWorkerJob("task", { a: 1 });

    const params = mocks.execute.mock.calls[0][0].queryChunks.filter(
      (chunk: unknown) => typeof chunk === "object" && chunk !== null,
    );
    expect(JSON.stringify(params)).toContain("task");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run, from `packages/app`: `pnpm exec vitest run src/server/worker/jobs.test.ts`
Expected: FAIL. The current `addWorkerJob` calls `makeWorkerUtils`, so `mocks.execute` is never called and `mock.calls[0]` is undefined.

- [ ] **Step 3: Rewrite the implementation**

Replace the whole of `src/server/worker/jobs.ts`:

```ts
import { sql } from "drizzle-orm";
import type { TaskSpec } from "graphile-worker";
import { db, type DbExecutor, type Transaction } from "@/db/client";

// One statement for both paths. graphile's `add_job` is the public enqueue
// API and is transaction-safe, so a job committed with the mutation that
// scheduled it and a job enqueued on its own take the identical route.
function addJob(
  executor: DbExecutor,
  identifier: string,
  payload: unknown,
  spec: TaskSpec,
): Promise<unknown> {
  return executor.execute(sql`
    SELECT graphile_worker.add_job(
      ${identifier},
      ${JSON.stringify(payload)}::json,
      queue_name := ${spec.queueName ?? null},
      run_at := ${spec.runAt ?? new Date()},
      max_attempts := ${spec.maxAttempts ?? 25},
      job_key := ${spec.jobKey ?? null},
      priority := ${spec.priority ?? 0},
      flags := ${spec.flags ?? null},
      job_key_mode := ${spec.jobKeyMode ?? "replace"}
    )
  `);
}

export async function addWorkerJob(
  identifier: string,
  payload: unknown,
  spec: TaskSpec = {},
): Promise<void> {
  await addJob(db, identifier, payload, spec);
}

export async function addWorkerJobInTransaction(
  tx: Transaction,
  identifier: string,
  payload: unknown,
  spec: TaskSpec = {},
): Promise<void> {
  await addJob(tx, identifier, payload, spec);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run, from `packages/app`: `pnpm exec vitest run src/server/worker/jobs.test.ts`
Expected: PASS, both tests.

- [ ] **Step 5: Check the other caller still type-checks**

Run: `pnpm -r --filter @everr/app... typecheck`
Expected: no errors. `src/server/github-events/enqueue.ts` calls `addWorkerJob(identifier, data, spec)` and its signature is unchanged.

- [ ] **Step 6: Run the tests that mock this module**

Run, from `packages/app`: `pnpm exec vitest run src/server/github-events src/server/alerting`
Expected: PASS. These files mock `@/server/worker/jobs`, so the change is invisible to them.

- [ ] **Step 7: Commit**

```bash
git add packages/app/src/server/worker/jobs.ts packages/app/src/server/worker/jobs.test.ts
git commit -m "refactor(worker): one statement enqueues a job, whichever path calls it"
```

---

### Task 2: A PostgreSQL that lives in the test process

**Files:**
- Create: `src/server/alerting/testing/pglite-database.ts`
- Create: `src/server/alerting/testing/pglite-database.test.ts`
- Modify: `packages/app/package.json`

**Interfaces:**
- Produces:
  - `createTestDatabase(): Promise<TestDatabase>`
  - `type TestDatabase = { db: PgliteDatabase<typeof schema>; client: PGlite; truncate(): Promise<void>; close(): Promise<void> }`

- [ ] **Step 1: Add the dependency**

```bash
cd /Users/gio/workspace/everr-labs/everr
pnpm --filter @everr/app add -D @electric-sql/pglite
```

- [ ] **Step 2: Write the failing test**

Create `src/server/alerting/testing/pglite-database.test.ts`:

```ts
// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { alertDefinitions } from "@/db/schema";
import { createTestDatabase, type TestDatabase } from "./pglite-database";

let database: TestDatabase;

beforeAll(async () => {
  database = await createTestDatabase();
}, 60_000);

afterAll(async () => {
  await database.close();
});

describe("createTestDatabase", () => {
  it("applies the app schema", async () => {
    await database.db.insert(alertDefinitions).values({
      organizationId: "org_a",
      repoid: "repo_a",
      slug: "checkout-latency",
      spec: {
        sql: "select 1 as value",
        interval_secs: 60,
        for_secs: 0,
        label_columns: [],
        condition: { operator: "gt", threshold: 0 },
        severity: "warning",
        annotations: {},
        resolve_after: 1,
      },
    });

    const rows = await database.db.select().from(alertDefinitions);
    expect(rows).toHaveLength(1);
  });

  it("applies the graphile-worker schema", async () => {
    await database.db.execute(
      sql`select graphile_worker.add_job('alerts/evaluate', '{}'::json, queue_name := 'queue-1')`,
    );

    const jobs = await database.db.execute<{ count: number }>(
      sql`select count(*)::int as count from graphile_worker.jobs`,
    );
    expect(jobs.rows[0]).toEqual({ count: 1 });
  });

  it("truncate clears app tables and jobs together", async () => {
    await database.truncate();

    const rules = await database.db.select().from(alertDefinitions);
    const jobs = await database.db.execute<{ count: number }>(
      sql`select count(*)::int as count from graphile_worker.jobs`,
    );
    expect(rules).toHaveLength(0);
    expect(jobs.rows[0]).toEqual({ count: 0 });
  });
});
```

The file's imports are:

```ts
// @vitest-environment node
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { alertDefinitions } from "@/db/schema";
import { createTestDatabase, type TestDatabase } from "./pglite-database";
```

- [ ] **Step 3: Run the test to verify it fails**

Run, from `packages/app`: `pnpm exec vitest run src/server/alerting/testing/pglite-database.test.ts`
Expected: FAIL, cannot resolve `./pglite-database`.

- [ ] **Step 4: Write the implementation**

Create `src/server/alerting/testing/pglite-database.ts`:

```ts
import { createRequire } from "node:module";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import * as schema from "@/db/schema";

const GRAPHILE_WORKER_SCHEMA = "graphile_worker";

export interface TestDatabase {
  db: PgliteDatabase<typeof schema>;
  client: PGlite;
  truncate(): Promise<void>;
  close(): Promise<void>;
}

function drizzleMigrationsDir(): string {
  // testing/ -> alerting/ -> server/ -> src/ -> packages/app/
  return join(dirname(fileURLToPath(import.meta.url)), "../../../../drizzle");
}

function graphileWorkerSqlDir(): string {
  const require = createRequire(import.meta.url);
  return join(dirname(require.resolve("graphile-worker/package.json")), "sql");
}

function sqlFilesIn(dir: string): string[] {
  return readdirSync(dir)
    .filter((name) => name.endsWith(".sql"))
    .sort()
    .map((name) => join(dir, name));
}

async function applyGraphileWorkerSchema(client: PGlite): Promise<void> {
  await client.exec(`CREATE SCHEMA ${GRAPHILE_WORKER_SCHEMA};`);
  for (const file of sqlFilesIn(graphileWorkerSqlDir())) {
    const text = readFileSync(file, "utf8").replaceAll(
      ":GRAPHILE_WORKER_SCHEMA",
      GRAPHILE_WORKER_SCHEMA,
    );
    await client.exec(text);
  }
}

async function applyAppSchema(client: PGlite): Promise<void> {
  for (const file of sqlFilesIn(drizzleMigrationsDir())) {
    for (const statement of readFileSync(file, "utf8").split(
      "--> statement-breakpoint",
    )) {
      if (statement.trim().length === 0) continue;
      await client.exec(statement);
    }
  }
}

export async function createTestDatabase(): Promise<TestDatabase> {
  const client = await PGlite.create();
  await applyGraphileWorkerSchema(client);
  await applyAppSchema(client);
  const db = drizzle(client, { schema });

  // Discovered rather than hand-listed, so a table added to the schema is
  // cleared without this file being updated. A stale row left behind is the
  // worst failure mode a shared fixture has: it makes one test's result
  // depend on which tests ran before it.
  const targets = await db.execute<{ target: string }>(sql`
    SELECT format('%I.%I', schemaname, tablename) AS target
    FROM pg_tables
    WHERE (schemaname = 'public' AND tablename LIKE 'alert%')
       OR schemaname = ${GRAPHILE_WORKER_SCHEMA}
  `);
  const truncateList = targets.rows.map((row) => row.target).join(", ");

  return {
    db,
    client,
    async truncate() {
      await db.execute(
        sql.raw(`TRUNCATE TABLE ${truncateList} RESTART IDENTITY CASCADE`),
      );
    },
    async close() {
      await client.close();
    },
  };
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run, from `packages/app`: `pnpm exec vitest run src/server/alerting/testing/pglite-database.test.ts`
Expected: PASS, all three tests.

If the graphile-worker files fail to apply, print the failing file and statement before changing anything: the spike applied all 18 cleanly, so a failure here is new information.

- [ ] **Step 6: Commit**

```bash
git add packages/app/package.json packages/app/src/server/alerting/testing pnpm-lock.yaml
git commit -m "test(alerts): a postgres the test process can own"
```

---

### Task 3: Point the pipeline at it

The pipeline imports `db` at module load, before any `beforeAll` runs, so the seam has to be a proxy that resolves lazily.

**Files:**
- Create: `src/server/alerting/testing/db-proxy.ts`
- Create: `src/server/alerting/testing/clickhouse-double.ts`
- Test: covered by Task 4's smoke test

**Interfaces:**
- Produces from `db-proxy.ts`:
  - `testDb: PgliteDatabase<typeof schema>` (a proxy)
  - `setTestDatabase(db: PgliteDatabase<typeof schema> | undefined): void`
  - `runInTransaction<T>(executor: DbExecutor, fn: (tx: Transaction) => Promise<T>): Promise<T>`
- Produces from `clickhouse-double.ts`:
  - `class ClickHouseDouble` with `setRows(rows: Record<string, unknown>[]): void`, `setFailure(error: Error | null): void`, `historyRows(): Record<string, unknown>[]`, `reset(): void`
  - `querySqlApiWithMeta`, `insertAdminRows`, `query`, `querySqlApi`, `createClickhouseQuery` bound to the active double
  - `activeClickHouse: ClickHouseDouble`

- [ ] **Step 1: Write the db proxy**

Create `src/server/alerting/testing/db-proxy.ts`:

```ts
import { PgTransaction } from "drizzle-orm/pg-core";
import type { PgliteDatabase } from "drizzle-orm/pglite";
import type * as schema from "@/db/schema";

type TestDb = PgliteDatabase<typeof schema>;

let current: TestDb | undefined;

export function setTestDatabase(db: TestDb | undefined): void {
  current = db;
}

// The pipeline imports `db` while the module graph loads, which is before any
// beforeAll can build a database. A proxy defers every property read to the
// moment the query runs, by which time the hook has set one.
export const testDb = new Proxy({} as TestDb, {
  get(_target, property) {
    if (!current) {
      throw new Error(
        "test database not set: call setTestDatabase in beforeAll",
      );
    }
    // The receiver defaults to the target, which is the real database. Passing
    // the proxy instead would run any accessor drizzle adds later with `this`
    // bound to the proxy, and the wrong value would read as a pipeline bug.
    const value = Reflect.get(current, property);
    return typeof value === "function" ? value.bind(current) : value;
  },
}) as TestDb;

// Copied from @/db/client rather than imported: importing it would construct
// the real connection pool, which is the thing the mock exists to avoid.
export function runInTransaction<T>(
  executor: unknown,
  fn: (tx: never) => Promise<T>,
): Promise<T> {
  return executor instanceof PgTransaction
    ? fn(executor as never)
    : (executor as TestDb).transaction(fn as never);
}
```

- [ ] **Step 2: Write the ClickHouse double**

Create `src/server/alerting/testing/clickhouse-double.ts`:

```ts
export interface SqlApiResult<T> {
  rows: T[];
  columns: string[];
  columnTypes: string[];
}

export class ClickHouseDouble {
  private rows: Record<string, unknown>[] = [];
  private failure: Error | null = null;
  private history: Record<string, unknown>[] = [];

  /** What the next rule evaluation sees as its query result. */
  setRows(rows: Record<string, unknown>[]): void {
    this.rows = rows;
    this.failure = null;
  }

  /** What the next rule evaluation throws instead of returning rows. */
  setFailure(error: Error | null): void {
    this.failure = error;
  }

  /** Every row written to app.alert_events, in write order. */
  historyRows(): Record<string, unknown>[] {
    return this.history;
  }

  reset(): void {
    this.rows = [];
    this.failure = null;
    this.history = [];
  }

  read<T>(): SqlApiResult<T> {
    if (this.failure) throw this.failure;
    const columns = Object.keys(this.rows[0] ?? {});
    return {
      rows: this.rows as T[],
      columns,
      columnTypes: columns.map(() => "String"),
    };
  }

  write(rows: object[]): void {
    this.history.push(...(rows as Record<string, unknown>[]));
  }
}

export const activeClickHouse = new ClickHouseDouble();

export async function querySqlApiWithMeta<T>(): Promise<SqlApiResult<T>> {
  return activeClickHouse.read<T>();
}

export async function querySqlApi<T>(): Promise<T[]> {
  return activeClickHouse.read<T>().rows;
}

export async function query<T>(): Promise<T[]> {
  return activeClickHouse.read<T>().rows;
}

export async function insertAdminRows(
  _table: string,
  rows: object[],
): Promise<void> {
  activeClickHouse.write(rows);
}

export function createClickhouseQuery() {
  return async <T>(): Promise<T[]> => activeClickHouse.read<T>().rows;
}
```

- [ ] **Step 3: Verify it type-checks**

Run: `pnpm -r --filter @everr/app... typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add packages/app/src/server/alerting/testing
git commit -m "test(alerts): the seams the pipeline is driven through"
```

---

### Task 4: A driver that runs the jobs

**Files:**
- Create: `src/server/alerting/testing/job-driver.ts`
- Create: `src/server/alerting/testing/harness.ts`
- Create: `src/server/alerting/pipeline-smoke.integration.test.ts`

**Interfaces:**
- Consumes: `TestDatabase` (Task 2), `setTestDatabase`, `testDb`, `runInTransaction` (Task 3), `activeClickHouse` (Task 3), `alertTaskList` from `@/server/alerting/runtime`.
- Produces from `job-driver.ts`:
  - `runDueJobs(db: PgliteDatabase<typeof schema>, opts?: { now?: Date; limit?: number }): Promise<number>` returning how many jobs ran
  - `pendingJobs(db): Promise<{ identifier: string; payload: unknown; runAt: Date; attempts: number }[]>`
  - `failedJobs(db): Promise<{ identifier: string; attempts: number; lastError: string }[]>`
- Produces from `harness.ts`:
  - `createAlertingHarness(): Promise<AlertingHarness>`
  - `type AlertingHarness = { db; clickhouse: ClickHouseDouble; fetchCalls(): { url: string; body: unknown }[]; setFetchResponse(r: { status: number; body?: string } | ((url: string) => { status: number; body?: string })): void; runDueJobs(opts?): Promise<number>; pendingJobs(): Promise<...>; failedJobs(): Promise<...>; setNow(when: Date): void; advance(ms: number): void; reset(): Promise<void>; close(): Promise<void> }`

- [ ] **Step 1: Write the job driver**

Create `src/server/alerting/testing/job-driver.ts`:

```ts
import { sql } from "drizzle-orm";
import type { PgliteDatabase } from "drizzle-orm/pglite";
import type * as schema from "@/db/schema";
import { alertTaskList } from "@/server/alerting/runtime";

type Db = PgliteDatabase<typeof schema>;

interface DueJob {
  id: string;
  identifier: string;
  payload: unknown;
  attempts: number;
  max_attempts: number;
}

// graphile's own backoff, so a test that counts attempts over time counts the
// same intervals production does.
function backoffSeconds(attempts: number): number {
  return Math.exp(Math.min(10, attempts));
}

async function claimNextDueJob(db: Db, now: Date): Promise<DueJob | undefined> {
  const result = await db.execute<DueJob>(sql`
    SELECT j.id::text AS id,
           t.identifier AS identifier,
           j.payload AS payload,
           j.attempts AS attempts,
           j.max_attempts AS max_attempts
    FROM graphile_worker._private_jobs j
    JOIN graphile_worker._private_tasks t ON t.id = j.task_id
    WHERE j.run_at <= ${now}
      AND j.attempts < j.max_attempts
    ORDER BY j.priority, j.run_at, j.id
    LIMIT 1
  `);
  return result.rows[0];
}

/**
 * Runs every job that is due, one at a time, until none is. A handler that
 * enqueues more work is picked up by the same loop, so one call drains a
 * whole cascade: evaluate, then process event, then flush group, then send.
 */
export async function runDueJobs(
  db: Db,
  opts: { now?: Date; limit?: number } = {},
): Promise<number> {
  const limit = opts.limit ?? 500;
  let ran = 0;
  for (; ran < limit; ) {
    const now = opts.now ?? new Date();
    const job = await claimNextDueJob(db, now);
    if (!job) return ran;
    ran += 1;
    const handler = alertTaskList[job.identifier];
    if (!handler) {
      throw new Error(`no handler registered for task ${job.identifier}`);
    }
    try {
      await handler(job.payload, {} as never);
      await db.execute(
        sql`DELETE FROM graphile_worker._private_jobs WHERE id = ${job.id}::bigint`,
      );
    } catch (cause) {
      const attempts = job.attempts + 1;
      const message = cause instanceof Error ? cause.message : String(cause);
      await db.execute(sql`
        UPDATE graphile_worker._private_jobs
        SET attempts = ${attempts},
            last_error = ${message},
            run_at = ${new Date(
              now.getTime() + backoffSeconds(attempts) * 1_000,
            )}
        WHERE id = ${job.id}::bigint
      `);
    }
  }
  throw new Error(
    `job driver ran ${limit} jobs without draining: suspect a job that re-enqueues itself`,
  );
}

export async function pendingJobs(db: Db) {
  const result = await db.execute<{
    identifier: string;
    payload: unknown;
    run_at: Date;
    attempts: number;
  }>(sql`
    SELECT t.identifier, j.payload, j.run_at, j.attempts
    FROM graphile_worker._private_jobs j
    JOIN graphile_worker._private_tasks t ON t.id = j.task_id
    WHERE j.attempts < j.max_attempts
    ORDER BY j.run_at, j.id
  `);
  return result.rows.map((row) => ({
    identifier: row.identifier,
    payload: row.payload,
    runAt: row.run_at,
    attempts: row.attempts,
  }));
}

export async function failedJobs(db: Db) {
  const result = await db.execute<{
    identifier: string;
    attempts: number;
    last_error: string;
  }>(sql`
    SELECT t.identifier, j.attempts, j.last_error
    FROM graphile_worker._private_jobs j
    JOIN graphile_worker._private_tasks t ON t.id = j.task_id
    WHERE j.attempts >= j.max_attempts
    ORDER BY j.id
  `);
  return result.rows.map((row) => ({
    identifier: row.identifier,
    attempts: row.attempts,
    lastError: row.last_error,
  }));
}
```

- [ ] **Step 2: Write the harness**

Create `src/server/alerting/testing/harness.ts`:

```ts
import { vi } from "vitest";
import { activeClickHouse, type ClickHouseDouble } from "./clickhouse-double";
import { failedJobs, pendingJobs, runDueJobs } from "./job-driver";
import { createTestDatabase, type TestDatabase } from "./pglite-database";
import { setTestDatabase } from "./db-proxy";

type FetchResponse = { status: number; body?: string };
type FetchResponder = FetchResponse | ((url: string) => FetchResponse);

export interface AlertingHarness {
  db: TestDatabase["db"];
  clickhouse: ClickHouseDouble;
  fetchCalls(): { url: string; body: unknown }[];
  setFetchResponse(responder: FetchResponder): void;
  runDueJobs(opts?: { limit?: number }): Promise<number>;
  pendingJobs(): ReturnType<typeof pendingJobs>;
  failedJobs(): ReturnType<typeof failedJobs>;
  setNow(when: Date): void;
  advance(ms: number): void;
  reset(): Promise<void>;
  close(): Promise<void>;
}

export async function createAlertingHarness(): Promise<AlertingHarness> {
  const database = await createTestDatabase();
  setTestDatabase(database.db);

  let responder: FetchResponder = { status: 200, body: "ok" };
  const calls: { url: string; body: unknown }[] = [];

  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      let body: unknown = init?.body;
      if (typeof init?.body === "string") {
        try {
          body = JSON.parse(init.body);
        } catch {
          // A provider that posts form-encoded text keeps its raw string.
        }
      }
      calls.push({ url, body });
      const response =
        typeof responder === "function" ? responder(url) : responder;
      return new Response(response.body ?? "", { status: response.status });
    }),
  );

  return {
    db: database.db,
    clickhouse: activeClickHouse,
    fetchCalls: () => calls,
    setFetchResponse(next) {
      responder = next;
    },
    runDueJobs: (opts) => runDueJobs(database.db, opts),
    pendingJobs: () => pendingJobs(database.db),
    failedJobs: () => failedJobs(database.db),
    setNow(when) {
      vi.setSystemTime(when);
    },
    advance(ms) {
      vi.setSystemTime(new Date(Date.now() + ms));
    },
    async reset() {
      await database.truncate();
      activeClickHouse.reset();
      calls.length = 0;
      responder = { status: 200, body: "ok" };
    },
    async close() {
      setTestDatabase(undefined);
      vi.unstubAllGlobals();
      await database.close();
    },
  };
}
```

- [ ] **Step 3: Write the failing smoke test**

Create `src/server/alerting/pipeline-smoke.integration.test.ts`:

```ts
// @vitest-environment node
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { alertDeliveries, alertInstances } from "@/db/schema";
import {
  type AlertingHarness,
  createAlertingHarness,
} from "./testing/harness";
import { insertDirectRule } from "./testing/fixtures";

vi.mock("@/db/client", async () => {
  const { testDb, runInTransaction } = await import("./testing/db-proxy");
  return { db: testDb, runInTransaction };
});

vi.mock("@/lib/clickhouse", async () => import("./testing/clickhouse-double"));

let harness: AlertingHarness;

beforeAll(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  harness = await createAlertingHarness();
}, 60_000);

afterEach(async () => {
  await harness.reset();
});

afterAll(async () => {
  await harness.close();
  vi.useRealTimers();
});

describe("the alerting pipeline", () => {
  it("takes a breaching rule from evaluation to a delivered notification", async () => {
    harness.setNow(new Date("2026-01-01T00:00:00Z"));
    const rule = await insertDirectRule(harness.db, {
      sql: "select 'checkout' as service, 42 as value",
      forSecs: 0,
      channelType: "slack",
    });
    harness.clickhouse.setRows([{ service: "checkout", value: 42 }]);

    await harness.runDueJobs();

    const instances = await harness.db.select().from(alertInstances);
    expect(instances).toHaveLength(1);
    expect(instances[0].status).toBe("firing");

    // A direct-channel rule groups like any other, so its notification waits
    // the default group wait before the flush claims it.
    harness.advance(ALERTING_DEFAULT_GROUP_WAIT_SECS * 1_000);
    await harness.runDueJobs();

    const deliveries = await harness.db.select().from(alertDeliveries);
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0].status).toBe("sent");

    expect(harness.fetchCalls()).toHaveLength(1);
    expect(harness.clickhouse.historyRows().map((r) => r.event_type)).toContain(
      "instance_fired",
    );
    expect(rule.id).toBeTruthy();
  });
});
```

- [ ] **Step 4: Run it to verify it fails**

Run, from `packages/app`: `pnpm exec vitest run src/server/alerting/pipeline-smoke.integration.test.ts`
Expected: FAIL, cannot resolve `./testing/fixtures`. Task 5 creates it.

- [ ] **Step 5: Commit the driver and harness**

```bash
git add packages/app/src/server/alerting/testing packages/app/src/server/alerting/pipeline-smoke.integration.test.ts
git commit -m "test(alerts): a driver that runs the pipeline's jobs to exhaustion"
```

---

### Task 5: Fixtures, and the smoke test goes green

The fixture builders decide how readable every later test is. One call sets up a whole scenario, and every field a test does not care about gets a working default.

**Files:**
- Create: `src/server/alerting/testing/fixtures.ts`
- Test: `src/server/alerting/pipeline-smoke.integration.test.ts` (from Task 4)

**Interfaces:**
- Produces:
  - `insertRule(db, overrides?): Promise<RuleFixture>` where `RuleFixture = { id: string; organizationId: string; project: string; slug: string }`
  - `insertPreview(db, overrides?): Promise<{ id: string }>` (required before a rule may carry a `previewId`)
  - `insertChannel(db, overrides?): Promise<{ id: string; name: string }>`
  - `insertReceiver(db, overrides?): Promise<{ id: string; name: string }>`
  - `insertRoute(db, overrides?): Promise<{ id: string }>`
  - `insertDirectRule(db, overrides?): Promise<RuleFixture>` (a rule with a channel attached directly, the shortest path to a delivery)
  - `insertSilence(db, overrides?): Promise<{ id: string }>`
  - `insertInhibition(db, overrides?): Promise<{ id: string }>`
  - `TEST_ORG = "org_test"`

- [ ] **Step 1: Write the fixtures**

Create `src/server/alerting/testing/fixtures.ts`:

```ts
import { eq } from "drizzle-orm";
import type { PgliteDatabase } from "drizzle-orm/pglite";
import { encryptChannelConfig } from "@/data/alerting/delivery/channel-secrets.server";
import type { AlertingRuleSpec } from "@/data/alerting/types";
import * as schema from "@/db/schema";
import {
  alertChannels,
  alertDefinitionChannels,
  alertDefinitions,
  alertInhibitions,
  alertReceiverChannels,
  alertReceivers,
  alertRoutes,
  alertSilences,
  previews,
} from "@/db/schema";

type Db = PgliteDatabase<typeof schema>;

export const TEST_ORG = "org_test";

export interface RuleFixture {
  id: string;
  organizationId: string;
  project: string;
  slug: string;
}

interface RuleOverrides {
  organizationId?: string;
  slug?: string;
  project?: string;
  sql?: string;
  forSecs?: number;
  intervalSecs?: number;
  labelColumns?: string[];
  severity?: AlertingRuleSpec["severity"];
  resolveAfter?: number;
  nextEvaluationAt?: Date;
  previewId?: string | null;
  active?: boolean;
}

function ruleSpec(overrides: RuleOverrides): AlertingRuleSpec {
  return {
    sql: overrides.sql ?? "select 'checkout' as service, 42 as value",
    interval_secs: overrides.intervalSecs ?? 60,
    for_secs: overrides.forSecs ?? 0,
    label_columns: overrides.labelColumns ?? ["service"],
    condition: { operator: "gt", threshold: 0 },
    severity: overrides.severity ?? "warning",
    annotations: { summary: "{{ labels.service }} is breaching" },
    resolve_after: overrides.resolveAfter ?? 1,
  };
}

export async function insertRule(
  db: Db,
  overrides: RuleOverrides = {},
): Promise<RuleFixture> {
  const [row] = await db
    .insert(alertDefinitions)
    .values({
      organizationId: overrides.organizationId ?? TEST_ORG,
      repoid: "repo_test",
      project: overrides.project ?? "default",
      slug: overrides.slug ?? "checkout-latency",
      spec: ruleSpec(overrides),
      previewId: overrides.previewId ?? null,
      active: overrides.active ?? true,
      // Due now, so the scanner picks it up on the first drain.
      nextEvaluationAt: overrides.nextEvaluationAt ?? new Date(),
    })
    .returning({
      id: alertDefinitions.id,
      organizationId: alertDefinitions.organizationId,
      project: alertDefinitions.project,
      slug: alertDefinitions.slug,
    });
  return row;
}

export async function insertChannel(
  db: Db,
  overrides: {
    organizationId?: string;
    name?: string;
    type?: "slack" | "discord" | "webhook" | "telegram";
  } = {},
) {
  const organizationId = overrides.organizationId ?? TEST_ORG;
  const name = overrides.name ?? "oncall";
  const type = overrides.type ?? "slack";
  const config =
    type === "telegram"
      ? { type, bot_token: "bot-token", chat_ids: ["1"] }
      : { type, url: `https://example.test/${type}` };
  const [created] = await db
    .insert(alertChannels)
    .values({ organizationId, name, encryptedConfig: "" })
    .returning({ id: alertChannels.id });
  // The config is sealed against the channel id, so it can only be written
  // once the row exists.
  await db
    .update(alertChannels)
    .set({
      encryptedConfig: encryptChannelConfig(
        organizationId,
        created.id,
        config as never,
      ),
    })
    .where(eq(alertChannels.id, created.id));
  return { id: created.id, name };
}

/**
 * A preview row, needed before any rule may carry a `previewId`: the rule's
 * foreign key is composite over (preview_id, organization_id, repoid).
 */
export async function insertPreview(
  db: Db,
  overrides: { organizationId?: string; name?: string } = {},
) {
  const [preview] = await db
    .insert(previews)
    .values({
      organizationId: overrides.organizationId ?? TEST_ORG,
      repoid: "repo_test",
      name: overrides.name ?? "gio/branch",
    })
    .returning({ id: previews.id });
  return preview;
}
```

Then add the remaining builders to the same file:

```ts
export async function insertReceiver(
  db: Db,
  overrides: {
    organizationId?: string;
    name?: string;
    channelIds?: string[];
  } = {},
) {
  const organizationId = overrides.organizationId ?? TEST_ORG;
  const name = overrides.name ?? "team-payments";
  const [receiver] = await db
    .insert(alertReceivers)
    .values({ organizationId, name })
    .returning({ id: alertReceivers.id });
  const channelIds = overrides.channelIds ?? [];
  if (channelIds.length > 0) {
    await db.insert(alertReceiverChannels).values(
      channelIds.map((channelId, position) => ({
        organizationId,
        receiverId: receiver.id,
        channelId,
        position,
      })),
    );
  }
  return { id: receiver.id, name };
}

export async function insertRoute(
  db: Db,
  overrides: {
    organizationId?: string;
    receiver?: string;
    priority?: number;
    matchers?: { label: string; op: "eq" | "ne"; value: string }[];
    continue?: boolean;
    groupBy?: string[];
    groupWaitSecs?: number;
    groupIntervalSecs?: number;
    repeatIntervalSecs?: number | null;
  } = {},
) {
  const [route] = await db
    .insert(alertRoutes)
    .values({
      organizationId: overrides.organizationId ?? TEST_ORG,
      receiver: overrides.receiver ?? "team-payments",
      priority: overrides.priority ?? 0,
      matchers: overrides.matchers ?? [],
      continue: overrides.continue ?? false,
      groupBy: overrides.groupBy ?? null,
      groupWaitSecs: overrides.groupWaitSecs ?? null,
      groupIntervalSecs: overrides.groupIntervalSecs ?? null,
      repeatIntervalSecs: overrides.repeatIntervalSecs ?? null,
    })
    .returning({ id: alertRoutes.id });
  return route;
}

/** A rule wired straight to one channel: the shortest path to a delivery. */
export async function insertDirectRule(
  db: Db,
  overrides: RuleOverrides & {
    channelType?: "slack" | "discord" | "webhook" | "telegram";
  } = {},
): Promise<RuleFixture> {
  const rule = await insertRule(db, overrides);
  const channel = await insertChannel(db, {
    organizationId: rule.organizationId,
    type: overrides.channelType ?? "slack",
  });
  await db.insert(alertDefinitionChannels).values({
    organizationId: rule.organizationId,
    alertDefinitionId: rule.id,
    channelId: channel.id,
    position: 0,
  });
  return rule;
}

export async function insertSilence(
  db: Db,
  overrides: {
    organizationId?: string;
    matchers?: { label: string; op: "eq" | "ne"; value: string }[];
    startsAt?: Date;
    endsAt?: Date;
  } = {},
) {
  const now = new Date();
  const [silence] = await db
    .insert(alertSilences)
    .values({
      organizationId: overrides.organizationId ?? TEST_ORG,
      matchers: overrides.matchers ?? [
        { label: "service", op: "eq", value: "checkout" },
      ],
      startsAt: overrides.startsAt ?? now,
      endsAt: overrides.endsAt ?? new Date(now.getTime() + 3_600_000),
    })
    .returning({ id: alertSilences.id });
  return silence;
}

export async function insertInhibition(
  db: Db,
  overrides: {
    organizationId?: string;
    sourceMatchers?: { label: string; op: "eq" | "ne"; value: string }[];
    targetMatchers?: { label: string; op: "eq" | "ne"; value: string }[];
    equalLabels?: string[];
  } = {},
) {
  const [inhibition] = await db
    .insert(alertInhibitions)
    .values({
      organizationId: overrides.organizationId ?? TEST_ORG,
      sourceMatchers: overrides.sourceMatchers ?? [
        { label: "rule", op: "eq", value: "default/cluster-down" },
      ],
      targetMatchers: overrides.targetMatchers ?? [
        { label: "rule", op: "eq", value: "default/checkout-latency" },
      ],
      equalLabels: overrides.equalLabels ?? [],
    })
    .returning({ id: alertInhibitions.id });
  return inhibition;
}
```

- [ ] **Step 2: Reconcile the column names against the schema**

The builders above name columns as the schema is expected to have them. Open `src/db/schema/alerts.ts` and check every column used here: `alertRoutes` (`receiver`, `priority`, `matchers`, `continue`, `groupBy`, `groupWaitSecs`, `groupIntervalSecs`, `repeatIntervalSecs`), `alertSilences` (`matchers`, `startsAt`, `endsAt`, and whether a principal or author column is `notNull`), `alertInhibitions` (`sourceMatchers`, `targetMatchers`, `equalLabels`), `alertReceiverChannels` and `alertDefinitionChannels` (`position`). Fix any name or nullability mismatch here rather than in the tests.

Run: `pnpm -r --filter @everr/app... typecheck`
Expected: no errors. A mismatch shows up as a type error on the insert.

- [ ] **Step 3: Run the smoke test**

Run, from `packages/app`: `pnpm exec vitest run src/server/alerting/pipeline-smoke.integration.test.ts`
Expected: PASS.

This is the moment the whole design is proved. If it fails, work outward in this order: does the scanner enqueue (`pendingJobs()` after one drain), does evaluation write an instance, does an event row appear, is a delivery created, is fetch called. Report which stage stops rather than adjusting the test.

- [ ] **Step 4: Commit**

```bash
git add packages/app/src/server/alerting/testing/fixtures.ts packages/app/src/server/alerting/pipeline-smoke.integration.test.ts
git commit -m "test(alerts): one rule goes from evaluation to a delivered message"
```

---

### Tasks 6 to 11: the test files

Every one of these tasks has the same shape, so the shape is stated once here and each task below lists only its cases.

**Facts established while building the harness. Every test file depends on these.**

- **A notification is never immediate.** Every dispatch target, including a rule wired straight to a channel, carries `ALERTING_DEFAULT_GROUP_WAIT_SECS` (10s). So the shape of an end-to-end case is: drain, then `harness.advance(10_000)`, then drain again, and only then assert on deliveries or `fetchCalls()`. Asserting on a delivery after a single drain will always find none.
- **A rule is enqueued when it is created, not when the scanner next runs.** Production's `createRule` enqueues the first evaluation transactionally, and the scanner cron is a backstop for rules that fall behind, never the first trigger. `insertRule` does the same, which is what makes one `runDueJobs()` reach evaluation.
- **`alert_routes` and `alert_inhibitions` do not have a column per field.** Both pack their non-identity fields into a single `config` jsonb column, in snake_case. `insertRoute` also resolves a receiver name to a receiver id. Read `fixtures.ts` before writing a routing case, not the domain types.
- **Channel URLs must be IP literals.** The production SSRF guard resolves the host before sending, so a `.test` hostname fails a real DNS lookup and the request never reaches the stubbed `fetch`. The fixtures default to `203.0.113.10` (RFC 5737 documentation range), which the guard passes without a DNS call.

**Per-task steps**

- [ ] **Step 1:** Create the file with the header block below.
- [ ] **Step 2:** Write the file's cases, one `it` each, in the order listed.
- [ ] **Step 3:** Run, from `packages/app`: `pnpm exec vitest run <file>`.
- [ ] **Step 4:** For each failure, decide whether the test is wrong or the code is. Report any case where the code looks wrong, with the observed rows, and do not weaken the assertion.
- [ ] **Step 5:** Commit with the message given in the task.

**The header block every file starts with**

```ts
// @vitest-environment node
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  type AlertingHarness,
  createAlertingHarness,
} from "./testing/harness";

vi.mock("@/db/client", async () => {
  const { testDb, runInTransaction } = await import("./testing/db-proxy");
  return { db: testDb, runInTransaction };
});

vi.mock("@/lib/clickhouse", async () => import("./testing/clickhouse-double"));

let harness: AlertingHarness;

// The harness owns the fake clock: it installs a Date-only fake timer on
// create and restores real timers on close. Faking the whole timer set would
// hang PGlite's WebAssembly boot, so no test file installs its own.
beforeAll(async () => {
  harness = await createAlertingHarness();
}, 60_000);

beforeEach(() => {
  harness.setNow(new Date("2026-01-01T00:00:00Z"));
});

afterEach(async () => {
  await harness.reset();
});

afterAll(async () => {
  await harness.close();
});
```

**How a case is written**

Arrange with the fixture builders, set the ClickHouse rows, drain the jobs, then assert on database rows, on `harness.fetchCalls()`, and on `harness.clickhouse.historyRows()`. A case that spans time sets the rows for the next tick, calls `harness.advance(...)`, and drains again. This example is the pattern to copy:

```ts
it("holds a breach in pending until `for` elapses, and never notifies while pending", async () => {
  await insertDirectRule(harness.db, { forSecs: 300, intervalSecs: 60 });
  harness.clickhouse.setRows([{ service: "checkout", value: 42 }]);

  await harness.runDueJobs();
  const [pending] = await harness.db.select().from(alertInstances);
  expect(pending.status).toBe("pending");
  expect(harness.fetchCalls()).toHaveLength(0);

  for (let tick = 0; tick < 5; tick += 1) {
    harness.advance(60_000);
    await harness.runDueJobs();
  }

  const [firing] = await harness.db.select().from(alertInstances);
  expect(firing.status).toBe("firing");

  // The tick that fires only enqueues the notification. Nothing is sent until
  // the group wait elapses and the flush claims it.
  harness.advance(ALERTING_DEFAULT_GROUP_WAIT_SECS * 1_000);
  await harness.runDueJobs();
  expect(harness.fetchCalls()).toHaveLength(1);
});
```

---

### Task 6: `pipeline-lifecycle.integration.test.ts`

**Cases**

1. `for: 0` fires on the first breach: one firing instance, one `instance_fired` history row, one delivery in `sent`, one fetch call carrying the rendered summary.
2. `for: 5m` stays pending across ticks then fires, and nothing is sent while pending. (The example above.)
3. The breach clears. With `resolve_after: 2`, one absent tick keeps the instance firing and the second resolves it: one `instance_resolved` row and a second fetch call.
4. Flap: fire, resolve, fire again. Two distinct `episode_id` values across the history rows, and the second episode's id is absent from the first episode's rows.
5. An outage restarts the `for` clock. `intervalSecs: 60`, `forSecs: 300`, breach seen once, then advance 10 minutes (more than `MISSED_EVALUATION_TOLERANCE` times the interval) and breach again. The instance is `pending`, not `firing`, and `pending_since` equals the later tick.
6. Pausing the rule closes the open instance with a terminal lifecycle row and stops further evaluation jobs. Drive it through `closeRuleLifecycle` from `@/data/alerting/rules/lifecycle.server`, which is the entry point both pause and delete use; read its signature before writing the case.
7. Deleting the rule closes the open instance and leaves no orphaned rows in `alert_instances`.
8. The query throws the result overflow: `harness.clickhouse.setFailure(new Error("Limit for result exceeded, max rows: 1000"))`. The rule's `health_status` is degraded, `degraded_since` is set once and does not move on the second failure, an `evaluation_failed` history row is written, and the next evaluation job's `run_at` is further out than the previous one.
9. The scanner advances scheduling: after one drain, `next_evaluation_at` is one interval later, and the same rule at the same `scheduledFor` does not produce a second evaluation job.
10. Changing `label_columns` closes the instances whose fingerprints it destroys, with the lifecycle reason the vocabulary defines for it.
11. A job payload carrying an older `ruleVersion` than the rule's current `version` does not overwrite the newer state.
12. Two history rows written by one evaluation transaction share the same `journaled_at` value.
13. Running the lifecycle projection twice over the same event leaves one history row for it.

**Commit:** `test(alerts): the instance lifecycle, driven end to end`

---

### Task 7: `pipeline-suppression.integration.test.ts`

**Cases**

1. A silence matching the instance's labels defers the notification: no fetch call, the `alert_events` row stamped silenced with `processed_at` back to null, and the instance still reaches `firing`. There is no `notification_deferred` history type: per ticket 40 a deferred fire is bookkept in Postgres and re-queued, and only a terminated event journals `notification_suppressed`.
2. The silence expires. Advance past `ends_at`, drain, and the notification goes out with a history row that marks it late.
3. Canceling the silence releases every held event in one statement: two held events both notify after one drain, and the cancel wrote both release jobs inside its own transaction.
4. An inhibition holds the target while the source fires. No fetch call for the target, and a hold decision row is written.
5. The source clears. After the 60 second recheck the held target notifies.
6. A preview rule never notifies: create a preview with `insertPreview`, pass its id as `previewId` to `insertDirectRule`, and assert there is no delivery row and that the history row carries `rule_muted` true.
7. A page severity outranks a preview: with both a preview rule and a paging rule breaching, only the paging rule notifies.
8. A canceled silence stores the stable principal separately from the display author.
9. A mutation records the server-derived actor, and a client-supplied actor field in the input does not reach the stored row.
10. A silence whose matchers select one of three instances defers exactly that one: one deferred, two delivered.

**Commit:** `test(alerts): silences and inhibitions mute the message, not the record`

---

### Task 8: `pipeline-delivery.integration.test.ts`

**Cases**

1. Group wait: three instances of one rule firing inside the wait window leave in one fetch call whose body names all three.
2. Group interval: after the first flush, a fourth instance waits the group interval, not the group wait, before its flush runs.
3. A repeat interval shorter than the group interval. Ticket 39 records this as an OPEN product decision ("do not treat the combination as a bug without settling this first"), so the case must not assert a floor. Pin the current behavior instead: a short repeat does fire faster than the group interval. Cite ticket 39 in a comment so that when the decision is made, changing this test is deliberate.
4. A group parked on the idle sentinel with `last_flushed_at` null takes `now + group_wait` when the next event is dispatched to it, not the year 9999. This is ticket 41's case and is expected to fail before the one line fix.
5. A permanent failure stops after one attempt: `setFetchResponse({ status: 403 })`, and the delivery row has `attempts` equal to `ALERT_DELIVERY_MAX_ATTEMPTS`, status `failed`, exactly one `delivery_failed` history row, and one fetch call.
6. A transient failure retries: `setFetchResponse({ status: 503 })`, drained repeatedly with `advance` between drains, produces exactly five fetch calls and then stops.
7. Telegram fan-out with one recipient permanent and one transient retries, because the combined verdict is transient.
8. Two runs of the same delivery converge on one history row for one `delivery_dedup_key`.
9. Deleting a channel that has delivery history succeeds, and the delivery row survives with its channel name intact.
10. A withheld delivery (every rule behind it paused) records the channel's real type, not `unknown`.
11. Losing the group creation race folds into the winner: create the group row, then run the dispatch that would have created it, and one group row holds both members.
12. A second dispatch of an already stamped event does nothing: the stamp is unchanged and no second delivery appears.
13. An instance that resolves between dispatch and flush is left out of the flushed message.
14. Each provider truncates at its own limit: a body longer than `CHANNEL_TEXT_MAX` for the provider is cut, and the cut is visible in the request body.
15. No error text in `alert_deliveries.last_error` or in a history row contains `https://`, a bot token, or a chat id.

**Commit:** `test(alerts): grouping, retries and the delivery record`

---

### Task 9: `pipeline-capacity.integration.test.ts`

Each case sits on one documented bound. Insert bulk fixtures with one multi-row insert, never a loop of inserts.

**Cases**

1. `FLUSH_GROUP_MEMBER_CLAIM_CAP` is 500. With 501 members, one flush claims 500, the newest are among them, the remainder flushes next, and the oversized group is reported.
2. `ALERT_EVALUATION_SAMPLE_LIMIT` is 64. With 65 instances of which 3 match, the samples hold 64 entries, the 3 matching ones are first, and `samples_truncated` is true.
3. `MAX_EVIDENCE_ROWS` is 50 and `MAX_EVIDENCE_BYTES` is 64KB. A 60 row result bounds the evidence and sets `evidence_truncated`.
4. `BODY_MAX_EVENTS` is 20. A group of 25 members composes a body listing 20 and stating what it omitted.
5. `ALERT_DELIVERY_MAX_ATTEMPTS` is 5: a transient failure reaches `attempts` 5 and stops; a permanent failure reaches 5 on its first attempt.
6. The scanner batch is 5000. With 5001 due rules, one scan enqueues 5000 and the next scan enqueues the last one.
7. The stale enqueue cutoff is 15 minutes. A rule whose `last_enqueued_at` is newer than `next_evaluation_at` is skipped, and once that stamp is older than the cutoff the scanner picks it up again.

**Commit:** `test(alerts): every bound is tested at the bound`

---

### Task 10: `pipeline-routing.integration.test.ts`

**Cases**

1. A rule with direct channels never consults routes: a route that would match a different receiver produces no delivery for it.
2. Route priority: two matching routes, and only the lower `priority` number delivers, because `continue` is false.
3. `continue: true` on the first route delivers through both receivers, making two groups.
4. A route naming a receiver that does not exist is skipped, and a later matching route still delivers.
5. Matchers: `eq` matches, `ne` matches when the label differs, a matcher on a label the instance does not carry matches only against the empty string, and a route with no matchers catches everything.
6. A route row persisted with a retired regex op never matches.
7. `group_by: ["service"]` splits two instances with different `service` labels into two groups, where the default grouping would have joined them.
8. A user label named `severity` does not override the system value in the dispatch labels.
9. A rule matching many routes stays inside the fan-out bound.

**Commit:** `test(alerts): routing decides who is told, and in what group`

---

### Task 11: `pipeline-invariants.integration.test.ts`

These cases assert against PostgreSQL itself. Several use raw inserts rather than the pipeline, because the point is what the database refuses.

**Cases**

1. Inserting an `alert_events` row whose `event_type` is `instance_pending` with `kind` set to `notifying` is rejected by `alert_events_kind_matches_type`, and the reverse case (`instance_fired` with `kind` `state`) is rejected too.
2. Writing the same instance twice for one definition and fingerprint converges on one row, because of `alert_instances_definition_fingerprint_uq`.
3. Deleting a rule removes its instances, its deliveries and its group memberships, and leaves no row referencing it.
4. Deleting a channel that has delivery history succeeds and leaves the delivery rows in place.
5. One slug is legal once as a live rule and once per preview: both inserts succeed, and a second live rule with the same slug is rejected.
6. A transaction that enqueues a job and then throws leaves no job. Open a transaction, call `addWorkerJobInTransaction`, throw, and assert `pendingJobs()` is empty.
7. Two evaluation enqueues for one `scheduledFor` collapse to one job, and the surviving job carries the newer payload.
8. `alertingPartitionQueue` gives the same queue for the same id every time, and 200 distinct ids spread over more than one queue.

**Commit:** `test(alerts): the constraints the database enforces`

---

### Task 12: Two organizations

**Files:**
- Modify: `src/server/alerting/pipeline-lifecycle.integration.test.ts` (add one `describe`)

**Cases**

Set up two organizations with identical rule slugs, identical instance labels, identical receiver names and identical channel names. Then, in one `describe`:

1. Evaluating org A's rule creates instances only for org A.
2. A silence in org A does not defer org B's notification.
3. Org A's group holds only org A's members.
4. Listing deliveries for org A returns none of org B's.
5. An inhibition in org A does not hold org B's target.

- [ ] **Step 1:** Write the `describe` with the five cases.
- [ ] **Step 2:** Run, from `packages/app`: `pnpm exec vitest run src/server/alerting/pipeline-lifecycle.integration.test.ts`.
- [ ] **Step 3:** Report any leak as a defect, with the query that leaked.
- [ ] **Step 4:** Commit with `test(alerts): one organization never sees another's alerts`.

---

### Task 13: Prune the mocked stage tests

The integration suite now covers ground the fluent database fakes were standing in for. Remove only what is genuinely covered, and say what was removed.

**Files:**
- Modify or delete: `src/server/alerting/delivery/flush-group.test.ts`, `src/server/alerting/delivery/process-event.test.ts`, `src/server/alerting/delivery/send-delivery.test.ts`, `src/server/alerting/scheduling/scanner.test.ts`

- [ ] **Step 1: Inventory**

For each of the four files, list every `it` and, next to it, the integration case that now covers it. Write the list into the commit message body. Any `it` with no integration counterpart stays.

- [ ] **Step 2: Delete only the covered cases**

Delete the covered `it` blocks. If a whole file becomes empty, delete the file. Keep any test that asserts a pure function's behavior (for example `grouping.test.ts`, `state-machine.test.ts`, `suppression.test.ts` matcher cases), because those do not mock the database and lose nothing.

- [ ] **Step 3: Run the whole app suite**

Run: `pnpm -r --filter @everr/app test:ci`
Expected: PASS, with the coverage of `src/server/alerting` no lower than before the deletions.

- [ ] **Step 4: Commit**

```bash
git add packages/app/src/server/alerting
git commit -m "test(alerts): drop the database fakes the real database replaced"
```

---

## Verification

After Task 13:

- [ ] `pnpm -r --filter @everr/app... typecheck` passes.
- [ ] `pnpm exec biome check packages/app` passes.
- [ ] `pnpm -r --filter @everr/app test:ci` passes.
- [ ] The integration files run in under two minutes in total. If not, split `pipeline-capacity.integration.test.ts` first, since it holds the only large fixture.
- [ ] Every defect found by a failing test is either fixed on this branch or filed as a ticket under `todo/issues/alerting-surface/tickets/`, and named in the PR body.
