import { describe, expect, it } from "vitest";
import type { AlertingMatcher, AlertingRuleView } from "../types";
import {
  alertingDispatchLabels,
  alertingIsCatchAll,
  alertingMatcherMatches,
  alertingMatchersMatch,
  alertingMatchingSilence,
  alertingSyntheticLabels,
} from "./matching";

function matcher(
  op: AlertingMatcher["op"],
  value: string,
  label = "team",
): AlertingMatcher {
  return { label, op, value };
}

describe("alertingMatcherMatches", () => {
  // A missing label reads as the empty string, so `ne` matches it.
  it.each<[AlertingMatcher["op"], string, Record<string, string>, boolean]>([
    ["eq", "pay", { team: "pay" }, true],
    ["eq", "pay", { team: "core" }, false],
    ["eq", "pay", {}, false],
    ["eq", "", {}, true],
    ["ne", "pay", { team: "core" }, true],
    ["ne", "pay", {}, true],
    ["ne", "pay", { team: "pay" }, false],
  ])("team %s %s against %j is %s", (op, value, labels, expected) => {
    expect(alertingMatcherMatches(matcher(op, value), labels)).toBe(expected);
  });

  // Matching is exact: a value that reads as a pattern is compared literally.
  it("compares pattern-looking values literally", () => {
    expect(
      alertingMatcherMatches(matcher("eq", "^pay.*"), { team: "pay" }),
    ).toBe(false);
    expect(
      alertingMatcherMatches(matcher("eq", "^pay.*"), { team: "^pay.*" }),
    ).toBe(true);
  });
});

describe("alertingMatchersMatch", () => {
  it("requires every matcher to match, and is vacuously true with none", () => {
    expect(alertingMatchersMatch([], { team: "pay" })).toBe(true);

    const matchers = [
      matcher("eq", "pay"),
      matcher("eq", "critical", "severity"),
    ];
    expect(
      alertingMatchersMatch(matchers, { team: "pay", severity: "critical" }),
    ).toBe(true);
    expect(
      alertingMatchersMatch(matchers, { team: "pay", severity: "warning" }),
    ).toBe(false);
  });
});

describe("alertingSyntheticLabels", () => {
  it("adds severity/status/rule, letting synthetics win over same-named user labels", () => {
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
    });
  });
});

describe("alertingDispatchLabels", () => {
  it("resolves severity from the rule", () => {
    const labels = alertingDispatchLabels(
      { labels: { team: "pay" }, rule: "r-1" },
      { spec: { severity: "warning" } as AlertingRuleView["spec"] },
    );
    expect(labels.severity).toBe("warning");
  });
});

describe("alertingIsCatchAll", () => {
  it("recognizes only an explicit route without matchers", () => {
    expect(alertingIsCatchAll([])).toBe(true);
    expect(alertingIsCatchAll([matcher("ne", "")])).toBe(false);
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
