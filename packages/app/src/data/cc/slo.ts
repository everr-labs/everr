// packages/app/src/data/cc/slo.ts
//
// The frontend's mirror of clickety-clack's SLO vocabulary (domain/slo.rs):
// the canonical burn-rate tiers, tier/severity resolution, and the handles an
// event row may carry for an SLO. Owned here in the data layer so every SLO
// surface (list, detail, triage, history) reads the same rules.
import { parseResourceName } from "@/data/as-code/identity";
import { fromCcSlo } from "@/data/slos/mapping";
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
 * slug as the SLO's first-class `name` (project/slug qualified), falling back
 * to the source uuid for records stored before CC stamped it (otel/
 * alert_log.rs `slug_for` — for SLO events `ev.rule` carries the SLO uuid), so
 * both handles can appear in stored history. When the name is qualified, the
 * bare slug is added too: pre-deploy ClickHouse rows stamped `alert.slug`
 * from the old everr.name annotation, which never carried a project prefix.
 * Restoring that bare-slug handle also restores the pre-branch ambiguity
 * where two projects sharing a slug both match the same legacy rows; that is
 * intentional (it matches the old, project-agnostic behavior), not a
 * regression.
 */
export function ccSloHandles(slo: CcSlo): string[] {
  const { name, id } = slo;
  if (!name.includes("/")) return [id, name];
  return [id, name, parseResourceName(name).slug];
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

/**
 * One resolution of "what do we call this SLO", mirroring `ccRuleIdentity`
 * (data/alerts/rule-identity.ts): the display-name annotation first, then
 * the as-code slug (always present, carried on the SLO's own first-class
 * `name`). Every SLO surface (list, detail, triage, feeds) reads names
 * through this so a display name renders consistently everywhere.
 */
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

/** The window the canonical burn-rate table is calibrated for (30 days). */
const CC_CANONICAL_TIER_WINDOW_SECS = 30 * 86_400;

/** Floor on a scaled tier's short window (mirrors domain/slo.rs). */
const CC_SHORT_WINDOW_FLOOR_SECS = 60;

// The canonical tiers as (name, long secs, short secs, ...), calibrated to
// CC_CANONICAL_TIER_WINDOW_SECS. Mirror of domain/slo.rs BASE_TIERS.
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
 * A tier window rendered for humans as its two largest non-zero units: the
 * single-unit stored form (`"1008m"` for a 7-day SLO's ticket window) reads back
 * as `"16h 48m"`, and a 70s short window as `"1m 10s"` (seconds kept, not
 * rounded). Passes an unparsable window through untouched.
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
 * The burn-rate tiers for an SLO, scaled to its own budget window — what every
 * SLO surface should use to label a burn ("1.4× / 14m") with the window the
 * engine measured it over. Falls back to the canonical 30-day windows when the
 * spec's window doesn't parse (guarded at the API, defensive here).
 */
export function ccSloTiers(spec: CcSloSpec): CcSloTier[] {
  return ccTiersForWindow(
    ccSloWindowSecs(spec) ?? CC_CANONICAL_TIER_WINDOW_SECS,
  );
}

/**
 * The burn-rate tiers scaled to a `windowSecs` budget window, mirroring
 * domain/slo.rs `tiers_for_window`. The engine measures each tier's burn over
 * these scaled windows (the canonical 1h/6h/3d only for a 30-day SLO), so the
 * SLO surfaces label a burn with the same window. Short windows floor at
 * `CC_SHORT_WINDOW_FLOOR_SECS`, pinning the tier at its 12:1 ratio.
 *
 * Fewer than three tiers come back when the floor collapses one onto another's
 * windows (a 1-day budget does this to fast-burn and slow-burn): identical
 * windows make them one detector, so the engine keeps only the lower threshold
 * and never evaluates the other. Rendering the dropped tier would show a row
 * that can never carry data.
 */
export function ccTiersForWindow(windowSecs: number): CcSloTier[] {
  const k = windowSecs / CC_CANONICAL_TIER_WINDOW_SECS;
  // Keyed on the computed seconds rather than the rendered windows, so the
  // collapse never depends on ccFmtWindowSecs being injective.
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
    // CC_BASE_TIERS runs fastest-first with strictly decreasing thresholds, so a
    // collision always means the newcomer is the lower-threshold twin: it takes
    // the slot of the tier it collided with.
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
 * One lookback window's measured burn: a distinct trailing span the engine
 * averaged this group's burn over. Every tier window (short and long alike)
 * is just "average burn over the last X", so the full set reads as a profile:
 * where in time the spending sits.
 */
export type CcSloWindowBurn = {
  /** Window shorthand as the tier spec spells it ("5m", "3d"). */
  window: string;
  /** The window's length in seconds (the sort key). */
  secs: number;
  /** Measured average burn over that trailing window; null = no data. */
  burn: number | null;
};

/**
 * Every distinct lookback window across the SLO's tiers with its measured
 * burn, sorted longest window first. Windows shared between tiers (the 6h
 * span is slow-burn's long window and ticket's short window) collapse into
 * one entry, preferring whichever measurement exists. This is the data the
 * burn-by-lookback readout plots: long windows = further back, short = now.
 */
export function ccSloWindowBurns(
  specTiers: readonly CcSloTier[],
  snapshot: CcSloGroupStatus["tiers"],
): CcSloWindowBurn[] {
  const byName = new Map(snapshot.map((t) => [t.name, t]));
  const bySecs = new Map<number, CcSloWindowBurn>();
  for (const t of specTiers) {
    const snap = byName.get(t.name);
    const spans: [string, number | null | undefined][] = [
      [t.long_window, snap?.long_burn_rate],
      [t.short_window, snap?.short_burn_rate],
    ];
    for (const [window, rate] of spans) {
      const secs = tierWindowSecs(window);
      if (!Number.isFinite(secs)) continue;
      const burn = rate ?? null;
      const existing = bySecs.get(secs);
      if (existing === undefined) {
        bySecs.set(secs, { window, secs, burn });
      } else if (existing.burn === null && burn !== null) {
        existing.burn = burn;
      }
    }
  }
  return [...bySecs.values()].sort((a, b) => b.secs - a.secs);
}

/**
 * The time-shape of the burn, read off the lookback profile: `burning` when
 * the most recent measured window is at or above the 1× sustainable line
 * (budget is being spent right now), `receding` when only longer windows are
 * elevated (a past burst still inside the window, current traffic clean) —
 * the exact shape that makes "ticket firing but recovering" true — `quiet`
 * when every window is under 1×, `no-data` without any measurement.
 */
export type CcSloBurnShape = "burning" | "receding" | "quiet" | "no-data";

export function ccSloBurnShape(
  burns: readonly CcSloWindowBurn[],
): CcSloBurnShape {
  const measured = burns.filter(
    (b): b is CcSloWindowBurn & { burn: number } => b.burn !== null,
  );
  if (measured.length === 0) return "no-data";
  // Sorted longest-first, so the last measured entry is the most recent view.
  const recent = measured[measured.length - 1].burn;
  const peak = Math.max(...measured.map((b) => b.burn));
  if (recent >= 1) return "burning";
  if (peak >= 1) return "receding";
  return "quiet";
}

/**
 * The one-line reading of the lookback profile, teaching the short-vs-long
 * window concept in place ("recent windows clean, older windows elevated" is
 * a story, not a contradiction). Null when there is nothing to read.
 */
export function ccSloBurnShapeCaption(shape: CcSloBurnShape): string | null {
  switch (shape) {
    case "burning":
      return "The most recent windows are over the 1× line: error budget is being spent right now.";
    case "receding":
      return "The most recent windows are back under 1×: the elevated burn is older, and rolls out of the longer windows as time passes.";
    case "quiet":
      return "Every window is under the 1× line: nothing is spending error budget faster than sustainable.";
    case "no-data":
      return null;
  }
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
 * already current. TTE is re-derived from the fresh budget and the current-spend
 * burn (`ccSloCurrentBurn`'s `effective`: the shortest-long-window tier's
 * `min(long, short)`), exactly as api/slos.rs projects it. That burn drops to 0
 * the moment spending stops, so a recovering budget shows no horizon even while a
 * slower tier still fires on a burst that has already passed.
 */
export function ccApplyFreshBudget(
  specTiers: readonly CcSloTier[],
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
        ccSloCurrentBurn(specTiers, g.tiers)?.effective ?? null,
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
    /**
     * The lookback profile's time-shape (ccSloBurnShape), when the caller has
     * it. `receding` rewrites the firing/healthy verdicts as the recovery
     * story instead of the contradictory "draining while burn reads 0".
     */
    shape?: CcSloBurnShape;
  },
): string {
  // The confirmed (both-window) spend, so a passed spike reads as recovering.
  const effective = opts.burn?.effective ?? null;
  // A ticket can keep firing on its long windows after the spending stopped;
  // treat that as the recovery story, not as active draining.
  const receding =
    opts.shape === "receding" || (opts.shape === undefined && effective === 0);
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
      if (receding) {
        return "A ticket is open for budget burned earlier in the window. Current traffic is healthy, so the alert clears as that burn ages out.";
      }
      return emptiesIn
        ? `Draining faster than sustainable. A ticket alert is firing and ${emptiesIn}.`
        : "Draining faster than sustainable. A ticket alert is firing.";
    case "at-risk":
      return "Running low. Nothing is paging yet, but there is little error budget left to spend this window.";
    case "healthy":
      if (opts.shape === "receding") {
        return "On track. Budget burned earlier is still visible in the longer windows, but current traffic is healthy.";
      }
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
 * The budget-over-time chart's range: exactly one SLO window, ending now. Each
 * point plots a trailing-window budget, so pinning the x-axis to the SLO's own
 * window keeps the chart honest with the rest of the page: the rightmost point's
 * window is `[now - window, now]`, the same span the status hero reads, so the
 * two always agree. Datemath (`now-<window>` .. `now`) so the query key stays
 * stable across reloads instead of churning on an absolute instant. Null when
 * the window shorthand doesn't parse (there is nothing to chart).
 */
export function ccSloChartRange(
  spec: CcSloSpec,
): { from: string; to: string } | null {
  if (ccSloWindowSecs(spec) === null) return null;
  return { from: `now-${spec.timeWindow.duration}`, to: "now" };
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
