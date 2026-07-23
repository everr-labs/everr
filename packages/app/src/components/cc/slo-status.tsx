// packages/app/src/components/cc/slo-status.tsx
//
// The at-a-glance status of one SLO, for the detail page: the worst group's
// error budget as a large meter, the headline burn and time to exhaustion,
// and — behind a disclosure that opens itself while anything fires — the burn
// read by lookback window plus each alert tier's firing condition in plain
// words. The plain-language verdict leads, so the page reads as a sentence
// before it reads as numbers, and a past burst still inside the long windows
// reads as the recovery story it is, never as a contradiction.
import { Card, CardContent } from "@everr/ui/components/card";
import {
  Collapsible,
  CollapsibleContent,
} from "@everr/ui/components/collapsible";
import { cn } from "@everr/ui/lib/utils";
import { useState } from "react";
import {
  ccBudgetTone,
  ccFmtBurn,
  ccFmtFraction,
} from "@/components/cc/budget-bar";
import {
  CcDisclosureTrigger,
  CcSloTierBadge,
  CcStatusDot,
} from "@/components/cc/shared";
import { SloBurnLookback } from "@/components/cc/slo-burn-lookback";
import {
  type CcSloState,
  ccFmtWindowLabel,
  ccFormatSloDuration,
  ccFormatSloTarget,
  ccSloBurnShape,
  ccSloBurnShapeCaption,
  ccSloCurrentBurn,
  ccSloDescription,
  ccSloGroupState,
  ccSloTiers,
  ccSloVerdict,
  ccSloWindowBurns,
  ccSloWindowLabel,
} from "@/data/cc/slo";
import type { CcSlo, CcSloGroupStatus, CcSloTier } from "@/data/cc/types";

// State → the instrument-panel readout: a toned dot, a word, and the color the
// budget meter and headline burn take. Amber is "attention" (warning / low
// budget), red is "emergency" (critical firing / exhausted); Signal Lime stays
// reserved, so healthy is emerald.
const STATE_READOUT: Record<
  CcSloState,
  {
    label: string;
    dot: Parameters<typeof CcStatusDot>[0]["tone"];
    text: string;
  }
> = {
  exhausted: {
    label: "Budget exhausted",
    dot: "firing",
    text: "text-destructive",
  },
  "firing-critical": {
    label: "Firing",
    dot: "firing",
    text: "text-destructive",
  },
  "firing-warning": {
    label: "Firing",
    dot: "warning",
    text: "text-amber-600 dark:text-amber-400",
  },
  "at-risk": {
    label: "At risk",
    dot: "warning",
    text: "text-amber-600 dark:text-amber-400",
  },
  healthy: {
    label: "On track",
    dot: "healthy",
    text: "text-emerald-600 dark:text-emerald-400",
  },
  unknown: {
    label: "No data yet",
    dot: "inactive",
    text: "text-muted-foreground",
  },
};

function budgetFill(remaining: number | null): {
  width: number;
  bar: string;
  track: string;
} {
  const { exhausted, low } = ccBudgetTone(remaining);
  return {
    width: remaining === null ? 0 : Math.max(0, Math.min(1, remaining)) * 100,
    bar: exhausted ? "bg-destructive" : low ? "bg-amber-500" : "bg-emerald-500",
    track: exhausted ? "bg-destructive/25" : "bg-muted",
  };
}

// ── Stats row ─────────────────────────────────────────────────────────────────
// The page's headline numbers as one strip above everything: budget, promise,
// achieved reliability, current burn, and the horizon. Each value is the worst
// group's, matching the hero it sits above.

function Stat({
  label,
  hint,
  children,
}: {
  label: string;
  /** Small line under the value: a window note or the budget meter. */
  hint?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1 lg:px-6 lg:first:pl-0 lg:last:pr-0">
      <dt className="text-[0.625rem] font-medium tracking-wide text-muted-foreground uppercase">
        {label}
      </dt>
      <dd className="text-2xl leading-tight font-semibold">{children}</dd>
      {hint !== undefined && (
        <div className="text-[0.6875rem] text-muted-foreground">{hint}</div>
      )}
    </div>
  );
}

