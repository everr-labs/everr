import { describe, expect, it, vi } from "vitest";
import { importRepo, importRepos } from "./import-stream";

function makeNdjsonStream(events: object[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const chunks = events.map((e) => encoder.encode(JSON.stringify(e) + "\n"));
  let index = 0;
  return new ReadableStream({
    pull(controller) {
      if (index < chunks.length) {
        controller.enqueue(chunks[index++]);
      } else {
        controller.close();
      }
    },
  });
}

function makeFetch(events: object[], status = 200): typeof fetch {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    body: status >= 200 && status < 300 ? makeNdjsonStream(events) : null,
  }) as unknown as typeof fetch;
}

describe("importRepo", () => {
  it("reads NDJSON stream and calls onProgress for each event", async () => {
    const events = [
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
    const onProgress = vi.fn();

    const result = await importRepo({
      repoFullName: "org/repo",
      onProgress,
      fetchFn: makeFetch(events),
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
    expect(result).toEqual({ jobsEnqueued: 7, errors: 0 });
  });

  it("counts errors from the done event", async () => {
    const events = [
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
    const onProgress = vi.fn();

    const result = await importRepo({
      repoFullName: "org/repo",
      onProgress,
      fetchFn: makeFetch(events),
    });

    expect(result).toEqual({ jobsEnqueued: 5, errors: 2 });
  });

  it("throws on non-ok response", async () => {
    const onProgress = vi.fn();

    await expect(
      importRepo({
        repoFullName: "org/repo",
        onProgress,
        fetchFn: makeFetch([], 401),
      }),
    ).rejects.toThrow("Import request failed");

    expect(onProgress).not.toHaveBeenCalled();
  });

  it("handles multiple events in a single chunk", async () => {
    const encoder = new TextEncoder();
    const combined = encoder.encode(
      '{"status":"importing","jobsEnqueued":0,"jobsQuota":100,"runsProcessed":0}\n' +
        '{"status":"done","jobsEnqueued":3,"jobsQuota":100,"runsProcessed":1,"errors":[]}\n',
    );
    let sent = false;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (!sent) {
          controller.enqueue(combined);
          sent = true;
        } else {
          controller.close();
        }
      },
    });
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      body: stream,
    }) as unknown as typeof fetch;

    const onProgress = vi.fn();
    const result = await importRepo({
      repoFullName: "org/repo",
      onProgress,
      fetchFn,
    });

    expect(onProgress).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ jobsEnqueued: 3, errors: 0 });
  });
});

describe("importRepos", () => {
  it("imports repos sequentially and aggregates results", async () => {
    const events1 = [
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
    const events2 = [
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
    let callCount = 0;
    const fetchFn = vi.fn().mockImplementation(() => {
      const events = callCount === 0 ? events1 : events2;
      callCount++;
      return Promise.resolve({
        ok: true,
        body: makeNdjsonStream(events),
      });
    }) as unknown as typeof fetch;

    const onRepoStart = vi.fn();
    const onProgress = vi.fn();
    const onComplete = vi.fn();

    const result = await importRepos({
      repos: ["org/repo-a", "org/repo-b"],
      onRepoStart,
      onProgress,
      onComplete,
      fetchFn,
    });

    expect(onRepoStart).toHaveBeenCalledTimes(2);
    expect(onRepoStart).toHaveBeenNthCalledWith(1, "org/repo-a", 0, 2);
    expect(onRepoStart).toHaveBeenNthCalledWith(2, "org/repo-b", 1, 2);
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ totalJobs: 15, totalErrors: 1 });
  });
});
