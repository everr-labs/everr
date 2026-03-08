import { describe, expect, it } from "vitest";
import {
  getTestPerfHierarchyKind,
  getTestPerfHierarchyKindBadgeLabel,
  getTestPerfHierarchyKindLabel,
} from "./hierarchy-kind";

describe("getTestPerfHierarchyKind", () => {
  it("treats root nodes as packages even when they are expandable", () => {
    expect(getTestPerfHierarchyKind({ isSuite: true })).toBe("package");
  });

  it("treats expandable package children as test suites", () => {
    expect(getTestPerfHierarchyKind({ isSuite: true }, "pkg/auth")).toBe(
      "suite",
    );
  });

  it("treats non-expandable package children as tests", () => {
    expect(getTestPerfHierarchyKind({ isSuite: false }, "pkg/auth")).toBe(
      "test",
    );
  });
});

describe("hierarchy kind labels", () => {
  it("returns readable long labels for the tooltip", () => {
    expect(getTestPerfHierarchyKindLabel("package")).toBe("Package");
    expect(getTestPerfHierarchyKindLabel("suite")).toBe("Test Suite");
    expect(getTestPerfHierarchyKindLabel("test")).toBe("Test");
  });

  it("returns compact labels for treemap badges", () => {
    expect(getTestPerfHierarchyKindBadgeLabel("package")).toBe("Pkg");
    expect(getTestPerfHierarchyKindBadgeLabel("suite")).toBe("Suite");
    expect(getTestPerfHierarchyKindBadgeLabel("test")).toBe("Test");
  });
});
