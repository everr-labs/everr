import { afterEach, describe, expect, it, vi } from "vitest";
import {
  errorIssueOptions,
  errorIssuesOptions,
  errorServicesOptions,
} from "./options";

describe("error query options", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("resolves datemath before searching issues", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-26T11:00:00.000Z"));

    const searchErrorIssues = vi.fn().mockResolvedValue([]);
    const options = errorIssuesOptions({
      searchErrorIssues,
      timeRange: { from: "now-1h", to: "now" },
      refresh: "",
      q: "boom",
      service: ["web"],
      fingerprint: "",
      sort: "lastSeen",
      limit: 50,
    });

    await (options.queryFn as () => Promise<unknown>)();

    expect(searchErrorIssues).toHaveBeenCalledWith({
      data: expect.objectContaining({
        fromTs: "2026-05-26 10:00:00.000",
        toTs: "2026-05-26 11:00:00.000",
        q: "boom",
        service: ["web"],
      }),
    });
  });

  it("includes fingerprint in detail query keys", () => {
    const getErrorIssue = vi.fn();
    const options = errorIssueOptions({
      getErrorIssue,
      fingerprint: "fp-1",
      timeRange: { from: "now-1h", to: "now" },
      refresh: "",
      service: [],
      occurrenceLimit: 50,
    });

    expect(options.queryKey).toContain("fp-1");
  });

  it("creates service option queries", () => {
    const listErrorServices = vi.fn();
    const options = errorServicesOptions({
      listErrorServices,
      timeRange: { from: "now-1h", to: "now" },
      refresh: "",
    });

    expect(options.queryKey[0]).toBe("errors");
    expect(options.queryKey[1]).toBe("services");
  });
});
