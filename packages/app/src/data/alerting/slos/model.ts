import { fromAlertingSlo } from "@/data/alerting/resources/slos/mapping";
import type {
  AlertingSlo,
  AlertingSloSpec,
  AlertingSloStatusPayload,
  AlertingSloTier,
} from "../types";

/**
 * The fixed 30-day-calibrated set every SLO is evaluated on. These tiers are
 * not user-configurable: `critical` tiers page and the `warning` tier opens a
 * ticket.
 */
export const ALERTING_CANONICAL_SLO_TIERS: readonly AlertingSloTier[] = [
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
 * An unknown or missing tier resolves to "critical", a conservative default
 * for a tier no longer in the spec.
 */
export function alertingSloTierSeverity(
  tiers: readonly AlertingSloTier[],
  labels: Record<string, string>,
): AlertingSloTier["severity"] {
  const name = labels.slo_tier;
  return tiers.find((t) => t.name === name)?.severity ?? "critical";
}

/** The canonical event-log slug for an SLO. */
export function alertingSloHandles(slo: AlertingSlo): string[] {
  return [slo.name];
}

export type AlertingSloIdentity = {
  /** Human name: displayName || slug. */
  name: string;
  project: string;
  /** The as-code slug, split off the SLO's first-class `name`. */
  slug: string;
  /** The display-name annotation, or null when unset (name falls back to slug). */
  displayName: string | null;
};

export function alertingSloIdentity(
  slo: Pick<AlertingSlo, "previewId" | "repoid" | "name" | "spec">,
): AlertingSloIdentity {
  const { project, slug, displayName } = fromAlertingSlo(slo);
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
const ALERTING_CANONICAL_TIER_WINDOW_SECS = 30 * 86_400;

/** Floor on a scaled tier's short window. */
const ALERTING_SHORT_WINDOW_FLOOR_SECS = 60;

/**
 * Seconds every SLI window ends before the evaluation instant. Rows take a few
 * seconds to settle in ClickHouse, so a window ending at "now" always
 * undercounts its trailing edge. Read-time SLI scans use the same shift so the
 * page and evaluator measure identical intervals.
 */
export const ALERTING_SLO_INGEST_DELAY_SECS = 10;

/** ClickHouse `DateTime` query parameter value at its native second precision. */
export function alertingFormatClickHouseDateTime(date: Date): string {
  return date.toISOString().slice(0, 19).replace("T", " ");
}

// Base tiers calibrated to ALERTING_CANONICAL_TIER_WINDOW_SECS.
const ALERTING_BASE_TIERS: readonly {
  name: string;
  longSecs: number;
  shortSecs: number;
  burn_rate: number;
  severity: AlertingSloTier["severity"];
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

/** Seconds to shortest exact shorthand. */
export function alertingFmtWindowSecs(secs: number): string {
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
export function alertingFmtWindowLabel(window: string): string {
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
export function alertingSloTiers(spec: AlertingSloSpec): AlertingSloTier[] {
  return alertingTiersForWindow(
    alertingSloWindowSecs(spec) ?? ALERTING_CANONICAL_TIER_WINDOW_SECS,
  );
}

/**
 * The evaluator measures burn over these scaled windows, so surfaces must
 * label with the same ones. Short windows
 * floor at `ALERTING_SHORT_WINDOW_FLOOR_SECS`, pinning the tier at its 12:1 ratio.
 * When the floor makes two tiers' windows identical (e.g. a 1-day budget),
 * the evaluator keeps only the lower threshold and never evaluates the other, so
 * the dropped tier is omitted here too (it could never carry data).
 */
export function alertingTiersForWindow(windowSecs: number): AlertingSloTier[] {
  const k = windowSecs / ALERTING_CANONICAL_TIER_WINDOW_SECS;
  // Keyed on computed seconds, not rendered windows, so the collapse never
  // depends on alertingFmtWindowSecs being injective.
  const seen: Array<[number, number]> = [];
  const out: AlertingSloTier[] = [];
  for (const b of ALERTING_BASE_TIERS) {
    const shortScaled = Math.round(b.shortSecs * k);
    const [long, short] =
      shortScaled < ALERTING_SHORT_WINDOW_FLOOR_SECS
        ? [
            ALERTING_SHORT_WINDOW_FLOOR_SECS * (b.longSecs / b.shortSecs),
            ALERTING_SHORT_WINDOW_FLOOR_SECS,
          ]
        : [Math.round(b.longSecs * k), shortScaled];
    const tier: AlertingSloTier = {
      name: b.name,
      long_window: alertingFmtWindowSecs(long),
      short_window: alertingFmtWindowSecs(short),
      burn_rate: b.burn_rate,
      severity: b.severity,
    };
    // ALERTING_BASE_TIERS runs fastest-first with strictly decreasing thresholds, so
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
 * Confirmed burn is the lower of the long and short window rates. It is null
 * until both windows have data.
 */
export function alertingEffectiveBurn(
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
export function alertingSloCurrentBurn(
  specTiers: readonly AlertingSloTier[],
  snapshot: AlertingSloStatusPayload["tiers"],
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
        effective: alertingEffectiveBurn(long, s?.short_burn_rate),
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
export type AlertingSloBurnPace =
  | "burning-fast"
  | "burning"
  | "draining"
  | "sustainable"
  | "steady";

/**
 * Pace of a confirmed burn against the 1x sustainable line. The firing paces
 * (`burning-fast`/`burning`) are alertingSloOverallPace's to assign: firing is a
 * tier-state fact, not burn arithmetic.
 */
export function alertingSloBurnPace(rate: number | null): AlertingSloBurnPace {
  if (rate === null || rate <= 0) return "steady";
  if (rate >= 1) return "draining"; // spending faster than sustainable
  return "sustainable"; // under 1x: recovers within the window
}

function alertingSloFiringSeverity(
  specTiers: readonly AlertingSloTier[],
  firingTiers: readonly { tier: string }[],
): AlertingSloTier["severity"] | null {
  let worst: AlertingSloTier["severity"] | null = null;
  for (const firing of firingTiers) {
    const severity = alertingSloTierSeverity(specTiers, {
      slo_tier: firing.tier,
    });
    if (severity === "critical") return "critical";
    worst = severity;
  }
  return worst;
}

/**
 * SLO pace: a firing tier wins, otherwise use the fastest confirmed burn.
 */
export function alertingSloOverallPace(
  specTiers: readonly AlertingSloTier[],
  status: AlertingSloStatusPayload,
): AlertingSloBurnPace {
  const severity = alertingSloFiringSeverity(specTiers, status.firing_tiers);
  if (severity === "critical") return "burning-fast";
  if (severity !== null) return "burning";
  return alertingSloBurnPace(
    alertingSloCurrentBurn(specTiers, status.tiers)?.effective ?? null,
  );
}

export function alertingSloBurnPaceLabel(pace: AlertingSloBurnPace): string {
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
export function alertingFormatSloTarget(targetPercent: number): string {
  return `${targetPercent}%`;
}

/** Read-time error budget from `querySloBudgetNow`. */
export type AlertingFreshBudget = {
  sli: number | null;
  budgetRemaining: number | null;
};

/** Forecast exhaustion as `window * budgetRemaining / burnRate`. */
export function alertingTimeToExhaustionSecs(
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

export type AlertingSloExhaustion = {
  kind: "exhausted" | "forecast" | "not-shrinking" | "unknown";
  /** What every surface prints; only the tone is left to the caller. */
  label: string;
};

/** Every surface decides "exhausted" through here so the <=0 boundary and
 *  its null semantics never drift between pages. */
export function alertingBudgetExhausted(
  remaining: number | null,
): remaining is number {
  return remaining !== null && remaining <= 0;
}

export function alertingSloExhaustion(
  budgetRemaining: number | null,
  tteSecs: number | null,
  effectiveBurn: number | null,
): AlertingSloExhaustion {
  if (alertingBudgetExhausted(budgetRemaining)) {
    return { kind: "exhausted", label: "exhausted" };
  }
  if (tteSecs !== null) {
    return { kind: "forecast", label: alertingFormatSloDuration(tteSecs) };
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
export function alertingApplyFreshBudget(
  specTiers: readonly AlertingSloTier[],
  status: AlertingSloStatusPayload,
  fresh: AlertingFreshBudget | undefined,
  windowSecs: number | null,
): AlertingSloStatusPayload {
  if (fresh === undefined) return status;
  return {
    ...status,
    sli: fresh.sli,
    budget_remaining: fresh.budgetRemaining,
    time_to_exhaustion_secs: alertingTimeToExhaustionSecs(
      fresh.budgetRemaining,
      alertingSloCurrentBurn(specTiers, status.tiers)?.effective ?? null,
      windowSecs,
    ),
  };
}

// `at-risk` is the low-budget warning band; `unknown` is no snapshot yet.
export type AlertingSloState =
  | "exhausted"
  | "firing-critical"
  | "firing-warning"
  | "at-risk"
  | "healthy"
  | "unknown";

export function alertingSloStatusState(
  tiers: readonly AlertingSloTier[],
  status: AlertingSloStatusPayload | null,
): AlertingSloState {
  if (status === null) return "unknown";
  if (alertingBudgetExhausted(status.budget_remaining)) {
    return "exhausted";
  }
  const severity = alertingSloFiringSeverity(tiers, status.firing_tiers);
  if (severity === "critical") return "firing-critical";
  if (severity !== null) return "firing-warning";
  if (status.budget_remaining !== null && status.budget_remaining < 0.25) {
    return "at-risk";
  }
  return "healthy";
}

/** "30d rolling" (v1 is rolling-only; the flag is honored anyway). */
export function alertingSloWindowLabel(spec: AlertingSloSpec): string {
  const { duration, isRolling } = spec.timeWindow;
  return isRolling ? `${duration} rolling` : duration;
}

/** Budget window in whole seconds; null if the duration shorthand doesn't parse. */
export function alertingSloWindowSecs(spec: AlertingSloSpec): number | null {
  const secs = tierWindowSecs(spec.timeWindow.duration);
  return Number.isFinite(secs) ? secs : null;
}

/**
 * Chart range: exactly one SLO window ending now, so the rightmost point's
 * trailing window is the same span the status hero reads and the two agree.
 * Datemath (`now-<window>` .. `now`) keeps the query key stable across reloads.
 * Null when the window shorthand doesn't parse.
 */
export function alertingSloChartRange(
  spec: AlertingSloSpec,
): { from: string; to: string } | null {
  if (alertingSloWindowSecs(spec) === null) return null;
  return { from: `now-${spec.timeWindow.duration}`, to: "now" };
}

/** Format the two largest non-zero duration units, for example "3d 4h". */
export function alertingFormatSloDuration(secs: number): string {
  const s = Math.max(0, Math.floor(secs));
  const d = Math.floor(s / 86_400);
  const h = Math.floor((s % 86_400) / 3_600);
  const m = Math.floor((s % 3_600) / 60);
  if (d > 0) return h > 0 ? `${d}d ${h}h` : `${d}d`;
  if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`;
  if (m > 0) return `${m}m`;
  return `${s % 60}s`;
}
