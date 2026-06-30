import { describe, expect, it } from "vitest";
import {
  breadcrumbSegments,
  buildTree,
  type DashboardSummary,
  nodeAtPath,
} from "./tree";

const d = (
  slug: string,
  project: string,
  name: string,
  folderPath: string,
  updatedAt = "2026-01-01T00:00:00.000Z",
): DashboardSummary => ({ slug, project, name, folderPath, updatedAt });

describe("buildTree (folder paths)", () => {
  it("nests dashboards by their folderPath segments", () => {
    const tree = buildTree([
      d("cpu", "team", "CPU", "Infra / Compute"),
      d("root", "team", "Root", ""),
    ]);
    expect(tree.dashboards.map((x) => x.slug)).toEqual(["root"]);
    expect(tree.folders[0]?.name).toBe("Infra");
    expect(tree.folders[0]?.subfolders[0]?.name).toBe("Compute");
    expect(tree.folders[0]?.subfolders[0]?.dashboards[0]?.slug).toBe("cpu");
  });

  it("merges dashboards from different projects into the same folder", () => {
    const tree = buildTree([
      d("a", "x", "A", "Shared"),
      d("b", "y", "B", "Shared"),
    ]);
    expect(tree.folders).toHaveLength(1);
    expect(tree.folders[0]?.dashboards.map((x) => x.slug).sort()).toEqual([
      "a",
      "b",
    ]);
  });
});

describe("buildTree (sorting)", () => {
  it("sorts root items by name by default", () => {
    const tree = buildTree([
      d("b", "t", "Beta", "", "2026-01-01T00:00:00.000Z"),
      d("a", "t", "Alpha", "", "2026-06-01T00:00:00.000Z"),
    ]);
    expect(tree.dashboards.map((x) => x.name)).toEqual(["Alpha", "Beta"]);
  });

  it("sorts items by most-recently-updated when sort='updated'", () => {
    const tree = buildTree(
      [
        d("a", "t", "Alpha", "", "2026-01-01T00:00:00.000Z"),
        d("b", "t", "Beta", "", "2026-06-01T00:00:00.000Z"),
      ],
      "updated",
    );
    expect(tree.dashboards.map((x) => x.name)).toEqual(["Beta", "Alpha"]);
  });

  it("sorts items inside folders by the chosen key", () => {
    const tree = buildTree(
      [
        d("a", "t", "Alpha", "Infra", "2026-01-01T00:00:00.000Z"),
        d("b", "t", "Beta", "Infra", "2026-06-01T00:00:00.000Z"),
      ],
      "updated",
    );
    expect(tree.folders[0]?.dashboards.map((x) => x.name)).toEqual([
      "Beta",
      "Alpha",
    ]);
  });
});

describe("nodeAtPath", () => {
  const tree = buildTree([
    d("cpu", "team", "CPU", "Infra / Compute"),
    d("mem", "team", "Mem", "Infra"),
  ]);

  it("returns null for an empty path", () => {
    expect(nodeAtPath(tree, "")).toBeNull();
  });

  it("finds a top-level folder", () => {
    expect(nodeAtPath(tree, "Infra")?.name).toBe("Infra");
  });

  it("finds a nested folder", () => {
    expect(nodeAtPath(tree, "Infra / Compute")?.name).toBe("Compute");
  });

  it("returns null for a missing path", () => {
    expect(nodeAtPath(tree, "Infra / Nope")).toBeNull();
  });
});

describe("breadcrumbSegments", () => {
  it("returns [] for an empty path", () => {
    expect(breadcrumbSegments("")).toEqual([]);
  });

  it("builds cumulative segments", () => {
    expect(breadcrumbSegments("Infra / Compute")).toEqual([
      { name: "Infra", path: "Infra" },
      { name: "Compute", path: "Infra / Compute" },
    ]);
  });
});
