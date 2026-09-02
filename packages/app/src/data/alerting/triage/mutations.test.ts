import { describe, expect, it, vi } from "vitest";

// Only so that importing the module for its pure half does not build a real
// database pool. The writes themselves are covered against real engines by
// mutations.integration.test.ts.
vi.mock("@/db/client", () => ({
  db: {},
  pool: {},
  runInTransaction: () => Promise.resolve(),
}));

import { parseMatchers } from "./mutations";

describe("the Matchers a person types into the Silence dialog", () => {
  it("reads a pair, whether it was separated by a space or by a comma", () => {
    expect(parseMatchers("service=checkout host=web-1")).toEqual([
      { label: "service", op: "eq", value: "checkout" },
      { label: "host", op: "eq", value: "web-1" },
    ]);
    expect(parseMatchers("service=checkout,host=web-1")).toEqual([
      { label: "service", op: "eq", value: "checkout" },
      { label: "host", op: "eq", value: "web-1" },
    ]);
  });

  it("reads nothing at all as no Matchers, which is the whole Alert rule", () => {
    expect(parseMatchers("")).toEqual([]);
    expect(parseMatchers("   ")).toEqual([]);
  });

  it("refuses a token that is not a pair, rather than widening the Silence", () => {
    expect(() => parseMatchers("service")).toThrow(/label=value/);
    expect(() => parseMatchers("=checkout")).toThrow(/label=value/);
    expect(() => parseMatchers("service=checkout host")).toThrow(/label=value/);
  });

  it("keeps an equals sign inside the value", () => {
    expect(parseMatchers("query=a=b")).toEqual([
      { label: "query", op: "eq", value: "a=b" },
    ]);
  });

  it("accepts an empty value, which selects a label that is present and blank", () => {
    expect(parseMatchers("host=")).toEqual([
      { label: "host", op: "eq", value: "" },
    ]);
  });
});
