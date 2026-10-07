// @vitest-environment node
import { StringChunk } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  addWorkerJob: vi.fn(),
  execute: vi.fn(),
}));

vi.mock("@/db/client", () => ({
  db: { execute: mocks.execute },
}));

vi.mock("@/server/worker/jobs", () => ({
  addWorkerJob: mocks.addWorkerJob,
}));

const ORG = "org-1";

async function loadStatus() {
  vi.resetModules();
  return import("./status");
}

function boundValues(query: { queryChunks: unknown[] }): unknown[] {
  return query.queryChunks.filter((chunk) => !(chunk instanceof StringChunk));
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.execute.mockResolvedValue({ rows: [] });
  mocks.addWorkerJob.mockResolvedValue(undefined);
});

describe("readSqlApiOrgUserSetup", () => {
  it("treats a missing job as ready and skips later lookups", async () => {
    const status = await loadStatus();

    await expect(status.readSqlApiOrgUserSetup(ORG)).resolves.toBe("ready");
    await expect(status.readSqlApiOrgUserSetup(ORG)).resolves.toBe("ready");

    expect(mocks.execute).toHaveBeenCalledOnce();
  });

  it("reports a queued or running job as pending", async () => {
    mocks.execute.mockResolvedValue({
      rows: [{ attempts: 1, max_attempts: 8, locked_at: null }],
    });
    const status = await loadStatus();

    await expect(status.readSqlApiOrgUserSetup(ORG)).resolves.toBe("pending");
  });

  it("stays pending while the last attempt is still locked", async () => {
    mocks.execute.mockResolvedValue({
      rows: [{ attempts: 8, max_attempts: 8, locked_at: new Date() }],
    });
    const status = await loadStatus();

    await expect(status.readSqlApiOrgUserSetup(ORG)).resolves.toBe("pending");
  });

  it("reports a job that used its attempts as failed", async () => {
    mocks.execute.mockResolvedValue({
      rows: [{ attempts: "8", max_attempts: "8", locked_at: null }],
    });
    const status = await loadStatus();

    await expect(status.readSqlApiOrgUserSetup(ORG)).resolves.toBe("failed");
    await expect(status.assertSqlApiOrgUserReady(ORG)).rejects.toMatchObject({
      name: "SqlApiOrgSetupPendingError",
      setupStatus: "failed",
    });
  });

  it("looks the job up again after a later enqueue", async () => {
    const status = await loadStatus();
    await status.readSqlApiOrgUserSetup(ORG);
    mocks.execute.mockClear();

    await status.enqueueSqlApiOrgUserProvision(ORG);
    mocks.execute.mockResolvedValue({
      rows: [{ attempts: 0, max_attempts: 8, locked_at: null }],
    });

    await expect(status.readSqlApiOrgUserSetup(ORG)).resolves.toBe("pending");
    expect(mocks.execute).toHaveBeenCalledOnce();
  });
});

describe("enqueueSqlApiOrgUserProvision", () => {
  it("dedupes onto one job with a fixed attempt budget", async () => {
    const status = await loadStatus();

    await status.enqueueSqlApiOrgUserProvision(ORG);

    expect(mocks.addWorkerJob).toHaveBeenCalledWith(
      status.SQL_API_PROVISION_TASK,
      { organizationId: ORG },
      {
        jobKey: `${status.SQL_API_PROVISION_TASK}:${ORG}`,
        jobKeyMode: "unsafe_dedupe",
        maxAttempts: 8,
      },
    );
  });
});

describe("retrySqlApiOrgUserProvision", () => {
  it("replaces the existing job so a failed one runs again", async () => {
    const status = await loadStatus();

    await status.retrySqlApiOrgUserProvision(ORG);

    expect(mocks.addWorkerJob).toHaveBeenCalledWith(
      status.SQL_API_PROVISION_TASK,
      { organizationId: ORG },
      expect.objectContaining({ jobKeyMode: "replace" }),
    );
  });
});

describe("cancelSqlApiOrgUserProvision", () => {
  it("removes the job by its key", async () => {
    const status = await loadStatus();

    await status.cancelSqlApiOrgUserProvision(ORG);

    const bound = boundValues(mocks.execute.mock.calls[0][0]);
    expect(bound).toEqual([`${status.SQL_API_PROVISION_TASK}:${ORG}`]);
  });
});