export function SloStatsRow({
  slo,
  worst,
}: {
  slo: CcSlo;
  /** The group spending budget fastest, or null when there is no snapshot. */
  worst: CcSloGroupStatus | null;
}) {
  const tiers = ccSloTiers(slo.spec);
  const state = ccSloGroupState(tiers, worst);
  const readout = STATE_READOUT[state];
  const budget = worst?.budget_remaining ?? null;
  const fill = budgetFill(budget);
  const burn = worst ? ccSloCurrentBurn(tiers, worst.tiers) : null;
  const tte = worst?.time_to_exhaustion_secs ?? null;

  return (
    <Card>
      <CardContent>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3 lg:grid-cols-5 lg:divide-x lg:divide-border/60">
          <Stat
            label="Error budget left"
            hint={
              <div
                className={cn(
                  "h-1 w-full max-w-32 overflow-hidden rounded-full",
                  fill.track,
                )}
              >
                <div
                  className={cn(
                    "h-full rounded-full transition-[width] duration-500 ease-[cubic-bezier(0.19,1,0.22,1)]",
                    fill.bar,
                  )}
                  style={{ width: `${fill.width}%` }}
                />
              </div>
            }
          >
            <span
              className={cn(
                fill.bar === "bg-destructive"
                  ? "text-destructive"
                  : fill.bar === "bg-amber-500"
                    ? "text-amber-600 dark:text-amber-400"
                    : undefined,
              )}
            >
              {budget === null
                ? "—"
                : ccBudgetTone(budget).exhausted
                  ? "0%"
                  : ccFmtFraction(budget)}
            </span>
          </Stat>
          <Stat label="SLO" hint={`over ${ccSloWindowLabel(slo.spec)}`}>
            {ccFormatSloTarget(slo.spec.targetPercent)}
          </Stat>
          <Stat label="SLI" hint={`last ${slo.spec.timeWindow.duration}`}>
            {worst?.sli == null ? (
              <span className="text-muted-foreground">—</span>
            ) : (
              ccFmtFraction(worst.sli)
            )}
          </Stat>
          <Stat
            label="Burn rate"
            hint={
              burn === null
                ? undefined
                : `last ${ccFmtWindowLabel(burn.window)}`
            }
          >
            {burn === null ? (
              <span className="text-muted-foreground">—</span>
            ) : (
              <span
                className={
                  state.startsWith("firing") && (burn.effective ?? 0) > 0
                    ? readout.text
                    : undefined
                }
              >
                {ccFmtBurn(burn.rate)}
              </span>
            )}
          </Stat>
          <Stat label="Time to exhaustion">
            {tte === null ? (
              <span className="text-muted-foreground">
                {burn?.effective === 0 ? "not shrinking" : "—"}
              </span>
            ) : tte === 0 ? (
              <span className="text-destructive">exhausted</span>
            ) : (
              ccFormatSloDuration(tte)
            )}
          </Stat>
        </dl>
      </CardContent>
    </Card>
  );
}

// One measured window's burn inside a tier sentence, toned by whether it is
// past the tier's own firing line (the value is printed either way, so the
// state never rides on color alone — the "firing" badge names it too).
function TierWindowValue({
  rate,
  threshold,
  severity,
}: {
  rate: number | null;
  threshold: number;
  severity: CcSloTier["severity"];
}) {
  if (rate === null) {
    return <span className="font-mono">—</span>;
  }
  const over = rate >= threshold;
  return (
    <span
      className={cn(
        "font-mono tabular-nums",
        over &&
          (severity === "critical"
            ? "font-medium text-destructive"
            : "font-medium text-amber-600 dark:text-amber-400"),
      )}
    >
      {ccFmtBurn(rate)}
    </span>
  );
}

// One tier's distance to its firing line, as a meter whose scale IS the
// firing rule: the track spans 0 → the tier's threshold, so a full bar means
// firing, by construction. The solid fill is the CONFIRMED burn — min of the
// two windows, exactly what the engine fires on — and the translucent ghost
// segment is the slower window's older burn that the confirmed rate has
// already moved past (the receding tail). No cross-tier comparison is implied:
// each bar answers only "how close to ITS line".
function TierMeter({
  tier,
  long,
  short,
  firing,
}: {
  tier: CcSloTier;
  long: number | null;
  short: number | null;
  firing: boolean;
}) {
  const confirmed =
    long === null || short === null ? null : Math.min(long, short);
  const lagging = Math.max(long ?? 0, short ?? 0);
  const pct = (v: number) => Math.max(0, Math.min(1, v / tier.burn_rate)) * 100;
  const confirmedPct = confirmed === null ? 0 : pct(confirmed);
  const laggingPct = pct(lagging);
  // Tone from real state: firing takes the tier's severity color; otherwise
  // the confirmed fill warms past halfway and stays calm below.
  const fill = firing
    ? tier.severity === "critical"
      ? "bg-destructive"
      : "bg-amber-500"
    : confirmed !== null && confirmed / tier.burn_rate >= 0.5
      ? "bg-amber-500"
      : "bg-emerald-500";
  return (
    <div
      aria-hidden
      className={cn(
        "relative h-1.5 w-full overflow-hidden rounded-full",
        firing
          ? tier.severity === "critical"
            ? "bg-destructive/15"
            : "bg-amber-500/15"
          : "bg-muted",
      )}
    >
      {/* Older, unconfirmed burn: what the slower window still remembers. */}
      {laggingPct > confirmedPct && (
        <div
          className="absolute inset-y-0 left-0 rounded-full bg-muted-foreground/30"
          style={{ width: `${laggingPct}%` }}
        />
      )}
      {confirmedPct > 0 && (
        <div
          className={cn(
            "absolute inset-y-0 left-0 rounded-full transition-[width] duration-500 ease-[cubic-bezier(0.19,1,0.22,1)]",
            fill,
          )}
          style={{ width: `${confirmedPct}%` }}
        />
      )}
    </div>
  );
}

