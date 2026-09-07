import { describe, expect, it } from "vitest";
import type { alertEvents } from "@/db/schema";
import type { AlertingMatcher } from "../types";
import {
  eventSubject,
  matchingSilence,
  ruleSubject,
  silenceIsInForce,
  silenceSelects,
} from "./matching";

function matcher(
  op: AlertingMatcher["op"],
  value: string,
  label = "team",
): AlertingMatcher {
  return { label, op, value };
}

const RULE_ID = "0e1c2b8f-4a3d-4c2b-9f11-5a7c9d2e8b41";

function event(
  overrides: Partial<typeof alertEvents.$inferSelect> = {},
): typeof alertEvents.$inferSelect {
  return {
    sourceDefinitionId: RULE_ID,
    severity: "critical",
    eventType: "instance_fired",
    instanceLabels: { team: "pay" },
    ...overrides,
  } as typeof alertEvents.$inferSelect;
}

describe("the subject a silence is matched against", () => {
  it("names the rule by its row id from either side", () => {
    // The one fact both sides have to agree on. They each built their own
    // label set once, and they spelled the rule differently: a silence written
    // from the screen then matched nothing the pipeline evaluated, and the
    // screen still said the rule was silenced.
    const fromEvent = eventSubject(event());
    const fromRule = ruleSubject(RULE_ID, "critical");

    expect(fromEvent.rule).toBe(RULE_ID);
    expect(fromRule.rule).toBe(RULE_ID);
  });

  it("lets the synthetics win over a user label of the same name", () => {
    const subject = eventSubject(
      event({
        severity: "critical",
        instanceLabels: { team: "pay", severity: "user-set", rule: "user-set" },
      }),
    );

    expect(subject).toEqual({
      team: "pay",
      severity: "critical",
      status: "firing",
      rule: RULE_ID,
    });
  });

  it("reads a resolve as resolved, so a silence may scope to one or the other", () => {
    const subject = eventSubject(event({ eventType: "instance_resolved" }));

    expect(subject.status).toBe("resolved");
  });

  // A rule has no instance labels of its own, so a silence scoped to one
  // instance does not select the whole rule.
  it("gives a rule the rule's own labels and nothing else", () => {
    const subject = ruleSubject(RULE_ID, "warning");

    expect(subject).toEqual({
      rule: RULE_ID,
      severity: "warning",
      status: "firing",
    });
  });
});

describe("silenceSelects", () => {
  const subject = eventSubject(event());

  // A missing label reads as the empty string, so `ne` selects it.
  it.each<[AlertingMatcher["op"], string, string, boolean]>([
    ["eq", "pay", "team", true],
    ["eq", "pay", "squad", false],
    ["eq", "", "squad", true],
    ["ne", "pay", "team", false],
    ["ne", "pay", "squad", true],
  ])("%s %s on %s is %s", (op, value, label, expected) => {
    expect(silenceSelects([matcher(op, value, label)], subject)).toBe(expected);
  });

  it("requires every matcher, and selects everything with none", () => {
    expect(silenceSelects([], subject)).toBe(true);
    expect(
      silenceSelects(
        [matcher("eq", "pay"), matcher("eq", "critical", "severity")],
        subject,
      ),
    ).toBe(true);
    expect(
      silenceSelects(
        [matcher("eq", "pay"), matcher("eq", "warning", "severity")],
        subject,
      ),
    ).toBe(false);
  });

  // Matching is exact: a value that reads as a pattern is compared literally.
  it("compares pattern-looking values literally", () => {
    expect(silenceSelects([matcher("eq", "^pay.*")], subject)).toBe(false);
    expect(
      silenceSelects(
        [matcher("eq", "^pay.*")],
        eventSubject(event({ instanceLabels: { team: "^pay.*" } })),
      ),
    ).toBe(true);
  });
});

describe("silenceIsInForce", () => {
  const now = new Date("2026-07-01T12:00:00Z");

  // Half-open: the start instant is covered, the end instant is not.
  it.each<[string, string, boolean]>([
    ["2026-07-01T11:00:00Z", "2026-07-01T13:00:00Z", true],
    ["2026-07-01T12:00:00Z", "2026-07-01T13:00:00Z", true],
    ["2026-07-01T11:00:00Z", "2026-07-01T12:00:00Z", false],
    ["2026-07-01T12:30:00Z", "2026-07-01T13:00:00Z", false],
  ])("%s to %s covers noon: %s", (startsAt, endsAt, expected) => {
    expect(
      silenceIsInForce(
        { startsAt: new Date(startsAt), endsAt: new Date(endsAt) },
        now,
      ),
    ).toBe(expected);
  });
});

describe("matchingSilence", () => {
  const now = new Date("2026-07-01T12:00:00Z");
  const inForce = {
    id: "s-active",
    matchers: [matcher("eq", "pay")],
    startsAt: new Date("2026-07-01T11:00:00Z"),
    endsAt: new Date("2026-07-01T13:00:00Z"),
  };
  const subject = eventSubject(event());

  it("returns the silence in force whose matchers all select, ignoring the rest", () => {
    expect(matchingSilence(subject, [inForce], now)).toBe(inForce);

    const expired = { ...inForce, endsAt: new Date("2026-07-01T11:30:00Z") };
    const scheduled = {
      ...inForce,
      startsAt: new Date("2026-07-01T12:30:00Z"),
    };
    expect(matchingSilence(subject, [expired, scheduled], now)).toBe(null);
    expect(
      matchingSilence(
        eventSubject(event({ instanceLabels: { team: "core" } })),
        [inForce],
        now,
      ),
    ).toBe(null);
  });

  it("selects a whole-rule silence by the id the dialog wrote", () => {
    const wholeRule = {
      ...inForce,
      matchers: [matcher("eq", RULE_ID, "rule")],
    };

    expect(matchingSilence(subject, [wholeRule], now)).toBe(wholeRule);
  });
});
