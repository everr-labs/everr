// Canonical tiers, tier-severity resolution, event handles, and the
// budget-projection duration format.
import { describe, expect, it } from "vitest";
import { ANN_DISPLAY_NAME } from "@/data/alerting/resources/annotations";
import type {
  AlertingSlo,
  AlertingSloSpec,
  AlertingSloStatusPayload,
} from "../types";
import {
  ALERTING_CANONICAL_SLO_TIERS,
  alertingApplyFreshBudget,
  alertingEffectiveBurn,
  alertingFmtWindowSecs,
  alertingFormatClickHouseDateTime,
  alertingFormatSloDuration,
  alertingSloBurnPace,
  alertingSloChartRange,
  alertingSloCurrentBurn,
  alertingSloExhaustion,
  alertingSloHandles,
  alertingSloIdentity,
  alertingSloOverallPace,
  alertingSloTierSeverity,
  alertingTiersForWindow,
  alertingTimeToExhaustionSecs,
} from "./model";

describe("alertingFormatClickHouseDateTime", () => {
  it("formats UTC DateTime parameters at second precision", () => {
    expect(
      alertingFormatClickHouseDateTime(new Date("2026-08-05T12:47:33.497Z")),
    ).toBe("2026-08-05 12:47:33");
  });
});

function spec(overrides: Partial<AlertingSloSpec> = {}): AlertingSloSpec {
  return {
    sli: { sql: "SELECT 1 AS good, 1 AS valid" },
    targetPercent: 99.9,
    timeWindow: { duration: "30d", isRolling: true },
    annotations: {},
    suppressed: false,
    ...overrides,
  };
}

function slo(overrides: Partial<AlertingSlo> = {}): AlertingSlo {
  return {
    id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    tenant: "org1",
    repoid: "repo-1",
    previewId: null,
    name: "default/checkout-availability",
    spec: spec(),
    version: 1,
    paused: false,
    ...overrides,
  };
}

describe("canonical tiers", () => {
  it("uses the three SRE-workbook tiers and resolves their severity", () => {
    // Every SLO is evaluated on this fixed set (tiers are not user-configurable),
    // and severity resolution reads them. Two critical (page), one warning
    // (ticket).
    expect(ALERTING_CANONICAL_SLO_TIERS.map((t) => t.name)).toEqual([
      "fast-burn",
      "slow-burn",
      "ticket",
    ]);
    expect(ALERTING_CANONICAL_SLO_TIERS[0].burn_rate).toBe(14.4);
    expect(ALERTING_CANONICAL_SLO_TIERS[0].severity).toBe("critical");
    expect(ALERTING_CANONICAL_SLO_TIERS[1].severity).toBe("critical");
    expect(ALERTING_CANONICAL_SLO_TIERS[2].severity).toBe("warning");
    // Includes the conservative fallback for a tier no longer in the spec.
    const tiers = ALERTING_CANONICAL_SLO_TIERS;
    expect(alertingSloTierSeverity(tiers, { slo_tier: "ticket" })).toBe(
      "warning",
    );
    expect(alertingSloTierSeverity(tiers, { slo_tier: "ghost-tier" })).toBe(
      "critical",
    );
    expect(alertingSloTierSeverity(tiers, {})).toBe("critical");
  });
});

describe("alertingTiersForWindow", () => {
  it("reproduces the canonical 30-day windows exactly", () => {
    const t = alertingTiersForWindow(30 * 86_400);
    expect(t.map((x) => [x.long_window, x.short_window])).toEqual([
      ["1h", "5m"],
      ["6h", "30m"],
      ["3d", "6h"],
    ]);
  });

  it("scales windows proportionally for a 7-day window, thresholds unchanged", () => {
    const t = alertingTiersForWindow(7 * 86_400); // k = 7/30
    expect(t[0]).toMatchObject({ long_window: "14m", short_window: "70s" });
    expect(t[1]).toMatchObject({ long_window: "84m", short_window: "7m" });
    expect(t[2]).toMatchObject({ short_window: "84m", burn_rate: 1 });
    expect(t[0].burn_rate).toBe(14.4);
  });

  it("drops a tier the floor collapses onto an earlier tier's windows", () => {
    // The evaluator keeps only the lower threshold, so the UI must not render a
    // fast-burn tier that is never evaluated. Every
    // surviving long window also stays inside the objective: the canonical 3-day
    // ticket window is longer than a 1-day SLO, and scaling is what fixes it.
    const t = alertingTiersForWindow(86_400);
    expect(t).toHaveLength(2);
    expect(t[0]).toMatchObject({
      name: "slow-burn",
      long_window: "12m",
      short_window: "1m",
      burn_rate: 6,
    });
    expect(t[1]).toMatchObject({
      name: "ticket",
      long_window: "144m",
      short_window: "12m",
    });
  });
});