// One tier's firing condition: identity and live meter, then the rule as a
// sentence with the live numbers in place — what it does (pages / opens a
// ticket), when it fires (both windows at the threshold), and where both
// windows sit right now.
function TierCondition({
  tier,
  snap,
  firing,
}: {
  tier: CcSloTier;
  snap: CcSloGroupStatus["tiers"][number] | undefined;
  firing: boolean;
}) {
  const long = snap?.long_burn_rate ?? null;
  const short = snap?.short_burn_rate ?? null;
  return (
    <div className="space-y-1 text-xs">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span className="font-mono">{tier.name}</span>
        <span className="text-[0.6875rem] text-muted-foreground">
          {tier.severity === "critical" ? "pages you" : "opens a ticket"}
        </span>
        {firing && <CcSloTierBadge tier="firing" severity={tier.severity} />}
        {/* The meter's end-of-track label: full bar = this line. */}
        <span className="ml-auto font-mono text-[0.625rem] tabular-nums text-muted-foreground">
          fires ≥ {ccFmtBurn(tier.burn_rate)}
        </span>
      </div>
      <TierMeter tier={tier} long={long} short={short} firing={firing} />
      <p className="text-[0.6875rem] text-muted-foreground">
        Fires when the last {ccFmtWindowLabel(tier.long_window)} and the last{" "}
        {ccFmtWindowLabel(tier.short_window)} both average ≥{" "}
        <span className="font-mono tabular-nums">
          {ccFmtBurn(tier.burn_rate)}
        </span>{" "}
        · now{" "}
        <TierWindowValue
          rate={long}
          threshold={tier.burn_rate}
          severity={tier.severity}
        />{" "}
        and{" "}
        <TierWindowValue
          rate={short}
          threshold={tier.burn_rate}
          severity={tier.severity}
        />
      </p>
    </div>
  );
}

// A tier's fraction of the way to its firing line, on the confirmed
// (both-window min) burn the engine fires on. Null without both measurements.
function tierFiringRatio(
  tier: CcSloTier,
  snap: CcSloGroupStatus["tiers"][number] | undefined,
): number | null {
  const long = snap?.long_burn_rate ?? null;
  const short = snap?.short_burn_rate ?? null;
  if (long === null || short === null) return null;
  return Math.min(long, short) / tier.burn_rate;
}

// A tier counts as "close" once its confirmed burn passes three quarters of
// its threshold — worth surfacing in the headline before it actually fires.
const TIER_CLOSE_RATIO = 0.75;

// The disclosure's headline: the live outcome in one phrase, colored only
// when something fires (or is genuinely close to its line).
function alertsSummary(
  tiers: readonly CcSloTier[],
  snapshot: CcSloGroupStatus["tiers"],
  firingTiers: readonly { tier: string }[],
): { label: string; tone: "critical" | "warning" | null; near: boolean } {
  const firing = new Set(firingTiers.map((f) => f.tier));
  const critical = tiers.filter(
    (t) => t.severity === "critical" && firing.has(t.name),
  );
  if (critical.length > 0) {
    return {
      label: `Paging: ${critical.map((t) => t.name).join(", ")}`,
      tone: "critical",
      near: true,
    };
  }
  if (firing.size > 0) {
    return {
      label: "Ticket alert firing · nothing is paging",
      tone: "warning",
      near: true,
    };
  }
  const close = tiers.filter((t) => {
    const ratio = tierFiringRatio(
      t,
      snapshot.find((s) => s.name === t.name),
    );
    return ratio !== null && ratio >= TIER_CLOSE_RATIO;
  });
  if (close.length > 0) {
    return {
      label: `${close.map((t) => t.name).join(", ")} close to firing`,
      tone: "warning",
      near: true,
    };
  }
  return { label: "No alert near firing", tone: null, near: false };
}

