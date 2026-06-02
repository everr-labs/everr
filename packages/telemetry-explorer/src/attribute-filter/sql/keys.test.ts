import { describe, expect, it } from "vitest";
import type { AttributeSource } from "../schemas";
import { buildAttributeKeysQuery, decodeAttributeKeyRows } from "./keys";

const COLUMNS: Partial<Record<AttributeSource, string>> = {
  resource: "ResourceAttributes",
  span: "SpanAttributes",
};
const columnFor = (s: AttributeSource) => COLUMNS[s] ?? "";

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
    expect(params.fromTime).toBeDefined();
    expect(params.toTime).toBeDefined();
  });

  it("scopes each source scan with an optional row predicate", () => {
    const { sql } = buildAttributeKeysQuery(
      { timeRange: { from: "now-1h", to: "now" } },
      {
        tableName: "logs",
        sources: ["resource", "span"],
        columnFor,
        rowPredicate: "SeverityNumber >= 17",
      },
    );
    // One scoped predicate per source scan.
    expect(sql.match(/SeverityNumber >= 17/g)).toHaveLength(2);
  });

  it("caps each source independently (no single global limit)", () => {
    const { sql } = buildAttributeKeysQuery(
      { timeRange: { from: "now-1h", to: "now" } },
      { tableName: "traces", sources: ["resource", "span"], columnFor },
    );
    // One LIMIT per source subquery, not one global cap after the union.
    expect(sql.match(/LIMIT 200/g)).toHaveLength(2);
    expect(sql).not.toContain("LIMIT 500");
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

  it("uses an injected time column when provided", () => {
    const { sql } = buildAttributeKeysQuery(
      { timeRange: { from: "now-1h", to: "now" } },
      {
        tableName: "traces",
        sources: ["resource"],
        columnFor,
        timeColumn: "Timestamp",
      },
    );
    expect(sql).toContain(
      "Timestamp >= parseDateTimeBestEffort({fromTime:String})",
    );
    expect(sql).not.toContain("TimestampTime");
  });
});
