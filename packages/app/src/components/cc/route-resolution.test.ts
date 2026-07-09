import { describe, expect, it } from "vitest";
import type { CcMatcher, CcRoute } from "@/data/cc/types";
import {
  CC_SYNTHETIC_LABEL_KEYS,
  ccFirstRoute,
  ccMatcherMatches,
  ccMatchingSilence,
  ccOpSymbol,
  ccRouteMatches,
  ccSelectRoutes,
  ccSyntheticLabels,
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

describe("ccSyntheticLabels", () => {
  it("adds severity/status/rule/kind on top of the instance labels", () => {
    expect(
      ccSyntheticLabels(
        { team: "pay" },
        { severity: "critical", status: "firing", rule: "r-1" },
      ),
    ).toEqual({
      team: "pay",
      severity: "critical",
      status: "firing",
      rule: "r-1",
      kind: "alert",
    });
  });

  it("lets synthetics win over same-named user labels (mirrors CC insert-last)", () => {
    const labels = ccSyntheticLabels(
      { severity: "user-set", team: "pay" },
      { severity: "warning", status: "firing", rule: "r-1" },
    );
    expect(labels.severity).toBe("warning");
  });
});

describe("ccSelectRoutes", () => {
  it("stops after the first match when continue is false", () => {
    const first = route(1, [matcher("eq", "pay")], {
      id: "first",
      continue: false,
    });
    const second = route(2, [matcher("eq", "pay")], { id: "second" });
    expect(ccSelectRoutes([second, first], { team: "pay" })).toEqual([first]);
  });

  it("keeps collecting past continue routes until a terminal match", () => {
    const cont = route(1, [matcher("eq", "pay")], {
      id: "cont",
      continue: true,
    });
    const terminal = route(2, [], { id: "terminal", continue: false });
    const after = route(3, [], { id: "after" });
    expect(ccSelectRoutes([after, terminal, cont], { team: "pay" })).toEqual([
      cont,
      terminal,
    ]);
  });

  it("returns an empty array (firehose fall-through) when nothing matches", () => {
    expect(
      ccSelectRoutes([route(1, [matcher("eq", "core")])], { team: "pay" }),
    ).toEqual([]);
  });
});

describe("ccMatchingSilence", () => {
  const now = Date.parse("2026-07-01T12:00:00Z");
  const active = {
    id: "s-active",
    matchers: [matcher("eq", "pay")],
    starts_at: "2026-07-01T11:00:00Z",
    ends_at: "2026-07-01T13:00:00Z",
  };

  it("returns the active silence whose matchers all match", () => {
    expect(ccMatchingSilence({ team: "pay" }, [active], now)).toBe(active);
  });

  it("ignores silences outside their window", () => {
    const expired = { ...active, ends_at: "2026-07-01T11:30:00Z" };
    const scheduled = { ...active, starts_at: "2026-07-01T12:30:00Z" };
    expect(ccMatchingSilence({ team: "pay" }, [expired, scheduled], now)).toBe(
      null,
    );
  });

  it("ignores active silences whose matchers do not match", () => {
    expect(ccMatchingSilence({ team: "core" }, [active], now)).toBe(null);
  });

  it("matches rule-scoped matchers against synthetic labels", () => {
    const ruleScoped = {
      ...active,
      matchers: [matcher("eq", "pay"), matcher("eq", "r-1", "rule")],
    };
    const labels = ccSyntheticLabels(
      { team: "pay" },
      { severity: "critical", status: "firing", rule: "r-1" },
    );
    expect(ccMatchingSilence(labels, [ruleScoped], now)).toBe(ruleScoped);
    expect(ccMatchingSilence({ team: "pay" }, [ruleScoped], now)).toBe(null);
  });
});

describe("CC_SYNTHETIC_LABEL_KEYS", () => {
  it("stays in lockstep with the keys ccSyntheticLabels injects", () => {
    const injected = ccSyntheticLabels(
      {},
      { severity: "info", status: "firing", rule: "r-1" },
    );
    expect([...CC_SYNTHETIC_LABEL_KEYS].sort()).toEqual(
      Object.keys(injected).sort(),
    );
  });
});
