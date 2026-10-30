import { createEventPublisher } from "@everr/app/server/events/publisher";
import { organizationReadinessEventDefinitions } from "@everr/app/organizations/events";
// @vitest-environment node

import { organization } from "@everr/app/db/schema";
import {
  createTestDatabase,
  type TestDatabase,
} from "@everr/app/server/alerting/testing/pglite-database";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { isOrganizationProvisioned } from "./metadata";

const mocks = vi.hoisted(() => ({
  database: undefined as unknown,
  publish: vi.fn(),
  provision: vi.fn(),
  deprovision: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
}));
vi.mock("@everr/app/db/client", () => ({
  runInTransaction: (executor: { transaction: (run: unknown) => Promise<unknown> }, run: unknown) =>
    executor.transaction(run),
  get db() {
    return mocks.database;
  },
}));
vi.mock("@everr/app/telemetry/logger", () => ({
  serverLogger: { error: mocks.error, info: mocks.info },
  exceptionAttributes: (error: Error) => ({
    "exception.message": error.message,
  }),
}));
vi.mock("../clickhouse/provisioning", () => ({
  provisionSqlApiOrgUser: mocks.provision,
  deprovisionSqlApiOrgUser: mocks.deprovision,
}));

import type { Database } from "@everr/app/db/client";
import type { TaskList } from "graphile-worker";
import {
  DEPROVISION_ORGANIZATION_TASK,
  enqueueOrganizationDeprovisioning,
  enqueueOrganizationProvisioning,
  ORGANIZATION_MAX_ATTEMPTS,
  PROVISION_ORGANIZATION_TASK,
} from "./jobs";
import { createOrganizationTaskList } from "./runtime";

let tasks: TaskList;

let fixture: TestDatabase;
const orgId = "signup-org";
const payload = { organizationId: orgId };
const provision = () => tasks[PROVISION_ORGANIZATION_TASK]?.(payload, {} as never);
const scan = () => tasks["clickhouse/scan-pending-organizations"]?.({}, {} as never);

beforeAll(async () => {
  fixture = await createTestDatabase();
  mocks.database = fixture.db;
  tasks = createOrganizationTaskList(fixture.db as unknown as Database, async () => {}, {
    publish: mocks.publish,
  });
});
afterAll(async () => fixture?.close());
beforeEach(async () => {
  await fixture.truncate();
  mocks.publish.mockReset();
  mocks.error.mockClear();
  mocks.info.mockClear();
  mocks.provision.mockReset().mockResolvedValue(undefined);
  mocks.deprovision.mockReset().mockResolvedValue(undefined);
  await fixture.db.insert(organization).values({
    id: orgId,
    name: "Signup",
    slug: orgId,
    createdAt: new Date(),
    metadata: JSON.stringify({ clickhouseReady: false, label: "preserved" }),
  });
});

async function ready() {
  const row = (await fixture.db.select().from(organization).where(eq(organization.id, orgId)))[0];
  return row && isOrganizationProvisioned(row.metadata);
}

