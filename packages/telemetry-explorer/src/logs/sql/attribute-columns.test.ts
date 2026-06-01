import { describe, expect, it } from "vitest";
import { ATTRIBUTE_SOURCES, attributeColumn } from "./attribute-columns";

describe("attributeColumn", () => {
  it("maps each source to its ClickHouse column", () => {
    expect(attributeColumn("resource")).toBe("ResourceAttributes");
    expect(attributeColumn("log")).toBe("LogAttributes");
    expect(attributeColumn("scope")).toBe("ScopeAttributes");
  });

  it("throws on an unknown source", () => {
    // @ts-expect-error testing runtime guard with an invalid source
    expect(() => attributeColumn("bogus")).toThrow(/unknown attribute source/i);
  });

  it("exposes every source", () => {
    expect(ATTRIBUTE_SOURCES).toEqual(["resource", "log", "scope"]);
  });
});
