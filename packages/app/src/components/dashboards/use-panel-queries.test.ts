import { describe, expect, it, vi } from "vitest";

// The pure helpers under test live alongside the hook, whose import chain
// (options -> server -> db client) touches server-only env at module load.
// jsdom runs as a "client", so stub the db client to keep that import inert.
vi.mock("@/db/client", () => ({ db: {} }));

import type { PanelQuerySource } from "./query-array";
import {
  buildPanelQueryRequest,
  buildPanelQueryRequests,
  combineQueryStates,
  type SingleQueryState,
} from "./use-panel-queries";

const ctx = {
  definedNames: new Set(["region"]),
  values: { region: "us" } as Record<string, string | string[]>,
  meta: {},
  pendingAllNames: [] as string[],
  allErrors: {} as Record<string, string>,
};

const ch = (sql: string): PanelQuerySource => ({ kind: "ClickHouseSQL", sql });

function state(partial: Partial<SingleQueryState>): SingleQueryState {
  return {
    active: true,
    missingName: undefined,
    isPending: false,
    isError: false,
    error: undefined,
    rows: [],
    ...partial,
  };
}

describe("buildPanelQueryRequests", () => {
  it("resolves variables per ClickHouse query independently", () => {
    const reqs = buildPanelQueryRequests(
      [ch("select $region"), ch("select 1")],
      ctx,
    );
    expect(reqs[0]!.variables).toEqual({ region: "us" });
    expect(reqs[0]!.missingName).toBeUndefined();
    expect(reqs[1]!.variables).toBeUndefined();
  });

  it("flags a query whose variable has no value", () => {
    const reqs = buildPanelQueryRequests([ch("select $region")], {
      ...ctx,
      values: {},
    });
    expect(reqs[0]!.missingName).toBe("region");
  });

  it("flags a query waiting for all-expansion options", () => {
    const reqs = buildPanelQueryRequests([ch("select $region")], {
      ...ctx,
      pendingAllNames: ["region"],
    });
    expect(reqs[0]!.waitingForOptions).toBe(true);
  });

  it("surfaces a used variable's options error", () => {
    const req = buildPanelQueryRequest(ch("select $region"), {
      ...ctx,
      allErrors: { region: 'Variable "$region" has too many values' },
    });
    expect(req.optionsError).toBe('Variable "$region" has too many values');
  });

  it("does no variable handling for a TestData source", () => {
    const source: PanelQuerySource = {
      kind: "TestData",
      spec: { scenario: "csv", columns: ["a"], rows: [] },
    };
    const req = buildPanelQueryRequest(source, { ...ctx, values: {} });
    expect(req.source).toEqual(source);
    expect(req.variables).toBeUndefined();
    expect(req.missingName).toBeUndefined();
    expect(req.waitingForOptions).toBe(false);
  });
});

describe("combineQueryStates", () => {
  it("is success with one result set per active query, in order", () => {
    const result = combineQueryStates([
      state({ rows: [{ x: 1 }] }),
      state({ rows: [{ x: 2 }] }),
    ]);
    expect(result.status).toBe("success");
    expect(result.data).toEqual([[{ x: 1 }], [{ x: 2 }]]);
  });

  it("ignores inactive queries entirely", () => {
    const result = combineQueryStates([
      state({ rows: [{ x: 1 }] }),
      state({ active: false, rows: undefined, isPending: true }),
    ]);
    expect(result.status).toBe("success");
    expect(result.data).toEqual([[{ x: 1 }]]);
  });

  it("errors the whole panel when any query errors", () => {
    const result = combineQueryStates([
      state({ rows: [{ x: 1 }] }),
      state({ isError: true, error: new Error("boom") }),
    ]);
    expect(result.status).toBe("error");
    expect(result.errorMessage).toBe("boom");
  });

  it("errors with the options error before considering pending state", () => {
    const result = combineQueryStates([
      state({
        optionsError: "Failed to load options for $region: boom",
        rows: undefined,
        isPending: true,
      }),
    ]);
    expect(result.status).toBe("error");
    expect(result.errorMessage).toBe(
      "Failed to load options for $region: boom",
    );
  });

  it("errors with a variable hint when a query is missing a value", () => {
    const result = combineQueryStates([
      state({ missingName: "region", rows: undefined }),
    ]);
    expect(result.status).toBe("error");
    expect(result.errorMessage).toBe("Select a value for $region");
  });

  it("is pending while any active query has no rows yet", () => {
    const result = combineQueryStates([
      state({ rows: [{ x: 1 }] }),
      state({ isPending: true, rows: undefined }),
    ]);
    expect(result.status).toBe("pending");
  });

  it("is success with undefined data when no queries are active", () => {
    const result = combineQueryStates([
      state({ active: false, rows: undefined }),
    ]);
    expect(result.status).toBe("success");
    expect(result.data).toBeUndefined();
  });
});
