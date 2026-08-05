import { parseResourceName } from "@/data/as-code/identity";
import { fromCcSlo } from "@/data/slos/mapping";
import type { CcSlo, CcSloSpec, CcSloStatusPayload, CcSloTier } from "./types";

/**
 * Mirrors domain/slo.rs `canonical_tiers()`: the fixed 30-day-calibrated set
 * every SLO is evaluated on (not user-configurable). `critical` tiers page;
 * the `warning` tier opens a ticket.
 */
export const CC_CANONICAL_SLO_TIERS: readonly CcSloTier[] = [
  {
    name: "fast-burn",
    long_window: "1h",
    short_window: "5m",
    burn_rate: 14.4,
    severity: "critical",
  },
  {
    name: "slow-burn",
    long_window: "6h",
    short_window: "30m",
    burn_rate: 6.0,
    severity: "critical",
  },
  {
    name: "ticket",
    long_window: "3d",
    short_window: "6h",
    burn_rate: 1.0,
    severity: "warning",
  },
];

/**
 * Mirrors domain/slo.rs `tier_severity`: an unknown or missing tier resolves
 * to "critical" (conservative default for a tier no longer in the spec).
 */
export function ccSloTierSeverity(
  tiers: readonly CcSloTier[],
  labels: Record<string, string>,
): CcSloTier["severity"] {
  const name = labels.slo_tier;
  return tiers.find((t) => t.name === name)?.severity ?? "critical";
}

/**
 * Handles an event row may carry for an SLO (see ccRuleHandles): CC's alert
 * log stamps the first-class `name`, falling back to the source uuid for
 * older records (otel/alert_log.rs `slug_for`), so both appear in history.
 * The bare slug covers pre-deploy rows stamped from the old, project-less
 * everr.name annotation; the cross-project ambiguity that reintroduces is
 * intentional (matches the old project-agnostic behavior).
 */
export function ccSloHandles(slo: CcSlo): string[] {
  const { name, id } = slo;
  if (!name.includes("/")) return [id, name];
  return [id, name, parseResourceName(name).slug];
}

export type CcSloIdentity = {
  /** Human name: displayName || slug. */
  name: string;
  project: string;
  /** The as-code slug, split off the SLO's first-class `name`. */
  slug: string;
  /** The display-name annotation, or null when unset (name falls back to slug). */
  displayName: string | null;
};

export function ccSloIdentity(
  slo: Pick<CcSlo, "namespace" | "name" | "spec">,
): CcSloIdentity {
  const { project, slug, displayName } = fromCcSlo(slo);
  return { name: displayName || slug, project, slug, displayName };
}

// Unparseable → Infinity, so a malformed tier can never win the headline slot.
const TIER_WINDOW_SECONDS: Record<string, number> = {
  s: 1,
  m: 60,
  h: 3_600,
  d: 86_400,
  w: 604_800,
};

function tierWindowSecs(window: string): number {
  const m = /^(\d+)([smhdw])$/.exec(window);
  return m
    ? Number(m[1]) * TIER_WINDOW_SECONDS[m[2]]
    : Number.POSITIVE_INFINITY;
}

/** The window the canonical burn-rate table is calibrated for (30 days). */
const CC_CANONICAL_TIER_WINDOW_SECS = 30 * 86_400;

/** Floor on a scaled tier's short window (mirrors domain/slo.rs). */
const CC_SHORT_WINDOW_FLOOR_SECS = 60;

/**
 * Seconds every SLI window ends before the evaluation instant, mirroring the
 * engine's `CC_SLO_INGEST_DELAY_SECS` default (config.rs): rows take a few
 * seconds to settle in ClickHouse, so a window ending at "now" always
 * undercounts its trailing edge. Read-time SLI scans shift the same way so the
 * page and the engine measure the same intervals.
 */
export const CC_SLO_INGEST_DELAY_SECS = 10;

// Mirror of domain/slo.rs BASE_TIERS, calibrated to CC_CANONICAL_TIER_WINDOW_SECS.
const CC_BASE_TIERS: readonly {
  name: string;
  longSecs: number;
  shortSecs: number;
  burn_rate: number;
  severity: CcSloTier["severity"];
}[] = [
  {
    name: "fast-burn",
    longSecs: 3600,
    shortSecs: 300,
    burn_rate: 14.4,
    severity: "critical",
  },
  {
    name: "slow-burn",
    longSecs: 21_600,
    shortSecs: 1800,
    burn_rate: 6,
    severity: "critical",
  },
  {
    name: "ticket",
    longSecs: 259_200,
    shortSecs: 21_600,
    burn_rate: 1,
    severity: "warning",
  },
];

