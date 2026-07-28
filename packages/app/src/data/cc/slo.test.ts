// The frontend mirror of domain/slo.rs: canonical tiers, tier-severity
// resolution, event handles, and the budget-projection duration format.
import { describe, expect, it } from "vitest";
import { ANN_DISPLAY_NAME } from "@/data/alerts/annotations";
import {
  CC_CANONICAL_SLO_TIERS,
  ccApplyFreshBudget,
  ccEffectiveBurn,
  ccFmtWindowSecs,
  ccFormatSloDuration,
  ccSloBurnPace,
  ccSloBurnPaceLabel,
  ccSloChartRange,
  ccSloCurrentBurn,
  ccSloExhaustion,
  ccSloHandleResolver,
  ccSloHandles,
  ccSloIdentity,
  ccSloTierSeverity,
  ccTiersForWindow,
  ccTimeToExhaustionSecs,
} from "./slo";
import type { CcSlo, CcSloGroupStatus, CcSloSpec } from "./types";

function spec(overrides: Partial<CcSloSpec> = {}): CcSloSpec {
  return {
    sli: { sql: "SELECT 1 AS good, 1 AS valid", label_columns: [] },
    targetPercent: 99.9,
    timeWindow: { duration: "30d", isRolling: true },
    annotations: {},
    suppressed: false,
    ...overrides,
  };
}

function slo(overrides: Partial<CcSlo> = {}): CcSlo {
  return {
    id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    tenant: "org1",
    namespace: "",
    name: "checkout-availability",
    spec: spec(),
    version: 1,
    paused: false,
    ...overrides,
  };
}

describe("canonical tiers", () => {
  it("mirrors the engine's three SRE-workbook defaults", () => {
    // Must match domain/slo.rs canonical_tiers() exactly: every SLO is evaluated
    // on this fixed set (tiers are not user-configurable), and severity
    // resolution reads them. Two critical (page), one warning (ticket).
    expect(CC_CANONICAL_SLO_TIERS.map((t) => t.name)).toEqual([
      "fast-burn",
      "slow-burn",
      "ticket",
    ]);
    expect(CC_CANONICAL_SLO_TIERS[0].burn_rate).toBe(14.4);
    expect(CC_CANONICAL_SLO_TIERS[0].severity).toBe("critical");
    expect(CC_CANONICAL_SLO_TIERS[1].severity).toBe("critical");
    expect(CC_CANONICAL_SLO_TIERS[2].severity).toBe("warning");
  });
});

describe("ccTiersForWindow", () => {
  it("reproduces the canonical 30-day windows exactly", () => {
    const t = ccTiersForWindow(30 * 86_400);
    expect(t.map((x) => [x.long_window, x.short_window])).toEqual([
      ["1h", "5m"],
      ["6h", "30m"],
      ["3d", "6h"],
    ]);
  });

  it("scales windows proportionally for a 7-day window, thresholds unchanged", () => {
    const t = ccTiersForWindow(7 * 86_400); // k = 7/30
    expect(t[0]).toMatchObject({ long_window: "14m", short_window: "70s" });
    expect(t[1]).toMatchObject({ long_window: "84m", short_window: "7m" });
    expect(t[2]).toMatchObject({ short_window: "84m", burn_rate: 1 });
    expect(t[0].burn_rate).toBe(14.4);
  });

  it("never exceeds a 1-day objective", () => {
    // The bug: the canonical 3-day ticket window is longer than a 1-day SLO.
    const t = ccTiersForWindow(86_400);
    for (const x of t) {
      const long = ccTierWinSecs(x.long_window);
      expect(long).toBeLessThanOrEqual(86_400);
    }
  });

  it("drops a tier the floor collapses onto an earlier tier's windows", () => {
    // The engine keeps only the lower threshold (domain/slo.rs `tiers_for_window`),
    // so the UI must not render a fast-burn tier that is never evaluated.
    const t = ccTiersForWindow(86_400);
    expect(t).toHaveLength(2);
    expect(t[0]).toMatchObject({
      name: "slow-burn",
      long_window: "12m",
      short_window: "1m",
      burn_rate: 6,
    });
    expect(t[1]).toMatchObject({ name: "ticket", short_window: "12m" });
  });
});

