// packages/app/src/components/cc/slo-status.tsx
//
// The at-a-glance status of one SLO, for the detail page. There is no budget
// history to chart (the engine keeps only the latest snapshot), so "status" is
// that snapshot rendered legibly: the worst group's error budget as a large
// meter, the headline burn and time to exhaustion, and a burn-pressure gauge
// per tier showing how close each is to firing. The plain-language objective
// leads, so the page reads as a sentence before it reads as numbers.
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
import {
  CC_CANONICAL_SLO_TIERS,
  type CcSloState,
  ccFormatSloDuration,
  ccSloCurrentBurn,
  ccSloDescription,
  ccSloGroupState,
  ccSloVerdict,
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

function Fact({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-0.5">
      <div className="text-[0.625rem] font-medium tracking-wide text-muted-foreground uppercase">
        {label}
      </div>
      <div className="font-mono text-sm tabular-nums">{children}</div>
    </div>
  );
}

// One tier's burn pressure: the sustained (long-window) burn as a fraction of
// the tier's fire threshold. The track spans 0 to the threshold, so a full bar
// means the long window is at the fire line; the tier only actually fires when
// the short window agrees too, which `firing` (from the snapshot) reflects.
function TierPressure({
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
  const ratio = long === null ? null : long / tier.burn_rate;
  const width = ratio === null ? 0 : Math.max(0, Math.min(1, ratio)) * 100;
  // Tone: firing takes the tier's severity color; otherwise the bar warms as it
  // approaches the line (amber past halfway) and stays calm below.
  const bar = firing
    ? tier.severity === "critical"
      ? "bg-destructive"
      : "bg-amber-500"
    : ratio !== null && ratio >= 0.5
      ? "bg-amber-500"
      : "bg-emerald-500";

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="flex items-center gap-1.5">
          <span className="font-mono">{tier.name}</span>
          {firing && <CcSloTierBadge tier="firing" severity={tier.severity} />}
        </span>
        <span className="font-mono tabular-nums text-muted-foreground">
          {long === null ? "—" : ccFmtBurn(long)}
          <span className="text-muted-foreground/70">
            {" "}
            / {tier.long_window}
          </span>
          <span className="px-1 text-muted-foreground/40">·</span>
          fires ≥ {ccFmtBurn(tier.burn_rate)}
        </span>
      </div>
      <div
        className={cn(
          "h-1.5 w-full overflow-hidden rounded-full",
          firing ? "bg-destructive/15" : "bg-muted",
        )}
      >
        <div
          className={cn(
            "h-full rounded-full transition-[width] duration-500 ease-[cubic-bezier(0.19,1,0.22,1)]",
            bar,
          )}
          style={{ width: `${width}%` }}
        />
      </div>
      {short !== null && (
        <div className="text-[0.625rem] text-muted-foreground/70">
          short window {ccFmtBurn(short)} / {tier.short_window}
        </div>
      )}
    </div>
  );
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
  const tiers = CC_CANONICAL_SLO_TIERS;
  const state = ccSloGroupState(tiers, worst);
  const readout = STATE_READOUT[state];
  const description = ccSloDescription(slo.spec);
  const budget = worst?.budget_remaining ?? null;
  const fill = budgetFill(budget);
  const burn = worst ? ccSloCurrentBurn(tiers, worst.tiers) : null;
  const tte = worst?.time_to_exhaustion_secs ?? null;
  const firingTiers = worst?.firing_tiers ?? [];
  // The tier meters are detail: fold them away when nothing is near firing, open
  // by default when a tier actually is, so an active incident shows its pressure.
  const [tiersOpen, setTiersOpen] = useState(firingTiers.length > 0);

  return (
    <Card>
      <CardContent className="space-y-4">
        {/* The answer first, in plain words: how this promise is doing right now.
            The promise itself and the concept glossary live elsewhere (header +
            objective + the "New to SLOs?" primer), so the hero stays terse. */}
        <div className="space-y-1">
          <p className="max-w-prose text-sm font-medium text-foreground">
            {ccSloVerdict(state, { burn, tteSecs: tte })}
          </p>
          {description && (
            <p className="max-w-prose text-xs text-muted-foreground">
              {description}
            </p>
          )}
        </div>

        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          {/* Budget headline: the one number that says how much room is left. */}
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <CcStatusDot
                tone={readout.dot}
                pulse={state.startsWith("firing")}
              />
              <span className={cn("text-xs font-medium", readout.text)}>
                {readout.label}
              </span>
              {/* Which group this budget belongs to, whenever the SLO groups at
                  all, plus the "worst of N" note once there is more than one. */}
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
            <div className="flex items-baseline gap-2">
              <span
                className={cn(
                  "text-3xl font-semibold tabular-nums",
                  fill.bar === "bg-destructive"
                    ? "text-destructive"
                    : fill.bar === "bg-amber-500"
                      ? "text-amber-600 dark:text-amber-400"
                      : "text-foreground",
                )}
              >
                {budget === null
                  ? "—"
                  : ccBudgetTone(budget).exhausted
                    ? "0%"
                    : ccFmtFraction(budget)}
              </span>
              <span className="text-xs text-muted-foreground">
                error budget left
              </span>
            </div>
            <div
              className={cn(
                "h-2 w-full max-w-xs overflow-hidden rounded-full sm:w-64",
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
          </div>

          {/* Dynamics: achieved reliability, how fast, and how long to empty. */}
          <div className="flex gap-6">
            <Fact label="SLI">
              {worst?.sli == null ? (
                <span className="text-muted-foreground">—</span>
              ) : (
                ccFmtFraction(worst.sli)
              )}
            </Fact>
            <Fact label="Burn rate">
              {burn === null ? (
                <span className="text-muted-foreground">—</span>
              ) : (
                <span
                  className={
                    state.startsWith("firing") ? readout.text : undefined
                  }
                >
                  {ccFmtBurn(burn.rate)}
                  <span className="text-muted-foreground">
                    {" "}
                    / {burn.window}
                  </span>
                </span>
              )}
            </Fact>
            <Fact label="Time to exhaustion">
              {tte === null ? (
                <span className="text-muted-foreground">—</span>
              ) : tte === 0 ? (
                <span className="text-destructive">exhausted</span>
              ) : (
                ccFormatSloDuration(tte)
              )}
            </Fact>
          </div>
        </div>

        {/* What would page you: a one-line verdict, with the per-tier pressure
            meters on demand (open when something is firing). */}
        {worst && (
          <div className="border-t border-border/60 pt-3">
            <Collapsible open={tiersOpen} onOpenChange={setTiersOpen}>
              <CcDisclosureTrigger open={tiersOpen}>
                <span
                  className={cn(
                    "text-xs font-medium",
                    firingTiers.length > 0 ? readout.text : "text-foreground",
                  )}
                >
                  {firingTiers.length > 0
                    ? `${firingTiers.map((f) => f.tier).join(", ")} firing`
                    : "No alert tier near firing"}
                </span>
                {!tiersOpen && (
                  <span className="text-[0.6875rem] text-muted-foreground">
                    burn-rate pressure
                  </span>
                )}
              </CcDisclosureTrigger>
              <CollapsibleContent>
                <div className="mt-2 space-y-2.5">
                  {tiers.map((t) => (
                    <TierPressure
                      key={t.name}
                      tier={t}
                      snap={worst.tiers.find((s) => s.name === t.name)}
                      firing={firingTiers.some((f) => f.tier === t.name)}
                    />
                  ))}
                </div>
              </CollapsibleContent>
            </Collapsible>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