/** Seconds → shortest exact shorthand (mirror of domain/slo.rs `fmt_window_secs`). */
export function ccFmtWindowSecs(secs: number): string {
  if (secs % 604_800 === 0) return `${secs / 604_800}w`;
  if (secs % 86_400 === 0) return `${secs / 86_400}d`;
  if (secs % 3600 === 0) return `${secs / 3600}h`;
  if (secs % 60 === 0) return `${secs / 60}m`;
  return `${secs}s`;
}

/**
 * Two largest non-zero units ("1008m" → "16h 48m"; seconds kept, not rounded).
 * An unparsable window passes through untouched.
 */
export function ccFmtWindowLabel(window: string): string {
  const secs = tierWindowSecs(window);
  if (!Number.isFinite(secs)) return window;
  const units: [number, string][] = [
    [Math.floor(secs / 86_400), "d"],
    [Math.floor((secs % 86_400) / 3600), "h"],
    [Math.floor((secs % 3600) / 60), "m"],
    [secs % 60, "s"],
  ];
  const parts = units.filter(([n]) => n > 0).map(([n, u]) => `${n}${u}`);
  return parts.slice(0, 2).join(" ") || "0s";
}

/**
 * Tiers scaled to the SLO's own budget window; falls back to the canonical
 * 30-day windows when the spec's window doesn't parse (guarded at the API,
 * defensive here).
 */
export function ccSloTiers(spec: CcSloSpec): CcSloTier[] {
  return ccTiersForWindow(
    ccSloWindowSecs(spec) ?? CC_CANONICAL_TIER_WINDOW_SECS,
  );
}

/**
 * Mirrors domain/slo.rs `tiers_for_window`: the engine measures burn over these
 * scaled windows, so surfaces must label with the same ones. Short windows
 * floor at `CC_SHORT_WINDOW_FLOOR_SECS`, pinning the tier at its 12:1 ratio.
 * When the floor makes two tiers' windows identical (e.g. a 1-day budget),
 * the engine keeps only the lower threshold and never evaluates the other, so
 * the dropped tier is omitted here too (it could never carry data).
 */
export function ccTiersForWindow(windowSecs: number): CcSloTier[] {
  const k = windowSecs / CC_CANONICAL_TIER_WINDOW_SECS;
  // Keyed on computed seconds, not rendered windows, so the collapse never
  // depends on ccFmtWindowSecs being injective.
  const seen: Array<[number, number]> = [];
  const out: CcSloTier[] = [];
  for (const b of CC_BASE_TIERS) {
    const shortScaled = Math.round(b.shortSecs * k);
    const [long, short] =
      shortScaled < CC_SHORT_WINDOW_FLOOR_SECS
        ? [
            CC_SHORT_WINDOW_FLOOR_SECS * (b.longSecs / b.shortSecs),
            CC_SHORT_WINDOW_FLOOR_SECS,
          ]
        : [Math.round(b.longSecs * k), shortScaled];
    const tier: CcSloTier = {
      name: b.name,
      long_window: ccFmtWindowSecs(long),
      short_window: ccFmtWindowSecs(short),
      burn_rate: b.burn_rate,
      severity: b.severity,
    };
    // CC_BASE_TIERS runs fastest-first with strictly decreasing thresholds, so
    // a colliding newcomer is always the lower-threshold twin: it takes the slot.
    const twin = seen.findIndex(([l, s]) => l === long && s === short);
    if (twin === -1) {
      seen.push([long, short]);
      out.push(tier);
    } else {
      out[twin] = tier;
    }
  }
  return out;
}

/**
 * Burn confirmed by BOTH windows: `min(long, short)` — the same both-windows
 * agreement the engine fires on. Reads 0 once a spike passes (the short window
 * drops first) even while the long window remembers it. Null when either
 * window has no data, so a rate is only claimed when confirmed.
 */
export function ccEffectiveBurn(
  longBurn: number | null | undefined,
  shortBurn: number | null | undefined,
): number | null {
  if (longBurn == null || shortBurn == null) return null;
  return Math.min(longBurn, shortBurn);
}

