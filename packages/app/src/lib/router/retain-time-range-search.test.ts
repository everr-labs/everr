import { describe, expect, it } from "vitest";
import { retainTimeRangeSearch } from "./retain-time-range-search";

describe("retainTimeRangeSearch", () => {
  it("retains current time range when destination has defaulted values", () => {
    const result = retainTimeRangeSearch({
      search: { from: "now-24h", to: "now-1h", refresh: "10s" },
      next: () => ({
        from: "now-7d",
        to: "now",
        refresh: "",
        page: 1,
      }),
    });

    expect(result).toEqual({
      from: "now-24h",
      to: "now-1h",
      refresh: "10s",
      page: 1,
    });
  });

  it("keeps explicit destination time range overrides", () => {
    const result = retainTimeRangeSearch({
      search: { from: "now-24h", to: "now", refresh: "5s" },
      next: () => ({
        from: "now-30d",
        to: "now",
        refresh: "30s",
      }),
    });

    expect(result).toEqual({
      from: "now-30d",
      to: "now",
      refresh: "30s",
    });
  });

  it("retains missing keys from current search", () => {
    const result = retainTimeRangeSearch({
      search: { from: "now-2d", to: "now", refresh: "1m" },
      next: () => ({ page: 2 }),
    });

    expect(result).toEqual({
      from: "now-2d",
      to: "now",
      refresh: "1m",
      page: 2,
    });
  });

  it("does not set refresh when current refresh is falsy", () => {
    const result = retainTimeRangeSearch({
      search: { from: "now-2d", to: "now", refresh: "" },
      next: () => ({ from: "now-7d", to: "now", refresh: "" }),
    });

    expect(result).toEqual({
      from: "now-2d",
      to: "now",
      refresh: "",
    });
  });
});
