import { describe, expect, it } from "vite-plus/test";
import { logsAttributeColumn } from "./attribute-columns";

describe("logsAttributeColumn", () => {
  it("maps each source to its ClickHouse column", () => {
    expect(logsAttributeColumn("resource")).toBe("ResourceAttributes");
    expect(logsAttributeColumn("log")).toBe("LogAttributes");
    expect(logsAttributeColumn("scope")).toBe("ScopeAttributes");
  });

  it("throws on an unknown source", () => {
    // @ts-expect-error testing runtime guard with an invalid source
    expect(() => logsAttributeColumn("bogus")).toThrow(/unknown logs attribute source/i);
  });
});
