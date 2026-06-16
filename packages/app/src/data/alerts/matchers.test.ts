import { describe, expect, it } from "vitest";
import {
  findSilenceForInstance,
  type Matcher,
  MatchersSchema,
  matcherMatches,
  silenceMatchesInstance,
  validateMatchers,
} from "./matchers";

const m = (label: string, op: Matcher["op"], value: string): Matcher => ({
  label,
  op,
  value,
});

describe("matcherMatches", () => {
  it("matches equality and inequality", () => {
    expect(matcherMatches(m("route", "=", "/x"), { route: "/x" })).toBe(true);
    expect(matcherMatches(m("route", "=", "/x"), { route: "/y" })).toBe(false);
    expect(matcherMatches(m("route", "!=", "/x"), { route: "/y" })).toBe(true);
  });

  it("treats absent labels as empty string", () => {
    expect(matcherMatches(m("zone", "=", ""), { route: "/x" })).toBe(true);
    expect(matcherMatches(m("zone", "!=", "a"), {})).toBe(true);
  });

  it("anchors regex matchers", () => {
    expect(
      matcherMatches(m("route", "=~", "/api/.*"), { route: "/api/x" }),
    ).toBe(true);
    expect(matcherMatches(m("route", "=~", "api"), { route: "/api/x" })).toBe(
      false,
    );
    expect(matcherMatches(m("route", "!~", "/api/.*"), { route: "/web" })).toBe(
      true,
    );
  });
});

describe("silenceMatchesInstance", () => {
  it("requires all matchers to match", () => {
    const matchers = [m("route", "=", "/x"), m("code", "=", "500")];
    expect(silenceMatchesInstance(matchers, { route: "/x", code: "500" })).toBe(
      true,
    );
    expect(silenceMatchesInstance(matchers, { route: "/x", code: "404" })).toBe(
      false,
    );
  });

  it("matches everything with an empty matcher list", () => {
    expect(silenceMatchesInstance([], { anything: "v" })).toBe(true);
    expect(silenceMatchesInstance([], {})).toBe(true);
  });
});

describe("findSilenceForInstance", () => {
  it("returns the first matching silence", () => {
    const silences = [
      { id: "a", matchers: [m("route", "=", "/y")] },
      { id: "b", matchers: [m("route", "=", "/x")] },
    ];
    expect(findSilenceForInstance(silences, { route: "/x" })?.id).toBe("b");
    expect(findSilenceForInstance(silences, { route: "/z" })).toBeUndefined();
  });
});

describe("validateMatchers", () => {
  it("rejects invalid regex", () => {
    expect(() => validateMatchers([m("route", "=~", "(")])).toThrow(
      /invalid regex/,
    );
    expect(() => validateMatchers([m("route", "=", "(")])).not.toThrow();
  });
});

describe("MatchersSchema", () => {
  it("accepts well-formed matchers and rejects unknown ops", () => {
    expect(MatchersSchema.safeParse([m("a", "=", "b")]).success).toBe(true);
    expect(
      MatchersSchema.safeParse([{ label: "a", op: "==", value: "b" }]).success,
    ).toBe(false);
    expect(
      MatchersSchema.safeParse([{ label: "", op: "=", value: "b" }]).success,
    ).toBe(false);
  });
});