describe("alertingFmtWindowSecs", () => {
  it("picks the coarsest exact unit, falling back to seconds", () => {
    expect(alertingFmtWindowSecs(3600)).toBe("1h");
    expect(alertingFmtWindowSecs(259_200)).toBe("3d");
    expect(alertingFmtWindowSecs(300)).toBe("5m");
    expect(alertingFmtWindowSecs(70)).toBe("70s");
    expect(alertingFmtWindowSecs(604_800)).toBe("1w");
  });
});

describe("SLO event handles", () => {
  it("returns only the canonical event slug", () => {
    expect(alertingSloHandles(slo())).toEqual([
      "default/checkout-availability",
    ]);
    expect(alertingSloHandles(slo({ name: "payments/checkout" }))).toEqual([
      "payments/checkout",
    ]);
  });
});

describe("alertingSloIdentity", () => {
  it("prefers the display-name annotation, falling back to the slug", () => {
    expect(alertingSloIdentity(slo({ name: "payments/checkout" }))).toEqual({
      name: "checkout",
      project: "payments",
      slug: "checkout",
      displayName: null,
    });
    expect(
      alertingSloIdentity(
        slo({
          name: "payments/checkout",
          spec: spec({
            annotations: { [ANN_DISPLAY_NAME]: "Checkout availability" },
          }),
        }),
      ),
    ).toEqual({
      name: "Checkout availability",
      project: "payments",
      slug: "checkout",
      displayName: "Checkout availability",
    });
  });
});

describe("alertingFormatSloDuration", () => {
  it("keeps the two largest non-zero duration units", () => {
    expect(alertingFormatSloDuration(30)).toBe("30s");
    expect(alertingFormatSloDuration(45 * 60)).toBe("45m");
    expect(alertingFormatSloDuration(2 * 3600 + 15 * 60)).toBe("2h 15m");
    expect(alertingFormatSloDuration(2 * 3600)).toBe("2h");
    expect(alertingFormatSloDuration(3 * 86400 + 4 * 3600 + 30 * 60)).toBe(
      "3d 4h",
    );
    expect(alertingFormatSloDuration(3 * 86400)).toBe("3d");
    expect(alertingFormatSloDuration(0)).toBe("0s");
  });
});

describe("alertingSloExhaustion", () => {
  it("says exhausted from the budget alone, with no burn to forecast from", () => {
    // A spent budget is exhausted even when the current burn is zero.
    expect(alertingSloExhaustion(-20.8, null, null).label).toBe("exhausted");
    expect(alertingSloExhaustion(0, null, null).label).toBe("exhausted");
  });

  it("passes a live forecast through, and says why when there is none", () => {
    expect(alertingSloExhaustion(0.3, 7200, 2)).toEqual({
      kind: "forecast",
      label: "2h",
    });
    expect(alertingSloExhaustion(0.4, null, 0).label).toBe("not shrinking");
    expect(alertingSloExhaustion(0.4, null, null).label).toBe("—");
    expect(alertingSloExhaustion(null, null, null).label).toBe("—");
  });
});

describe("alertingEffectiveBurn", () => {
  it("is min(long, short), and null when either window has no data", () => {
    expect(alertingEffectiveBurn(3, 2)).toBe(2);
    expect(alertingEffectiveBurn(2, 3)).toBe(2);
    // A passed spike: long still remembers it, short has recovered to 0.
    expect(alertingEffectiveBurn(3, 0)).toBe(0);
    expect(alertingEffectiveBurn(3, null)).toBeNull();
    expect(alertingEffectiveBurn(null, 2)).toBeNull();
    expect(alertingEffectiveBurn(undefined, undefined)).toBeNull();
  });
});

