import { describe, expect, it, vi } from "vitest";
import type { BackfillProgress } from "@/server/github-events/backfill";
import { importRepos } from "./import-stream";

function makeProgressStream(
  events: BackfillProgress[],
): ReadableStream<BackfillProgress> {
  let index = 0;
  return new ReadableStream({
    pull(controller) {
      if (index < events.length) {
        controller.enqueue(events[index++]);
      } else {
        controller.close();
      }
    },
  });
}

vi.mock("@/data/onboarding", () => ({
  importRepoFn: vi.fn(),
}));

async function mockImportRepoFn(
  eventsByRepo: BackfillProgress[][],
): Promise<void> {
  const { importRepoFn } = await import("@/data/onboarding");
  const mock = vi.mocked(importRepoFn);
  let callCount = 0;
  mock.mockImplementation(() => {
    const events = eventsByRepo[callCount++] ?? [];
    return Promise.resolve(makeProgressStream(events)) as ReturnType<
      typeof importRepoFn
    >;
  });
}

describe("importRepos", () => {
  it("imports a single repo and calls onProgress for each event", async () => {
    const events: BackfillProgress[] = [
      {
        status: "importing",
        jobsEnqueued: 0,
        jobsQuota: 100,
        runsProcessed: 0,
      },
      {
        status: "importing",
        jobsEnqueued: 3,
        jobsQuota: 100,
        runsProcessed: 1,
      },
      {
        status: "importing",
        jobsEnqueued: 7,
        jobsQuota: 100,
        runsProcessed: 2,
      },
      {
        status: "done",
        jobsEnqueued: 7,
        jobsQuota: 100,
        runsProcessed: 2,
        errors: [],
      },
    ];

    await mockImportRepoFn([events]);

    const onRepoStart = vi.fn();
    const onProgress = vi.fn();
    const onComplete = vi.fn();

    const result = await importRepos({
      repos: ["org/repo"],
      onRepoStart,
      onProgress,
      onComplete,
    });

    expect(onProgress).toHaveBeenCalledTimes(4);
    expect(onProgress).toHaveBeenNthCalledWith(1, {
      jobsEnqueued: 0,
      jobsQuota: 100,
      runsProcessed: 0,
    });
    expect(onProgress).toHaveBeenNthCalledWith(3, {
      jobsEnqueued: 7,
      jobsQuota: 100,
      runsProcessed: 2,
    });
    expect(result).toEqual({ totalJobs: 7, totalErrors: 0 });
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it("counts errors from the done event", async () => {
    const events: BackfillProgress[] = [
      {
        status: "importing",
        jobsEnqueued: 0,
        jobsQuota: 100,
        runsProcessed: 0,
      },
      {
        status: "done",
        jobsEnqueued: 5,
        jobsQuota: 100,
        runsProcessed: 3,
        errors: ["err1", "err2"],
      },
    ];

    await mockImportRepoFn([events]);

    const result = await importRepos({
      repos: ["org/repo"],
      onRepoStart: vi.fn(),
      onProgress: vi.fn(),
      onComplete: vi.fn(),
    });

    expect(result).toEqual({ totalJobs: 5, totalErrors: 2 });
  });

  it("imports repos sequentially and aggregates results", async () => {
    const events1: BackfillProgress[] = [
      {
        status: "importing",
        jobsEnqueued: 0,
        jobsQuota: 100,
        runsProcessed: 0,
      },
      {
        status: "done",
        jobsEnqueued: 10,
        jobsQuota: 100,
        runsProcessed: 2,
        errors: ["e1"],
      },
    ];
    const events2: BackfillProgress[] = [
      {
        status: "importing",
        jobsEnqueued: 0,
        jobsQuota: 100,
        runsProcessed: 0,
      },
      {
        status: "done",
        jobsEnqueued: 5,
        jobsQuota: 100,
        runsProcessed: 1,
        errors: [],
      },
    ];

    await mockImportRepoFn([events1, events2]);

    const onRepoStart = vi.fn();
    const onProgress = vi.fn();
    const onComplete = vi.fn();

    const result = await importRepos({
      repos: ["org/repo-a", "org/repo-b"],
      onRepoStart,
      onProgress,
      onComplete,
    });

    expect(onRepoStart).toHaveBeenCalledTimes(2);
    expect(onRepoStart).toHaveBeenNthCalledWith(1, "org/repo-a", 0, 2);
    expect(onRepoStart).toHaveBeenNthCalledWith(2, "org/repo-b", 1, 2);
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ totalJobs: 15, totalErrors: 1 });

    // Progress should accumulate across repos (total quota = 2 * 100 = 200)
    expect(onProgress).toHaveBeenCalledTimes(4);
    expect(onProgress).toHaveBeenNthCalledWith(1, {
      jobsEnqueued: 0,
      jobsQuota: 200,
      runsProcessed: 0,
    });
    expect(onProgress).toHaveBeenNthCalledWith(2, {
      jobsEnqueued: 10,
      jobsQuota: 200,
      runsProcessed: 2,
    });
    expect(onProgress).toHaveBeenNthCalledWith(3, {
      jobsEnqueued: 100,
      jobsQuota: 200,
      runsProcessed: 2,
    });
    expect(onProgress).toHaveBeenNthCalledWith(4, {
      jobsEnqueued: 105,
      jobsQuota: 200,
      runsProcessed: 3,
    });
  });
});