// Local mirror of the tier-window parser for the assertion above.
function ccTierWinSecs(w: string): number {
  const m = /^(\d+)([smhdw])$/.exec(w);
  const mult = { s: 1, m: 60, h: 3600, d: 86_400, w: 604_800 }[m?.[2] ?? "s"];
  return Number(m?.[1] ?? 0) * (mult ?? 1);
}

describe("ccFmtWindowSecs", () => {
  it("picks the coarsest exact unit, falling back to seconds", () => {
    expect(ccFmtWindowSecs(3600)).toBe("1h");
    expect(ccFmtWindowSecs(259_200)).toBe("3d");
    expect(ccFmtWindowSecs(300)).toBe("5m");
    expect(ccFmtWindowSecs(70)).toBe("70s");
    expect(ccFmtWindowSecs(604_800)).toBe("1w");
  });
});

describe("ccSloTierSeverity", () => {
  it("resolves a known tier and defaults unknown or missing to critical", () => {
    // Mirrors domain/slo.rs tier_severity, including the conservative
    // fallback for a tier no longer in the spec.
    const tiers = CC_CANONICAL_SLO_TIERS;
    expect(ccSloTierSeverity(tiers, { slo_tier: "ticket" })).toBe("warning");
    expect(ccSloTierSeverity(tiers, { slo_tier: "ghost-tier" })).toBe(
      "critical",
    );
    expect(ccSloTierSeverity(tiers, {})).toBe("critical");
  });
});

describe("SLO event handles", () => {
  it("carries the uuid and the first-class name, with no legacy handle for a slashless name", () => {
    expect(ccSloHandles(slo())).toEqual([
      "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      "checkout-availability",
    ]);
  });

  it("appends the bare slug as a legacy handle for a qualified name", () => {
    expect(ccSloHandles(slo({ name: "payments/checkout" }))).toEqual([
      "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      "payments/checkout",
      "checkout",
    ]);
  });

  it("resolves any handle to the SLO and misses unknown handles", () => {
    const resolve = ccSloHandleResolver([slo({ name: "payments/checkout" })]);
    expect(resolve("payments/checkout")?.name).toBe("payments/checkout");
    expect(resolve("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee")?.name).toBe(
      "payments/checkout",
    );
    // The legacy bare-slug handle also resolves.
    expect(resolve("checkout")?.name).toBe("payments/checkout");
    expect(resolve("some-rule-slug")).toBeUndefined();
  });
});

describe("ccSloIdentity", () => {
  it("falls back to the slug when no display name is set", () => {
    expect(ccSloIdentity(slo({ name: "payments/checkout" }))).toEqual({
      name: "checkout",
      project: "payments",
      slug: "checkout",
      displayName: null,
    });
  });

  it("prefers the display-name annotation over the slug", () => {
    const identity = ccSloIdentity(
      slo({
        name: "payments/checkout",
        spec: spec({
          annotations: { [ANN_DISPLAY_NAME]: "Checkout availability" },
        }),
      }),
    );
    expect(identity).toEqual({
      name: "Checkout availability",
      project: "payments",
      slug: "checkout",
      displayName: "Checkout availability",
    });
  });
});

describe("ccFormatSloDuration", () => {
  it("keeps the two largest non-zero units, like the engine's fmt_duration_secs", () => {
    expect(ccFormatSloDuration(30)).toBe("30s");
    expect(ccFormatSloDuration(45 * 60)).toBe("45m");
    expect(ccFormatSloDuration(2 * 3600 + 15 * 60)).toBe("2h 15m");
    expect(ccFormatSloDuration(2 * 3600)).toBe("2h");
    expect(ccFormatSloDuration(3 * 86400 + 4 * 3600 + 30 * 60)).toBe("3d 4h");
    expect(ccFormatSloDuration(3 * 86400)).toBe("3d");
    expect(ccFormatSloDuration(0)).toBe("0s");
  });
});

