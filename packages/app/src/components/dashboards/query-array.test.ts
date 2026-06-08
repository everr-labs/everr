import { describe, expect, it } from "vitest";
import type { Panel } from "@/data/dashboards/schema";
import { getQueryTextAt, getQueryTexts } from "./query-array";

function panelWith(queries: string[]): Panel {
  return {
    kind: "Panel",
    spec: {
      display: { name: "p" },
      plugin: { kind: "TimeSeriesChart", spec: {} },
      queries: queries.map((query) => ({
        kind: "ClickHouseSQL",
        spec: { plugin: { kind: "ClickHouseSQL", spec: { query } } },
      })),
    },
  };
}

describe("query-array", () => {
  it("reads query text by index, empty string when absent", () => {
    const panel = panelWith(["select 1"]);
    expect(getQueryTextAt(panel, 0)).toBe("select 1");
    expect(getQueryTextAt(panel, 1)).toBe("");
  });

  it("getQueryTexts returns all texts in order", () => {
    expect(getQueryTexts(panelWith(["a", "b"]))).toEqual(["a", "b"]);
    expect(getQueryTexts(panelWith([]))).toEqual([]);
  });
});
