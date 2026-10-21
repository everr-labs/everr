import { describe, expect, it } from "vite-plus/test";
import { generateTestData } from "./generate";
import { testDataSpec } from "./spec";

// A 1-hour range; step 60s → ~61 buckets.
const PARAMS = {
  from: "2026-06-10 00:00:00.000",
  to: "2026-06-10 01:00:00.000",
  step: 60,
};

function gen(raw: unknown, params = PARAMS) {
  return generateTestData(testDataSpec.parse(raw), params);
}

describe("generateTestData – random_walk", () => {
  it("is deterministic for the same seed", () => {
    const spec = {
      scenario: "random_walk",
      seed: 7,
      series: [{ name: "v", start: 10 }],
    };
    expect(gen(spec)).toEqual(gen(spec));
  });

  it("differs for a different seed", () => {
    const a = gen({
      scenario: "random_walk",
      seed: 1,
      series: [{ name: "v", start: 10 }],
    });
    const b = gen({
      scenario: "random_walk",
      seed: 2,
      series: [{ name: "v", start: 10 }],
    });
    expect(a).not.toEqual(b);
  });

  it("wide output: ts + one numeric column per series, spanning the range", () => {
    const rows = gen({
      scenario: "random_walk",
      series: [{ name: "p50" }, { name: "p95" }],
    });
    expect(rows.length).toBeGreaterThan(50);
    expect(Object.keys(rows[0]!)).toEqual(["ts", "p50", "p95"]);
    expect(rows[0]!.ts).toBe("2026-06-10 00:00:00.000");
    expect(typeof rows[0]!.p50).toBe("number");
  });

  it("long output: ts + label column + value column, one row per series per bucket", () => {
    const rows = gen({
      scenario: "random_walk",
      labelColumn: "status",
      series: [{ name: "Ok" }, { name: "Error" }],
    });
    expect(Object.keys(rows[0]!)).toEqual(["ts", "status", "value"]);
    const labels = new Set(rows.map((r) => r.status));
    expect(labels).toEqual(new Set(["Ok", "Error"]));
  });

  it("timeColumn:false emits `points` rows with no ts", () => {
    const rows = gen({
      scenario: "random_walk",
      timeColumn: false,
      points: 50,
      series: [{ name: "spans" }],
    });
    expect(rows).toHaveLength(50);
    expect(Object.keys(rows[0]!)).toEqual(["spans"]);
  });

  it("respects min/max clamping", () => {
    const rows = gen({
      scenario: "random_walk",
      series: [{ name: "v", start: 0, noise: 1000, min: 0, max: 10 }],
    });
    for (const r of rows) {
      expect(r.v as number).toBeGreaterThanOrEqual(0);
      expect(r.v as number).toBeLessThanOrEqual(10);
    }
  });

  it("nullChance:1 makes every value null", () => {
    const rows = gen({
      scenario: "random_walk",
      series: [{ name: "v", nullChance: 1 }],
    });
    expect(rows.every((r) => r.v === null)).toBe(true);
  });

  it("round limits decimals", () => {
    const rows = gen({
      scenario: "random_walk",
      series: [{ name: "v", start: 1, noise: 1, round: 1 }],
    });
    for (const r of rows) {
      const v = r.v as number;
      expect(Number(v.toFixed(1))).toBe(v);
    }
  });
});

describe("generateTestData – table", () => {
  it("emits `rows` rows with the declared columns", () => {
    const rows = gen({
      scenario: "table",
      rows: 4,
      columns: [
        { name: "ts", time: true },
        { name: "name", values: ["a", "b"] },
        { name: "dur", walk: { start: 5, round: 1 } },
        { name: "n", seq: true },
        { name: "kind", const: "Server" },
      ],
    });
    expect(rows).toHaveLength(4);
    expect(Object.keys(rows[0]!)).toEqual(["ts", "name", "dur", "n", "kind"]);
    expect(rows[0]!.name).toBe("a");
    expect(rows[1]!.name).toBe("b");
    expect(rows[2]!.name).toBe("a"); // cycled
    expect(rows[0]!.n).toBe(1);
    expect(rows[0]!.kind).toBe("Server");
    expect(typeof rows[0]!.ts).toBe("string");
  });

  it("rows:0 yields an empty frame", () => {
    expect(gen({ scenario: "table", rows: 0, columns: [{ name: "a", seq: true }] })).toEqual([]);
  });

  it("cycles null values from a values list", () => {
    const rows = gen({
      scenario: "table",
      rows: 2,
      columns: [{ name: "a", values: [null, "x"] }],
    });
    expect(rows[0]!.a).toBeNull();
    expect(rows[1]!.a).toBe("x");
  });
});

describe("generateTestData – csv", () => {
  it("maps literal rows to objects keyed by columns", () => {
    const rows = gen({
      scenario: "csv",
      columns: ["severity", "logs"],
      rows: [
        ["ERROR", 12],
        ["WARN", null],
      ],
    });
    expect(rows).toEqual([
      { severity: "ERROR", logs: 12 },
      { severity: "WARN", logs: null },
    ]);
  });

  it("empty rows yields an empty frame", () => {
    expect(gen({ scenario: "csv", columns: ["a"], rows: [] })).toEqual([]);
  });
});

describe("geo scenario", () => {
  const GEO_PARAMS = {
    from: "2026-06-10 00:00:00.000",
    to: "2026-06-10 06:00:00.000",
    step: 600,
  };

  it("points shape emits lat/lon/value and is deterministic", () => {
    const spec = {
      scenario: "geo" as const,
      shape: "points" as const,
      seed: 5,
      points: 8,
    };
    const a = generateTestData(testDataSpec.parse(spec), GEO_PARAMS);
    const b = generateTestData(testDataSpec.parse(spec), GEO_PARAMS);
    expect(a).toEqual(b);
    expect(a).toHaveLength(8);
    for (const row of a) {
      expect(typeof row.lat).toBe("number");
      expect(typeof row.lon).toBe("number");
      expect(typeof row.value).toBe("number");
      expect(row.lat as number).toBeGreaterThanOrEqual(-90);
      expect(row.lat as number).toBeLessThanOrEqual(90);
      expect(row.lon as number).toBeGreaterThanOrEqual(-180);
      expect(row.lon as number).toBeLessThanOrEqual(180);
    }
  });

  it("regions shape emits region/value with valid ISO codes", () => {
    const spec = {
      scenario: "geo" as const,
      shape: "regions" as const,
      seed: 3,
      count: 6,
    };
    const rows = generateTestData(testDataSpec.parse(spec), GEO_PARAMS);
    expect(rows).toHaveLength(6);
    for (const row of rows) {
      expect(typeof row.region).toBe("string");
      expect(typeof row.value).toBe("number");
    }
  });
});