describe("ccSloExhaustion", () => {
  it("says exhausted from the budget alone, with no burn to forecast from", () => {
    // The regression this exists for: the engine's forecast checks burn before
    // budget and returns null when nothing is burning, which made a definitively
    // spent budget read as "no data" instead of "exhausted".
    expect(ccSloExhaustion(-20.8, null, null).label).toBe("exhausted");
    expect(ccSloExhaustion(0, null, null).label).toBe("exhausted");
  });

  it("passes a live forecast through, already formatted", () => {
    expect(ccSloExhaustion(0.3, 7200, 2)).toEqual({
      kind: "forecast",
      label: "2h",
    });
  });

  it("distinguishes a stopped burn from an unknown one", () => {
    expect(ccSloExhaustion(0.4, null, 0).label).toBe("not shrinking");
    expect(ccSloExhaustion(0.4, null, null).label).toBe("—");
    expect(ccSloExhaustion(null, null, null).label).toBe("—");
  });
});

describe("ccEffectiveBurn", () => {
  it("is min(long, short) when both windows have data", () => {
    expect(ccEffectiveBurn(3, 2)).toBe(2);
    expect(ccEffectiveBurn(2, 3)).toBe(2);
    // A passed spike: long still remembers it, short has recovered to 0.
    expect(ccEffectiveBurn(3, 0)).toBe(0);
  });

  it("is null when either window has no data (fail open, like firing)", () => {
    expect(ccEffectiveBurn(3, null)).toBeNull();
    expect(ccEffectiveBurn(null, 2)).toBeNull();
    expect(ccEffectiveBurn(undefined, undefined)).toBeNull();
  });
});

describe("ccSloCurrentBurn", () => {
  const tiers = CC_CANONICAL_SLO_TIERS;
  const tier = (
    name: string,
    long: number | null,
    short: number | null,
  ): CcSloGroupStatus["tiers"][number] => ({
    name,
    long_burn_rate: long,
    short_burn_rate: short,
    long_window_valid: null,
  });

  it("leads with the fast-burn 1h rate but carries the confirmed effective burn", () => {
    // Sustained drain: long 3x over 1h, short 2x over 5m -> shows the 1h figure,
    // effective is the both-window min (2x) that pace/TTE read.
    const burn = ccSloCurrentBurn(tiers, [tier("fast-burn", 3, 2)]);
    expect(burn).toEqual({ rate: 3, effective: 2, window: "1h" });
  });

  it("keeps the raw 1h rate but reads effective 0 once a spike has passed", () => {
    // long 3x (the last hour), short 0 (the last 5m): the number shown stays the
    // honest 1h rate, but effective is 0 so the pace reads steady, not draining.
    const burn = ccSloCurrentBurn(tiers, [tier("fast-burn", 3, 0)]);
    expect(burn).toEqual({ rate: 3, effective: 0, window: "1h" });
    expect(ccSloBurnPace(burn?.effective ?? null, [])).toBe("steady");
  });

  it("prefers the shortest-long-window tier and skips tiers with no long rate", () => {
    const burn = ccSloCurrentBurn(tiers, [
      tier("fast-burn", null, null), // no data -> skipped
      tier("slow-burn", 2, 2), // 6h long window
      tier("ticket", 1, 1), // 3d long window
    ]);
    expect(burn?.window).toBe("6h"); // slow-burn wins over ticket
  });
});

