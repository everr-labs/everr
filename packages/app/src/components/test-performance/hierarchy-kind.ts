import type { TestPerfChild } from "@/data/test-performance";

export type TestPerfHierarchyKind = "package" | "suite" | "test";

export function getTestPerfHierarchyKind(
  row: Pick<TestPerfChild, "isSuite">,
  scopePkg?: string,
): TestPerfHierarchyKind {
  if (!scopePkg) {
    return "package";
  }

  return row.isSuite ? "suite" : "test";
}

export function getTestPerfHierarchyKindLabel(
  kind: TestPerfHierarchyKind,
): string {
  switch (kind) {
    case "package":
      return "Package";
    case "suite":
      return "Test Suite";
    case "test":
      return "Test";
  }
}

export function getTestPerfHierarchyKindBadgeLabel(
  kind: TestPerfHierarchyKind,
): string {
  switch (kind) {
    case "package":
      return "Pkg";
    case "suite":
      return "Suite";
    case "test":
      return "Test";
  }
}
