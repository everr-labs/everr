import { describe, expect, it } from "vitest";
import {
  ccMatcherMatches,
  ccMatchingSilence,
  ccOpSymbol,
  ccRouteMatches,
  ccSelectRoutes,
  ccSyntheticLabels,
} from "./route-resolution";
import { CC_SYNTHETIC_LABEL_KEYS } from "./synthetic-labels";
import type { CcMatcher, CcRoute } from "./types";

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

  it("regex: a missing label is the empty string, so permissive patterns match", () => {
    expect(ccMatcherMatches(matcher("regex", ".*"), {})).toBe(true);
    expect(ccMatcherMatches(matcher("regex", "pay"), {})).toBe(false);
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

  it("notregex: true on an invalid pattern (an invalid pattern never matches)", () => {
    // Mirrors matching.rs: NotRegex is !regex_full_match, and regex_full_match
    // is false for an invalid pattern, so notregex is true.
    expect(ccMatcherMatches(matcher("notregex", "("), { team: "pay" })).toBe(
      true,
    );
  });

  // Parity vectors copied from matching.rs's unit tests, so the TS port and
  // the engine cannot silently diverge.
  describe("parity with matching.rs", () => {
    it("eq_and_ne", () => {
      const l = { svc: "api" };
      expect(ccMatcherMatches(matcher("eq", "api", "svc"), l)).toBe(true);
      expect(ccMatcherMatches(matcher("eq", "web", "svc"), l)).toBe(false);
      expect(ccMatcherMatches(matcher("ne", "web", "svc"), l)).toBe(true);
    });

    it("missing_label_is_empty_string", () => {
      expect(ccMatcherMatches(matcher("eq", "api", "svc"), {})).toBe(false);
      expect(ccMatcherMatches(matcher("ne", "api", "svc"), {})).toBe(true);
      // eq "" matches a missing label: absent means empty string.
      expect(ccMatcherMatches(matcher("eq", "", "svc"), {})).toBe(true);
    });

    it("regex_is_anchored", () => {
      const l = { svc: "api" };
      expect(ccMatcherMatches(matcher("regex", "api", "svc"), l)).toBe(true);
      // Anchored, not a prefix.
      expect(ccMatcherMatches(matcher("regex", "ap", "svc"), l)).toBe(false);
      expect(ccMatcherMatches(matcher("regex", "ap.*", "svc"), l)).toBe(true);
      expect(ccMatcherMatches(matcher("notregex", "web", "svc"), l)).toBe(true);
    });

    it("invalid_pattern_never_matches", () => {
      expect(
        ccMatcherMatches(matcher("regex", "[unterminated", "svc"), {
          svc: "api",
        }),
      ).toBe(false);
    });

    it("repeated_patterns_are_consistent_and_cached", () => {
      // Same pattern, many calls: behavior identical across calls (the
      // pattern cache must not corrupt results).
      for (let i = 0; i < 3; i++) {
        expect(
          ccMatcherMatches(matcher("regex", "api-.*", "svc"), { svc: "api-1" }),
        ).toBe(true);
        expect(
          ccMatcherMatches(matcher("regex", "api-.*", "svc"), { svc: "web-1" }),
        ).toBe(false);
        expect(
          ccMatcherMatches(matcher("regex", "[unterminated", "svc"), {
            svc: "anything",
          }),
        ).toBe(false);
      }
      // Distinct patterns coexist in the cache.
      expect(
        ccMatcherMatches(matcher("regex", "a+", "svc"), { svc: "aaa" }),
      ).toBe(true);
      expect(
        ccMatcherMatches(matcher("regex", "b+", "svc"), { svc: "bbb" }),
      ).toBe(true);
      expect(
        ccMatcherMatches(matcher("regex", "a+", "svc"), { svc: "bbb" }),
      ).toBe(false);
    });
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