describe("ccTimeToExhaustionSecs", () => {
  it("mirrors the engine: window * budget / burn, truncated", () => {
    // 2592000s (30d) * 0.10 / 1.4 = 185142.857 -> 185142 (floor).
    expect(ccTimeToExhaustionSecs(0.1, 1.4, 2_592_000)).toBe(185142);
  });

  it("is null when any input is missing or the burn is non-positive", () => {
    expect(ccTimeToExhaustionSecs(null, 1.4, 2_592_000)).toBeNull();
    expect(ccTimeToExhaustionSecs(0.1, null, 2_592_000)).toBeNull();
    expect(ccTimeToExhaustionSecs(0.1, 1.4, null)).toBeNull();
    expect(ccTimeToExhaustionSecs(0.1, 0, 2_592_000)).toBeNull();
    expect(ccTimeToExhaustionSecs(0.1, -3, 2_592_000)).toBeNull();
  });

  it("is 0 when the budget is already overspent", () => {
    expect(ccTimeToExhaustionSecs(0, 1.4, 2_592_000)).toBe(0);
    expect(ccTimeToExhaustionSecs(-0.2, 1.4, 2_592_000)).toBe(0);
  });
});

describe("ccApplyFreshBudget", () => {
  function group(overrides: Partial<CcSloGroupStatus> = {}): CcSloGroupStatus {
    return {
      labels: { service: "checkout" },
      sli: 0.9992,
      budget_remaining: 0.42,
      tiers: [
        {
          name: "fast-burn",
          long_burn_rate: 1.4,
          short_burn_rate: 0.9,
          long_window_valid: 120000,
        },
      ],
      time_to_exhaustion_secs: 3 * 86400 + 4 * 3600,
      firing_tiers: [{ tier: "fast-burn", status: "firing" }],
      ...overrides,
    };
  }

  it("overrides budget/SLI and re-derives TTE, keeping tiers and firing", () => {
    const [merged] = ccApplyFreshBudget(
      CC_CANONICAL_SLO_TIERS,
      [group()],
      [{ labels: { service: "checkout" }, sli: 0.998, budgetRemaining: 0.1 }],
      2_592_000,
    );
    expect(merged.budget_remaining).toBe(0.1);
    expect(merged.sli).toBe(0.998);
    // TTE is re-derived from the fresh budget and the effective (both-window)
    // burn min(1.4, 0.9) = 0.9, not the raw 1h rate: 2592000 * 0.1 / 0.9 = 288000.
    expect(merged.time_to_exhaustion_secs).toBe(288000);
    // Burn tiers and firing state stay from the snapshot (they refresh often).
    expect(merged.tiers).toEqual(group().tiers);
    expect(merged.firing_tiers).toEqual(group().firing_tiers);
  });

  it("gives no exhaustion projection once a spike has passed (short back to 0)", () => {
    // Long window still remembers the spike (3×) but the short window has
    // recovered to 0, so the effective burn is 0 and there is nothing draining
    // the (fresh) budget to project an exhaustion from.
    const [merged] = ccApplyFreshBudget(
      CC_CANONICAL_SLO_TIERS,
      [
        group({
          tiers: [
            {
              name: "fast-burn",
              long_burn_rate: 3,
              short_burn_rate: 0,
              long_window_valid: 120000,
            },
          ],
        }),
      ],
      [{ labels: { service: "checkout" }, sli: 0.999, budgetRemaining: 0.5 }],
      2_592_000,
    );
    expect(merged.budget_remaining).toBe(0.5);
    expect(merged.time_to_exhaustion_secs).toBeNull();
  });

  it("gives no horizon when a slow tier fires on a burst the fastest tier has moved past", () => {
    // The payments-success-rate shape: the fast-burn short window is back to 0
    // (nothing spent recently), but the slow ticket tier still fires on a burst
    // still inside its 3d/6h windows. TTE reads the fastest tier's current spend
    // (min(4, 0) = 0), so there is no horizon — the ticket's lagging rate must not
    // fabricate an exhaustion time for a budget that is recovering.
    const [merged] = ccApplyFreshBudget(
      CC_CANONICAL_SLO_TIERS,
      [
        group({
          tiers: [
            {
              name: "fast-burn",
              long_burn_rate: 4,
              short_burn_rate: 0,
              long_window_valid: 120000,
            },
            {
              name: "ticket",
              long_burn_rate: 2,
              short_burn_rate: 1.5,
              long_window_valid: 120000,
            },
          ],
          firing_tiers: [{ tier: "ticket", status: "firing" }],
        }),
      ],
      [{ labels: { service: "checkout" }, sli: 0.98, budgetRemaining: 0.3 }],
      2_592_000,
    );
    expect(merged.time_to_exhaustion_secs).toBeNull();
    // The ticket badge still surfaces — the SLO is still firing, it just isn't
    // draining right now.
    expect(merged.firing_tiers).toEqual([{ tier: "ticket", status: "firing" }]);
  });

  it("matches groups by label set regardless of key order", () => {
    const g = group({ labels: { region: "eu", service: "checkout" } });
    const [merged] = ccApplyFreshBudget(
      CC_CANONICAL_SLO_TIERS,
      [g],
      [
        {
          labels: { service: "checkout", region: "eu" },
          sli: 1,
          budgetRemaining: 0.2,
        },
      ],
      2_592_000,
    );
    expect(merged.budget_remaining).toBe(0.2);
  });

  it("keeps the snapshot for groups with no fresh match (instant fallback)", () => {
    const [merged] = ccApplyFreshBudget(
      CC_CANONICAL_SLO_TIERS,
      [group()],
      [{ labels: { service: "cart" }, sli: 1, budgetRemaining: 0.99 }],
      2_592_000,
    );
    expect(merged.budget_remaining).toBe(0.42);
  });

  it("returns the snapshot unchanged when there is no fresh data", () => {
    const groups = [group()];
    expect(
      ccApplyFreshBudget(CC_CANONICAL_SLO_TIERS, groups, undefined, 2_592_000),
    ).toEqual(groups);
    expect(
      ccApplyFreshBudget(CC_CANONICAL_SLO_TIERS, groups, [], 2_592_000),
    ).toEqual(groups);
  });
});

