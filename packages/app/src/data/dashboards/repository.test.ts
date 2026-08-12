import { beforeEach, describe, expect, it, vi } from "vitest";
import { PanelRepository, VARIABLE_OPTIONS_LIMIT } from "./repository";

const execute = vi.fn();
const client = { execute };

beforeEach(() => {
  execute.mockReset();
  execute.mockResolvedValue([]);
});

function makeRepo() {
  return new PanelRepository(client);
}

/** Fixed absolute range so `{from}`/`{to}`/`{step}` are deterministic. */
const RANGE = { from: "2026-08-01T00:00:00Z", to: "2026-08-01T01:00:00Z" };

describe("runPanel", () => {
  it("passes ClickHouse SQL through to the client and returns its rows", async () => {
    const row = { service: "api", count: 3 };
    execute.mockResolvedValueOnce([row]);

    const result = await makeRepo().runPanel({
      source: { kind: "ClickHouseSQL", sql: "SELECT ServiceName FROM traces" },
      ...RANGE,
    });

    expect(result).toEqual({ rows: [row] });
    expect(execute).toHaveBeenCalledTimes(1);
    const [sql] = execute.mock.calls[0] ?? [];
    expect(sql).toBe("SELECT ServiceName FROM traces");
  });

  it("binds from, to and an adaptive step for every panel query", async () => {
    await makeRepo().runPanel({
      source: { kind: "ClickHouseSQL", sql: "SELECT 1" },
      ...RANGE,
    });

    const [, params] = execute.mock.calls[0] ?? [];
    expect(params).toMatchObject({
      from: "2026-08-01 00:00:00.000",
      to: "2026-08-01 01:00:00.000",
    });
    // One hour across ~500 target points snaps to a nice step, not a raw 7.2s.
    expect(params.step).toBeGreaterThan(0);
    expect(Number.isInteger(params.step)).toBe(true);
  });

  it("widens the adaptive step as the range widens", async () => {
    const repo = makeRepo();
    await repo.runPanel({
      source: { kind: "ClickHouseSQL", sql: "SELECT 1" },
      ...RANGE,
    });
    await repo.runPanel({
      source: { kind: "ClickHouseSQL", sql: "SELECT 1" },
      from: "2026-07-01T00:00:00Z",
      to: "2026-08-01T00:00:00Z",
    });

    const [, hourParams] = execute.mock.calls[0] ?? [];
    const [, monthParams] = execute.mock.calls[1] ?? [];
    expect(monthParams.step).toBeGreaterThan(hourParams.step);
  });

  it("falls back to the default range when none is given", async () => {
    await makeRepo().runPanel({
      source: { kind: "ClickHouseSQL", sql: "SELECT 1" },
    });

    const [, params] = execute.mock.calls[0] ?? [];
    expect(typeof params.from).toBe("string");
    expect(typeof params.to).toBe("string");
    expect(params.step).toBeGreaterThan(0);
  });

  it("interpolates variables into the SQL before executing", async () => {
    await makeRepo().runPanel({
      source: {
        kind: "ClickHouseSQL",
        sql: "SELECT * FROM traces WHERE ServiceName = $service",
      },
      ...RANGE,
      variables: { service: "api" },
    });

    const [sql] = execute.mock.calls[0] ?? [];
    expect(sql).toBe("SELECT * FROM traces WHERE ServiceName = 'api'");
  });

  it("leaves the SQL untouched when there are no variables", async () => {
    const sql = "SELECT * FROM traces WHERE ServiceName = $service";
    await makeRepo().runPanel({
      source: { kind: "ClickHouseSQL", sql },
      ...RANGE,
    });

    expect(execute.mock.calls[0]?.[0]).toBe(sql);
  });

  it("expands an All selection using the variable's known options", async () => {
    await makeRepo().runPanel({
      source: {
        kind: "ClickHouseSQL",
        sql: "SELECT * FROM traces WHERE ServiceName IN $service",
      },
      ...RANGE,
      variables: { service: "__all" },
      variableMeta: { service: { options: ["api", "web"] } },
    });

    const [sql] = execute.mock.calls[0] ?? [];
    expect(sql).toContain("'api'");
    expect(sql).toContain("'web'");
  });

  it("generates synthetic rows for a TestData source without touching the client", async () => {
    const result = await makeRepo().runPanel({
      source: {
        kind: "TestData",
        spec: { scenario: "csv", columns: ["a", "b"], rows: [["x", 1]] },
      },
      ...RANGE,
    });

    expect(result.rows).toEqual([{ a: "x", b: 1 }]);
    expect(execute).not.toHaveBeenCalled();
  });

  it("spans the resolved time range for a random_walk scenario", async () => {
    const { rows } = await makeRepo().runPanel({
      source: {
        kind: "TestData",
        spec: { scenario: "random_walk", seed: 1, series: [{ name: "v" }] },
      },
      from: "2026-06-10 00:00:00",
      to: "2026-06-10 00:10:00",
    });

    expect(rows.length).toBeGreaterThan(0);
    expect(Object.keys(rows[0]!)).toContain("ts");
    expect(Object.keys(rows[0]!)).toContain("v");
  });
});

