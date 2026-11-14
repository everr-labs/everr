import { describe, expect, it } from "vite-plus/test";
import { AttributeFilterSchema, attributesField, attributeValuesInputSchema } from "./schemas";

describe("attributesField", () => {
  const logsAttrs = attributesField(["resource", "log", "scope"]);

  it("defaults to [] and accepts supported sources", () => {
    expect(logsAttrs.parse(undefined)).toEqual([]);
    expect(logsAttrs.parse([{ source: "log", key: "k", op: "exists" }])).toEqual([
      { source: "log", key: "k", op: "exists", values: [] },
    ]);
  });

  it("rejects a filter whose source the domain does not support", () => {
    expect(() => logsAttrs.parse([{ source: "span", key: "k", op: "exists" }])).toThrow();
  });
});

describe("attributeValuesInputSchema", () => {
  const tracesValues = attributeValuesInputSchema(["resource", "span"]);

  it("accepts a supported source", () => {
    expect(
      tracesValues.parse({
        timeRange: { from: "now-1h", to: "now" },
        source: "span",
        key: "http.route",
      }).source,
    ).toBe("span");
  });

  it("rejects a source the domain does not support", () => {
    expect(() =>
      tracesValues.parse({
        timeRange: { from: "now-1h", to: "now" },
        source: "log",
        key: "k",
      }),
    ).toThrow();
  });
});

describe("AttributeFilterSchema", () => {
  it("defaults values to an empty array", () => {
    expect(AttributeFilterSchema.parse({ source: "resource", key: "k", op: "in" })).toEqual({
      source: "resource",
      key: "k",
      op: "in",
      values: [],
    });
  });

  it("rejects an empty key or an unknown op", () => {
    expect(() => AttributeFilterSchema.parse({ source: "log", key: "", op: "exists" })).toThrow();
    expect(() => AttributeFilterSchema.parse({ source: "scope", key: "k", op: "regex" })).toThrow();
  });
});
