import { describe, expect, it, vi } from "vitest";
import {
  logAttributeKeysOptions,
  logAttributeValuesOptions,
  logsExplorerInfiniteOptions,
} from "./options";
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

describe("logAttributeKeysOptions", () => {
  it("keys the query by time range", () => {
    const repo = {} as never;
    const opts = logAttributeKeysOptions(repo, {
      timeRange: { from: "now-1h", to: "now" },
    });
    expect(opts.queryKey).toEqual([
      "logs",
      "attributeKeys",
      { from: "now-1h", to: "now" },
    ]);
  });
});

describe("logAttributeValuesOptions", () => {
  it("keys the query by source and key", () => {
    const repo = {} as never;
    const opts = logAttributeValuesOptions(repo, {
      timeRange: { from: "now-1h", to: "now" },
      source: "log",
      key: "http.method",
    });
    expect(opts.queryKey).toEqual([
      "logs",
      "attributeValues",
      { from: "now-1h", to: "now" },
      "log",
      "http.method",
    ]);
    expect(opts.select(["GET"])).toEqual(["GET"]);
  });
});
