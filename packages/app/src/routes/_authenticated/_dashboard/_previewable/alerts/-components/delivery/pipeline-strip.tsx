import { toneText } from "@everr/ui/components/tone";
import {
  AlertingBreachBreakdown,
  AlertingSummaryCard,
  AlertingSummaryStat,
} from "../common/summary-card";

export type AlertingPipelineFacts = {
  watchingRules: number;
  pausedRules: number;
  firing: number;
  pending: number;
  silenced: number;
  activeSilences: number;
  defaultChannelCount: number;
  undeliveredFiring: number;
};

function MetricNumber({ children }: { children: React.ReactNode }) {
  return (
    <span className="font-semibold leading-none tabular-nums">{children}</span>
  );
}

function MetricCount({
  value,
  singular,
  plural,
}: {
  value: number;
  singular: string;
  plural: string;
}) {
  return (
    <span className="inline-flex items-baseline gap-1 whitespace-nowrap">
      <MetricNumber>{value}</MetricNumber>{" "}
      <span className="text-xs">{value === 1 ? singular : plural}</span>
    </span>
  );
}

export function AlertingPipelineStrip({
  facts,
}: {
  facts: AlertingPipelineFacts;
}) {
  const breaching = facts.firing + facts.pending;

  return (
    <AlertingSummaryCard ariaLabel="Alerting overview" ariaLive="polite">
      <AlertingSummaryStat
        label="Breaching instances"
        value={<MetricNumber>{breaching}</MetricNumber>}
        valueClassName={breaching > 0 ? "text-destructive" : undefined}
        detail={
          <AlertingBreachBreakdown
            firing={facts.firing}
            pending={facts.pending}
          />
        }
      />
      <AlertingSummaryStat
        label="Delivery"
        wrapValue
        value={
          <MetricCount
            value={facts.defaultChannelCount}
            singular="default channel"
            plural="default channels"
          />
        }
        detail={
          facts.defaultChannelCount === 0
            ? "Not configured"
            : facts.undeliveredFiring > 0
              ? "Coverage incomplete"
              : "Delivery ready"
        }
        detailClassName={
          facts.undeliveredFiring > 0
            ? toneText({ tone: "warning" })
            : undefined
        }
      />
      <AlertingSummaryStat
        label="Watching"
        wrapValue
        value={
          <MetricCount
            value={facts.watchingRules}
            singular="rule"
            plural="rules"
          />
        }
        detail={
          facts.pausedRules > 0 ? `${facts.pausedRules} paused` : "All enabled"
        }
      />
      <AlertingSummaryStat
        label="Silenced"
        value={
          <MetricCount
            value={facts.silenced}
            singular="alert"
            plural="alerts"
          />
        }
        detail={
          facts.activeSilences === 0
            ? "No active silences"
            : `${facts.activeSilences} active ${
                facts.activeSilences === 1 ? "silence" : "silences"
              }`
        }
      />
    </AlertingSummaryCard>
  );
}
