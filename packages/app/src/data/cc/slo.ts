// packages/app/src/data/cc/slo.ts
//
// The frontend's mirror of clickety-clack's SLO vocabulary (domain/slo.rs):
// the canonical burn-rate tiers, tier/severity resolution, and the handles an
// event row may carry for an SLO. Owned here in the data layer so every SLO
// surface (list, detail, triage, history) reads the same rules.
import type { CcSlo, CcSloGroupStatus, CcSloSpec, CcSloTier } from "./types";

/**
 * The SRE-workbook canonical three burn-rate tiers, calibrated to a 30-day
 * window — the fixed set every SLO is evaluated on (domain/slo.rs
 * `canonical_tiers()`; tiers are not user-configurable). The two `critical`
 * tiers page; the `warning` tier opens a ticket.
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
 * Resolve a burn-rate instance's severity from its `slo_tier` label against
 * the SLO's resolved tier list, mirroring domain/slo.rs `tier_severity`: an
 * unknown or missing tier defensively resolves to "critical" (a conservative
 * default for a tier no longer in the spec).
 */
export function ccSloTierSeverity(
  tiers: readonly CcSloTier[],
  labels: Record<string, string>,
): CcSloTier["severity"] {
  const name = labels.slo_tier;
  return tiers.find((t) => t.name === name)?.severity ?? "critical";
}

/**
 * The handles an event row may carry for an SLO, mirroring
 * `ccRuleHandles` (data/alerts/rule-identity.ts): CC's alert log resolves the
 * slug as the `everr.name` annotation falling back to the source uuid
 * (otel/alert_log.rs `slug_for` — for SLO events `ev.rule` carries the SLO
 * uuid), so both handles can appear in stored history.
 */
export function ccSloHandles(slo: CcSlo): string[] {
  const slug = slo.spec.annotations["everr.name"];
  return slug ? [slo.id, slug] : [slo.id];
}

/**
 * Resolve event-row handles (slug or bare uuid) to their SLO, so history and
 * triage surfaces can name SLO-sourced rows by the SLO's first-class name and
 * link them to the SLO detail page instead of falling back to a uuid.
 */
export function ccSloHandleResolver(
  slos: readonly CcSlo[],
): (handle: string) => CcSlo | undefined {
  const byHandle = new Map<string, CcSlo>();
  for (const slo of slos) {
    for (const handle of ccSloHandles(slo)) byHandle.set(handle, slo);
  }
  return (handle) => byHandle.get(handle);
}

// Tier window shorthand (m/h/d/w plus defensive s) → seconds; unparseable
// sorts last so a malformed spec tier can never win the headline slot.
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

/**
 * The burn rate confirmed by BOTH of a tier's windows: `min(long, short)`. The
 * short window drops to ~0 as soon as spending stops, so this reads 0 once a past
 * spike is over even while the long window still remembers it — the same
 * both-windows agreement the engine fires on. Null when either window has no data
 * (zero traffic), so a rate is only claimed when the current spend is confirmed.
 */
export function ccEffectiveBurn(
  longBurn: number | null | undefined,
  shortBurn: number | null | undefined,
): number | null {
  if (longBurn == null || shortBurn == null) return null;
  return Math.min(longBurn, shortBurn);
}

/**
 * A group's headline burn: the shortest-long-window tier that has a computed
 * long-window rate (the 1h window for canonical tiers). `rate` is that long-window
 * value — the number shown, labelled by `window` (so "1.4× / 1h" is honest). Its
 * `effective` burn is `min(long, short)`: the spend confirmed by BOTH windows,
 * which drops to ~0 the moment a spike passes even while the long window still
 * remembers it. Read the pace and time-to-exhaustion off `effective` so a
 * recovering budget never reads as draining; show `rate` as the raw 1h figure.
 */