/**
 * Headline burn: the shortest-long-window tier with a computed long-window
 * rate. `rate` is that long-window value, labelled by `window`; `effective` is
 * `min(long, short)`. Read pace and time-to-exhaustion off `effective` so a
 * recovering budget never reads as draining; show `rate` as the raw figure.
 */
export function ccSloCurrentBurn(
  specTiers: readonly CcSloTier[],
  snapshot: CcSloStatusPayload["tiers"],
): { rate: number; effective: number | null; window: string } | null {
  const byName = new Map(snapshot.map((t) => [t.name, t]));
  let best: {
    rate: number;
    effective: number | null;
    window: string;
    secs: number;
  } | null = null;
  for (const t of specTiers) {
    const s = byName.get(t.name);
    const long = s?.long_burn_rate;
    if (long === null || long === undefined) continue;
    const secs = tierWindowSecs(t.long_window);
    if (best === null || secs < best.secs) {
      best = {
        rate: long,
        effective: ccEffectiveBurn(long, s?.short_burn_rate),
        window: t.long_window,
        secs,
      };
    }
  }
  return best === null
    ? null
    : { rate: best.rate, effective: best.effective, window: best.window };
}

// Firing state wins over the rate; then the rate against the 1x sustainable line.
export type CcSloBurnPace =
  | "burning-fast"
  | "burning"
  | "draining"
  | "sustainable"
  | "steady";

/**
 * Pace of a confirmed burn against the 1x sustainable line. The firing paces
 * (`burning-fast`/`burning`) are ccSloOverallPace's to assign: firing is a
 * tier-state fact, not burn arithmetic.
 */
export function ccSloBurnPace(rate: number | null): CcSloBurnPace {
  if (rate === null || rate <= 0) return "steady";
  if (rate >= 1) return "draining"; // spending faster than sustainable
  return "sustainable"; // under 1x: recovers within the window
}

/**
 * The highest severity among the firing tiers; null when nothing fires.
 */
export function ccSloFiringSeverity(
  specTiers: readonly CcSloTier[],
  firingTiers: readonly { tier: string }[],
): CcSloTier["severity"] | null {
  let worst: CcSloTier["severity"] | null = null;
  for (const f of firingTiers) {
    const severity = ccSloTierSeverity(specTiers, { slo_tier: f.tier });
    if (severity === "critical") return "critical";
    worst = severity;
  }
  return worst;
}

/**
 * SLO pace: a firing tier wins, otherwise use the fastest confirmed burn.
 */
export function ccSloOverallPace(
  specTiers: readonly CcSloTier[],
  status: CcSloStatusPayload,
): CcSloBurnPace {
  const severity = ccSloFiringSeverity(specTiers, status.firing_tiers);
  if (severity === "critical") return "burning-fast";
  if (severity !== null) return "burning";
  return ccSloBurnPace(
    ccSloCurrentBurn(specTiers, status.tiers)?.effective ?? null,
  );
}

export function ccSloBurnPaceLabel(pace: CcSloBurnPace): string {
  switch (pace) {
    // The two firing paces speak alert severity, not burn arithmetic: that is
    // the vocabulary every surface renders.
    case "burning-fast":
      return "Critical";
    case "burning":
      return "Warning";
    case "draining":
      return "Draining";
    case "sustainable":
      return "Sustainable";
    case "steady":
      return "Steady";
  }
}

/** "99.9%" without trailing-zero noise ("99.5%", "99.95%"). */
export function ccFormatSloTarget(targetPercent: number): string {
  return `${targetPercent}%`;
}

/** Read-time error budget from `querySloBudgetNow`. */
export type CcFreshBudget = {
  sli: number | null;
  budgetRemaining: number | null;
};

/**
 * Mirrors the engine's `time_to_exhaustion_secs` (engine/slo_math.rs) exactly:
 * null when any input is missing or burn is non-positive, 0 when already
 * overspent, else `window * budget_remaining / burn_rate` truncated.
 */
export function ccTimeToExhaustionSecs(
  budgetRemaining: number | null,
  burnRate: number | null,
  windowSecs: number | null,
): number | null {
  if (budgetRemaining === null || burnRate === null || windowSecs === null) {
    return null;
  }
  if (Number.isNaN(burnRate) || burnRate <= 0) return null;
  if (budgetRemaining <= 0) return 0;
  return Math.floor((windowSecs * budgetRemaining) / burnRate);
}

/**
 * Budget is consulted before the forecast, deliberately reversing the engine's
 * `time_to_exhaustion_secs` (engine/slo_math.rs): a spent budget is exhausted
 * whether or not anything is burning right now.
 */
