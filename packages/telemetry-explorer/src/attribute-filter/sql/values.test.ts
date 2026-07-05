import { describe, expect, it } from "vite-plus/test";
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
    expect(sql).not.toContain("positionCaseInsensitive");
    expect(params.valueSearch).toBeUndefined();
  });

  it("adds a substring filter when a search term is given", () => {
    const { sql, params } = buildAttributeValuesQuery(
      {
        timeRange: { from: "now-1h", to: "now" },
        source: "span",
        key: "http.route",
        search: "/api",
      },
      { tableName: "traces", columnFor },
    );
    expect(sql).toContain(
      "positionCaseInsensitive(SpanAttributes[{key:String}], {valueSearch:String}) > 0",
    );
    expect(params.valueSearch).toBe("/api");
  });

  it("scopes the scan with an optional row predicate", () => {
    const { sql } = buildAttributeValuesQuery(
      {
        timeRange: { from: "now-1h", to: "now" },
        source: "span",
        key: "http.route",
      },
      { tableName: "traces", columnFor, rowPredicate: "SeverityNumber >= 17" },
    );
    expect(sql).toContain("(SeverityNumber >= 17)");
  });

  it("ignores a blank search term", () => {
    const { sql, params } = buildAttributeValuesQuery(
      {
        timeRange: { from: "now-1h", to: "now" },
        source: "span",
        key: "http.route",
        search: "   ",
      },
      { tableName: "traces", columnFor },
    );
    expect(sql).not.toContain("positionCaseInsensitive");
    expect(params.valueSearch).toBeUndefined();
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
    expect(decodeAttributeValueRows([{ v: "GET" }, { v: "POST" }])).toEqual(["GET", "POST"]);
  });

  it("uses an injected time column when provided", () => {
    const { sql } = buildAttributeValuesQuery(
      {
        timeRange: { from: "now-1h", to: "now" },
        source: "span",
        key: "http.route",
      },
      { tableName: "traces", columnFor, timeColumn: "Timestamp" },
    );
    expect(sql).toContain("Timestamp >= parseDateTimeBestEffort({fromTime:String})");
    expect(sql).not.toContain("TimestampTime");
  });

  it("uses an injected time-bound parser for both bounds", () => {
    const { sql } = buildAttributeValuesQuery(
      {
        timeRange: { from: "now-1h", to: "now" },
        source: "span",
        key: "http.route",
      },
      {
        tableName: "traces",
        columnFor,
        timeColumn: "Timestamp",
        timeBound: (p) => `parseDateTime64BestEffort({${p}:String}, 9)`,
      },
    );
    expect(sql).toContain("Timestamp >= parseDateTime64BestEffort({fromTime:String}, 9)");
    expect(sql).toContain("Timestamp <= parseDateTime64BestEffort({toTime:String}, 9)");
    expect(sql).not.toContain("parseDateTimeBestEffort(");
  });
});
