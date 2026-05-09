import { describe, expect, it } from "vitest";
import { substituteParams } from "./param-substitute";

describe("substituteParams", () => {
  it("substitutes a String param with quoted, escaped value", () => {
    const out = substituteParams("WHERE x = {q:String}", { q: "hi 'there'" });
    expect(out).toBe("WHERE x = 'hi \\'there\\''");
  });

  it("substitutes a UInt32 param with a number literal", () => {
    const out = substituteParams("LIMIT {limit:UInt32}", { limit: 50 });
    expect(out).toBe("LIMIT 50");
  });

  it("substitutes Array(String) with a tuple of quoted strings", () => {
    const out = substituteParams("x IN {ids:Array(String)}", {
      ids: ["a", "b'c"],
    });
    expect(out).toBe("x IN ['a','b\\'c']");
  });

  it("treats undefined as the empty string for String params", () => {
    const out = substituteParams("x = {q:String}", { q: undefined });
    expect(out).toBe("x = ''");
  });

  it("throws on unknown param type", () => {
    expect(() => substituteParams("x = {q:Bogus}", { q: 1 })).toThrow(
      /unsupported parameter type/i,
    );
  });

  it("throws when a referenced param is missing", () => {
    expect(() => substituteParams("x = {q:String}", {})).toThrow(
      /missing parameter q/i,
    );
  });
});
