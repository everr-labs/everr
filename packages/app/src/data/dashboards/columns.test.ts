import { describe, expect, it } from "vite-plus/test";
import { columnsBody, rowsFromColumns } from "./columns";

describe("rowsFromColumns", () => {
  it("reads a ClickHouse JSONColumnsWithMetadata body as rows, in column order", () => {
    const body = `{
      "meta": [{"name": "ts", "type": "DateTime"}, {"name": "n", "type": "UInt64"}, {"name": "v", "type": "Nullable(Float64)"}],
      "data": {"ts": ["2026-11-24 00:00:00", "2026-11-24 00:01:00"], "n": [0, "18446744073709551615"], "v": [1.5, null]},
      "rows": 2,
      "statistics": {"elapsed": 0.001, "rows_read": 2, "bytes_read": 16}
    }`;
    const rows = rowsFromColumns(body);
    expect(rows).toEqual([
      { ts: "2026-11-24 00:00:00", n: 0, v: 1.5 },
      { ts: "2026-11-24 00:01:00", n: "18446744073709551615", v: null },
    ]);
    expect(Object.keys(rows[0] ?? {})).toEqual(["ts", "n", "v"]);
  });

  it("reads an empty result as no rows", () => {
    expect(
      rowsFromColumns('{"meta": [{"name": "a", "type": "UInt8"}], "data": {}, "rows": 0}'),
    ).toEqual([]);
  });

  it("gets back the rows a body was made from", () => {
    const rows = [
      { ts: "2026-11-24 00:00:00", service: "api", value: 1 },
      { ts: "2026-11-24 00:01:00", service: "web", value: null },
    ];
    expect(rowsFromColumns(columnsBody(rows))).toEqual(rows);
    expect(rowsFromColumns(columnsBody([]))).toEqual([]);
  });
});
