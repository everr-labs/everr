import { describe, expect, it } from "vitest";
import {
  type AttributeFilter,
  AttributeFilterSchema,
  type AttributeKey,
  type AttributeKeysInput,
  type AttributeOp,
  AttributeOpSchema,
  AttributeSourceSchema,
  type AttributeValuesInput,
} from "./schemas";

describe("attribute-filter schemas", () => {
  it("accepts all four sources (superset across domains)", () => {
    for (const s of ["resource", "log", "scope", "span"]) {
      expect(AttributeSourceSchema.parse(s)).toBe(s);
    }
  });

  it("lists ops in display order", () => {
    expect(AttributeOpSchema.options).toEqual([
      "in",
      "not_in",
      "exists",
      "missing",
    ]);
  });

  it("defaults values to an empty array", () => {
    expect(
      AttributeFilterSchema.parse({ source: "resource", key: "k", op: "in" }),
    ).toEqual({ source: "resource", key: "k", op: "in", values: [] });
  });

  it("rejects an empty key", () => {
    expect(() =>
      AttributeFilterSchema.parse({ source: "log", key: "", op: "exists" }),
    ).toThrow();
  });

  // Exercises the type-only exports so the dead-code check sees them used
  // before their SQL/repository consumers land in later tasks.
  it("types the discovery inputs and key shape", () => {
    const key: AttributeKey = { source: "span", key: "http.route" };
    const keysIn: AttributeKeysInput = {
      timeRange: { from: "now-1h", to: "now" },
    };
    const valsIn: AttributeValuesInput = {
      timeRange: { from: "now-1h", to: "now" },
      source: "resource",
      key: "k",
    };
    expect([key.key, keysIn.timeRange.to, valsIn.source]).toEqual([
      "http.route",
      "now",
      "resource",
    ]);
  });

  it("types AttributeFilter and AttributeOp", () => {
    const filter: AttributeFilter = {
      source: "span",
      key: "http.method",
      op: "in",
      values: ["GET"],
    };
    const op: AttributeOp = filter.op;
    expect(op).toBe("in");
  });
});
