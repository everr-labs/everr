import { describe, expect, it } from "vitest";
import type { AttributeSource } from "../schemas";
import { buildAttributeKeysQuery, decodeAttributeKeyRows } from "./keys";

const columnFor = (s: AttributeSource) =>
  ({ resource: "ResourceAttributes", span: "SpanAttributes" })[s] ?? "";

describe("buildAttributeKeysQuery", () => {
  it("unions a SELECT per requested source and binds the time range", () => {
    const { sql, params } = buildAttributeKeysQuery(
      { timeRange: { from: "now-1h", to: "now" } },
      { tableName: "traces", sources: ["resource", "span"], columnFor },
    );
    expect(sql).toContain("mapKeys(ResourceAttributes)");
    expect(sql).toContain("'resource' AS source");
    expect(sql).toContain("mapKeys(SpanAttributes)");
    expect(sql).toContain("'span' AS source");
    expect(sql).toContain("UNION ALL");
    expect(sql).toContain("LIMIT 500");
    expect(params.fromTime).toBeDefined();
    expect(params.toTime).toBeDefined();
  });

  it("rejects an invalid table name", () => {
    expect(() =>
      buildAttributeKeysQuery(
        { timeRange: { from: "now-1h", to: "now" } },
        { tableName: "bad; DROP", sources: ["resource"], columnFor },
      ),
    ).toThrow();
  });

  it("decodes rows into {source, key}", () => {
    expect(
      decodeAttributeKeyRows([{ key: "http.route", source: "span" }]),
    ).toEqual([{ source: "span", key: "http.route" }]);
  });
});