export function ccSloCurrentBurn(
  specTiers: readonly CcSloTier[],
  snapshot: CcSloGroupStatus["tiers"],
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

/**
 * Plain-language pace for a burn rate, so a listing cell can lead with a word
 * ("Draining", "Sustainable") instead of a bare "1.4×". The firing state wins
 * (an actually-paging tier is "Burning", severity aside from the rate), then the
 * rate against the 1x sustainable line. "steady" is nothing meaningfully
 * spending. `ccSloBurnPaceLabel` gives the display word; tone is the caller's.
 */
export type CcSloBurnPace =
  | "burning-fast"
  | "burning"
  | "draining"
  | "sustainable"
  | "steady";

export function ccSloBurnPace(
  rate: number | null,
  firing: readonly { severity: string }[],
): CcSloBurnPace {
  if (firing.some((f) => f.severity === "critical")) return "burning-fast";
  if (firing.length > 0) return "burning";
  if (rate === null || rate <= 0) return "steady";
  if (rate >= 1) return "draining"; // spending faster than sustainable
  return "sustainable"; // under 1x: recovers within the window
}

export function ccSloBurnPaceLabel(pace: CcSloBurnPace): string {
  switch (pace) {
    case "burning-fast":
      return "Burning fast";
    case "burning":
      return "Burning";
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

/**
 * The group spending its budget fastest (least remaining), the SLO's headline
 * status. Groups with no budget number sort last so a real number always wins
 * the summary when one exists. Null only when there are no groups at all.
 */
export function ccWorstSloGroup(
  groups: readonly CcSloGroupStatus[],
): CcSloGroupStatus | null {
  let worst: CcSloGroupStatus | null = null;
  for (const g of groups) {
    if (worst === null) {
      worst = g;
      continue;
    }
    const a = g.budget_remaining ?? Number.POSITIVE_INFINITY;
    const b = worst.budget_remaining ?? Number.POSITIVE_INFINITY;
    if (a < b) worst = g;
  }
  return worst;
}

/**
 * One group's freshly-computed error budget, from a read-time SLI scan over the
 * trailing window ending now (data/cc/slo-series.server.ts `querySloBudgetNow`).
 * `ccApplyFreshBudget` merges these onto a stored status snapshot so the hero and
 * the listing show budget as of page view rather than the engine's throttled
 * last evaluation (the budget window only re-evaluates every ~window/12).
 */
export type CcFreshBudgetGroup = {
  labels: Record<string, string>;
  sli: number | null;
  budgetRemaining: number | null;
};

/**
 * Seconds until the error budget is exhausted at the current burn, mirroring the
 * engine's `time_to_exhaustion_secs` (engine/slo_math.rs) exactly: null when any
 * input is missing or the burn is non-positive, 0 when already overspent, else
 * `window * budget_remaining / burn_rate` truncated. Re-derives TTE after a
 * group's budget is overridden with a fresh read-time value.
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

/** Order-independent, collision-safe key identifying a group by its label set. */
function sloLabelsKey(labels: Record<string, string>): string {
  const sorted: Record<string, string> = {};
  for (const k of Object.keys(labels).sort()) sorted[k] = labels[k];
  return JSON.stringify(sorted);
}

/**
 * Override each snapshot group's budget, SLI, and time-to-exhaustion with the
 * fresh read-time values, matched by label set. Groups with no fresh match keep
 * the stored snapshot (the instant fallback shown while the scan is in flight or
 * when it fails). Burn rates and firing tiers always stay from the snapshot: they
 * refresh far more often than the throttled budget window, so the snapshot's are
 * already current. TTE is re-derived from the fresh budget and the snapshot's
 * first-tier effective (both-window) burn, exactly as api/slos.rs projects it —
 * so a passed spike (short back to 0) yields no exhaustion projection.
 */
export function ccApplyFreshBudget(
  groups: readonly CcSloGroupStatus[],
  fresh: readonly CcFreshBudgetGroup[] | undefined,
  windowSecs: number | null,
): CcSloGroupStatus[] {
  if (fresh === undefined || fresh.length === 0) return groups.slice();
  const byKey = new Map(fresh.map((f) => [sloLabelsKey(f.labels), f]));
  return groups.map((g) => {
    const f = byKey.get(sloLabelsKey(g.labels));
    if (f === undefined) return g;
    return {
      ...g,
      sli: f.sli,
      budget_remaining: f.budgetRemaining,
      time_to_exhaustion_secs: ccTimeToExhaustionSecs(
        f.budgetRemaining,
        ccEffectiveBurn(
          g.tiers[0]?.long_burn_rate,
          g.tiers[0]?.short_burn_rate,
        ),
        windowSecs,
      ),
    };
  });
}

/**
 * The at-a-glance state of an SLO, derived from a group's snapshot: the single
 * word that answers "how is this promise doing". `exhausted` and the firing
 * states are facts (from budget/firing_tiers); `at-risk` is the low-budget
 * warning band; `healthy` is everything else. `unknown` is no snapshot yet.
 */
export type CcSloState =
  | "exhausted"
  | "firing-critical"
  | "firing-warning"
  | "at-risk"
  | "healthy"
  | "unknown";

export function ccSloGroupState(
  tiers: readonly CcSloTier[],
  group: CcSloGroupStatus | null,
): CcSloState {
  if (group === null) return "unknown";
  if (group.budget_remaining !== null && group.budget_remaining <= 0) {
    return "exhausted";
  }
  const firingSeverities = group.firing_tiers.map((f) =>
    ccSloTierSeverity(tiers, { slo_tier: f.tier }),
  );
  if (firingSeverities.includes("critical")) return "firing-critical";
  if (firingSeverities.length > 0) return "firing-warning";
  if (group.budget_remaining !== null && group.budget_remaining < 0.25) {
    return "at-risk";
  }
  return "healthy";
}

/**
 * How a multi-group SLO's groups are distributed across the risk states, so a
 * listing row can say "worst of 12 · 3 firing" instead of hiding everything
 * behind the single worst group. Counts each group's `ccSloGroupState` into the
 * three that warrant attention; a group that is both exhausted and firing counts
 * as exhausted (the state resolves exhausted first).
 */
export function ccSloGroupBreakdown(
  tiers: readonly CcSloTier[],
  groups: readonly CcSloGroupStatus[],
): { total: number; firing: number; exhausted: number; atRisk: number } {
  let firing = 0;
  let exhausted = 0;
  let atRisk = 0;
  for (const g of groups) {
    switch (ccSloGroupState(tiers, g)) {
      case "firing-critical":
      case "firing-warning":
        firing++;
        break;
      case "exhausted":
        exhausted++;
        break;
      case "at-risk":
        atRisk++;
        break;
    }
  }
  return { total: groups.length, firing, exhausted, atRisk };
}

/**
 * The one-sentence plain-language verdict for the hero: what the current state
 * *means*, in words, before the reader parses any number. Answers the two
 * questions a newcomer actually has ("am I OK?" / "am I about to be paged?")
 * from the state plus the live burn and time-to-exhaustion.
 */
export function ccSloVerdict(
  state: CcSloState,
  opts: {
    burn: { rate: number; effective: number | null; window: string } | null;
    tteSecs: number | null;
  },
): string {
  // The confirmed (both-window) spend, so a passed spike reads as recovering.
  const effective = opts.burn?.effective ?? null;
  const emptiesIn =
    opts.tteSecs && opts.tteSecs > 0
      ? `the budget runs out in about ${ccFormatSloDuration(opts.tteSecs)}`
      : null;
  switch (state) {
    case "unknown":
      return "Not evaluated yet. The first reading appears once the evaluator runs.";
    case "exhausted":
      return "Out of error budget. This window is already below target and will stay there until older failures age out of the window.";
    case "firing-critical":
      return emptiesIn
        ? `Burning fast. A critical alert is firing and ${emptiesIn} at the current rate. A page has gone out.`
        : "Burning fast. A critical alert is firing and a page has gone out.";
    case "firing-warning":
      return emptiesIn
        ? `Draining faster than sustainable. A warning alert is firing and ${emptiesIn}.`
        : "Draining faster than sustainable. A warning alert is firing.";
    case "at-risk":
      return "Running low. Nothing is paging yet, but there is little error budget left to spend this window.";
    case "healthy":
      if (effective === null || effective <= 0) {
        return "On track. Nothing is spending error budget right now.";
      }
      if (effective < 1) {
        return "On track. Budget is being spent slower than the sustainable rate.";
      }
      return "On track for now, but currently spending budget faster than sustainable. Worth a look if it holds.";
  }
}

/**
 * A human description an author attached via a `description` or `summary`
 * pass-through annotation, or null when none is set. Lets an SLO carry prose
 * intent through the as-code pipeline and surface it above the derived
 * sentence.
 */
export function ccSloDescription(spec: CcSloSpec): string | null {
  return spec.annotations.description ?? spec.annotations.summary ?? null;
}

/** "30d rolling" (v1 is rolling-only; the flag is honored anyway). */
export function ccSloWindowLabel(spec: CcSloSpec): string {
  const { duration, isRolling } = spec.timeWindow;
  return isRolling ? `${duration} rolling` : duration;
}

/**
 * The budget window length in whole seconds, or null if the duration shorthand
 * doesn't parse. The trailing-window length each error-budget-chart point sums
 * over (the read-time series runs the SLI over `[t - windowSecs, t]`).
 */
export function ccSloWindowSecs(spec: CcSloSpec): number | null {
  const secs = tierWindowSecs(spec.timeWindow.duration);
  return Number.isFinite(secs) ? secs : null;
}

/**
 * Compact humanized seconds for budget projections ("3d 4h", "2h 15m",
 * "45m", "30s"), mirroring the engine's own readout granularity
 * (engine/slo_math.rs `fmt_duration_secs`): the two largest non-zero units.
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
