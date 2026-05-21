import { describe, expect, it, vi } from "vitest";
import { tracesSearchOptions } from "./options";
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

describe("tracesSearchOptions", () => {
  it("keeps previous rows only when increasing the limit", () => {
    const previousOptions = tracesSearchOptions({ ...baseInput, limit: 50 });
    const nextOptions = tracesSearchOptions({ ...baseInput, limit: 100 });

    const placeholderData = nextOptions.placeholderData as (
      previousData: TraceSummary[] | undefined,
      previousQuery: { queryKey: readonly unknown[] },
    ) => TraceSummary[] | undefined;

    expect(placeholderData(rows, { queryKey: previousOptions.queryKey })).toBe(
      rows,
    );
  });

  it("does not keep previous rows when filters change", () => {
    const previousOptions = tracesSearchOptions({ ...baseInput, limit: 50 });
    const nextOptions = tracesSearchOptions({
      ...baseInput,
      service: ["api"],
      limit: 50,
    });

    const placeholderData = nextOptions.placeholderData as (
      previousData: TraceSummary[] | undefined,
      previousQuery: { queryKey: readonly unknown[] },
    ) => TraceSummary[] | undefined;

    expect(
      placeholderData(rows, { queryKey: previousOptions.queryKey }),
    ).toBeUndefined();
  });
});
