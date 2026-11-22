import { describe, expect, it } from "vite-plus/test";
import { LogsExplorerInputSchema } from "./schemas";

describe("LogsExplorerInputSchema", () => {
  it("defaults attributes to an empty array", () => {
    const parsed = LogsExplorerInputSchema.parse({
      timeRange: { from: "2026-06-10T00:00:00.000Z", to: "2026-06-10T01:00:00.000Z" },
    });
    expect(parsed.attributes).toEqual([]);
  });
});
