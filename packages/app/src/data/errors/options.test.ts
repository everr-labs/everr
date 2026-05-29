import { afterEach, describe, expect, it, vi } from "vitest";
import {
  errorIssueOptions,
  errorIssuesInfiniteOptions,
  errorServicesOptions,
} from "./options";

describe("error query options", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("resolves datemath and forwards the page param as offset", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-26T11:00:00.000Z"));

    const searchErrorIssues = vi.fn().mockResolvedValue({ issues: [] });
    const options = errorIssuesInfiniteOptions({
      searchErrorIssues,
      timeRange: { from: "now-1h", to: "now" },
      refresh: "",
      q: "boom",
      service: ["web"],
      fingerprint: "",
      sort: "lastSeen",
      limit: 50,
    });

    await (options.queryFn as (ctx: { pageParam: number }) => Promise<unknown>)(
      { pageParam: 100 },
    );

    expect(searchErrorIssues).toHaveBeenCalledWith({
      data: expect.objectContaining({
        fromTs: "2026-05-26 10:00:00.000",
        toTs: "2026-05-26 11:00:00.000",
        q: "boom",
        service: ["web"],
        limit: 50,
        offset: 100,
      }),
    });
    expect(options.refetchInterval).toBe(false);
    expect(options.initialPageParam).toBe(0);
  });

  it("stops paging when the last page is short", () => {
    const searchErrorIssues = vi.fn();
    const options = errorIssuesInfiniteOptions({
      searchErrorIssues,
      timeRange: { from: "now-1h", to: "now" },
      refresh: "",
      q: "",
      service: [],
      fingerprint: "",
      sort: "lastSeen",
      limit: 2,
    });
    const issue = { fingerprint: "fp" } as never;
    const full = { issues: [issue, issue] };

    expect(options.getNextPageParam(full, [full], 0, [0])).toBe(2);
    expect(
      options.getNextPageParam({ issues: [issue] }, [full], 2, [0, 2]),
    ).toBeUndefined();
  });

  it("resolves datemath before loading issue detail", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-26T11:00:00.000Z"));

    const getErrorIssue = vi.fn().mockResolvedValue(null);
    const options = errorIssueOptions({
      getErrorIssue,
      fingerprint: "fp-1",
      timeRange: { from: "now-1h", to: "now" },
      refresh: "5s",
      service: ["api"],
      occurrenceLimit: 50,
    });

    expect(options.queryKey).toContain("fp-1");
    expect(options.enabled).toBe(true);
    expect(options.refetchInterval).toBe(5000);

    await (options.queryFn as () => Promise<unknown>)();

    expect(getErrorIssue).toHaveBeenCalledWith({
      data: {
        fingerprint: "fp-1",
        fromTs: "2026-05-26 10:00:00.000",
        toTs: "2026-05-26 11:00:00.000",
        service: ["api"],
        occurrenceLimit: 50,
      },
    });
  });

  it("disables issue detail queries when fingerprint is blank", () => {
    const getErrorIssue = vi.fn().mockResolvedValue(null);
    const options = errorIssueOptions({
      getErrorIssue,
      fingerprint: "",
      timeRange: { from: "now-1h", to: "now" },
      refresh: "",
      service: [],
      occurrenceLimit: 50,
    });

    expect(options.enabled).toBe(false);
    expect(options.refetchInterval).toBe(false);
  });

  it("resolves datemath before listing services", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-26T11:00:00.000Z"));

    const listErrorServices = vi.fn().mockResolvedValue([]);
    const options = errorServicesOptions({
      listErrorServices,
      timeRange: { from: "now-1h", to: "now" },
      refresh: "5s",
    });

    expect(options.queryKey[0]).toBe("errors");
    expect(options.queryKey[1]).toBe("services");
    expect(options.refetchInterval).toBe(5000);

    await (options.queryFn as () => Promise<unknown>)();

    expect(listErrorServices).toHaveBeenCalledWith({
      data: {
        fromTs: "2026-05-26 10:00:00.000",
        toTs: "2026-05-26 11:00:00.000",
      },
    });
  });
});
