import { describe, expect, it } from "vitest";
import { buildTree, type DashboardSummary } from "./tree";

const d = (
  slug: string,
  project: string,
  name: string,
  folderPath: string,
): DashboardSummary => ({ slug, project, name, folderPath });

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
