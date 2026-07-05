import { isNotFound } from "@tanstack/react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db/client";
import { querySqlApi } from "@/lib/clickhouse";

// Spy on `eq`/`isNull` while keeping every other drizzle-orm export real, so
// the live-mode filter (`isNull(dashboards.previewId)`) is assertable without
// hand-rolling a fake SQL builder for the rest of the query.
vi.mock("drizzle-orm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("drizzle-orm")>();
  return { ...actual, eq: vi.fn(actual.eq), isNull: vi.fn(actual.isNull) };
});

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
    leftJoin: vi.fn(() => selectChain),
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
    repoid: "repoid",
    previewId: "preview_id",
    slug: "slug",
    project: "project",
    folderPath: "folder_path",
    updatedAt: "updated_at",
    document: "document",
  },
  previews: {
    id: "previews.id",
    organizationId: "organization_id",
    repoid: "repoid",
    name: "name",
    lastAppliedAt: "last_applied_at",
  },
}));

import {
  getDashboard,
  listDashboards,
  runPanelQuery,
  runVariableOptionsQuery,
} from "./server";

const mockedDb = vi.mocked(db);
const mockedClickhouse = vi.mocked(querySqlApi);

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
        source: {
          kind: "ClickHouseSQL",
          sql: "SELECT * FROM logs WHERE service = $service AND env IN $env",
        },
        variables: { service: "api", env: ["prod", "staging"] },
      },
    });

    expect(mockedClickhouse).toHaveBeenCalledTimes(1);
    expect(mockedClickhouse.mock.calls[0]![0]).toBe(
      "SELECT * FROM logs WHERE service = 'api' AND env IN ('prod','staging')",
    );
    // User SQL must run through the per-org SQL API user (row-policy tenant
    // isolation), scoped to the active org — not the SETTINGS-based app path.
    expect(mockedClickhouse.mock.calls[0]![1]).toBe("test_org");
  });

  it("expands the All sentinel using variableMeta options", async () => {
    mockedClickhouse.mockResolvedValue([]);

    await runPanelQuery({
      data: {
        source: {
          kind: "ClickHouseSQL",
          sql: "SELECT * FROM logs WHERE env IN $env",
        },
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

    await runPanelQuery({
      data: {
        source: { kind: "ClickHouseSQL", sql: "SELECT $notavar FROM logs" },
      },
    });

    expect(mockedClickhouse.mock.calls[0]![0]).toBe(
      "SELECT $notavar FROM logs",
    );
  });

  it("binds from/to and an adaptive {step} bucket as query params", async () => {
    mockedClickhouse.mockResolvedValue([]);

    await runPanelQuery({
      data: { source: { kind: "ClickHouseSQL", sql: "SELECT 1" } },
    });

    const params = mockedClickhouse.mock.calls[0]![2] as Record<
      string,
      unknown
    >;
    expect(typeof params.from).toBe("string");
    expect(typeof params.to).toBe("string");
    // Default range is now-7d..now → 604800s / 500 = 1209.6 → snapped to 30m.
    expect(params.step).toBe(1800);
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

  it("binds the same from/to/step params as a panel query", async () => {
    // The docs promise the parameters are always available; an options query
    // referencing {step}/{from}/{to} must not error where a panel wouldn't.
    mockedClickhouse.mockResolvedValue([]);

    await runVariableOptionsQuery({
      data: { query: "SELECT DISTINCT ServiceName FROM traces" },
    });

    const params = mockedClickhouse.mock.calls[0]![2] as Record<
      string,
      unknown
    >;
    expect(typeof params.from).toBe("string");
    expect(typeof params.to).toBe("string");
    expect(params.step).toBe(1800); // default now-7d..now → 30m
  });

  it("injects a LIMIT so the SQL API profile never throws on overflow", async () => {
    // The profile caps results at 1000 with result_overflow_mode='throw', so the
    // bound must be in the SQL — wrap the user query and LIMIT the outer select.
    mockedClickhouse.mockResolvedValue([]);

    await runVariableOptionsQuery({
      data: { query: "SELECT DISTINCT ServiceName FROM traces ORDER BY 1;" },
    });

    const sql = mockedClickhouse.mock.calls[0]![0] as string;
    expect(sql).toContain("SELECT DISTINCT ServiceName FROM traces ORDER BY 1");
    expect(sql).not.toContain(";"); // trailing semicolon stripped before wrapping
    expect(sql).toMatch(/\)\s*LIMIT 1000$/);
  });

  it("sets truncated when the result comes back full (cap hit)", async () => {
    // ClickHouse returns at most the injected LIMIT; a full set means it cut more.
    mockedClickhouse.mockResolvedValue(
      Array.from({ length: 1000 }, (_, i) => ({ v: `service-${i}` })),
    );

    const result = await runVariableOptionsQuery({ data: { query: "q" } });

    expect(result.options).toHaveLength(1000);
    expect(result.options[0]).toBe("service-0");
    expect(result.options[999]).toBe("service-999");
    expect(result.truncated).toBe(true);
  });

  it("does not set truncated when the result is under the cap", async () => {
    const rows = [
      { v: "a" },
      { v: "b" },
      { v: "a" }, // duplicates dedup away but do not affect truncation
    ];
    mockedClickhouse.mockResolvedValue(rows);

    const result = await runVariableOptionsQuery({ data: { query: "q" } });

    expect(result.options).toEqual(["a", "b"]);
    expect(result.truncated).toBe(false);
  });

  it("skips rows with no columns and stringifies null values", async () => {
    mockedClickhouse.mockResolvedValue([{}, { v: null }, { v: "a" }]);

    const result = await runVariableOptionsQuery({ data: { query: "q" } });

    expect(result).toEqual({ options: ["null", "a"], truncated: false });
  });
});

// ---------------------------------------------------------------------------
// getDashboard (project/slug)
// ---------------------------------------------------------------------------

describe("getDashboard (project/slug)", () => {
  it("returns the stored document verbatim, including unknown fields", async () => {
    const document = {
      kind: "Dashboard",
      metadata: { name: "cpu" },
      spec: { panels: {}, layouts: [] },
      apiVersion: "perses.dev/v1",
    };
    selectImpl = () => [{ document }];
    const result = await getDashboard({
      data: { project: "team", slug: "cpu" },
    });
    expect(result).toEqual({ document, previewStatus: undefined });
  });

  it("throws a notFound when the dashboard is missing", async () => {
    selectImpl = () => [];
    const error = await getDashboard({
      data: { project: "team", slug: "missing" },
    }).then(
      () => null,
      (e) => e,
    );
    expect(isNotFound(error)).toBe(true);
  });

  it("in live mode, only reads rows with preview = ''", async () => {
    const document = {
      kind: "Dashboard",
      metadata: { name: "cpu" },
      spec: { panels: {}, layouts: [] },
      apiVersion: "perses.dev/v1",
    };
    selectImpl = () => [{ document }];
    const { isNull } = await import("drizzle-orm");
    await getDashboard({ data: { project: "team", slug: "cpu" } });

    expect(isNull).toHaveBeenCalledWith("preview_id");
  });

  it("in preview mode, overlays preview rows and tags a 'changed' result", async () => {
    mockedDb.select
      // getCoveredRepoids
      .mockImplementationOnce(
        () =>
          ({
            from: () => ({
              where: () => Promise.resolve([{ repoid: "repo-1" }]),
            }),
          }) as unknown as ReturnType<typeof mockedDb.select>,
      )
      // dashboards rows (live + preview): repoid/preview come coalesced from the
      // registry join, so the read path uses .from().leftJoin().where().
      .mockImplementationOnce(
        () =>
          ({
            from: () => ({
              leftJoin: () => ({
                where: () =>
                  Promise.resolve([
                    {
                      repoid: "repo-1",
                      previewId: null,
                      project: "team",
                      slug: "cpu",
                      folderPath: "",
                      document: {
                        kind: "Dashboard",
                        metadata: { name: "cpu" },
                        spec: {
                          panels: {},
                          layouts: [],
                          display: { name: "v1" },
                        },
                      },
                    },
                    {
                      repoid: "repo-1",
                      previewId: "prev-1",
                      project: "team",
                      slug: "cpu",
                      folderPath: "",
                      document: {
                        kind: "Dashboard",
                        metadata: { name: "cpu" },
                        spec: {
                          panels: {},
                          layouts: [],
                          display: { name: "v2" },
                        },
                      },
                    },
                  ]),
              }),
            }),
          }) as unknown as ReturnType<typeof mockedDb.select>,
      );

    const result = await getDashboard({
      data: { project: "team", slug: "cpu", preview: "gio/branch" },
    });

    expect(result.previewStatus).toBe("changed");
    expect(result.document.spec.display?.name).toBe("v2");
  });
});

// ---------------------------------------------------------------------------
// listDashboards (with project + folderPath)
// ---------------------------------------------------------------------------

describe("listDashboards (with project + folderPath)", () => {
  it("returns slug, project, name and folderPath", async () => {
    mockedDb.select.mockImplementationOnce(
      () =>
        ({
          from: () => ({
            where: () =>
              Promise.resolve([
                {
                  slug: "cpu",
                  project: "team",
                  folderPath: "Infra",
                  displayName: "CPU",
                },
              ]),
          }),
        }) as unknown as ReturnType<typeof mockedDb.select>,
    );
    const rows = await listDashboards();
    expect(rows).toEqual([
      { slug: "cpu", project: "team", name: "CPU", folderPath: "Infra" },
    ]);
  });

  it("in live mode, only reads rows with preview = ''", async () => {
    mockedDb.select.mockImplementationOnce(
      () =>
        ({
          from: () => ({ where: () => Promise.resolve([]) }),
        }) as unknown as ReturnType<typeof mockedDb.select>,
    );
    const { isNull } = await import("drizzle-orm");
    await listDashboards();

    expect(isNull).toHaveBeenCalledWith("preview_id");
  });
});

// ---------------------------------------------------------------------------
// runPanelQuery – TestData source
// ---------------------------------------------------------------------------

describe("runPanelQuery – TestData", () => {
  it("generates synthetic rows without touching ClickHouse", async () => {
    const { rows } = await runPanelQuery({
      data: {
        source: {
          kind: "TestData",
          spec: { scenario: "csv", columns: ["a", "b"], rows: [["x", 1]] },
        },
      },
    });
    expect(rows).toEqual([{ a: "x", b: 1 }]);
    expect(mockedClickhouse).not.toHaveBeenCalled();
  });

  it("spans the resolved time range for a random_walk scenario", async () => {
    const { rows } = await runPanelQuery({
      data: {
        source: {
          kind: "TestData",
          spec: { scenario: "random_walk", seed: 1, series: [{ name: "v" }] },
        },
        from: "2026-06-10 00:00:00",
        to: "2026-06-10 00:10:00",
      },
    });
    expect(rows.length).toBeGreaterThan(0);
    expect(Object.keys(rows[0])).toContain("ts");
    expect(Object.keys(rows[0])).toContain("v");
  });
});