describe("organization provisioning", () => {
  it("remains pending after a timeout and becomes ready only after a successful retry", async () => {
    mocks.provision.mockRejectedValueOnce(new Error("Timeout error"));
    await expect(provision()).rejects.toThrow("Timeout error");
    expect(await ready()).toBe(false);
    expect(mocks.publish).not.toHaveBeenCalled();
    await provision();
    expect(await ready()).toBe(true);
    await provision();
    expect(mocks.provision).toHaveBeenCalledTimes(2);
    expect(mocks.publish).toHaveBeenCalledExactlyOnceWith({
      type: "organization.provisioned",
      version: 1,
      subjectId: orgId,
      data: { organizationId: orgId },
    });
  });

  it("scans missed enqueues without resetting retry attempts or scheduling", async () => {
    await scan();
    await fixture.db.execute(
      sql`UPDATE graphile_worker._private_jobs SET attempts = 7, run_at = now() + interval '1 hour', last_error = 'Timeout error'`,
    );
    await scan();
    const jobs = await fixture.db.execute<{
      attempts: number;
      max_attempts: number;
      last_error: string;
      later: boolean;
    }>(sql`
      SELECT attempts, max_attempts, last_error, run_at > now() + interval '59 minutes' AS later
      FROM graphile_worker.jobs
    `);
    expect(jobs.rows).toEqual([
      {
        attempts: 7,
        max_attempts: ORGANIZATION_MAX_ATTEMPTS,
        last_error: "Timeout error",
        later: true,
      },
    ]);
  });

  it("does not duplicate a running provision job when signup or a scan enqueues again", async () => {
    await enqueueOrganizationProvisioning(orgId);
    await fixture.db.execute(
      sql`UPDATE graphile_worker._private_jobs SET locked_at = now(), locked_by = 'worker', attempts = 1`,
    );
    await enqueueOrganizationProvisioning(orgId);
    await scan();
    const jobs = await fixture.db.execute(sql`SELECT * FROM graphile_worker.jobs`);
    expect(jobs.rows).toHaveLength(1);
  });

  it("puts deletion and provisioning in the same per-organization queue", async () => {
    await enqueueOrganizationProvisioning(orgId);
    await enqueueOrganizationDeprovisioning(orgId);
    const jobs = await fixture.db.execute<{
      task_identifier: string;
      queue_name: string;
    }>(sql`SELECT task_identifier, queue_name FROM graphile_worker.jobs ORDER BY id`);
    expect(jobs.rows).toEqual([
      {
        task_identifier: PROVISION_ORGANIZATION_TASK,
        queue_name: `clickhouse-organization:${orgId}`,
      },
      {
        task_identifier: DEPROVISION_ORGANIZATION_TASK,
        queue_name: `clickhouse-organization:${orgId}`,
      },
    ]);
  });

  it("cleans up a partially provisioned user if the organization was deleted before a retry", async () => {
    await fixture.db.delete(organization).where(eq(organization.id, orgId));
    mocks.deprovision.mockRejectedValueOnce(new Error("Still stalled"));
    await expect(provision()).rejects.toThrow("Still stalled");
    await provision();
    expect(mocks.provision).not.toHaveBeenCalled();
    expect(mocks.deprovision).toHaveBeenCalledTimes(2);
  });

  it("cleans up if deletion commits during provisioning", async () => {
    mocks.provision.mockImplementationOnce(async () => {
      await fixture.db.delete(organization).where(eq(organization.id, orgId));
    });
    await provision();
    expect(await ready()).toBeUndefined();
    expect(mocks.publish).not.toHaveBeenCalled();
    expect(mocks.deprovision).toHaveBeenCalledWith(orgId, undefined);
  });

  it("leaves pre-existing organizations without a provisioning flag ready", async () => {
    await fixture.db.insert(organization).values({
      id: "existing",
      name: "Existing",
      slug: "existing",
      createdAt: new Date(),
    });
    await scan();
    const jobs = await fixture.db.execute<{ payload: unknown }>(
      sql`SELECT payload FROM graphile_worker._private_jobs`,
    );
    expect(jobs.rows).toEqual([{ payload: { ...payload, version: 1 } }]);
  });
});

it("records failures on every attempt with job and exhaustion identity", async () => {
  mocks.provision.mockRejectedValue(new Error("stall"));
  for (const attempts of [1, ORGANIZATION_MAX_ATTEMPTS]) {
    await expect(
      tasks[PROVISION_ORGANIZATION_TASK]?.(payload, {
        job: { id: "99", attempts, max_attempts: ORGANIZATION_MAX_ATTEMPTS },
      } as never),
    ).rejects.toThrow("stall");
    expect(mocks.error).toHaveBeenLastCalledWith(
      "clickhouse.organization.provision.failed",
      expect.objectContaining({
        "everr.worker.job.id": "99",
        "everr.worker.job.attempt": attempts,
        "everr.worker.job.exhausted": attempts === ORGANIZATION_MAX_ATTEMPTS,
        "exception.message": "stall",
      }),
    );
  }
});
it("reports stalled setup and still scans when retry recovery fails", async () => {
  await fixture.db
    .update(organization)
    .set({ createdAt: new Date(Date.now() - 180_000) })
    .where(eq(organization.id, orgId));
  const scanTasks = createOrganizationTaskList(
    fixture.db as unknown as Database,
    async () => {
      throw new Error("recovery unavailable");
    },
    { publish: mocks.publish },
  );
  await scanTasks["clickhouse/scan-pending-organizations"]?.({}, {} as never);
  expect(mocks.error).toHaveBeenCalledWith(
    "clickhouse.organization.retry_recovery.failed",
    expect.objectContaining({ "exception.message": "recovery unavailable" }),
  );
  expect(mocks.error).toHaveBeenCalledWith(
    "clickhouse.organization.provision.stalled",
    expect.objectContaining({ "everr.provisioning.stalled_count": 1 }),
  );
  expect(mocks.info).toHaveBeenCalledWith(
    "clickhouse.organization.provision.health",
    expect.objectContaining({
      "everr.provisioning.stalled_count": 1,
      "everr.provisioning.pending_count": 1,
    }),
  );
  expect((await fixture.db.execute(sql`SELECT * FROM graphile_worker.jobs`)).rows).toHaveLength(1);
});

