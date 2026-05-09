import { describe, expect, it } from "vitest";
import { buildExplorerQuery, mapExplorerRow } from "./explorer";

describe("buildExplorerQuery", () => {
  it("returns sql + params with limit/offset bound", () => {
    const built = buildExplorerQuery({
      timeRange: { from: "now-1h", to: "now" },
      levels: ["error"],
      services: [],
      repos: [],
      limit: 50,
      offset: 100,
    });
    expect(built.sql).toContain("FROM logs");
    expect(built.sql).toContain("ORDER BY Timestamp DESC");
    expect(built.sql).toContain("LIMIT {limit:UInt32}");
    expect(built.sql).toContain("OFFSET {offset:UInt32}");
    expect(built.params.limit).toBe(50);
    expect(built.params.offset).toBe(100);
    expect(built.params.levels).toEqual(["error"]);
  });
});

describe("mapExplorerRow", () => {
  it("normalizes timestamp and produces a stable id", () => {
    const row = mapExplorerRow({
      timestampRaw: "2026-03-09 12:00:00",
      level: "info",
      body: "hi",
      traceId: "t",
      spanId: "s",
      serviceName: "svc",
      bodyHash: "h",
    });
    expect(row.id).toBe("2026-03-09 12:00:00|t|s|svc|h");
    expect(row.timestamp).toMatch(/^2026-03-09T12:00:00/);
    expect(row.identity.bodyHash).toBe("h");
  });
});
