// @vitest-environment node
import { StringChunk } from "drizzle-orm";
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

  it("fills an unset spec with graphile's own add_job defaults", async () => {
    const { addWorkerJob } = await import("./jobs");

    await addWorkerJob("task", { a: 1 });

    // The statement's bound values, in the order add_job takes them: every
    // chunk that is not a literal fragment of SQL text.
    const bound = (
      mocks.execute.mock.calls[0][0].queryChunks as unknown[]
    ).filter((chunk) => !(chunk instanceof StringChunk));
    expect(bound).toEqual([
      "task",
      JSON.stringify({ a: 1 }),
      null, // queue_name
      new Date(), // run_at, the frozen now
      25, // max_attempts
      null, // job_key
      0, // priority
      null, // flags
      "replace", // job_key_mode
    ]);
  });
});
