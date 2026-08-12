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

import { executePanelSql, getDashboard, listDashboards } from "./server";

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
// executePanelSql — the cloud half of the panel SqlClient seam.
// Interpolation, param binding and the options row cap now live in
// PanelRepository (see repository.test.ts); what is left to prove here is that
// panel SQL still reaches the per-org SQL API user, tenant filter and all.
// ---------------------------------------------------------------------------

describe("executePanelSql", () => {
  it("runs the SQL as the per-org SQL API user and returns its rows", async () => {
    mockedClickhouse.mockResolvedValueOnce([{ n: 1 }]);

    const result = await executePanelSql({
      data: { sql: "SELECT 1 AS n", params: { from: "a", to: "b", step: 60 } },
    });

    expect(result).toEqual({ rows: [{ n: 1 }] });
    expect(mockedClickhouse).toHaveBeenCalledTimes(1);
    const [sql, orgId, params] = mockedClickhouse.mock.calls[0] ?? [];
    expect(sql).toBe("SELECT 1 AS n");
    expect(orgId).toBe("test_org");
    expect(params).toEqual({ from: "a", to: "b", step: 60 });
  });
});
