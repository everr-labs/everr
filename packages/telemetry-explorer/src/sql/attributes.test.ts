import { describe, expect, it } from "vitest";
import {
  attributeColumn,
  ERRORS_ATTRIBUTE_SCHEMA,
  LOGS_ATTRIBUTE_SCHEMA,
  TRACES_ATTRIBUTE_SCHEMA,
} from "./attributes";

describe("attributeColumn", () => {
  it("maps each source to its ClickHouse column", () => {
    expect(attributeColumn("resource")).toBe("ResourceAttributes");
    expect(attributeColumn("log")).toBe("LogAttributes");
    expect(attributeColumn("scope")).toBe("ScopeAttributes");
    expect(attributeColumn("span")).toBe("SpanAttributes");
  });
});

describe("signal attribute schemas", () => {
  it("exposes each signal's sources", () => {
    expect(LOGS_ATTRIBUTE_SCHEMA.sources).toEqual(["resource", "log", "scope"]);
    expect(ERRORS_ATTRIBUTE_SCHEMA.sources).toEqual([
      "resource",
      "log",
      "scope",
    ]);
    expect(TRACES_ATTRIBUTE_SCHEMA.sources).toEqual(["resource", "span"]);
  });

  it("resolves columns for exposed sources", () => {
    expect(LOGS_ATTRIBUTE_SCHEMA.columnFor("log")).toBe("LogAttributes");
    expect(TRACES_ATTRIBUTE_SCHEMA.columnFor("span")).toBe("SpanAttributes");
  });

  it("rejects a source the signal does not expose", () => {
    expect(() => TRACES_ATTRIBUTE_SCHEMA.columnFor("log")).toThrow(
      /unknown traces attribute source/i,
    );
    // @ts-expect-error testing runtime guard with an invalid source
    expect(() => LOGS_ATTRIBUTE_SCHEMA.columnFor("bogus")).toThrow(
      /unknown logs attribute source/i,
    );
  });
});
