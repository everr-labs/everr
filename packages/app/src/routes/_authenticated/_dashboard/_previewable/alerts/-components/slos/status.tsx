import { toneText } from "@everr/ui/components/tone";
import {
  type AlertingSloState,
  alertingFmtWindowLabel,
  alertingFormatSloTarget,
  alertingSloCurrentBurn,
  alertingSloExhaustion,
  alertingSloStatusState,
  alertingSloTiers,
  alertingSloWindowLabel,
} from "@/data/alerting/slos/model";
import type {
  AlertingSlo,
  AlertingSloStatusPayload,
} from "@/data/alerting/types";
import {
  AlertingSummaryCard,
  AlertingSummaryStat,
} from "../shared/summary-card";
import {
  AlertingBudgetMeter,
  alertingBudgetTextTone,
  alertingFmtBudgetRemaining,
  alertingFmtBurn,
  alertingFmtFraction,
} from "./budget-bar";

// Keep every state explicit so new states require a deliberate tone choice.
const STATE_TEXT: Record<AlertingSloState, string> = {
  exhausted: toneText({ tone: "danger" }),
  "firing-critical": toneText({ tone: "danger" }),
  "firing-warning": toneText({ tone: "warning" }),
  "at-risk": toneText({ tone: "warning" }),
  healthy: toneText({ tone: "healthy" }),
  unknown: toneText({ tone: "muted" }),
};

export function SloSummaryCard({
  slo,
  status,
}: {
  slo: AlertingSlo;
  status: AlertingSloStatusPayload | null;
}) {
  const tiers = alertingSloTiers(slo.spec);
  const state = alertingSloStatusState(tiers, status);
  const budget = status?.budget_remaining ?? null;
  const burn = status ? alertingSloCurrentBurn(tiers, status.tiers) : null;
  const tte = status?.time_to_exhaustion_secs ?? null;
  const exhaustion = alertingSloExhaustion(
    budget,
    tte,
    burn?.effective ?? null,
  );
  // A null burn on a loaded snapshot means the SLI saw no valid events
  // inside any alert window: unmeasurable, not missing.
  const burnHint =
    burn !== null
      ? `last ${alertingFmtWindowLabel(burn.window)}`
      : status !== null
        ? "no recent events"
        : undefined;
  const burnTone =
    burn === null
      ? toneText({ tone: "muted" })
      : state.startsWith("firing") && (burn.effective ?? 0) > 0
        ? STATE_TEXT[state]
        : undefined;
  const exhaustionTone =
    exhaustion.kind === "exhausted"
      ? toneText({ tone: "danger" })
      : exhaustion.kind === "forecast"
        ? undefined
        : toneText({ tone: "muted" });

  return (
    <AlertingSummaryCard ariaLabel="SLO activity summary">
      <AlertingSummaryStat
        label="Error budget left"
        value={budget === null ? "—" : alertingFmtBudgetRemaining(budget)}
        valueClassName={alertingBudgetTextTone(budget)}
        detail={<AlertingBudgetMeter remaining={budget} size="sm" />}
      />
      <AlertingSummaryStat
        label="SLO"
        value={alertingFormatSloTarget(slo.spec.targetPercent)}
        detail={`over ${alertingSloWindowLabel(slo.spec)}`}
      />
      <AlertingSummaryStat
        label="SLI"
        value={status?.sli == null ? "—" : alertingFmtFraction(status.sli)}
        valueClassName={
          status?.sli == null ? toneText({ tone: "muted" }) : undefined
        }
        detail={`last ${slo.spec.timeWindow.duration}`}
      />
      <AlertingSummaryStat
        label="Burn rate"
        value={burn === null ? "—" : alertingFmtBurn(burn.rate)}
        valueClassName={burnTone}
        detail={burnHint}
      />
      <AlertingSummaryStat
        label="Time to exhaustion"
        value={exhaustion.label}
        valueClassName={exhaustionTone}
      />
    </AlertingSummaryCard>
  );
}
