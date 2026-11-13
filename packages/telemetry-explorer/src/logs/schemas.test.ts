import { describe, expect, it } from "vite-plus/test";
import { LogsExplorerInputSchema } from "./schemas";

describe("LogsExplorerInputSchema", () => {
  it("defaults attributes to an empty array", () => {
    const parsed = LogsExplorerInputSchema.parse({
      timeRange: { from: "now-1h", to: "now" },
    });
    expect(parsed.attributes).toEqual([]);
  });
});
