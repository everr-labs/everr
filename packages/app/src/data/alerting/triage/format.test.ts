import { describe, expect, it, vi } from "vitest";

// Importing the Alert rule module for its pure ordering function must not
// build a database pool in this browser-environment suite.
vi.mock("@/db/client", () => ({
  db: {},
  pool: {},
  runInTransaction: () => Promise.resolve(),
}));

import { compareRuleLabels } from "@/data/alerting/rules/read";
import {
  formatElapsed,
  formatSincePhrase,
  formatValue,
  silenceImpact,
} from "./format";

describe("formatElapsed", () => {
  it("calls anything under a minute now, because that is what it reads as", () => {
    expect(formatElapsed(0)).toBe("just now");
    expect(formatElapsed(29_000)).toBe("just now");
    // Rounded, not floored: 30 seconds is nearer a minute than nothing.
    expect(formatElapsed(30_000)).toBe("1m");
  });

  it("counts in minutes up to an hour, then in hours and minutes", () => {
    expect(formatElapsed(59 * 60_000)).toBe("59m");
    expect(formatElapsed(60 * 60_000)).toBe("1h");
    expect(formatElapsed(372 * 60_000)).toBe("6h 12m");
  });

  it("switches to days at two days, and drops an hour count of nothing", () => {
    expect(formatElapsed(47 * 3_600_000)).toBe("47h");
    expect(formatElapsed(48 * 3_600_000)).toBe("2d");
    expect(formatElapsed(76 * 3_600_000)).toBe("3d 4h");
  });

  it("never counts backwards from a stamp in the future", () => {
    expect(formatElapsed(-60_000)).toBe("just now");
  });
});

describe("formatSincePhrase", () => {
  const now = new Date("2026-08-26T12:00:00Z");

  it("gives an elapsed time the preposition that starts a sentence", () => {
    expect(formatSincePhrase(new Date("2026-08-26T11:46:00Z"), now)).toBe(
      "since 14m",
    );
  });

  it("leaves the sub-minute phrase bare, because it takes no preposition", () => {
    expect(formatSincePhrase(new Date("2026-08-26T11:59:50Z"), now)).toBe(
      "just now",
    );
  });

  it("has nothing to say about a stamp that was never set", () => {
    expect(formatSincePhrase(null, now)).toBeNull();
  });
});

describe("formatValue", () => {
  it("never grows a decimal on a count that never had one", () => {
    expect(formatValue(42)).toBe("42");
    expect(formatValue(0)).toBe("0");
  });

  it("keeps two decimals below ten and one above, where the rest is noise", () => {
    expect(formatValue(1.23456)).toBe("1.23");
    expect(formatValue(412.38176)).toBe("412.4");
    expect(formatValue(-1.23456)).toBe("-1.23");
    expect(formatValue(-412.38176)).toBe("-412.4");
  });

  it("has nothing to print for a rule that measured nothing", () => {
    expect(formatValue(null)).toBeNull();
    expect(formatValue(Number.NaN)).toBeNull();
    expect(formatValue(Number.POSITIVE_INFINITY)).toBeNull();
  });
});

describe("silenceImpact", () => {
  it("keeps holds and suppressions apart: one may still go out, one never will", () => {
    expect(silenceImpact({ held: 3, dropped: 1 })).toBe("held 3 · dropped 1");
    expect(silenceImpact({ held: 3, dropped: 0 })).toBe("held 3");
    expect(silenceImpact({ held: 0, dropped: 1 })).toBe("dropped 1");
  });

  it("reports nothing at all when a silence withheld nothing", () => {
    expect(silenceImpact({ held: 0, dropped: 0 })).toBeNull();
  });
});

describe("compareRuleLabels", () => {
  const order = (rules: { label: string; path: string }[]) =>
    rules
      .slice()
      .sort(compareRuleLabels)
      .map((rule) => rule.path);

  it("orders by the label the list prints, not by the path behind it", () => {
    expect(
      order([
        { label: "Zeta latency", path: "aaa/zeta" },
        { label: "Alpha latency", path: "zzz/alpha" },
      ]),
    ).toEqual(["zzz/alpha", "aaa/zeta"]);
  });

  it("does not split a run of names on case", () => {
    expect(
      order([
        { label: "beta", path: "demo/beta" },
        { label: "Alpha", path: "demo/alpha" },
        { label: "Gamma", path: "demo/gamma" },
      ]),
    ).toEqual(["demo/alpha", "demo/beta", "demo/gamma"]);
  });

  it("counts numbers in a label rather than comparing them as text", () => {
    expect(
      order([
        { label: "shard-10 saturation", path: "demo/s10" },
        { label: "shard-2 saturation", path: "demo/s2" },
      ]),
    ).toEqual(["demo/s2", "demo/s10"]);
  });

  it("falls back to the path when two rules display the same name", () => {
    expect(
      order([
        { label: "High 5xx", path: "web/high-5xx" },
        { label: "High 5xx", path: "api/high-5xx" },
      ]),
    ).toEqual(["api/high-5xx", "web/high-5xx"]);
  });
});
