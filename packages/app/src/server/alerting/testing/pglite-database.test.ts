// @vitest-environment node
import { sql } from "drizzle-orm";
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
