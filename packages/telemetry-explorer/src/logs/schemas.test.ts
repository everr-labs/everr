import { describe, expect, it } from "vite-plus/test";
import { AttributeFilterSchema, LogsExplorerInputSchema } from "./schemas";

describe("AttributeFilterSchema", () => {
  it("defaults values to an empty array", () => {
    const parsed = AttributeFilterSchema.parse({
      source: "resource",
      key: "deployment.environment",
      op: "in",
    });
    expect(parsed.values).toEqual([]);
  });

  it("rejects an empty key", () => {
    expect(() => AttributeFilterSchema.parse({ source: "log", key: "", op: "exists" })).toThrow();
  });

  it("rejects an unknown op", () => {
    expect(() =>
      AttributeFilterSchema.parse({
        source: "scope",
        key: "k",
        op: "regex",
      }),
    ).toThrow();
  });
});

describe("LogsExplorerInputSchema", () => {
  it("defaults attributes to an empty array", () => {
    const parsed = LogsExplorerInputSchema.parse({
      timeRange: { from: "now-1h", to: "now" },
    });
    expect(parsed.attributes).toEqual([]);
  });
});
