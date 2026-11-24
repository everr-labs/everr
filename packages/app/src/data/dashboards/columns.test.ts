import { describe, expect, it } from "vite-plus/test";
import { columnsBody, panelResponse, readPanelResponse } from "./columns";

const window = { from: "2026-11-24T00:00:00.000Z", to: "2026-11-24T01:00:00.000Z" };

describe("panel responses", () => {
  it("carries a ClickHouse JSONColumnsWithMetadata body as rows, in column order", async () => {
    const body = `{
      "meta": [{"name": "ts", "type": "DateTime"}, {"name": "n", "type": "UInt64"}, {"name": "v", "type": "Nullable(Float64)"}],
      "data": {"ts": ["2026-11-24 00:00:00", "2026-11-24 00:01:00"], "n": [0, "18446744073709551615"], "v": [1.5, null]},
      "rows": 2,
      "statistics": {"elapsed": 0.001, "rows_read": 2, "bytes_read": 16}
    }`;
    const { rows, timeRange } = await readPanelResponse(panelResponse(body, window));
    expect(rows).toEqual([
      { ts: "2026-11-24 00:00:00", n: 0, v: 1.5 },
      { ts: "2026-11-24 00:01:00", n: "18446744073709551615", v: null },
    ]);
    expect(Object.keys(rows[0] ?? {})).toEqual(["ts", "n", "v"]);
    expect(timeRange).toEqual(window);
  });

  it("carries an empty result as no rows", async () => {
    const body = '{"meta": [{"name": "a", "type": "UInt8"}], "data": {}, "rows": 0}';
    expect((await readPanelResponse(panelResponse(body, window))).rows).toEqual([]);
  });

  it("gets back the rows a body was made from", async () => {
    const rows = [
      { ts: "2026-11-24 00:00:00", service: "api", value: 1 },
      { ts: "2026-11-24 00:01:00", service: "web", value: null },
    ];
    expect((await readPanelResponse(panelResponse(columnsBody(rows), window))).rows).toEqual(rows);
    expect((await readPanelResponse(panelResponse(columnsBody([]), window))).rows).toEqual([]);
  });
});