describe("ccSloChartRange", () => {
  it("is exactly one SLO window ending now, as datemath", () => {
    expect(
      ccSloChartRange(
        spec({ timeWindow: { duration: "1d", isRolling: true } }),
      ),
    ).toEqual({ from: "now-1d", to: "now" });
    expect(
      ccSloChartRange(
        spec({ timeWindow: { duration: "30d", isRolling: true } }),
      ),
    ).toEqual({ from: "now-30d", to: "now" });
  });

  it("is null when the window shorthand doesn't parse", () => {
    expect(
      ccSloChartRange(
        spec({ timeWindow: { duration: "banana", isRolling: true } }),
      ),
    ).toBeNull();
  });
});

describe("ccSloBurnPace", () => {
  it("lets the firing state win, regardless of the rate", () => {
    expect(ccSloBurnPace(0.2, [{ severity: "critical" }])).toBe("burning-fast");
    expect(ccSloBurnPace(0.2, [{ severity: "warning" }])).toBe("burning");
    // Even a null rate still reads as firing when a tier is paging.
    expect(ccSloBurnPace(null, [{ severity: "critical" }])).toBe(
      "burning-fast",
    );
  });

  it("reads the rate against the 1x sustainable line when nothing fires", () => {
    expect(ccSloBurnPace(2, [])).toBe("draining");
    expect(ccSloBurnPace(1, [])).toBe("draining");
    expect(ccSloBurnPace(0.5, [])).toBe("sustainable");
    expect(ccSloBurnPace(0, [])).toBe("steady");
    expect(ccSloBurnPace(null, [])).toBe("steady");
  });

  it("labels each pace in plain words", () => {
    expect(ccSloBurnPaceLabel("burning-fast")).toBe("Burning fast");
    expect(ccSloBurnPaceLabel("draining")).toBe("Draining");
    expect(ccSloBurnPaceLabel("sustainable")).toBe("Sustainable");
    expect(ccSloBurnPaceLabel("steady")).toBe("Steady");
  });
});
