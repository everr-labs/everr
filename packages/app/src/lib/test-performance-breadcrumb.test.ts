import { describe, expect, it } from "vitest";
import { buildTestPerformanceBreadcrumb } from "./test-performance-breadcrumb";

describe("buildTestPerformanceBreadcrumb", () => {
  it("returns root label when pkg/path are missing", () => {
    expect(buildTestPerformanceBreadcrumb({})).toBe("Tests Overview");
  });

  it("returns root and pkg segments when pkg is set", () => {
    const result = buildTestPerformanceBreadcrumb({ pkg: "my-pkg" });
    expect(result).toEqual([
      {
        label: "Tests Overview",
        search: { pkg: undefined, path: undefined },
      },
      { label: "my-pkg", search: { pkg: "my-pkg", path: undefined } },
    ]);
  });

  it("builds nested vitest segments", () => {
    const result = buildTestPerformanceBreadcrumb({
      pkg: "my-pkg",
      path: "my-pkg > Describe > does thing",
    });

    expect(result).toEqual([
      {
        label: "Tests Overview",
        search: { pkg: undefined, path: undefined },
      },
      { label: "my-pkg", search: { pkg: "my-pkg", path: undefined } },
      {
        label: "Describe",
        search: { pkg: "my-pkg", path: "my-pkg > Describe" },
      },
      {
        label: "does thing",
        search: { pkg: "my-pkg", path: "my-pkg > Describe > does thing" },
      },
    ]);
  });

  it("builds nested go-style segments", () => {
    const result = buildTestPerformanceBreadcrumb({
      pkg: "pkg",
      path: "Suite/SubTest",
    });

    expect(result).toEqual([
      {
        label: "Tests Overview",
        search: { pkg: undefined, path: undefined },
      },
      { label: "pkg", search: { pkg: "pkg", path: undefined } },
      { label: "Suite", search: { pkg: "pkg", path: "Suite" } },
      { label: "SubTest", search: { pkg: "pkg", path: "Suite/SubTest" } },
    ]);
  });

  it("builds nested rust-style segments", () => {
    const result = buildTestPerformanceBreadcrumb({
      pkg: "everr_core",
      path: "assistant::tests::sync_assistants_updates_only_selected_targets",
    });

    expect(result).toEqual([
      {
        label: "Tests Overview",
        search: { pkg: undefined, path: undefined },
      },
      { label: "everr_core", search: { pkg: "everr_core", path: undefined } },
      { label: "assistant", search: { pkg: "everr_core", path: "assistant" } },
      {
        label: "tests",
        search: { pkg: "everr_core", path: "assistant::tests" },
      },
      {
        label: "sync_assistants_updates_only_selected_targets",
        search: {
          pkg: "everr_core",
          path: "assistant::tests::sync_assistants_updates_only_selected_targets",
        },
      },
    ]);
  });
});
