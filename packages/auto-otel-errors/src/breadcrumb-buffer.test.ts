import { describe, expect, it } from "vitest";
import { BreadcrumbBuffer } from "./breadcrumb-buffer.js";
import type { Breadcrumb } from "./types.js";

function crumb(message: string, traceId?: string): Breadcrumb {
  return { timestamp: Date.now(), category: "test", message, traceId };
}

describe("BreadcrumbBuffer", () => {
  it("evicts oldest entries beyond maxEntries", () => {
    const buffer = new BreadcrumbBuffer(2);
    buffer.add(crumb("a"));
    buffer.add(crumb("b"));
    buffer.add(crumb("c"));
    expect(buffer.all().map((c) => c.message)).toEqual(["b", "c"]);
  });

  it("filtered returns matching-trace and untagged entries", () => {
    const buffer = new BreadcrumbBuffer(10);
    buffer.add(crumb("ambient"));
    buffer.add(crumb("mine", "trace-1"));
    buffer.add(crumb("other", "trace-2"));
    expect(buffer.filtered("trace-1").map((c) => c.message)).toEqual([
      "ambient",
      "mine",
    ]);
  });

  it("filtered without a traceId returns only untagged entries", () => {
    const buffer = new BreadcrumbBuffer(10);
    buffer.add(crumb("ambient"));
    buffer.add(crumb("tagged", "trace-1"));
    expect(buffer.filtered(undefined).map((c) => c.message)).toEqual(["ambient"]);
  });

  it("clear empties the buffer", () => {
    const buffer = new BreadcrumbBuffer(10);
    buffer.add(crumb("a"));
    buffer.clear();
    expect(buffer.all()).toEqual([]);
  });
});
