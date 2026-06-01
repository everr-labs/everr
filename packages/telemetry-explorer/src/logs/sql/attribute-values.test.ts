import { describe, expect, it } from "vitest";
import {
  buildAttributeValuesQuery,
  decodeAttributeValueRows,
} from "./attribute-values";

describe("buildAttributeValuesQuery", () => {
  it("queries distinct values for the key in the resolved column within range", () => {
    const built = buildAttributeValuesQuery({
      timeRange: { from: "now-1h", to: "now" },
      source: "log",
      key: "http.method",
    });
    expect(built.sql).toContain("DISTINCT LogAttributes[{key:String}] AS v");
    expect(built.sql).toContain("mapContains(LogAttributes, {key:String})");
    expect(built.sql).toContain("LogAttributes[{key:String}] != ''");
    expect(built.sql).toContain("LIMIT 100");
    expect(built.params.key).toBe("http.method");
    expect(typeof built.params.fromTime).toBe("string");
  });

  it("rejects an unknown source", () => {
    expect(() =>
      buildAttributeValuesQuery({
        timeRange: { from: "now-1h", to: "now" },
        // @ts-expect-error invalid source
        source: "bogus",
        key: "k",
      }),
    ).toThrow(/unknown attribute source/i);
  });
});

describe("decodeAttributeValueRows", () => {
  it("extracts the v column", () => {
    expect(decodeAttributeValueRows([{ v: "GET" }, { v: "POST" }])).toEqual([
      "GET",
      "POST",
    ]);
  });
});
