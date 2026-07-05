import { describe, expect, it } from "vite-plus/test";
import type { Panel } from "@/data/dashboards/schema";
import {
  getPanelQuerySources,
  getQuerySourceAt,
  getQueryTextAt,
  getQueryTexts,
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

  it("ignores a non-ClickHouse query plugin even if it has a string query", () => {
    // The schema accepts unknown plugin kinds for Perses compatibility; such a
    // query must not be executed as ClickHouse SQL.
    const panel: Panel = {
      kind: "Panel",
      spec: {
        display: { name: "p" },
        plugin: { kind: "TimeSeriesChart", spec: {} },
        queries: [
          {
            kind: "PrometheusQuery",
            spec: {
              plugin: {
                kind: "PrometheusTimeSeriesQuery",
                spec: { query: "up" },
              },
            },
          },
        ],
      },
    };
    expect(getQueryTextAt(panel, 0)).toBe("");
    expect(getQueryTexts(panel)).toEqual([""]);
  });

  it("reads SQL only from the ClickHouseSQL plugin in a mixed query list", () => {
    const panel: Panel = {
      kind: "Panel",
      spec: {
        display: { name: "p" },
        plugin: { kind: "TimeSeriesChart", spec: {} },
        queries: [
          {
            kind: "OtherQuery",
            spec: { plugin: { kind: "OtherPlugin", spec: { query: "nope" } } },
          },
          {
            kind: "ClickHouseSQL",
            spec: {
              plugin: { kind: "ClickHouseSQL", spec: { query: "select 1" } },
            },
          },
        ],
      },
    };
    expect(getQueryTexts(panel)).toEqual(["", "select 1"]);
  });

  it("extracts a ClickHouseSQL source", () => {
    const panel = panelWith(["select 1"]);
    expect(getQuerySourceAt(panel, 0)).toEqual({
      kind: "ClickHouseSQL",
      sql: "select 1",
    });
  });

  it("extracts a TestData source carrying its raw spec", () => {
    const panel: Panel = {
      kind: "Panel",
      spec: {
        display: { name: "p" },
        plugin: { kind: "TimeSeriesChart", spec: {} },
        queries: [
          {
            kind: "TestData",
            spec: {
              plugin: {
                kind: "TestData",
                spec: { scenario: "random_walk", series: [{ name: "v" }] },
              },
            },
          },
        ],
      },
    };
    expect(getQuerySourceAt(panel, 0)).toEqual({
      kind: "TestData",
      spec: { scenario: "random_walk", series: [{ name: "v" }] },
    });
  });

  it("maps unknown/absent query kinds to none", () => {
    expect(getQuerySourceAt(panelWith([]), 0)).toEqual({ kind: "none" });
    const prom: Panel = {
      kind: "Panel",
      spec: {
        display: { name: "p" },
        plugin: { kind: "TimeSeriesChart", spec: {} },
        queries: [
          {
            kind: "PromQuery",
            spec: { plugin: { kind: "PromQuery", spec: { query: "up" } } },
          },
        ],
      },
    };
    expect(getQuerySourceAt(prom, 0)).toEqual({ kind: "none" });
  });

  it("getPanelQuerySources returns one source per query in order", () => {
    expect(getPanelQuerySources(panelWith(["a", "b"]))).toEqual([
      { kind: "ClickHouseSQL", sql: "a" },
      { kind: "ClickHouseSQL", sql: "b" },
    ]);
  });
});
