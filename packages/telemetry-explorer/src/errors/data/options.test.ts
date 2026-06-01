import { describe, expect, it, vi } from "vitest";
import {
  errorAttributeKeysOptions,
  errorAttributeValuesOptions,
  errorIssueOptions,
  errorIssuesInfiniteOptions,
  errorServicesOptions,
} from "./options";
import type { ErrorsRepositoryLike } from "./repository";

function makeRepo(
  overrides: Partial<ErrorsRepositoryLike> = {},
): ErrorsRepositoryLike {
  return {
    searchIssues: vi.fn(async () => ({ issues: [] })),
    getIssue: vi.fn(async () => ({
      summary: {} as never,
      latest: {} as never,
      occurrences: [],
    })),
    listServices: vi.fn(async () => []),
    attributeKeys: vi.fn(async () => []),
    attributeValues: vi.fn(async () => []),
    ...overrides,
  };
}

const baseInput = {
  timeRange: { from: "now-1h", to: "now" },
  refresh: "",
  q: "",
  service: [],
  fingerprint: "",
  sort: "lastSeen" as const,
  limit: 50,
  attributes: [],
};

describe("errorIssuesInfiniteOptions", () => {
  it("forwards the page param as the search offset", async () => {
    const searchIssues = vi.fn(async () => ({ issues: [] }));
    const options = errorIssuesInfiniteOptions(makeRepo({ searchIssues }), {
      ...baseInput,
      q: "boom",
    });

    await (options.queryFn as (ctx: { pageParam: number }) => Promise<unknown>)(
      { pageParam: 100 },
    );

    expect(searchIssues).toHaveBeenCalledWith(
      expect.objectContaining({ q: "boom", limit: 50, offset: 100 }),
    );
    expect(options.initialPageParam).toBe(0);
  });

  it("stops paging when the last page is short or missing", () => {
    const options = errorIssuesInfiniteOptions(makeRepo(), {
      ...baseInput,
      limit: 2,
    });
    const issue = { fingerprint: "fp" } as never;
    const full = { issues: [issue, issue] };

    expect(options.getNextPageParam(full, [full], 0, [0])).toBe(2);
    expect(
      options.getNextPageParam({ issues: [issue] }, [full], 2, [0, 2]),
    ).toBeUndefined();
    expect(
      options.getNextPageParam(
        undefined as never,
        [undefined as never],
        0,
        [0],
      ),
    ).toBeUndefined();
  });
});

describe("errorIssueOptions / errorServicesOptions", () => {
  it("disables issue detail when fingerprint is blank", () => {
    const options = errorIssueOptions(makeRepo(), {
      fingerprint: "",
      timeRange: { from: "now-1h", to: "now" },
      refresh: "",
      service: [],
      occurrenceLimit: 50,
    });
    expect(options.enabled).toBe(false);
  });

  it("keys services by time range", () => {
    const options = errorServicesOptions(makeRepo(), {
      timeRange: { from: "now-1h", to: "now" },
      refresh: "5s",
      attributes: [],
    });
    expect(options.queryKey[0]).toBe("errors");
    expect(options.queryKey[1]).toBe("services");
    expect(options.refetchInterval).toBe(5000);
  });
});

const repo = {} as ErrorsRepositoryLike;
const timeRange = { from: "now-1h", to: "now" };

describe("error attribute options", () => {
  it("namespaces keys query under the errors domain", () => {
    expect(errorAttributeKeysOptions(repo, { timeRange }).queryKey).toEqual([
      "errors",
      "attributeKeys",
      timeRange,
    ]);
  });
  it("namespaces values query by source and key", () => {
    expect(
      errorAttributeValuesOptions(repo, {
        timeRange,
        source: "log",
        key: "http.method",
      }).queryKey,
    ).toEqual(["errors", "attributeValues", timeRange, "log", "http.method"]);
  });
});