describe("alertingSloCurrentBurn", () => {
  const tiers = ALERTING_CANONICAL_SLO_TIERS;
  const tier = (
    name: string,
    long: number | null,
    short: number | null,
  ): AlertingSloStatusPayload["tiers"][number] => ({
    name,
    long_burn_rate: long,
    short_burn_rate: short,
    long_window_valid: null,
  });

  it("leads with the fast-burn 1h rate but carries the confirmed effective burn", () => {
    // Sustained drain: long 3x over 1h, short 2x over 5m -> shows the 1h figure,
    // effective is the both-window min (2x) that pace/TTE read.
    expect(alertingSloCurrentBurn(tiers, [tier("fast-burn", 3, 2)])).toEqual({
      rate: 3,
      effective: 2,
      window: "1h",
    });
    // Once the spike has passed (short back to 0) the number shown stays the
    // honest 1h rate, but effective is 0 so the pace reads steady, not draining.
    const passed = alertingSloCurrentBurn(tiers, [tier("fast-burn", 3, 0)]);
    expect(passed).toEqual({ rate: 3, effective: 0, window: "1h" });
    expect(alertingSloBurnPace(passed?.effective ?? null)).toBe("steady");
  });

  it("prefers the shortest-long-window tier and skips tiers with no long rate", () => {
    const burn = alertingSloCurrentBurn(tiers, [
      tier("fast-burn", null, null), // no data -> skipped
      tier("slow-burn", 2, 2), // 6h long window
      tier("ticket", 1, 1), // 3d long window
    ]);
    expect(burn?.window).toBe("6h"); // slow-burn wins over ticket
  });
});

describe("alertingTimeToExhaustionSecs", () => {
  it("forecasts as window times budget divided by burn, truncated", () => {
    // 2592000s (30d) * 0.10 / 1.4 = 185142.857 -> 185142 (floor).
    expect(alertingTimeToExhaustionSecs(0.1, 1.4, 2_592_000)).toBe(185142);
    expect(alertingTimeToExhaustionSecs(0, 1.4, 2_592_000)).toBe(0);
    expect(alertingTimeToExhaustionSecs(-0.2, 1.4, 2_592_000)).toBe(0);
  });

  it("is null when any input is missing or the burn is non-positive", () => {
    expect(alertingTimeToExhaustionSecs(null, 1.4, 2_592_000)).toBeNull();
    expect(alertingTimeToExhaustionSecs(0.1, null, 2_592_000)).toBeNull();
    expect(alertingTimeToExhaustionSecs(0.1, 1.4, null)).toBeNull();
    expect(alertingTimeToExhaustionSecs(0.1, 0, 2_592_000)).toBeNull();
    expect(alertingTimeToExhaustionSecs(0.1, -3, 2_592_000)).toBeNull();
  });
});

