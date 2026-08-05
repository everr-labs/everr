import { Card, CardContent } from "@everr/ui/components/card";
import { toneText } from "@everr/ui/components/tone";
import {
  type CcSloState,
  ccFmtWindowLabel,
  ccFormatSloTarget,
  ccSloCurrentBurn,
  ccSloExhaustion,
  ccSloStatusState,
  ccSloTiers,
  ccSloWindowLabel,
} from "@/data/cc/slo";
import type { CcSlo, CcSloStatusPayload } from "@/data/cc/types";
import {
  CcBudgetMeter,
  ccBudgetTextTone,
  ccFmtBudgetRemaining,
  ccFmtBurn,
  ccFmtFraction,
} from "./budget-bar";

// Only the firing states are ever read (see the burn Stat); the rest are
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
  status,
}: {
  slo: CcSlo;
  status: CcSloStatusPayload | null;
}) {
  const tiers = ccSloTiers(slo.spec);
  const state = ccSloStatusState(tiers, status);
  const budget = status?.budget_remaining ?? null;
  const burn = status ? ccSloCurrentBurn(tiers, status.tiers) : null;
  const tte = status?.time_to_exhaustion_secs ?? null;
  const exhaustion = ccSloExhaustion(budget, tte, burn?.effective ?? null);
  // A null burn on a loaded snapshot means the SLI saw no valid events
  // inside any alert window: unmeasurable, not missing.
  const burnHint =
    burn !== null
      ? `last ${ccFmtWindowLabel(burn.window)}`
      : status !== null
        ? "no recent events"
        : undefined;

  return (
    <Card>
      <CardContent>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3 lg:grid-cols-5 lg:divide-x lg:divide-border/60">
          <Stat
            label="Error budget left"
            // Deliberately the same meter, formatter and thresholds as the
            // listing's inline bar.
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
            {status?.sli == null ? (
              <span className="text-muted-foreground">—</span>
            ) : (
              ccFmtFraction(status.sli)
            )}
          </Stat>
          <Stat label="Burn rate" hint={burnHint}>
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
