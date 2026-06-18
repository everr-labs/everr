import { describe, expect, it } from "vitest";
import type { AttributeFilter } from "../attribute-filter/schemas";
import { environmentFilter, withEnvironment } from "./environment";

describe("environmentFilter", () => {
  it("returns null when no environments are selected", () => {
    expect(environmentFilter([])).toBeNull();
  });

  it("builds a deployment.environment resource 'in' filter", () => {
    expect(environmentFilter(["prod", "staging"])).toEqual({
      source: "resource",
      key: "deployment.environment",
      op: "in",
      values: ["prod", "staging"],
    });
  });
});

describe("withEnvironment", () => {
  const base: AttributeFilter[] = [
    { source: "log", key: "http.method", op: "in", values: ["GET"] },
  ];

  it("returns the original array reference when no environment selected", () => {
    expect(withEnvironment(base, [])).toBe(base);
  });

  it("appends the environment filter without mutating the input", () => {
    const result = withEnvironment(base, ["prod"]);
    expect(result).toEqual([
      ...base,
      {
        source: "resource",
        key: "deployment.environment",
        op: "in",
        values: ["prod"],
      },
    ]);
    expect(base).toHaveLength(1);
  });
});
