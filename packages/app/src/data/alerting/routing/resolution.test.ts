import { describe, expect, it } from "vitest";
import type {
  AlertingMatcher,
  AlertingRoute,
  AlertingRuleView,
  AlertingSlo,
} from "../types";
import {
  alertingDispatchLabels,
  alertingIsCatchAll,
  alertingMatcherMatches,
  alertingMatchingSilence,
  alertingRouteMatches,
  alertingSelectRoutes,
  alertingSyntheticLabels,
} from "./resolution";

function matcher(
  op: AlertingMatcher["op"],
  value: string,
  label = "team",
): AlertingMatcher {
  return { label, op, value };
}

function route(
  priority: number,
  matchers: AlertingMatcher[],
  overrides: Partial<AlertingRoute> = {},
): AlertingRoute {
  return {
    id: `r-${priority}`,
    priority,
    matchers,
    receiver: "default",
    ...overrides,
  } as AlertingRoute;
}

describe("alertingMatcherMatches", () => {
  // A missing label reads as the empty string, so `ne` and `notregex` match it
  // and a permissive pattern does too. An invalid pattern never matches, which
  // notregex negates into a match.
  it.each<[AlertingMatcher["op"], string, Record<string, string>, boolean]>([
    ["eq", "pay", { team: "pay" }, true],
    ["eq", "pay", { team: "core" }, false],
    ["eq", "pay", {}, false],
    ["ne", "pay", { team: "core" }, true],
    ["ne", "pay", {}, true],
    ["ne", "pay", { team: "pay" }, false],
    ["regex", "^pay.*", { team: "payments" }, true],
    ["regex", "^pay.*", { team: "core" }, false],
    ["regex", ".*", {}, true],
    ["regex", "pay", {}, false],
    ["regex", "(", { team: "pay" }, false],
    ["notregex", "^pay.*", { team: "core" }, true],
    ["notregex", "^pay.*", {}, true],
    ["notregex", "^pay.*", { team: "payments" }, false],
    ["notregex", "(", { team: "pay" }, true],
  ])("team %s %s against %j is %s", (op, value, labels, expected) => {
    expect(alertingMatcherMatches(matcher(op, value), labels)).toBe(expected);
  });
});

describe("alertingRouteMatches", () => {
  it("requires every matcher to match, and is vacuously true with none", () => {
    expect(alertingRouteMatches([], { team: "pay" })).toBe(true);

    const matchers = [
      matcher("eq", "pay"),
      matcher("eq", "critical", "severity"),
    ];
    expect(
      alertingRouteMatches(matchers, { team: "pay", severity: "critical" }),
    ).toBe(true);
    expect(
      alertingRouteMatches(matchers, { team: "pay", severity: "warning" }),
    ).toBe(false);
  });
});

describe("alertingSyntheticLabels", () => {
  it("adds severity/status/rule/kind, letting synthetics win over same-named user labels", () => {
    expect(
      alertingSyntheticLabels(
        { team: "pay", severity: "user-set" },
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
});

describe("alertingDispatchLabels", () => {
  const slo: Pick<AlertingSlo, "spec"> = {
    spec: {
      sli: { sql: "SELECT 1 AS good, 1 AS valid" },
      targetPercent: 99.9,
      timeWindow: { duration: "30d", isRolling: true },
      annotations: {},
      suppressed: false,
    },
  };

  it("stamps the synthetic slo label and resolves severity from the burn-rate tier", () => {
    // fast-burn defaults to critical.
    const labels = alertingDispatchLabels(
      {
        labels: { slo_tier: "fast-burn" },
        rule: "slo-uuid",
        slo: "slo-uuid",
      },
      undefined,
      slo,
    );
    expect(labels).toEqual({
      slo_tier: "fast-burn",
      severity: "critical",
      status: "firing",
      rule: "slo-uuid",
      kind: "alert",
      slo: "slo-uuid",
    });
    // The ticket tier fires at warning.
    expect(
      alertingDispatchLabels(
        {
          labels: { slo_tier: "ticket" },
          rule: "slo-uuid",
          slo: "slo-uuid",
        },
        undefined,
        slo,
      ).severity,
    ).toBe("warning");
  });

  it("keeps rule-sourced instances slo-free and severity from the rule", () => {
    const labels = alertingDispatchLabels(
      { labels: { team: "pay" }, rule: "r-1" },
      { spec: { severity: "warning" } as AlertingRuleView["spec"] },
    );
    expect(labels.severity).toBe("warning");
    expect("slo" in labels).toBe(false);
  });
});

describe("alertingSelectRoutes", () => {
  it("stops after the first match when continue is false", () => {
    const first = route(1, [matcher("eq", "pay")], {
      id: "first",
      continue: false,
    });
    const second = route(2, [matcher("eq", "pay")], { id: "second" });
    expect(alertingSelectRoutes([second, first], { team: "pay" })).toEqual([
      first,
    ]);
  });

  it("keeps collecting past continue routes until a terminal match", () => {
    const cont = route(1, [matcher("eq", "pay")], {
      id: "cont",
      continue: true,
    });
    const terminal = route(2, [], { id: "terminal", continue: false });
    const after = route(3, [], { id: "after" });
    expect(
      alertingSelectRoutes([after, terminal, cont], { team: "pay" }),
    ).toEqual([cont, terminal]);
  });

  it("returns an empty array when nothing matches", () => {
    expect(
      alertingSelectRoutes([route(1, [matcher("eq", "core")])], {
        team: "pay",
      }),
    ).toEqual([]);
  });
});

describe("alertingIsCatchAll", () => {
  it("recognizes only an explicit route without matchers", () => {
    expect(alertingIsCatchAll([])).toBe(true);
    expect(alertingIsCatchAll([matcher("regex", ".*")])).toBe(false);
  });
});

describe("alertingMatchingSilence", () => {
  const now = Date.parse("2026-07-01T12:00:00Z");
  const active = {
    id: "s-active",
    matchers: [matcher("eq", "pay")],
    starts_at: "2026-07-01T11:00:00Z",
    ends_at: "2026-07-01T13:00:00Z",
  };

  it("returns the active silence whose matchers all match, ignoring the rest", () => {
    expect(alertingMatchingSilence({ team: "pay" }, [active], now)).toBe(
      active,
    );

    const expired = { ...active, ends_at: "2026-07-01T11:30:00Z" };
    const scheduled = { ...active, starts_at: "2026-07-01T12:30:00Z" };
    expect(
      alertingMatchingSilence({ team: "pay" }, [expired, scheduled], now),
    ).toBe(null);
    expect(alertingMatchingSilence({ team: "core" }, [active], now)).toBe(null);
  });

  it("matches rule-scoped matchers against synthetic labels", () => {
    const ruleScoped = {
      ...active,
      matchers: [matcher("eq", "pay"), matcher("eq", "r-1", "rule")],
    };
    const labels = alertingSyntheticLabels(
      { team: "pay" },
      { severity: "critical", status: "firing", rule: "r-1" },
    );
    expect(alertingMatchingSilence(labels, [ruleScoped], now)).toBe(ruleScoped);
    expect(alertingMatchingSilence({ team: "pay" }, [ruleScoped], now)).toBe(
      null,
    );
  });
});