export function SloStatusHero({
  slo,
  worst,
  groupCount,
}: {
  slo: CcSlo;
  /** The group spending budget fastest, or null when there is no snapshot. */
  worst: CcSloGroupStatus | null;
  groupCount: number;
}) {
  const tiers = ccSloTiers(slo.spec);
  const state = ccSloGroupState(tiers, worst);
  const readout = STATE_READOUT[state];
  const description = ccSloDescription(slo.spec);
  const burn = worst ? ccSloCurrentBurn(tiers, worst.tiers) : null;
  const burns = worst ? ccSloWindowBurns(tiers, worst.tiers) : [];
  const shape = ccSloBurnShape(burns);
  const tte = worst?.time_to_exhaustion_secs ?? null;
  const firingTiers = worst?.firing_tiers ?? [];
  const summary = alertsSummary(tiers, worst?.tiers ?? [], firingTiers);
  // The lookback readout is detail: folded while everything is quiet, open by
  // default when a tier is firing or close to its line, so an incident (or a
  // brewing one) shows its pressure without a click.
  const [alertsOpen, setAlertsOpen] = useState(summary.near);

  return (
    <Card>
      <CardContent className="space-y-4">
        {/* The answer first: the state word, then what it means in plain
            words. The numbers live in the stats row above (SloStatsRow), so
            the hero card reads state → verdict → alert instruments. */}
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <CcStatusDot
              tone={readout.dot}
              pulse={state.startsWith("firing")}
            />
            <span className={cn("text-xs font-medium", readout.text)}>
              {readout.label}
            </span>
            {/* Which group the headline numbers belong to, whenever the SLO
                groups at all, plus the "worst of N" note past one group. */}
            {worst && Object.keys(worst.labels).length > 0 && (
              <span className="font-mono text-[0.6875rem] text-muted-foreground">
                {Object.values(worst.labels).join(", ")}
              </span>
            )}
            {groupCount > 1 && (
              <span className="text-[0.6875rem] text-muted-foreground">
                worst of {groupCount} groups
              </span>
            )}
          </div>
          <p className="max-w-prose text-sm font-medium text-foreground">
            {ccSloVerdict(state, { burn, tteSecs: tte, shape })}
          </p>
          {description && (
            <p className="max-w-prose text-xs text-muted-foreground">
              {description}
            </p>
          )}
        </div>

        {/* What would page you: the live outcome in one phrase, with the burn
            read by lookback window + each tier's firing condition on demand
            (open while anything is firing). */}
        {worst && (
          <div className="border-t border-border/60 pt-3">
            <Collapsible open={alertsOpen} onOpenChange={setAlertsOpen}>
              <CcDisclosureTrigger open={alertsOpen}>
                <span
                  className={cn(
                    "text-xs font-medium",
                    summary.tone === "critical"
                      ? "text-destructive"
                      : summary.tone === "warning"
                        ? "text-amber-600 dark:text-amber-400"
                        : "text-foreground",
                  )}
                >
                  {summary.label}
                </span>
                {!alertsOpen && (
                  <span className="text-[0.6875rem] text-muted-foreground">
                    burn rate over each alert window
                  </span>
                )}
              </CcDisclosureTrigger>
              <CollapsibleContent>
                {/* One instrument cluster: the lookback profile answers WHEN
                    the burn happened, the tier meters answer HOW CLOSE each
                    alert is to its own line. Side by side once there is room. */}
                <div className="mt-3 flex flex-col gap-x-10 gap-y-4 lg:flex-row lg:items-start">
                  <div className="min-w-0 flex-1 space-y-2">
                    <SloBurnLookback burns={burns} />
                    {(() => {
                      const caption = ccSloBurnShapeCaption(shape);
                      return caption === null ? null : (
                        <p className="max-w-prose text-[0.6875rem] text-muted-foreground">
                          {caption}
                        </p>
                      );
                    })()}
                    {/* The unit legend: one sentence that grounds every ×
                        on the page in this SLO's own failure rate. */}
                    {burns.some((b) => b.burn !== null) && (
                      <p className="max-w-prose text-[0.6875rem] text-muted-foreground/70">
                        1× means{" "}
                        {Number((100 - slo.spec.targetPercent).toFixed(2))}% of
                        events failing — the most a{" "}
                        {ccFormatSloTarget(slo.spec.targetPercent)} target can
                        absorb. 2× fails twice that share, and so on.
                      </p>
                    )}
                  </div>
                  <div className="w-full space-y-3 lg:max-w-sm">
                    {tiers.map((t) => (
                      <TierCondition
                        key={t.name}
                        tier={t}
                        snap={worst.tiers.find((s) => s.name === t.name)}
                        firing={firingTiers.some((f) => f.tier === t.name)}
                      />
                    ))}
                  </div>
                </div>
              </CollapsibleContent>
            </Collapsible>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
