// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
}));

vi.mock("@/db/client", () => ({
  db: { execute: mocks.execute },
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.execute.mockResolvedValue({ rows: [] });
  // Both paths default `run_at` to `new Date()`. Freeze the clock so two
  // separate calls in one test see the same instant instead of racing a
  // millisecond boundary.
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("addWorkerJob", () => {
  it("enqueues through the same statement the transactional path uses", async () => {
    const { addWorkerJob, addWorkerJobInTransaction } = await import("./jobs");
    const tx = { execute: vi.fn().mockResolvedValue({ rows: [] }) };

    await addWorkerJob("task", { a: 1 }, { jobKey: "k" });
    await addWorkerJobInTransaction(
      tx as never,
      "task",
      { a: 1 },
      {
        jobKey: "k",
      },
    );

    const viaPool = mocks.execute.mock.calls[0][0];
    const viaTx = tx.execute.mock.calls[0][0];
    expect(viaPool.queryChunks).toEqual(viaTx.queryChunks);
  });

  it("defaults the spec the same way on both paths", async () => {
    const { addWorkerJob, addWorkerJobInTransaction } = await import("./jobs");
    const tx = { execute: vi.fn().mockResolvedValue({ rows: [] }) };

    await addWorkerJob("task", { a: 1 });
    await addWorkerJobInTransaction(tx as never, "task", { a: 1 });

    const viaPool = mocks.execute.mock.calls[0][0];
    const viaTx = tx.execute.mock.calls[0][0];
    expect(viaPool.queryChunks).toEqual(viaTx.queryChunks);
  });
});
