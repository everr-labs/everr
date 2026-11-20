import { describe, expect, it } from "vite-plus/test";
import type { AttributeFilter } from "../attribute-filter/schemas";
import { withEnvironment } from "./environment";

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
        key: "deployment.environment.name",
        op: "in",
        values: ["prod"],
      },
    ]);
    expect(base).toHaveLength(1);
  });
});
