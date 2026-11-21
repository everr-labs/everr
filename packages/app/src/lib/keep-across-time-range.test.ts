import { describe, expect, it } from "vite-plus/test";
import { keepAcrossTimeRange } from "./keep-across-time-range";

const lastHour = { from: "now-1h", to: "now" };
const lastDay = { from: "now-24h", to: "now" };

describe("keepAcrossTimeRange", () => {
  it("keeps the previous answer when only the time range changed", () => {
    const keep = keepAcrossTimeRange(["repo", "stats", { timeRange: lastDay, repo: "acme/api" }]);
    const previousQuery = {
      queryKey: ["repo", "stats", { timeRange: lastHour, repo: "acme/api" }],
    };
    expect(keep("previous", previousQuery)).toBe("previous");
  });

  it("keeps it when the range is a bare element of the key", () => {
    const keep = keepAcrossTimeRange(["cost", "overTimeBreakdown", lastDay, "repo"]);
    expect(keep("previous", { queryKey: ["cost", "overTimeBreakdown", lastHour, "repo"] })).toBe(
      "previous",
    );
  });

  it("drops it when anything besides the range changed", () => {
    const keep = keepAcrossTimeRange(["repo", "stats", { timeRange: lastDay, repo: "acme/web" }]);
    const previousQuery = {
      queryKey: ["repo", "stats", { timeRange: lastHour, repo: "acme/api" }],
    };
    expect(keep("previous", previousQuery)).toBeUndefined();
  });
});
