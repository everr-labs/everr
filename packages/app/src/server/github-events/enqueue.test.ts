// @vitest-environment node
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { createTestDatabase, type TestDatabase } from "../alerting/testing/pglite-database";
import type { WebhookJobData } from "./types";

const mocks = vi.hoisted(() => ({ database: undefined as unknown }));
vi.mock("#app/db/client.ts", () => ({
  get db() {
    return mocks.database;
  },
}));

import { enqueueWebhookEvent } from "./enqueue";

const payload: WebhookJobData = {
  body: Buffer.from("{}", "utf8").toString("base64"),
  headers: { "x-github-event": ["workflow_run"] },
};
let fixture: TestDatabase;
beforeAll(async () => {
  fixture = await createTestDatabase();
  mocks.database = fixture.db;
});
afterAll(async () => fixture?.close());
beforeEach(async () => fixture.truncate());

async function jobs() {
  return (
    await fixture.db.execute(sql`
    SELECT t.identifier AS task_identifier, j.payload, j.key, j.max_attempts
    FROM graphile_worker._private_jobs j
    JOIN graphile_worker._private_tasks t ON t.id = j.task_id
    ORDER BY j.id
  `)
  ).rows;
}

describe("enqueueWebhookEvent", () => {
  it("persists both consumer commands for one webhook", async () => {
    await enqueueWebhookEvent("delivery-1", payload);
    expect(await jobs()).toEqual(
      ["github-events/collector", "github-events/status"].map((task_identifier) => ({
        task_identifier,
        payload,
        key: `${task_identifier}:delivery-1`,
        max_attempts: 10,
      })),
    );
  });

  it("rolls back the first command if the second enqueue fails", async () => {
    await fixture.client.exec(`
      CREATE FUNCTION graphile_worker.reject_status_job() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.task_id = (SELECT id FROM graphile_worker._private_tasks WHERE identifier = 'github-events/status') THEN
          RAISE EXCEPTION 'status enqueue rejected';
        END IF;
        RETURN NEW;
      END $$;
      CREATE TRIGGER reject_status_job BEFORE INSERT ON graphile_worker._private_jobs
        FOR EACH ROW EXECUTE FUNCTION graphile_worker.reject_status_job();
    `);
    try {
      await expect(enqueueWebhookEvent("delivery-1", payload)).rejects.toThrow();
      expect(await jobs()).toEqual([]);
    } finally {
      await fixture.client.exec(`
        DROP TRIGGER reject_status_job ON graphile_worker._private_jobs;
        DROP FUNCTION graphile_worker.reject_status_job();
      `);
    }
    await enqueueWebhookEvent("delivery-1", payload);
    expect(await jobs()).toHaveLength(2);
  });

  it("keeps distinct effects and coalesces repeat deliveries while pending", async () => {
    await enqueueWebhookEvent("delivery-1", payload);
    await enqueueWebhookEvent("delivery-1", payload);
    expect(await jobs()).toHaveLength(2);
    await enqueueWebhookEvent("delivery-2", payload);
    expect(await jobs()).toHaveLength(4);
  });
});