describe("alertingApplyFreshBudget", () => {
  function status(
    overrides: Partial<AlertingSloStatusPayload> = {},
  ): AlertingSloStatusPayload {
    return {
      window: "30d",
      target_percent: 99.9,
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
      window_computed_at: {},
      ...overrides,
    };
  }

  it("overrides budget/SLI and re-derives TTE, keeping tiers and firing", () => {
    const merged = alertingApplyFreshBudget(
      ALERTING_CANONICAL_SLO_TIERS,
      status(),
      { sli: 0.998, budgetRemaining: 0.1 },
      2_592_000,
    );
    expect(merged.budget_remaining).toBe(0.1);
    expect(merged.sli).toBe(0.998);
    // TTE is re-derived from the fresh budget and the effective (both-window)
    // burn min(1.4, 0.9) = 0.9, not the raw 1h rate: 2592000 * 0.1 / 0.9 = 288000.
    expect(merged.time_to_exhaustion_secs).toBe(288000);
    // Burn tiers and firing state stay from the snapshot (they refresh often).
    expect(merged.tiers).toEqual(status().tiers);
    expect(merged.firing_tiers).toEqual(status().firing_tiers);
  });

  it("gives no horizon when a slow tier fires on a burst the fastest tier has moved past", () => {
    // The payments-success-rate shape: the fast-burn short window is back to 0
    // (nothing spent recently), but the slow ticket tier still fires on a burst
    // still inside its 3d/6h windows. TTE reads the fastest tier's current spend
    // (min(4, 0) = 0), so there is no horizon — the ticket's lagging rate must not
    // fabricate an exhaustion time for a budget that is recovering.
    const merged = alertingApplyFreshBudget(
      ALERTING_CANONICAL_SLO_TIERS,
      status({
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
      { sli: 0.98, budgetRemaining: 0.3 },
      2_592_000,
    );
    expect(merged.budget_remaining).toBe(0.3);
    expect(merged.time_to_exhaustion_secs).toBeNull();
    // The ticket badge still surfaces — the SLO is still firing, it just isn't
    // draining right now.
    expect(merged.firing_tiers).toEqual([{ tier: "ticket", status: "firing" }]);
  });

  it("keeps the snapshot when the scan has no result", () => {
    const snapshot = status();
    expect(
      alertingApplyFreshBudget(
        ALERTING_CANONICAL_SLO_TIERS,
        snapshot,
        undefined,
        2_592_000,
      ),
    ).toEqual(snapshot);
  });
});

describe("alertingSloChartRange", () => {
  it("is exactly one SLO window ending now, as datemath, null when it doesn't parse", () => {
    expect(
      alertingSloChartRange(
        spec({ timeWindow: { duration: "30d", isRolling: true } }),
      ),
    ).toEqual({ from: "now-30d", to: "now" });
    expect(
      alertingSloChartRange(
        spec({ timeWindow: { duration: "banana", isRolling: true } }),
      ),
    ).toBeNull();
  });
});

describe("alertingSloBurnPace", () => {
  // Firing precedence (burning-fast/burning) is alertingSloOverallPace's business
  // and is tested there; this ladder only reads the rate.
  it("reads the rate against the 1x sustainable line", () => {
    expect(alertingSloBurnPace(2)).toBe("draining");
    expect(alertingSloBurnPace(1)).toBe("draining");
    expect(alertingSloBurnPace(0.5)).toBe("sustainable");
    expect(alertingSloBurnPace(0)).toBe("steady");
    expect(alertingSloBurnPace(null)).toBe("steady");
  });
});

describe("alertingSloOverallPace", () => {
  const tiers = ALERTING_CANONICAL_SLO_TIERS;
  const status = (
    o: Partial<AlertingSloStatusPayload>,
  ): AlertingSloStatusPayload => ({
    window: "30d",
    target_percent: 99.9,
    sli: null,
    budget_remaining: null,
    tiers: [],
    time_to_exhaustion_secs: null,
    firing_tiers: [],
    window_computed_at: {},
    ...o,
  });
  const tier = (
    name: string,
    long: number | null,
    short: number | null,
  ): AlertingSloStatusPayload["tiers"][number] => ({
    name,
    long_burn_rate: long,
    short_burn_rate: short,
    long_window_valid: null,
  });

  it("uses a firing warning tier before burn arithmetic", () => {
    const firing = status({
      budget_remaining: -20,
      tiers: [tier("ticket", 64, 40)],
      firing_tiers: [{ tier: "ticket", status: "firing" }],
    });
    expect(alertingSloOverallPace(tiers, firing)).toBe("burning");
  });

  it("escalates to burning-fast for a critical tier", () => {
    const critical = status({
      firing_tiers: [{ tier: "fast-burn", status: "firing" }],
    });
    expect(alertingSloOverallPace(tiers, critical)).toBe("burning-fast");
  });

  it("paces by the confirmed burn when no tier fires", () => {
    expect(
      alertingSloOverallPace(
        tiers,
        status({ tiers: [tier("fast-burn", 2, 2)] }),
      ),
    ).toBe("draining");
    expect(
      alertingSloOverallPace(
        tiers,
        status({ tiers: [tier("fast-burn", 0, 0)] }),
      ),
    ).toBe("steady");
  });

  it("is steady when there is no confirmed burn", () => {
    expect(
      alertingSloOverallPace(
        tiers,
        status({ tiers: [tier("ticket", null, null)] }),
      ),
    ).toBe("steady");
  });
});
