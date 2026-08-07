import { fromAlertingSlo } from "@/data/alerting/slos/resource/mapping";
import type {
  AlertingSlo,
  AlertingSloSpec,
  AlertingSloStatusPayload,
  AlertingSloTier,
} from "../types";

// Every SLO uses these fixed tiers. Critical tiers page. The warning tier
// creates a ticket.
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

// Use critical severity when a tier is unknown.
export function alertingSloTierSeverity(
  tiers: readonly AlertingSloTier[],
  labels: Record<string, string>,
): AlertingSloTier["severity"] {
  const name = labels.slo_tier;
  return tiers.find((t) => t.name === name)?.severity ?? "critical";
}

export function alertingSloHandles(slo: AlertingSlo): string[] {
  return [slo.name];
}

export type AlertingSloIdentity = {
  name: string;
  project: string;
  slug: string;
  displayName: string | null;
};

export function alertingSloIdentity(
  slo: Pick<AlertingSlo, "previewId" | "repoid" | "name" | "spec">,
): AlertingSloIdentity {
  const { project, slug, displayName } = fromAlertingSlo(slo);
  return { name: displayName || slug, project, slug, displayName };
}

// Use Infinity for an invalid window so it cannot become the headline value.
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

const ALERTING_CANONICAL_TIER_WINDOW_SECS = 30 * 86_400;

const ALERTING_SHORT_WINDOW_FLOOR_SECS = 60;

// End each SLI window before the evaluation time. This delay lets ClickHouse
// ingest recent rows. Read queries use the same delay as evaluations.
export const ALERTING_SLO_INGEST_DELAY_SECS = 10;

export function alertingFormatClickHouseDateTime(date: Date): string {
  return date.toISOString().slice(0, 19).replace("T", " ");
}

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

export function alertingFmtWindowSecs(secs: number): string {
  if (secs % 604_800 === 0) return `${secs / 604_800}w`;
  if (secs % 86_400 === 0) return `${secs / 86_400}d`;
  if (secs % 3600 === 0) return `${secs / 3600}h`;
  if (secs % 60 === 0) return `${secs / 60}m`;
  return `${secs}s`;
}

// Use the two largest non-zero units. Preserve an invalid value.
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

// Scale tiers to the SLO budget window. Use the 30-day window if parsing fails.
export function alertingSloTiers(spec: AlertingSloSpec): AlertingSloTier[] {
  return alertingTiersForWindow(
    alertingSloWindowSecs(spec) ?? ALERTING_CANONICAL_TIER_WINDOW_SECS,
  );
}

// Use the same scaled windows in evaluations and labels. Keep the 12:1 ratio
// when a short window reaches the minimum. If two tiers become equal, keep the
// tier with the lower threshold.
export function alertingTiersForWindow(windowSecs: number): AlertingSloTier[] {
  const k = windowSecs / ALERTING_CANONICAL_TIER_WINDOW_SECS;
  // Compare seconds because two different windows can have the same label.
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
    // Later tiers have lower thresholds and replace equal earlier tiers.
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

// Confirm burn only when both windows have data.
export function alertingEffectiveBurn(
  longBurn: number | null | undefined,
  shortBurn: number | null | undefined,
): number | null {
  if (longBurn == null || shortBurn == null) return null;
  return Math.min(longBurn, shortBurn);
}

// Use the shortest available long window for the headline. Show its raw rate.
// Use the confirmed rate for pace and exhaustion estimates.
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

export type AlertingSloBurnPace =
  | "burning-fast"
  | "burning"
  | "draining"
  | "sustainable"
  | "steady";

// This function classifies burn arithmetic. Overall pace adds firing state.
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

// Firing state takes priority over the confirmed burn rate.
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

export function alertingFormatSloTarget(targetPercent: number): string {
  return `${targetPercent}%`;
}

export type AlertingFreshBudget = {
  sli: number | null;
  budgetRemaining: number | null;
};

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
  label: string;
};

// Use one exhaustion boundary on all surfaces.
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

// Replace budget values with fresh reads. Keep burn rates and firing tiers
// from the evaluation snapshot.
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

export function alertingSloWindowLabel(spec: AlertingSloSpec): string {
  const { duration, isRolling } = spec.timeWindow;
  return isRolling ? `${duration} rolling` : duration;
}

export function alertingSloWindowSecs(spec: AlertingSloSpec): number | null {
  const secs = tierWindowSecs(spec.timeWindow.duration);
  return Number.isFinite(secs) ? secs : null;
}

// Use one SLO window so the chart and summary use the same period. Datemath
// keeps the query key stable between refreshes.
export function alertingSloChartRange(
  spec: AlertingSloSpec,
): { from: string; to: string } | null {
  if (alertingSloWindowSecs(spec) === null) return null;
  return { from: `now-${spec.timeWindow.duration}`, to: "now" };
}

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
