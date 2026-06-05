import { describe, expect, it } from "vitest";
import {
  buildTree,
  countFolderContents,
  type DashboardSummary,
  descendantFolderIds,
  type FolderSummary,
  flattenFolders,
  folderPath,
  searchItems,
} from "./tree";

const folders: FolderSummary[] = [
  { id: "f-prod", parentId: null, name: "Production" },
  { id: "f-api", parentId: "f-prod", name: "API" },
  { id: "f-staging", parentId: null, name: "Staging" },
];

const dashboards: DashboardSummary[] = [
  { slug: "request-rate", name: "Request Rate", folderId: "f-api" },
  { slug: "error-budget", name: "Error Budget", folderId: "f-api" },
  { slug: "overview", name: "Overview", folderId: "f-prod" },
  { slug: "scratch", name: "Scratch", folderId: null },
];

describe("buildTree", () => {
  it("nests folders by parentId and dashboards by folderId", () => {
    const tree = buildTree(folders, dashboards);
    expect(tree.folders.map((n) => n.folder.id)).toEqual([
      "f-prod",
      "f-staging",
    ]);
    const prod = tree.folders[0];
    expect(prod?.subfolders.map((n) => n.folder.id)).toEqual(["f-api"]);
    expect(prod?.dashboards.map((d) => d.slug)).toEqual(["overview"]);
    expect(prod?.subfolders[0]?.dashboards.map((d) => d.slug)).toEqual([
      "error-budget",
      "request-rate",
    ]);
    expect(tree.dashboards.map((d) => d.slug)).toEqual(["scratch"]);
  });

  it("sorts folders and dashboards alphabetically within a level", () => {
    const tree = buildTree(
      [
        { id: "b", parentId: null, name: "Bravo" },
        { id: "a", parentId: null, name: "alpha" },
      ],
      [
        { slug: "z", name: "Zulu", folderId: null },
        { slug: "y", name: "yankee", folderId: null },
      ],
    );
    expect(tree.folders.map((n) => n.folder.name)).toEqual(["alpha", "Bravo"]);
    expect(tree.dashboards.map((d) => d.name)).toEqual(["yankee", "Zulu"]);
  });

  it("places orphaned items at root instead of dropping them", () => {
    const tree = buildTree(
      [{ id: "f-lost", parentId: "missing", name: "Lost" }],
      [{ slug: "d-lost", name: "Lost Dash", folderId: "missing" }],
    );
    expect(tree.folders.map((n) => n.folder.id)).toEqual(["f-lost"]);
    expect(tree.dashboards.map((d) => d.slug)).toEqual(["d-lost"]);
  });
});

describe("flattenFolders", () => {
  it("returns depth-first order with depths", () => {
    expect(
      flattenFolders(folders).map(({ folder, depth }) => [folder.id, depth]),
    ).toEqual([
      ["f-prod", 0],
      ["f-api", 1],
      ["f-staging", 0],
    ]);
  });
});

describe("descendantFolderIds", () => {
  it("includes the folder itself and all descendants", () => {
    const deep: FolderSummary[] = [
      ...folders,
      { id: "f-api-internal", parentId: "f-api", name: "Internal" },
    ];
    expect(descendantFolderIds(deep, "f-prod")).toEqual(
      new Set(["f-prod", "f-api", "f-api-internal"]),
    );
    expect(descendantFolderIds(deep, "f-staging")).toEqual(
      new Set(["f-staging"]),
    );
  });
});

describe("countFolderContents", () => {
  it("counts dashboards and subfolders recursively", () => {
    expect(countFolderContents(folders, dashboards, "f-prod")).toEqual({
      folders: 1,
      dashboards: 3,
    });
    expect(countFolderContents(folders, dashboards, "f-staging")).toEqual({
      folders: 0,
      dashboards: 0,
    });
  });
});

describe("folderPath", () => {
  it("joins ancestor names from root", () => {
    expect(folderPath(folders, "f-api")).toBe("Production / API");
    expect(folderPath(folders, "f-prod")).toBe("Production");
    expect(folderPath(folders, null)).toBe("");
  });
});

describe("searchItems", () => {
  it("matches dashboards and folders case-insensitively with paths", () => {
    const result = searchItems(folders, dashboards, "rate");
    expect(result.dashboards.map((m) => m.dashboard.slug)).toEqual([
      "request-rate",
    ]);
    expect(result.dashboards[0]?.path).toBe("Production / API");
    expect(result.folders).toEqual([]);

    const folderResult = searchItems(folders, dashboards, "api");
    expect(folderResult.folders.map((m) => m.folder.id)).toEqual(["f-api"]);
    expect(folderResult.folders[0]?.path).toBe("Production");
  });
});
