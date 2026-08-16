// @vitest-environment node
import { sql } from "drizzle-orm";
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
import { alertDefinitions } from "@/db/schema";
import { BACKOFF_EXPRESSION_TEST } from "./job-driver";
import { createTestDatabase, type TestDatabase } from "./pglite-database";

let database: TestDatabase;

const RULE = {
  organizationId: "org_a",
  repoid: "repo_a",
  slug: "checkout-latency",
  spec: {
    sql: "select 1 as value",
    interval_secs: 60,
    for_secs: 0,
    label_columns: [],
    condition: { operator: "gt" as const, threshold: 0 },
    severity: "warning" as const,
    annotations: {},
    resolve_after: 1,
  },
};

beforeAll(async () => {
  database = await createTestDatabase();
}, 60_000);

afterAll(async () => {
  await database.close();
});

describe("createTestDatabase", () => {
  it("applies the app schema", async () => {
    await database.db.insert(alertDefinitions).values(RULE);

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

describe("the database clock", () => {
  const pinned = new Date("2026-01-01T00:00:00.000Z");

  beforeEach(() => {
    // Date only, for the reason createAlertingHarness gives: a fully faked
    // timer set stops PGlite from ever finishing its boot.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(pinned);
  });

  afterEach(async () => {
    vi.useRealTimers();
    await database.truncate();
  });

  it("dates a job graphile scheduled for now from the faked clock", async () => {
    await database.db.execute(
      sql`select graphile_worker.add_job('alerts/evaluate', '{}'::json)`,
    );

    const jobs = await database.db.execute<{ run_at: string }>(
      sql`select run_at from graphile_worker.jobs`,
    );
    expect(new Date(jobs.rows[0].run_at)).toEqual(pinned);
  });

  it("dates a default column from the faked clock, and moves with it", async () => {
    await database.db.insert(alertDefinitions).values(RULE);

    const later = new Date(pinned.getTime() + 3_600_000);
    vi.setSystemTime(later);
    await database.db.insert(alertDefinitions).values({ ...RULE, slug: "b" });

    const rows = await database.db
      .select({ slug: alertDefinitions.slug, at: alertDefinitions.createdAt })
      .from(alertDefinitions)
      .orderBy(alertDefinitions.createdAt);
    expect(rows).toEqual([
      { slug: RULE.slug, at: pinned },
      { slug: "b", at: later },
    ]);
  });
});

describe("the job driver's copy of graphile's backoff", () => {
  it("still matches the expression the installed graphile-worker ships", async () => {
    const { createRequire } = await import("node:module");
    const { readFileSync } = await import("node:fs");
    const { dirname, join } = await import("node:path");
    const require = createRequire(import.meta.url);
    const failJobSource = readFileSync(
      join(
        dirname(require.resolve("graphile-worker/package.json")),
        "dist/sql/failJob.js",
      ),
      "utf8",
    );

    // job-driver.ts copies this expression rather than calling graphile,
    // because 0.16.6 ships no `fail_job` function to call. A copy cannot
    // notice a version bump on its own, so this reads the shipped file and
    // fails when the curve moves.
    expect(failJobSource).toContain(BACKOFF_EXPRESSION_TEST);
  });
});
