// @vitest-environment node
import { EventEmitter } from "node:events";
import { sql } from "drizzle-orm";
import type { WorkerEvents } from "graphile-worker";
import type { Pool } from "pg";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  createTestDatabase,
  type TestDatabase,
} from "@/server/alerting/testing/pglite-database";
import { addWorkerJob } from "@/server/worker/jobs";

const mocks = vi.hoisted(() => ({ database: undefined as unknown }));
vi.mock("@/db/client", () => ({
  get db() {
    return mocks.database;
  },
}));

import {
  enqueueOrganizationProvisioning,
  ORGANIZATION_MAX_ATTEMPTS,
} from "./jobs";
import {
  attachOrganizationRetryPolicy,
  organizationRetryDelaySeconds,
} from "./retries";

let fixture: TestDatabase;
let events: WorkerEvents;
let retries: ReturnType<typeof attachOrganizationRetryPolicy>;
const orgId = "retry-org";

beforeAll(async () => {
  fixture = await createTestDatabase();
  mocks.database = fixture.db;
});
afterAll(async () => fixture?.close());
beforeEach(async () => {
  await fixture.truncate();
  events = new EventEmitter() as WorkerEvents;
  const pgPool = {
    query: (text: string, values: unknown[]) =>
      fixture.client.query(text, values),
  } as unknown as Pick<Pool, "query">;
  retries = attachOrganizationRetryPolicy(events, pgPool);
});

async function job() {
  const result = await fixture.db.execute<{
    id: string;
    attempts: number;
    max_attempts: number;
    task_identifier: string;
    delay: number;
    last_error: string;
    locked_by: string | null;
  }>(sql`
    SELECT id::text, attempts, max_attempts, task_identifier,
      extract(epoch FROM run_at - now())::float AS delay, last_error, locked_by
    FROM graphile_worker.jobs ORDER BY id LIMIT 1
  `);
  return result.rows[0];
}

function completed(current: Awaited<ReturnType<typeof job>>, error: unknown) {
  events.emit("job:complete", { job: current, error } as never);
}

describe("organization retry scheduling", () => {
  it("uses short initial delays and never exceeds 30 seconds, including large attempt counts", () => {
    const random = vi.spyOn(Math, "random").mockReturnValue(0.5);
    expect(
      [1, 2, 3, 4, 5, 50, 10_000].map(organizationRetryDelaySeconds),
    ).toEqual([1.8, 3.6, 7.2, 14.4, 27, 27, 27]);
    random.mockReturnValue(0);
    expect(organizationRetryDelaySeconds(1000)).toBe(24);
    random.mockReturnValue(1);
    expect(organizationRetryDelaySeconds(1000)).toBe(30);
    random.mockRestore();
  });

  it("caps a persisted failure without losing attempts or error details", async () => {
    await enqueueOrganizationProvisioning(orgId);
    await fixture.db.execute(
      sql`UPDATE graphile_worker._private_jobs SET attempts=12, last_error='Timeout', run_at=now()+interval '6 hours'`,
    );
    const failed = await job();
    completed(failed, new Error("Timeout"));
    await retries.drain();
    const retry = await job();
    expect(retry.id).toBe(failed.id);
    expect(retry.attempts).toBe(12);
    expect(retry.last_error).toBe("Timeout");
    expect(retry.delay).toBeGreaterThan(23);
    expect(retry.delay).toBeLessThanOrEqual(30);
  });

  it("does not race Graphile's failure persistence by rescheduling on job:error", async () => {
    await enqueueOrganizationProvisioning(orgId);
    await fixture.db.execute(
      sql`UPDATE graphile_worker._private_jobs SET attempts=12, run_at=now()+interval '6 hours', locked_by='worker', locked_at=now()`,
    );
    events.emit("job:error", {
      job: await job(),
      error: new Error("Timeout"),
    } as never);
    await retries.drain();
    expect((await job()).delay).toBeGreaterThan(20_000);
  });

  it("recovers old retry schedules on startup and extends their retry budget", async () => {
    await enqueueOrganizationProvisioning(orgId);
    await fixture.db.execute(
      sql`UPDATE graphile_worker._private_jobs SET attempts=12, max_attempts=100, run_at=now()+interval '6 hours'`,
    );
    await retries.capPendingRetries();
    const recovered = await job();
    expect(recovered.delay).toBeGreaterThan(29);
    expect(recovered.delay).toBeLessThanOrEqual(30);
    expect(recovered.attempts).toBe(12);
    expect(recovered.max_attempts).toBe(ORGANIZATION_MAX_ATTEMPTS);
  });

  it("does not push a near-term retry back while extending an old budget", async () => {
    await enqueueOrganizationProvisioning(orgId);
    await fixture.db.execute(
      sql`UPDATE graphile_worker._private_jobs SET attempts=1, max_attempts=100, run_at=now()+interval '2 seconds'`,
    );
    await retries.capPendingRetries();
    expect((await job()).delay).toBeLessThanOrEqual(2);
    expect((await job()).max_attempts).toBe(ORGANIZATION_MAX_ATTEMPTS);
  });

  it("leaves locked jobs alone during recovery", async () => {
    await enqueueOrganizationProvisioning(orgId);
    await fixture.db.execute(
      sql`UPDATE graphile_worker._private_jobs SET attempts=12, run_at=now()+interval '6 hours', locked_by='worker', locked_at=now()`,
    );
    await retries.capPendingRetries();
    expect((await job()).locked_by).toBe("worker");
    expect((await job()).delay).toBeGreaterThan(20_000);
  });

  it("does not change retries for other task types", async () => {
    await addWorkerJob("alerts/evaluate", {});
    await fixture.db.execute(
      sql`UPDATE graphile_worker._private_jobs SET attempts=12, run_at=now()+interval '6 hours'`,
    );
    completed(await job(), new Error("Timeout"));
    await retries.drain();
    await retries.capPendingRetries();
    expect((await job()).delay).toBeGreaterThan(20_000);
  });

  it("does not reschedule successful or exhausted lifecycle jobs", async () => {
    await enqueueOrganizationProvisioning(orgId);
    await fixture.db.execute(
      sql`UPDATE graphile_worker._private_jobs SET attempts=max_attempts, run_at=now()+interval '6 hours'`,
    );
    completed(await job(), new Error("Timeout"));
    await retries.drain();
    await retries.capPendingRetries();
    expect((await job()).delay).toBeGreaterThan(20_000);
    await fixture.db.execute(
      sql`UPDATE graphile_worker._private_jobs SET attempts=2`,
    );
    completed(await job(), null);
    await retries.drain();
    expect((await job()).delay).toBeGreaterThan(20_000);
  });
});