describe("runVariableOptions", () => {
  it("wraps the query in a row limit so an overflow cannot throw", async () => {
    await makeRepo().runVariableOptions({
      query: "SELECT DISTINCT ServiceName FROM traces",
      ...RANGE,
    });

    const [sql] = execute.mock.calls[0] ?? [];
    expect(sql).toContain("SELECT DISTINCT ServiceName FROM traces");
    expect(sql).toContain(`LIMIT ${VARIABLE_OPTIONS_LIMIT}`);
  });

  it("strips a trailing semicolon so the wrapped subquery stays valid", async () => {
    await makeRepo().runVariableOptions({
      query: "SELECT DISTINCT ServiceName FROM traces;",
      ...RANGE,
    });

    const [sql] = execute.mock.calls[0] ?? [];
    expect(sql).not.toContain(";\n)");
  });

  it("binds the same parameters a panel query gets", async () => {
    await makeRepo().runVariableOptions({
      query: "SELECT 1",
      ...RANGE,
    });

    const [, params] = execute.mock.calls[0] ?? [];
    expect(params).toMatchObject({
      from: "2026-08-01 00:00:00.000",
      to: "2026-08-01 01:00:00.000",
    });
    expect(params.step).toBeGreaterThan(0);
  });

  it("returns the stringified first column, deduplicated, in query order", async () => {
    execute.mockResolvedValueOnce([
      { name: "web" },
      { name: "api" },
      { name: "web" },
      { name: 42 },
    ]);

    const result = await makeRepo().runVariableOptions({
      query: "SELECT 1",
      ...RANGE,
    });

    expect(result.options).toEqual(["web", "api", "42"]);
  });

  it("ignores rows with no columns", async () => {
    execute.mockResolvedValueOnce([{ name: "api" }, {}]);

    const result = await makeRepo().runVariableOptions({
      query: "SELECT 1",
      ...RANGE,
    });

    expect(result.options).toEqual(["api"]);
  });

  it("reports no truncation for a short result", async () => {
    execute.mockResolvedValueOnce([{ name: "api" }]);

    const result = await makeRepo().runVariableOptions({
      query: "SELECT 1",
      ...RANGE,
    });

    expect(result.truncated).toBe(false);
  });

  it("reports truncation when the result fills the limit", async () => {
    execute.mockResolvedValueOnce(
      Array.from({ length: VARIABLE_OPTIONS_LIMIT }, (_, i) => ({
        name: `svc-${i}`,
      })),
    );

    const result = await makeRepo().runVariableOptions({
      query: "SELECT 1",
      ...RANGE,
    });

    expect(result.truncated).toBe(true);
  });
});
