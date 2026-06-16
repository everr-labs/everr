// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  addJob: vi.fn(),
  makeWorkerUtils: vi.fn(),
  pool: {},
}));

vi.mock("graphile-worker", () => ({
  makeWorkerUtils: mocks.makeWorkerUtils,
}));

vi.mock("@/db/client", () => ({
  pool: mocks.pool,
}));

async function loadJobs() {
  // resetModules drops the module-level WorkerUtils handle so each import starts
  // from an uninitialized slate.
  vi.resetModules();
  return import("./jobs");
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.addJob.mockResolvedValue(undefined);
  mocks.makeWorkerUtils.mockResolvedValue({ addJob: mocks.addJob });
});

describe("addWorkerJob", () => {
  it("reuses one WorkerUtils across calls and forwards the job", async () => {
    const { addWorkerJob } = await loadJobs();

    await addWorkerJob("task", { a: 1 });
    await addWorkerJob("task", { a: 2 }, { jobKey: "k" });

    expect(mocks.makeWorkerUtils).toHaveBeenCalledOnce();
    expect(mocks.makeWorkerUtils).toHaveBeenCalledWith({ pgPool: mocks.pool });
    expect(mocks.addJob).toHaveBeenNthCalledWith(
      1,
      "task",
      { a: 1 },
      undefined,
    );
    expect(mocks.addJob).toHaveBeenNthCalledWith(
      2,
      "task",
      { a: 2 },
      { jobKey: "k" },
    );
  });
});
