import { describe, expect, it } from "vitest";
import type { CcMatcher, CcRoute } from "@/data/cc/types";
import {
  ccFirstRoute,
  ccMatcherMatches,
  ccOpSymbol,
  ccRouteMatches,
} from "./route-resolution";

function matcher(
  op: CcMatcher["op"],
  value: string,
  label = "team",
): CcMatcher {
  return { label, op, value };
}

function route(
  priority: number,
  matchers: CcMatcher[],
  overrides: Partial<CcRoute> = {},
): CcRoute {
  return {
    id: `r-${priority}`,
    priority,
    matchers,
    receiver: "default",
    ...overrides,
  } as CcRoute;
}

describe("ccOpSymbol", () => {
  it("maps each operator to its display symbol", () => {
    expect(ccOpSymbol("eq")).toBe("=");
    expect(ccOpSymbol("ne")).toBe("≠");
    expect(ccOpSymbol("regex")).toBe("=~");
    expect(ccOpSymbol("notregex")).toBe("!~");
  });
});

describe("ccMatcherMatches", () => {
  it("eq: true only on exact value equality", () => {
    expect(ccMatcherMatches(matcher("eq", "pay"), { team: "pay" })).toBe(true);
    expect(ccMatcherMatches(matcher("eq", "pay"), { team: "core" })).toBe(
      false,
    );
    expect(ccMatcherMatches(matcher("eq", "pay"), {})).toBe(false);
  });

  it("ne: true when the label is absent or differs", () => {
    expect(ccMatcherMatches(matcher("ne", "pay"), { team: "core" })).toBe(true);
    expect(ccMatcherMatches(matcher("ne", "pay"), {})).toBe(true);
    expect(ccMatcherMatches(matcher("ne", "pay"), { team: "pay" })).toBe(false);
  });

  it("regex: true when the label value matches the pattern", () => {
    expect(
      ccMatcherMatches(matcher("regex", "^pay.*"), { team: "payments" }),
    ).toBe(true);
    expect(ccMatcherMatches(matcher("regex", "^pay.*"), { team: "core" })).toBe(
      false,
    );
  });

  it("regex: false when the label is missing (nothing to test against)", () => {
    expect(ccMatcherMatches(matcher("regex", ".*"), {})).toBe(false);
  });

  it("regex: false (not throw) on an invalid pattern", () => {
    expect(ccMatcherMatches(matcher("regex", "("), { team: "pay" })).toBe(
      false,
    );
  });

  it("notregex: true when the label is missing or the pattern doesn't match", () => {
    expect(ccMatcherMatches(matcher("notregex", "^pay.*"), {})).toBe(true);
    expect(
      ccMatcherMatches(matcher("notregex", "^pay.*"), { team: "core" }),
    ).toBe(true);
    expect(
      ccMatcherMatches(matcher("notregex", "^pay.*"), { team: "payments" }),
    ).toBe(false);
  });

  it("notregex: false (not true) on an invalid pattern", () => {
    // Pinning actual behavior: the catch branch returns false for notregex
    // too, even though missing-label semantics would suggest true.
    expect(ccMatcherMatches(matcher("notregex", "("), { team: "pay" })).toBe(
      false,
    );
  });
});

describe("ccRouteMatches", () => {
  it("is true (vacuously) when there are no matchers", () => {
    expect(ccRouteMatches([], { team: "pay" })).toBe(true);
  });

  it("requires every matcher to match", () => {
    const matchers = [
      matcher("eq", "pay"),
      matcher("eq", "critical", "severity"),
    ];
    expect(
      ccRouteMatches(matchers, { team: "pay", severity: "critical" }),
    ).toBe(true);
    expect(ccRouteMatches(matchers, { team: "pay", severity: "warning" })).toBe(
      false,
    );
  });
});

describe("ccFirstRoute", () => {
  it("picks the matching route with the lowest priority number", () => {
    const low = route(1, [matcher("eq", "pay")]);
    const high = route(5, [matcher("eq", "pay")]);
    expect(ccFirstRoute([high, low], { team: "pay" })).toBe(low);
  });

  it("skips non-matching routes regardless of priority", () => {
    const low = route(1, [matcher("eq", "core")]);
    const high = route(5, [matcher("eq", "pay")]);
    expect(ccFirstRoute([low, high], { team: "pay" })).toBe(high);
  });

  it("returns null when no route matches", () => {
    expect(
      ccFirstRoute([route(1, [matcher("eq", "core")])], { team: "pay" }),
    ).toBeNull();
  });

  it("breaks ties on equal priority by original array order (stable sort)", () => {
    const first = route(1, [matcher("eq", "pay")], { id: "first" });
    const second = route(1, [matcher("eq", "pay")], { id: "second" });
    expect(ccFirstRoute([first, second], { team: "pay" })).toBe(first);
    expect(ccFirstRoute([second, first], { team: "pay" })).toBe(second);
  });

  it("does not mutate the input array", () => {
    const routes = [
      route(5, [matcher("eq", "pay")]),
      route(1, [matcher("eq", "pay")]),
    ];
    const copy = [...routes];
    ccFirstRoute(routes, { team: "pay" });
    expect(routes).toEqual(copy);
  });
});
