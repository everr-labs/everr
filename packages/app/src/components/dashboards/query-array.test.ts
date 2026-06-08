import { describe, expect, it } from "vitest";
import type { Panel } from "@/data/dashboards/schema";
import {
  addQuery,
  getQueryTextAt,
  getQueryTexts,
  removeQueryAt,
  setQueryTextAt,
} from "./query-array";

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

  it("sets query text at an index without touching siblings", () => {
    const next = setQueryTextAt(panelWith(["a", "b"]), 1, "b2");
    expect(getQueryTexts(next)).toEqual(["a", "b2"]);
  });

  it("appends a blank ClickHouseSQL query", () => {
    const next = addQuery(panelWith(["a"]));
    expect(getQueryTexts(next)).toEqual(["a", ""]);
    expect(next.spec.queries?.[1]?.kind).toBe("ClickHouseSQL");
  });

  it("adds the first query when queries is undefined", () => {
    const panel: Panel = {
      kind: "Panel",
      spec: { display: {}, plugin: { kind: "Table", spec: {} } },
    };
    expect(getQueryTexts(addQuery(panel))).toEqual([""]);
  });

  it("removes a query by index", () => {
    expect(getQueryTexts(removeQueryAt(panelWith(["a", "b", "c"]), 1))).toEqual(
      ["a", "c"],
    );
  });

  it("preserves an existing query's kind and extra plugin spec fields when editing", () => {
    const panel: Panel = {
      kind: "Panel",
      spec: {
        display: {},
        plugin: { kind: "TimeSeriesChart", spec: {} },
        queries: [
          {
            kind: "PrometheusTimeSeriesQuery",
            spec: {
              plugin: {
                kind: "PrometheusTimeSeriesQuery",
                spec: { query: "old", datasource: "ds-1", step: 60 },
              },
            },
          },
        ],
      },
    };
    const next = setQueryTextAt(panel, 0, "new");
    const q = next.spec.queries?.[0];
    expect(q?.kind).toBe("PrometheusTimeSeriesQuery");
    expect(q?.spec.plugin.kind).toBe("PrometheusTimeSeriesQuery");
    expect(q?.spec.plugin.spec).toEqual({
      query: "new",
      datasource: "ds-1",
      step: 60,
    });
  });
});
