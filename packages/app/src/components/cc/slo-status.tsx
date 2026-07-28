// packages/app/src/components/cc/slo-status.tsx
//
// The SLO detail page's headline numbers, as one strip: the worst group's error
// budget (with the same meter the listing uses), the promise, the reliability
// actually achieved, the current burn, and how long the budget lasts at that
// burn. Every value is the worst group's, so the strip and the budget chart
// below it are talking about the same thing.
import { Card, CardContent } from "@everr/ui/components/card";
import { toneText } from "@everr/ui/components/tone";
import {
  CcBudgetMeter,
  ccBudgetTextTone,
  ccFmtBudgetRemaining,
  ccFmtBurn,
  ccFmtFraction,
} from "@/components/cc/budget-bar";
import {
  type CcSloState,
  ccFmtWindowLabel,
  ccFormatSloTarget,
  ccSloCurrentBurn,
  ccSloExhaustion,
  ccSloGroupState,
  ccSloTiers,
  ccSloWindowLabel,
} from "@/data/cc/slo";
import type { CcSlo, CcSloGroupStatus } from "@/data/cc/types";

// The colour a firing state lends the burn figure. Amber is "attention", red is
// "emergency"; Signal Lime stays reserved, so healthy is emerald. Only the
// firing states are ever read from here (see the burn Stat) — the rest are
// listed so a new state cannot be added without deciding its tone.
const STATE_TEXT: Record<CcSloState, string> = {
  exhausted: toneText({ tone: "danger" }),
  "firing-critical": toneText({ tone: "danger" }),
  "firing-warning": toneText({ tone: "warning" }),
  "at-risk": toneText({ tone: "warning" }),
  healthy: toneText({ tone: "healthy" }),
  unknown: toneText({ tone: "muted" }),
};

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
  const budget = worst?.budget_remaining ?? null;
  const burn = worst ? ccSloCurrentBurn(tiers, worst.tiers) : null;
  const tte = worst?.time_to_exhaustion_secs ?? null;
  const exhaustion = ccSloExhaustion(budget, tte, burn?.effective ?? null);

  return (
    <Card>
      <CardContent>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3 lg:grid-cols-5 lg:divide-x lg:divide-border/60">
          <Stat
            label="Error budget left"
            // Same meter, formatter and thresholds as the listing's inline bar,
            // one size up: this is the page's headline figure. The number takes
            // its own type scale, hence the two Stat slots rather than a whole
            // CcBudgetBar.
            hint={<CcBudgetMeter remaining={budget} />}
          >
            <span className={ccBudgetTextTone(budget)}>
              {budget === null ? "—" : ccFmtBudgetRemaining(budget)}
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
                    ? STATE_TEXT[state]
                    : undefined
                }
              >
                {ccFmtBurn(burn.rate)}
              </span>
            )}
          </Stat>
          <Stat label="Time to exhaustion">
            <span
              className={
                exhaustion.kind === "exhausted"
                  ? toneText({ tone: "danger" })
                  : exhaustion.kind === "forecast"
                    ? undefined
                    : toneText({ tone: "muted" })
              }
            >
              {exhaustion.label}
            </span>
          </Stat>
        </dl>
      </CardContent>
    </Card>
  );
}
