import { describe, expect, it } from "vitest";
import { formatResourceName, parseResourceName } from "./identity";

describe("resource names", () => {
  it("formats project/slug explicitly, including default", () => {
    expect(formatResourceName("default", "api-errors")).toBe(
      "default/api-errors",
    );
    expect(formatResourceName("payments", "checkout")).toBe(
      "payments/checkout",
    );
  });

  it("parses on the first slash", () => {
    expect(parseResourceName("payments/checkout")).toEqual({
      project: "payments",
      slug: "checkout",
    });
    expect(parseResourceName("default/a/b")).toEqual({
      project: "default",
      slug: "a/b",
    });
  });

  it("rejects non-canonical names", () => {
    expect(() => parseResourceName("rule-ab12cd34")).toThrow(
      "invalid resource name",
    );
  });
});
