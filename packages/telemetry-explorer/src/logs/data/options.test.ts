import { describe, expect, it, vi } from "vite-plus/test";
import { logsExplorerInfiniteOptions } from "./options";
import type { LogsRepositoryLike } from "./repository";

const repo: LogsRepositoryLike = {
  explorer: vi.fn(),
  totals: vi.fn(),
  histogram: vi.fn(),
  detail: vi.fn(),
  filterOptions: vi.fn(),
  attributeKeys: vi.fn(),
  attributeValues: vi.fn(),
};

const input = {
  timeRange: { from: "now-1h", to: "now" },
  levels: [],
  services: [],
  attributes: [],
  limit: 100,
};

describe("logsExplorerInfiniteOptions", () => {
  it("does not request another page when the last page is missing", () => {
    const options = logsExplorerInfiniteOptions(repo, input);
    const getNextPageParam = options.getNextPageParam as (
      lastPage: { logs: unknown[] } | undefined,
      allPages: { logs: unknown[] }[],
    ) => unknown;

    expect(getNextPageParam(undefined, [])).toBeUndefined();
  });
});
