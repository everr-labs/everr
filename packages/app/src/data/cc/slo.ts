// packages/app/src/data/cc/slo.ts
//
// The frontend's mirror of clickety-clack's SLO vocabulary (domain/slo.rs):
// the canonical burn-rate tiers, tier/severity resolution, and the handles an
// event row may carry for an SLO. Owned here in the data layer so every SLO
// surface (list, detail, triage, history) reads the same rules.
import type { CcSlo, CcSloGroupStatus, CcSloSpec, CcSloTier } from "./types";

/**
 * The SRE-workbook canonical three tiers, calibrated to a 30-day window —
 * what the engine evaluates when `spec.tiers` is unset (domain/slo.rs
 * `canonical_tiers()`).
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

/** The tiers the engine actually evaluates: explicit spec tiers or canonical. */
export function ccSloTiers(spec: CcSloSpec): readonly CcSloTier[] {
  return spec.tiers ?? CC_CANONICAL_SLO_TIERS;
}

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
 * A group's headline burn: the long-window rate of the shortest-long-window
 * tier that has a computed rate (the 1h window for canonical tiers) — the
 * most current sustained signal. 1× spends exactly the error budget over the
 * SLO window. The full per-tier long/short matrix stays reachable where this
 * is shown (tooltip), this only picks the lead number.
 */
export function ccSloCurrentBurn(
  specTiers: readonly CcSloTier[],
  snapshot: CcSloGroupStatus["tiers"],
): { rate: number; window: string } | null {
  const rateByName = new Map(snapshot.map((t) => [t.name, t.long_burn_rate]));
  let best: { rate: number; window: string; secs: number } | null = null;
  for (const t of specTiers) {
    const rate = rateByName.get(t.name);
    if (rate === null || rate === undefined) continue;
    const secs = tierWindowSecs(t.long_window);
    if (best === null || secs < best.secs) {
      best = { rate, window: t.long_window, secs };
    }
  }
  return best === null ? null : { rate: best.rate, window: best.window };
}

/** "99.9%" without trailing-zero noise ("99.5%", "99.95%"). */
export function ccFormatSloTarget(targetPercent: number): string {
  return `${targetPercent}%`;
}

/** "30d rolling" (v1 is rolling-only; the flag is honored anyway). */
export function ccSloWindowLabel(spec: CcSloSpec): string {
  const { duration, isRolling } = spec.timeWindow;
  return isRolling ? `${duration} rolling` : duration;
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
