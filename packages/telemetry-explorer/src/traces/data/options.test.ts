import { describe, expect, it, vi } from "vitest";
import { tracesSearchInfiniteOptions } from "./options";
import type { TracesRepositoryLike } from "./repository";
import type { TraceSummary } from "./types";

const repo: TracesRepositoryLike = {
  search: vi.fn(),
  getTrace: vi.fn(),
  listServiceIdentities: vi.fn(),
};

const baseInput = {
  repo,
  timeRange: { from: "now-1h", to: "now" },
  refresh: "",
  namespace: [],
  service: [],
  name: "",
  minMs: undefined,
  maxMs: undefined,
  status: "all" as const,
};

const rows: TraceSummary[] = [
  {
    traceId: "trace-1",
    rootName: "GET /home",
    rootService: "web",
    rootNamespace: "",
    rootStatus: "Ok",
    startTs: "2026-05-20 12:00:00.000",
    durationNs: "1000000",
    spanCount: 1,
    errorCount: 0,
    services: ["web"],
  },
];

describe("tracesSearchInfiniteOptions", () => {
  it("passes the page param as the search offset", async () => {
    const search = vi.fn(async () => ({ traces: rows }));
    const options = tracesSearchInfiniteOptions({
      ...baseInput,
      repo: { ...repo, search },
      limit: 50,
    });

    const result = await options.queryFn?.({ pageParam: 100 } as never);

    expect(result).toEqual({ traces: rows });
    expect(search).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 50, offset: 100 }),
    );
  });

  it("computes the next offset until a short page ends pagination", () => {
    const options = tracesSearchInfiniteOptions({ ...baseInput, limit: 2 });
    const full = { traces: [rows[0], rows[0]] };

    // Full page → next offset = total rows so far.
    expect(options.getNextPageParam(full, [full], 0, [0])).toBe(2);
    expect(options.getNextPageParam(full, [full, full], 2, [0, 2])).toBe(4);
    // Short page → no more pages.
    expect(
      options.getNextPageParam({ traces: [rows[0]] }, [full], 2, [0, 2]),
    ).toBeUndefined();
  });

  it("uses initial page param 0", () => {
    const options = tracesSearchInfiniteOptions({ ...baseInput, limit: 50 });
    expect(options.initialPageParam).toBe(0);
  });
});
