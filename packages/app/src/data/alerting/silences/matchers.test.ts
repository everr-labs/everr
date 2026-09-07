import { describe, expect, it } from "vitest";
import { formatMatchers, parseMatchers } from "./matchers";

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

  it("reads the negation the dialog documents, rather than a label ending in a bang", () => {
    expect(parseMatchers("region=eu-west-1 service!=search")).toEqual([
      { label: "region", op: "eq", value: "eu-west-1" },
      { label: "service", op: "ne", value: "search" },
    ]);
  });

  it("refuses a negation with no label, the same as a pair with none", () => {
    expect(() => parseMatchers("!=search")).toThrow(/label=value/);
  });

  it("keeps an equals sign inside the value", () => {
    expect(parseMatchers("query=a=b")).toEqual([
      { label: "query", op: "eq", value: "a=b" },
    ]);
  });

  it("reads a bang inside the value as part of it, not as the operator", () => {
    expect(parseMatchers("query=a!=b")).toEqual([
      { label: "query", op: "eq", value: "a!=b" },
    ]);
  });

  it("reads back what the lists print, so Silence again and Undo round-trip", () => {
    const matchers = [
      { label: "region", op: "eq" as const, value: "eu-west-1" },
      { label: "service", op: "ne" as const, value: "search" },
      { label: "query", op: "eq" as const, value: "a!=b" },
    ];
    expect(parseMatchers(formatMatchers(matchers))).toEqual(matchers);
  });

  it("round-trips the values a Silence written as code can hold", () => {
    // Every one of these printed bare would read back as something else, and
    // a Silence seeded from it would cover more or less than the one it was
    // seeded from.
    const matchers = [
      { label: "service", op: "eq" as const, value: "checkout api" },
      { label: "list", op: "eq" as const, value: "a," },
      { label: "quote", op: "ne" as const, value: '"leading' },
      { label: "escape", op: "eq" as const, value: 'a"b\\c' },
      { label: "blank", op: "eq" as const, value: "" },
      { label: "spaced label", op: "eq" as const, value: "x" },
      { label: "bang!", op: "eq" as const, value: "y" },
    ];
    expect(parseMatchers(formatMatchers(matchers))).toEqual(matchers);
  });

  it("keeps a value with a space whole rather than reading it as two pairs", () => {
    expect(parseMatchers('service="checkout api"')).toEqual([
      { label: "service", op: "eq", value: "checkout api" },
    ]);
  });

  it("refuses a quote nobody closed, rather than guessing where it ended", () => {
    expect(() => parseMatchers('service="checkout')).toThrow(/unclosed quote/);
  });

  it("accepts an empty value, which selects a label that is present and blank", () => {
    expect(parseMatchers("host=")).toEqual([
      { label: "host", op: "eq", value: "" },
    ]);
  });
});
