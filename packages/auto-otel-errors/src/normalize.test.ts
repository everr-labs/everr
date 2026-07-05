import { describe, expect, it } from "vite-plus/test";
import { normalizeError } from "./normalize.js";

describe("normalizeError", () => {
  it("extracts type, message, stacktrace, and top frame from an Error", () => {
    const result = normalizeError(new TypeError("boom"));
    expect(result.type).toBe("TypeError");
    expect(result.message).toBe("boom");
    expect(result.stacktrace).toContain("normalize.test.ts");
    expect(result.topFrame).toMatch(/^at /);
  });

  it("appends cause chains to the stacktrace", () => {
    const error = new Error("outer", { cause: new RangeError("inner") });
    const result = normalizeError(error);
    expect(result.stacktrace).toContain("[cause] RangeError: inner");
  });

  it("appends AggregateError members", () => {
    const error = new AggregateError([new Error("a"), new Error("b")], "agg");
    const result = normalizeError(error);
    expect(result.stacktrace).toContain("[aggregate] Error: a");
    expect(result.stacktrace).toContain("[aggregate] Error: b");
  });

  it("does not recurse infinitely on self-referential causes", () => {
    const error = new Error("loop");
    (error as { cause?: unknown }).cause = error;
    expect(() => normalizeError(error)).not.toThrow();
  });

  it("normalizes non-Error throwables as NonError", () => {
    expect(normalizeError("just a string")).toEqual({
      type: "NonError",
      message: "just a string",
    });
    expect(normalizeError({ code: 42 })).toEqual({
      type: "NonError",
      message: '{"code":42}',
    });
  });

  it("survives unstringifiable values", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(normalizeError(circular).type).toBe("NonError");
  });
});