it.each(["retrying", "running", "exhausted"])(
  "scanner leaves an existing %s job untouched",
  async (state) => {
    await enqueueOrganizationProvisioning(orgId);
    if (state === "running")
      await fixture.db.execute(
        sql`UPDATE graphile_worker._private_jobs SET locked_at = now(), locked_by = 'worker'`,
      );
    if (state === "exhausted")
      await fixture.db.execute(
        sql`UPDATE graphile_worker._private_jobs SET attempts = max_attempts`,
      );
    const before = await fixture.db.execute(sql`SELECT * FROM graphile_worker._private_jobs`);
    await scan();
    expect(
      (await fixture.db.execute(sql`SELECT * FROM graphile_worker._private_jobs`)).rows,
    ).toEqual(before.rows);
  },
);

it("executes a persisted v1 payload and still accepts legacy jobs", async () => {
  await enqueueOrganizationProvisioning(orgId);
  const queued = await fixture.db.execute<{ payload: unknown }>(
    sql`SELECT payload FROM graphile_worker._private_jobs`,
  );
  expect(queued.rows[0].payload).toEqual({ version: 1, organizationId: orgId });
  await tasks[PROVISION_ORGANIZATION_TASK]?.(queued.rows[0].payload, {} as never);
  expect(await ready()).toBe(true);
  await tasks[PROVISION_ORGANIZATION_TASK]?.(payload, {} as never);
  expect(mocks.provision).toHaveBeenCalledOnce();
});

it.each([PROVISION_ORGANIZATION_TASK, DEPROVISION_ORGANIZATION_TASK])(
  "rejects unsupported payload versions before %s effects",
  async (identifier) => {
    await expect(tasks[identifier]?.({ ...payload, version: 2 }, {} as never)).rejects.toThrow();
    expect(mocks.provision).not.toHaveBeenCalled();
    expect(mocks.deprovision).not.toHaveBeenCalled();
    expect(await ready()).toBe(false);
  },
);

it("does not announce readiness when another attempt already committed the guarded transition", async () => {
  mocks.provision.mockImplementationOnce(async () => {
    await fixture.db
      .update(organization)
      .set({ metadata: JSON.stringify({ clickhouseReady: true }) })
      .where(eq(organization.id, orgId));
  });
  await provision();
  expect(await ready()).toBe(true);
  expect(mocks.publish).not.toHaveBeenCalled();
});

it.each(["Graphile unavailable"])(
  "preserves readiness when Graphile admission fails (%s)",
  async (failure) => {
    mocks.publish.mockImplementation(
      createEventPublisher({
        routes: organizationReadinessEventDefinitions.map((definition) => ({
          definition,
          job: (event) => ({ task: "test/event", payload: event }),
        })),
        enqueue: async () => {
          throw new Error(failure);
        },
      }).publish,
    );
    await expect(provision()).resolves.toBeUndefined();
    expect(await ready()).toBe(true);
    await provision();
    expect(mocks.publish).toHaveBeenCalledOnce();
  },
);

it("does not publish readiness when its guarded database write fails, and retries normally", async () => {
  await fixture.client.exec(
    `ALTER TABLE organization ADD CONSTRAINT reject_ready CHECK (metadata::jsonb ->> 'clickhouseReady' <> 'true')`,
  );
  try {
    await expect(provision()).rejects.toThrow();
    expect(await ready()).toBe(false);
    expect(mocks.publish).not.toHaveBeenCalled();
  } finally {
    await fixture.client.exec("ALTER TABLE organization DROP CONSTRAINT reject_ready");
  }
  await provision();
  expect(await ready()).toBe(true);
  expect(mocks.publish).toHaveBeenCalledOnce();
});
