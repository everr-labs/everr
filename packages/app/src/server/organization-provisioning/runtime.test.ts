// @vitest-environment node
import { eq, sql } from "drizzle-orm";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { isOrganizationProvisioned } from "@/common/organization-provisioning";
import { organization } from "@/db/schema";
import {
  createTestDatabase,
  type TestDatabase,
} from "@/server/alerting/testing/pglite-database";

const mocks = vi.hoisted(() => ({
  database: undefined as unknown,
  provision: vi.fn(),
  deprovision: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
}));
vi.mock("@/db/client", () => ({
  runInTransaction: (
    executor: { transaction: (run: unknown) => Promise<unknown> },
    run: unknown,
  ) => executor.transaction(run),
  get db() {
    return mocks.database;
  },
}));
vi.mock("@/telemetry/logger", () => ({
  serverLogger: { error: mocks.error, info: mocks.info },
  exceptionAttributes: (error: Error) => ({
    "exception.message": error.message,
  }),
}));
vi.mock("@/lib/clickhouse", () => ({
  provisionSqlApiOrgUser: mocks.provision,
  deprovisionSqlApiOrgUser: mocks.deprovision,
}));

import type { TaskList } from "graphile-worker";
import type { Database } from "@/db/client";
import { assertClickhouseReady } from "@/lib/clickhouse-readiness.server";
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
const provision = () =>
  tasks[PROVISION_ORGANIZATION_TASK]?.(payload, {} as never);
const scan = () =>
  tasks["clickhouse/scan-pending-organizations"]?.({}, {} as never);

beforeAll(async () => {
  fixture = await createTestDatabase();
  mocks.database = fixture.db;
  tasks = createOrganizationTaskList(
    fixture.db as unknown as Database,
    async () => {},
  );
});
afterAll(async () => fixture?.close());
beforeEach(async () => {
  await fixture.truncate();
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
  const row = (
    await fixture.db
      .select()
      .from(organization)
      .where(eq(organization.id, orgId))
  )[0];
  return row && isOrganizationProvisioned(row.metadata);
}

describe("organization provisioning", () => {
  it("remains pending after a timeout and becomes ready only after a successful retry", async () => {
    mocks.provision.mockRejectedValueOnce(new Error("Timeout error"));
    await expect(provision()).rejects.toThrow("Timeout error");
    expect(await ready()).toBe(false);
    await expect(assertClickhouseReady(orgId)).rejects.toMatchObject({
      name: "ClickhouseProvisioningPendingError",
    });
    await provision();
    expect(await ready()).toBe(true);
    await expect(assertClickhouseReady(orgId)).resolves.toBeUndefined();
    await provision();
    expect(mocks.provision).toHaveBeenCalledTimes(2);
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
    const jobs = await fixture.db.execute(
      sql`SELECT * FROM graphile_worker.jobs`,
    );
    expect(jobs.rows).toHaveLength(1);
  });

  it("puts deletion and provisioning in the same per-organization queue", async () => {
    await enqueueOrganizationProvisioning(orgId);
    await enqueueOrganizationDeprovisioning(orgId);
    const jobs = await fixture.db.execute<{
      task_identifier: string;
      queue_name: string;
    }>(
      sql`SELECT task_identifier, queue_name FROM graphile_worker.jobs ORDER BY id`,
    );
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
    expect(mocks.deprovision).toHaveBeenCalledWith(orgId, undefined);
  });

  it("leaves pre-existing organizations without a provisioning flag ready", async () => {
    await fixture.db.insert(organization).values({
      id: "existing",
      name: "Existing",
      slug: "existing",
      createdAt: new Date(),
    });
    await expect(assertClickhouseReady("existing")).resolves.toBeUndefined();
    await scan();
    const jobs = await fixture.db.execute<{ payload: unknown }>(
      sql`SELECT payload FROM graphile_worker._private_jobs`,
    );
    expect(jobs.rows).toEqual([{ payload }]);
  });
});

it("records failures on every attempt with job and exhaustion identity", async () => {
  mocks.provision.mockRejectedValue(new Error("stall"));
  for (const attempts of [1, 10_000]) {
    await expect(
      tasks[PROVISION_ORGANIZATION_TASK]?.(payload, {
        job: { id: "99", attempts, max_attempts: 10_000 },
      } as never),
    ).rejects.toThrow("stall");
    expect(mocks.error).toHaveBeenLastCalledWith(
      "clickhouse.organization.provision.failed",
      expect.objectContaining({
        "everr.worker.job.id": "99",
        "everr.worker.job.attempt": attempts,
        "everr.worker.job.exhausted": attempts === 10_000,
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
  );
  await scanTasks["clickhouse/scan-pending-organizations"]?.({}, {} as never);
  expect(mocks.error).toHaveBeenCalledWith(
    "clickhouse.organization.retry_recovery.failed",
    expect.objectContaining({ "exception.message": "recovery unavailable" }),
  );
  expect(mocks.error).toHaveBeenCalledWith(
    "clickhouse.organization.provision.stalled",
    expect.objectContaining({ "everr.organization.id": orgId }),
  );
  expect(mocks.info).toHaveBeenCalledWith(
    "clickhouse.organization.provision.health",
    expect.objectContaining({
      "everr.provisioning.stalled_count": 1,
      "everr.provisioning.pending_count": 1,
    }),
  );
  expect(
    (await fixture.db.execute(sql`SELECT * FROM graphile_worker.jobs`)).rows,
  ).toHaveLength(1);
});