export type CcSloExhaustion = {
  kind: "exhausted" | "forecast" | "not-shrinking" | "unknown";
  /** What every surface prints; only the tone is left to the caller. */
  label: string;
};

/** Every surface decides "exhausted" through here so the <=0 boundary and
 *  its null semantics never drift between pages. */
export function ccBudgetExhausted(
  remaining: number | null,
): remaining is number {
  return remaining !== null && remaining <= 0;
}

export function ccSloExhaustion(
  budgetRemaining: number | null,
  tteSecs: number | null,
  effectiveBurn: number | null,
): CcSloExhaustion {
  if (ccBudgetExhausted(budgetRemaining)) {
    return { kind: "exhausted", label: "exhausted" };
  }
  // A zero forecast needs no case of its own: the engine only produces one when
  // the budget is already spent, which the check above has taken.
  if (tteSecs !== null) {
    return { kind: "forecast", label: ccFormatSloDuration(tteSecs) };
  }
  if (effectiveBurn === 0) {
    return { kind: "not-shrinking", label: "not shrinking" };
  }
  return { kind: "unknown", label: "—" };
}

/**
 * Override the stored budget/SLI/TTE with fresh read-time values. Burn rates
 * and firing tiers stay from the evaluator snapshot.
 */
export function ccApplyFreshBudget(
  specTiers: readonly CcSloTier[],
  status: CcSloStatusPayload,
  fresh: CcFreshBudget | undefined,
  windowSecs: number | null,
): CcSloStatusPayload {
  if (fresh === undefined) return status;
  return {
    ...status,
    sli: fresh.sli,
    budget_remaining: fresh.budgetRemaining,
    time_to_exhaustion_secs: ccTimeToExhaustionSecs(
      fresh.budgetRemaining,
      ccSloCurrentBurn(specTiers, status.tiers)?.effective ?? null,
      windowSecs,
    ),
  };
}

// `at-risk` is the low-budget warning band; `unknown` is no snapshot yet.
export type CcSloState =
  | "exhausted"
  | "firing-critical"
  | "firing-warning"
  | "at-risk"
  | "healthy"
  | "unknown";

export function ccSloStatusState(
  tiers: readonly CcSloTier[],
  status: CcSloStatusPayload | null,
): CcSloState {
  if (status === null) return "unknown";
  if (ccBudgetExhausted(status.budget_remaining)) {
    return "exhausted";
  }
  const severity = ccSloFiringSeverity(tiers, status.firing_tiers);
  if (severity === "critical") return "firing-critical";
  if (severity !== null) return "firing-warning";
  if (status.budget_remaining !== null && status.budget_remaining < 0.25) {
    return "at-risk";
  }
  return "healthy";
}

/** "30d rolling" (v1 is rolling-only; the flag is honored anyway). */
export function ccSloWindowLabel(spec: CcSloSpec): string {
  const { duration, isRolling } = spec.timeWindow;
  return isRolling ? `${duration} rolling` : duration;
}

/** Budget window in whole seconds; null if the duration shorthand doesn't parse. */
export function ccSloWindowSecs(spec: CcSloSpec): number | null {
  const secs = tierWindowSecs(spec.timeWindow.duration);
  return Number.isFinite(secs) ? secs : null;
}

/**
 * Chart range: exactly one SLO window ending now, so the rightmost point's
 * trailing window is the same span the status hero reads and the two agree.
 * Datemath (`now-<window>` .. `now`) keeps the query key stable across reloads.
 * Null when the window shorthand doesn't parse.
 */
export function ccSloChartRange(
  spec: CcSloSpec,
): { from: string; to: string } | null {
  if (ccSloWindowSecs(spec) === null) return null;
  return { from: `now-${spec.timeWindow.duration}`, to: "now" };
}

/**
 * Two largest non-zero units ("3d 4h"), mirroring the engine's readout
 * granularity (engine/slo_math.rs `fmt_duration_secs`).
 */
export function ccFormatSloDuration(secs: number): string {
  const s = Math.max(0, Math.floor(secs));
  const d = Math.floor(s / 86_400);
  const h = Math.floor((s % 86_400) / 3_600);
  const m = Math.floor((s % 3_600) / 60);
  if (d > 0) return h > 0 ? `${d}d ${h}h` : `${d}d`;
  if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`;
  if (m > 0) return `${m}m`;
  return `${s % 60}s`;
}
