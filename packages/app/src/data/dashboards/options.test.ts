import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockedRunPanelQuery, mockedRunVariableOptionsQuery } = vi.hoisted(
  () => ({
    mockedRunPanelQuery: vi.fn(),
    mockedRunVariableOptionsQuery: vi.fn(),
  }),
);

vi.mock("./server", () => ({
  getDashboard: vi.fn(),
  getTelemetryCapabilities: vi.fn(),
  listDashboards: vi.fn(),
  runPanelQuery: mockedRunPanelQuery,
  runVariableOptionsQuery: mockedRunVariableOptionsQuery,
}));

import { panelQueryOptions, variableOptionsQueryOptions } from "./options";

describe("panelQueryOptions", () => {
  beforeEach(() => {
    mockedRunPanelQuery.mockReset();
    mockedRunPanelQuery.mockResolvedValue({ rows: [] });
    mockedRunVariableOptionsQuery.mockReset();
    mockedRunVariableOptionsQuery.mockResolvedValue({ options: [] });
  });

  it("forwards query cancellation to the server function", async () => {
    const controller = new AbortController();
    const options = panelQueryOptions(
      { kind: "ClickHouseSQL", sql: "SELECT 1" },
      "2026-09-21 07:15:00",
      "2026-09-21 07:45:00",
    );

    await options.queryFn?.({ signal: controller.signal } as never);

    expect(mockedRunPanelQuery).toHaveBeenCalledWith({
      data: {
        source: { kind: "ClickHouseSQL", sql: "SELECT 1" },
        from: "2026-09-21 07:15:00",
        to: "2026-09-21 07:45:00",
        variableMeta: undefined,
        variables: undefined,
      },
      signal: controller.signal,
    });
  });

  it("does not automatically retry an expensive failed query", () => {
    const options = panelQueryOptions({
      kind: "ClickHouseSQL",
      sql: "SELECT 1",
    });

    expect(options.retry).toBe(false);
  });
});

describe("variableOptionsQueryOptions", () => {
  it("forwards cancellation and does not retry", async () => {
    const controller = new AbortController();
    const options = variableOptionsQueryOptions(
      "SELECT DISTINCT ServiceName FROM traces",
      "2026-09-21 07:15:00",
      "2026-09-21 07:45:00",
    );

    await options.queryFn?.({ signal: controller.signal } as never);

    expect(mockedRunVariableOptionsQuery).toHaveBeenCalledWith({
      data: {
        query: "SELECT DISTINCT ServiceName FROM traces",
        from: "2026-09-21 07:15:00",
        to: "2026-09-21 07:45:00",
      },
      signal: controller.signal,
    });
    expect(options.retry).toBe(false);
  });
});
