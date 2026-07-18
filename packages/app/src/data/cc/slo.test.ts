// The frontend mirror of domain/slo.rs: canonical tiers, tier-severity
// resolution, event handles, and the budget-projection duration format.
import { describe, expect, it } from "vitest";
import {
  CC_CANONICAL_SLO_TIERS,
  ccFormatSloDuration,
  ccSloHandleResolver,
  ccSloHandles,
  ccSloTierSeverity,
  ccSloTiers,
} from "./slo";
import type { CcSlo, CcSloSpec } from "./types";

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
    name: "checkout-availability",
    spec: spec(),
    version: 1,
    paused: false,
    ...overrides,
  };
}

describe("canonical tiers", () => {
  it("mirrors the engine's three SRE-workbook defaults", () => {
    // Must match domain/slo.rs canonical_tiers() exactly: the evaluator uses
    // these when spec.tiers is unset, and severity resolution reads them.
    expect(CC_CANONICAL_SLO_TIERS.map((t) => t.name)).toEqual([
      "fast-burn",
      "slow-burn",
      "ticket",
    ]);
    expect(CC_CANONICAL_SLO_TIERS[0].burn_rate).toBe(14.4);
    expect(CC_CANONICAL_SLO_TIERS[0].severity).toBe("critical");
    expect(CC_CANONICAL_SLO_TIERS[2].severity).toBe("warning");
  });

  it("ccSloTiers prefers explicit spec tiers over the canonical trio", () => {
    const explicit = [
      {
        name: "page",
        long_window: "1h",
        short_window: "5m",
        burn_rate: 10,
        severity: "warning" as const,
      },
    ];
    expect(ccSloTiers(spec({ tiers: explicit }))).toEqual(explicit);
    expect(ccSloTiers(spec())).toBe(CC_CANONICAL_SLO_TIERS);
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
  it("carries the uuid alone without an everr.name annotation, both with one", () => {
    expect(ccSloHandles(slo())).toEqual([
      "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    ]);
    expect(
      ccSloHandles(
        slo({ spec: spec({ annotations: { "everr.name": "checkout" } }) }),
      ),
    ).toEqual(["aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", "checkout"]);
  });

  it("resolves either handle to the SLO and misses unknown handles", () => {
    const resolve = ccSloHandleResolver([
      slo({ spec: spec({ annotations: { "everr.name": "checkout" } }) }),
    ]);
    expect(resolve("checkout")?.name).toBe("checkout-availability");
    expect(resolve("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee")?.name).toBe(
      "checkout-availability",
    );
    expect(resolve("some-rule-slug")).toBeUndefined();
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
