import { bucketSeconds } from "@everr/ui/lib/bucket";
import { describe, expect, it } from "vite-plus/test";
import {
  buildM4Query,
  type ColumnRoles,
  M4_MAX_BUCKETS,
  M4_MIN_BUCKETS,
  m4BucketSeconds,
  m4BucketsForWidth,
  resolveColumnRoles,
} from "./m4";

const col = (name: string, type: string) => ({ name, type });

describe("resolveColumnRoles", () => {
  const cases: Array<{
    name: string;
    columns: { name: string; type: string }[];
    expected: Omit<ColumnRoles, "columns"> | null;
  }> = [
    {
      name: "time, group and value columns",
      columns: [
        col("ts", "DateTime"),
        col("service", "String"),
        col("p95", "Float64"),
        col("calls", "UInt64"),
      ],
      expected: { time: "ts", groups: ["service"], values: ["p95", "calls"] },
    },
    {
      name: "the time name is case-insensitive and may be time or timestamp",
      columns: [col("Time", "DateTime64(3, 'UTC')"), col("v", "Int32")],
      expected: { time: "Time", groups: [], values: ["v"] },
    },
    {
      name: "Date and Date32 count as time",
      columns: [col("timestamp", "Date32"), col("v", "Int8")],
      expected: { time: "timestamp", groups: [], values: ["v"] },
    },
    {
      name: "Nullable and LowCardinality wrappers are unwrapped",
      columns: [
        col("ts", "Nullable(DateTime)"),
        col("service", "LowCardinality(Nullable(String))"),
        col("v", "Nullable(Float64)"),
      ],
      expected: { time: "ts", groups: ["service"], values: ["v"] },
    },
    {
      name: "numeric families are values",
      columns: [
        col("ts", "DateTime"),
        col("a", "Decimal(18, 4)"),
        col("b", "BFloat16"),
        col("c", "UInt256"),
        col("d", "Float32"),
      ],
      expected: { time: "ts", groups: [], values: ["a", "b", "c", "d"] },
    },
    {
      name: "string-like types and further date columns are groups",
      columns: [
        col("ts", "DateTime"),
        col("a", "FixedString(4)"),
        col("b", "Enum8('x' = 1)"),
        col("c", "UUID"),
        col("d", "Bool"),
        col("e", "IPv4"),
        col("f", "IPv6"),
        col("day", "Date"),
        col("v", "Float64"),
      ],
      expected: { time: "ts", groups: ["a", "b", "c", "d", "e", "f", "day"], values: ["v"] },
    },
    {
      name: "only the first time-named column is the time axis",
      columns: [col("ts", "DateTime"), col("time", "DateTime"), col("v", "Float64")],
      expected: { time: "ts", groups: ["time"], values: ["v"] },
    },
    {
      name: "a time-named column with a non-temporal type",
      columns: [col("ts", "UInt32"), col("v", "Float64")],
      expected: null,
    },
    {
      name: "no time column",
      columns: [col("service", "String"), col("v", "Float64")],
      expected: null,
    },
    {
      name: "no value column",
      columns: [col("ts", "DateTime"), col("s", "String")],
      expected: null,
    },
    {
      name: "an array column",
      columns: [col("ts", "DateTime"), col("v", "Float64"), col("tags", "Array(String)")],
      expected: null,
    },
    {
      name: "a map, tuple, JSON, Dynamic and Nothing column",
      columns: [col("ts", "DateTime"), col("v", "Float64"), col("x", "Map(String, String)")],
      expected: null,
    },
    {
      name: "a Nothing column",
      columns: [col("ts", "DateTime"), col("v", "Float64"), col("x", "Nullable(Nothing)")],
      expected: null,
    },
    {
      name: "a duplicate column name",
      columns: [col("ts", "DateTime"), col("v", "Float64"), col("v", "Float64")],
      expected: null,
    },
    {
      name: "a reserved column name",
      columns: [col("ts", "DateTime"), col("__everr_row", "Float64"), col("v", "Float64")],
      expected: null,
    },
  ];

  it.each(cases)("$name", ({ columns, expected }) => {
    expect(resolveColumnRoles(columns)).toEqual(
      expected === null ? null : { columns: columns.map((c) => c.name), ...expected },
    );
  });
});

describe("m4BucketsForWidth", () => {
  it.each([
    { width: 0, buckets: M4_MIN_BUCKETS },
    { width: 180, buckets: M4_MIN_BUCKETS },
    { width: 300, buckets: 300 },
    { width: 301, buckets: 400 },
    { width: 640, buckets: 700 },
    { width: 1000, buckets: M4_MAX_BUCKETS },
    { width: 3840, buckets: M4_MAX_BUCKETS },
  ])("asks for $buckets buckets at $width px", ({ width, buckets }) => {
    expect(m4BucketsForWidth(width)).toBe(buckets);
  });
});

describe("m4BucketSeconds", () => {
  const from = new Date("2026-01-01T00:00:00.000Z");
  const ranges = [0, 1, 90, 3600, 6 * 3600, 86_400, 7 * 86_400, 90 * 86_400, 365 * 86_400];
  const cases = [M4_MIN_BUCKETS, 500, M4_MAX_BUCKETS].flatMap((buckets) =>
    ranges.map((seconds) => ({ buckets, seconds })),
  );

  it.each(cases)(
    "stays within [1, 2 * step] for $buckets buckets over $seconds seconds",
    ({ buckets, seconds }) => {
      const to = new Date(from.getTime() + seconds * 1000);
      const bucket = m4BucketSeconds(from, to, buckets);
      expect(bucket).toBeGreaterThanOrEqual(1);
      expect(bucket).toBeLessThanOrEqual(2 * bucketSeconds(from, to, 500));
    },
  );

  it("keeps a fractional range unrounded", () => {
    const to = new Date(from.getTime() + 250_001);
    expect(m4BucketSeconds(from, to, 250)).toBe(2);
  });

  it("narrows the bucket as the panel asks for more of them", () => {
    const to = new Date(from.getTime() + 3600_000);
    expect(m4BucketSeconds(from, to, 250)).toBe(15);
    expect(m4BucketSeconds(from, to, 1000)).toBe(4);
  });
});

describe("buildM4Query", () => {
  const roles: ColumnRoles = {
    columns: ["ts", "we`ird\\name", "v"],
    time: "ts",
    groups: ["we`ird\\name"],
    values: ["v"],
  };

  it("escapes identifiers and strips the statement terminator", () => {
    const sql = buildM4Query("SELECT 1;\n", roles, 15);
    expect(sql).toContain("`we\\`ird\\\\name`");
    expect(sql).toContain("SELECT 1\n    )");
  });

  it("keeps a trailing line comment from swallowing the closing paren", () => {
    const sql = buildM4Query("SELECT 1 -- note", roles, 15);
    expect(sql).toContain("SELECT 1 -- note\n    )");
  });
});
