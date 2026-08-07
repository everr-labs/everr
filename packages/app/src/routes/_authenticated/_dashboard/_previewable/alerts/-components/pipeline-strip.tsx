import { toneText } from "@everr/ui/components/tone";
import { Link } from "@tanstack/react-router";
import {
  AlertingBreachBreakdown,
  AlertingSummaryCard,
  AlertingSummaryStat,
} from "./summary-card";

export type AlertingPipelineFacts = {
  watchingRules: number;
  pausedRules: number;
  watchingSlos: number;
  firing: number;
  pending: number;
  silenced: number;
  activeSilences: number;
  routeCount: number;
  receiverCount: number;
  unroutedFiring: number;
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
    <AlertingSummaryCard ariaLabel="Alerting pipeline" ariaLive="polite">
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
          <span className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
            <MetricCount
              value={facts.routeCount}
              singular="route"
              plural="routes"
            />
            <span className="text-xs text-muted-foreground"> · </span>
            <MetricCount
              value={facts.receiverCount}
              singular="destination"
              plural="destinations"
            />
          </span>
        }
        detail={
          facts.routeCount === 0
            ? "Not configured"
            : facts.unroutedFiring > 0
              ? "Coverage incomplete"
              : "Delivery ready"
        }
        detailClassName={
          facts.unroutedFiring > 0 ? toneText({ tone: "warning" }) : undefined
        }
      />
      <AlertingSummaryStat
        label="Watching"
        wrapValue
        value={
          <span className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
            <Link
              to="/alerts/rules"
              className="rounded-sm underline-offset-2 outline-2 outline-dotted outline-transparent hover:underline focus-visible:outline-primary"
            >
              <MetricCount
                value={facts.watchingRules}
                singular="rule"
                plural="rules"
              />
            </Link>
            <span className="text-xs text-muted-foreground"> · </span>
            <Link
              to="/alerts/slos"
              className="rounded-sm underline-offset-2 outline-2 outline-dotted outline-transparent hover:underline focus-visible:outline-primary"
            >
              <MetricCount
                value={facts.watchingSlos}
                singular="SLO"
                plural="SLOs"
              />
            </Link>
          </span>
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
