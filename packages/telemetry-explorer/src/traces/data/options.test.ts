import { describe, expect, it, vi } from "vitest";
import { tracesSearchInfiniteOptions } from "./options";
import type { TracesRepositoryLike } from "./repository";
import type { TraceSummary } from "./types";

const repo: TracesRepositoryLike = {
  search: vi.fn(),
  getTrace: vi.fn(),
  listServiceIdentities: vi.fn(),
  attributeKeys: vi.fn(async () => []),
  attributeValues: vi.fn(async () => []),
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
  attributes: [],
  limit: 50,
};

const rows: TraceSummary[] = [
  {
    traceId: "trace-1",
    rootName: "GET /home",
    rootService: "web",
    rootNamespace: "",
    rootStatus: "Ok",
    rootStatusCode: "",
    startTs: "2026-05-20 12:00:00.000",
    durationNs: "1000000",
    spanCount: 1,
    errorCount: 0,
    services: ["web"],
  },
];

describe("tracesSearchInfiniteOptions", () => {
  it("uses the last row as the next cursor when the page is full", () => {
    const options = tracesSearchInfiniteOptions({ ...baseInput, limit: 1 });
    const getNextPageParam = options.getNextPageParam as (
      lastPage: TraceSummary[] | undefined,
      allPages: TraceSummary[][],
    ) => unknown;

    expect(getNextPageParam(rows, [rows])).toEqual({
      startTs: "2026-05-20 12:00:00.000",
      traceId: "trace-1",
    });
  });

  it("stops pagination when the last page is shorter than the page size", () => {
    const options = tracesSearchInfiniteOptions({ ...baseInput, limit: 2 });
    const getNextPageParam = options.getNextPageParam as (
      lastPage: TraceSummary[] | undefined,
      allPages: TraceSummary[][],
    ) => unknown;

    expect(getNextPageParam(rows, [rows])).toBeUndefined();
  });
});
