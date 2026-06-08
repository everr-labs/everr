import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db/client";
import { query as clickhouseQuery } from "@/lib/clickhouse";

// ---------------------------------------------------------------------------
// Mock the db client with a chainable fluent builder.
// Individual tests configure `selectImpl` / `updateImpl` / `insertImpl` /
// `deleteImpl` to return whatever data they need.
// ---------------------------------------------------------------------------

let selectImpl: () => unknown = () => undefined;
let updateImpl: () => unknown = () => ({ returning: () => [] });
let insertImpl: () => unknown = () => [{ slug: "aaaaaaaaaaaa" }];
let deleteImpl: () => unknown = () => [];

vi.mock("@/db/client", () => {
  const selectChain = {
    from: vi.fn(() => selectChain),
    where: vi.fn(() => selectChain),
    limit: vi.fn(() => selectImpl()),
  };
  const updateChain = {
    set: vi.fn(() => updateChain),
    where: vi.fn(() => updateImpl()),
  };
  const insertChain = {
    values: vi.fn(() => insertChain),
    returning: vi.fn(() => insertImpl()),
  };
  const deleteChain = {
    where: vi.fn(() => deleteImpl()),
  };
  return {
    db: {
      select: vi.fn(() => selectChain),
      update: vi.fn(() => updateChain),
      insert: vi.fn(() => insertChain),
      delete: vi.fn(() => deleteChain),
      transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({
          insert: vi.fn(() => insertChain),
          update: vi.fn(() => updateChain),
          delete: vi.fn(() => deleteChain),
        }),
      ),
    },
  };
});

vi.mock("@/db/schema", () => ({
  dashboards: {
    id: "id",
    organizationId: "organization_id",
    slug: "slug",
    source: "source",
    folderPath: "folder_path",
    updatedAt: "updated_at",
    spec: "spec",
  },
}));

import {
  getDashboard,
  listDashboards,
  runPanelQuery,
  runVariableOptionsQuery,
} from "./server";

const mockedDb = vi.mocked(db);
const mockedClickhouse = vi.mocked(clickhouseQuery);

beforeEach(() => {
  vi.clearAllMocks();
  selectImpl = () => undefined;
  updateImpl = () => ({ returning: () => [] });
  insertImpl = () => [{ slug: "aaaaaaaaaaaa" }];
  deleteImpl = () => [];
});

// ---------------------------------------------------------------------------
// runPanelQuery – variable interpolation
// ---------------------------------------------------------------------------

describe("runPanelQuery – variable interpolation", () => {
  it("interpolates variables into the SQL before executing", async () => {
    mockedClickhouse.mockResolvedValue([]);

    await runPanelQuery({
      data: {
        sql: "SELECT * FROM logs WHERE service = $service AND env IN $env",
        variables: { service: "api", env: ["prod", "staging"] },
      },
    });

    expect(mockedClickhouse).toHaveBeenCalledTimes(1);
    expect(mockedClickhouse.mock.calls[0]![0]).toBe(
      "SELECT * FROM logs WHERE service = 'api' AND env IN ('prod','staging')",
    );
  });

  it("expands the All sentinel using variableMeta options", async () => {
    mockedClickhouse.mockResolvedValue([]);

    await runPanelQuery({
      data: {
        sql: "SELECT * FROM logs WHERE env IN $env",
        variables: { env: "__all" },
        variableMeta: { env: { options: ["prod", "staging"] } },
      },
    });

    expect(mockedClickhouse.mock.calls[0]![0]).toBe(
      "SELECT * FROM logs WHERE env IN ('prod','staging')",
    );
  });

  it("runs the SQL unchanged when no variables are provided", async () => {
    mockedClickhouse.mockResolvedValue([]);

    await runPanelQuery({ data: { sql: "SELECT $notavar FROM logs" } });

    expect(mockedClickhouse.mock.calls[0]![0]).toBe(
      "SELECT $notavar FROM logs",
    );
  });
});

// ---------------------------------------------------------------------------
// runVariableOptionsQuery
// ---------------------------------------------------------------------------

describe("runVariableOptionsQuery", () => {
  it("returns stringified, deduped first-column values in query order", async () => {
    mockedClickhouse.mockResolvedValue([
      { service: "api", count: 10 },
      { service: "web", count: 20 },
      { service: "api", count: 30 },
      { service: 42, count: 40 },
    ]);

    const result = await runVariableOptionsQuery({
      data: { query: "SELECT service FROM logs GROUP BY service" },
    });

    expect(result).toEqual({ options: ["api", "web", "42"], truncated: false });
  });

  it("caps options at 1000 unique values and sets the truncated flag", async () => {
    mockedClickhouse.mockResolvedValue(
      Array.from({ length: 1100 }, (_, i) => ({ v: `service-${i}` })),
    );

    const result = await runVariableOptionsQuery({ data: { query: "q" } });

    expect(result.options).toHaveLength(1000);
    expect(result.options[0]).toBe("service-0");
    expect(result.options[999]).toBe("service-999");
    expect(result.truncated).toBe(true);
  });

  it("does not set truncated when exactly at the cap after dedup", async () => {
    const rows = [
      ...Array.from({ length: 1000 }, (_, i) => ({ v: `s-${i}` })),
      // duplicates beyond the cap do not count as new values
      { v: "s-0" },
      { v: "s-1" },
    ];
    mockedClickhouse.mockResolvedValue(rows);

    const result = await runVariableOptionsQuery({ data: { query: "q" } });

    expect(result.options).toHaveLength(1000);
    expect(result.truncated).toBe(false);
  });

  it("skips rows with no columns and stringifies null values", async () => {
    mockedClickhouse.mockResolvedValue([{}, { v: null }, { v: "a" }]);

    const result = await runVariableOptionsQuery({ data: { query: "q" } });

    expect(result).toEqual({ options: ["null", "a"], truncated: false });
  });
});

// ---------------------------------------------------------------------------
// getDashboard (source/slug)
// ---------------------------------------------------------------------------

describe("getDashboard (source/slug)", () => {
  it("looks up by org + source + slug and returns the Perses document", async () => {
    selectImpl = () => [{ slug: "cpu", spec: { panels: {}, layouts: [] } }];
    const result = await getDashboard({
      data: { source: "team", slug: "cpu" },
    });
    expect(result).toEqual({
      kind: "Dashboard",
      metadata: { name: "cpu" },
      spec: { panels: {}, layouts: [] },
    });
  });

  it("throws when not found", async () => {
    selectImpl = () => [];
    await expect(
      getDashboard({ data: { source: "team", slug: "missing" } }),
    ).rejects.toThrow(/not found/);
  });
});

// ---------------------------------------------------------------------------
// listDashboards (with source + folderPath)
// ---------------------------------------------------------------------------

describe("listDashboards (with source + folderPath)", () => {
  it("returns slug, source, name and folderPath", async () => {
    mockedDb.select.mockImplementationOnce(
      () =>
        ({
          from: () => ({
            where: () =>
              Promise.resolve([
                {
                  slug: "cpu",
                  source: "team",
                  folderPath: "Infra",
                  displayName: "CPU",
                },
              ]),
          }),
        }) as unknown as ReturnType<typeof mockedDb.select>,
    );
    const rows = await listDashboards();
    expect(rows).toEqual([
      { slug: "cpu", source: "team", name: "CPU", folderPath: "Infra" },
    ]);
  });
});
