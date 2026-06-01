import { describe, expect, it } from "vitest";
import {
  buildAttributeKeysQuery,
  decodeAttributeKeyRows,
} from "./attribute-keys";

describe("buildAttributeKeysQuery", () => {
  it("unions distinct keys across all three maps within range", () => {
    const built = buildAttributeKeysQuery({
      timeRange: { from: "now-1h", to: "now" },
    });
    expect(built.sql).toContain(
      "DISTINCT arrayJoin(mapKeys(ResourceAttributes))",
    );
    expect(built.sql).toContain("DISTINCT arrayJoin(mapKeys(LogAttributes))");
    expect(built.sql).toContain("DISTINCT arrayJoin(mapKeys(ScopeAttributes))");
    expect(built.sql).toContain("UNION ALL");
    expect(built.sql).toContain("LIMIT 500");
    expect(typeof built.params.fromTime).toBe("string");
    expect(typeof built.params.toTime).toBe("string");
  });
});

describe("decodeAttributeKeyRows", () => {
  it("maps rows to typed keys", () => {
    expect(
      decodeAttributeKeyRows([
        { key: "host.name", source: "resource" },
        { key: "http.method", source: "log" },
      ]),
    ).toEqual([
      { key: "host.name", source: "resource" },
      { key: "http.method", source: "log" },
    ]);
  });

  it("returns an empty array for no rows", () => {
    expect(decodeAttributeKeyRows([])).toEqual([]);
  });
});
