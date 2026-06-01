import { describe, expect, it } from "vitest";
import type { AttributeSource } from "../schemas";
import { buildAttributeValuesQuery, decodeAttributeValueRows } from "./values";

const COLUMNS: Partial<Record<AttributeSource, string>> = {
  resource: "ResourceAttributes",
  span: "SpanAttributes",
};
const columnFor = (s: AttributeSource) => COLUMNS[s] ?? "";

describe("buildAttributeValuesQuery", () => {
  it("selects distinct non-empty values for the key with the source column", () => {
    const { sql, params } = buildAttributeValuesQuery(
      {
        timeRange: { from: "now-1h", to: "now" },
        source: "span",
        key: "http.route",
      },
      { tableName: "traces", columnFor },
    );
    expect(sql).toContain("SpanAttributes[{key:String}] AS v");
    expect(sql).toContain("mapContains(SpanAttributes, {key:String})");
    expect(sql).toContain("LIMIT 100");
    expect(params.key).toBe("http.route");
    expect(params.fromTime).toBeDefined();
  });

  it("rejects an invalid table name", () => {
    expect(() =>
      buildAttributeValuesQuery(
        {
          timeRange: { from: "now-1h", to: "now" },
          source: "resource",
          key: "k",
        },
        { tableName: "bad name", columnFor },
      ),
    ).toThrow();
  });

  it("decodes value rows", () => {
    expect(decodeAttributeValueRows([{ v: "GET" }, { v: "POST" }])).toEqual([
      "GET",
      "POST",
    ]);
  });
});
