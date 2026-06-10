import { describe, expect, it } from "vitest";
import { testDataSpec } from "./spec";

describe("testDataSpec", () => {
  it("parses a random_walk spec and applies defaults", () => {
    const parsed = testDataSpec.parse({
      scenario: "random_walk",
      series: [{ name: "p95_ms", start: 120 }],
    });
    expect(parsed.scenario).toBe("random_walk");
    if (parsed.scenario !== "random_walk") throw new Error("narrowing");
    expect(parsed.seed).toBe(1);
    expect(parsed.timeColumn).toBe(true);
    expect(parsed.valueColumn).toBe("value");
    expect(parsed.series[0]?.noise).toBe(1);
    expect(parsed.series[0]?.nullChance).toBe(0);
  });

  it("parses a table spec with per-column generators", () => {
    const parsed = testDataSpec.parse({
      scenario: "table",
      rows: 5,
      columns: [
        { name: "Timestamp", time: true },
        { name: "SpanName", values: ["a", "b"] },
        { name: "dur", walk: { start: 1 } },
        { name: "n", seq: true },
      ],
    });
    if (parsed.scenario !== "table") throw new Error("narrowing");
    expect(parsed.rows).toBe(5);
    expect(parsed.columns).toHaveLength(4);
  });

  it("parses a csv spec with literal rows including null", () => {
    const parsed = testDataSpec.parse({
      scenario: "csv",
      columns: ["a", "b"],
      rows: [
        ["x", 1],
        ["y", null],
      ],
    });
    if (parsed.scenario !== "csv") throw new Error("narrowing");
    expect(parsed.rows).toEqual([
      ["x", 1],
      ["y", null],
    ]);
  });

  it("rejects an unknown scenario", () => {
    expect(testDataSpec.safeParse({ scenario: "nope" }).success).toBe(false);
  });

  it("preserves unknown keys (looseObject, Perses-compatible)", () => {
    const parsed = testDataSpec.parse({
      scenario: "csv",
      columns: ["a"],
      rows: [],
      extra: "kept",
    }) as Record<string, unknown>;
    expect(parsed.extra).toBe("kept");
  });
});
