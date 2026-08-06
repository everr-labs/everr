import { toneText } from "@everr/ui/components/tone";
import { cn } from "@everr/ui/lib/utils";

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

function Stage({
  label,
  primary,
  secondary,
  tone,
}: {
  label: string;
  primary: React.ReactNode;
  secondary?: React.ReactNode;
  tone?: "firing" | "degraded";
}) {
  return (
    <span className="flex min-w-0 flex-col gap-0.5 px-3 py-2">
      <span className="text-[0.6875rem] font-medium tracking-wide text-muted-foreground uppercase">
        {label}
      </span>
      <span
        className={cn(
          "text-sm font-semibold tabular-nums whitespace-nowrap",
          tone === "firing" && "text-destructive",
        )}
      >
        {primary}
      </span>
      {secondary && (
        <span
          className={cn(
            "text-xs whitespace-nowrap",
            toneText({ tone: tone === "degraded" ? "warning" : "muted" }),
          )}
        >
          {secondary}
        </span>
      )}
    </span>
  );
}

// Every cell is deliberately inert: navigation is the sidebar's job.
const STAGE_CELL_CLASS = "rounded-md border border-border bg-card";

export function AlertingPipelineStrip({
  facts,
}: {
  facts: AlertingPipelineFacts;
}) {
  return (
    <section
      aria-label="Alerting pipeline"
      aria-live="polite"
      className="grid grid-cols-2 gap-1.5 lg:grid-cols-4 lg:gap-2"
    >
      <div className={STAGE_CELL_CLASS}>
        <Stage
          label="Firing"
          primary={facts.firing}
          secondary={
            facts.pending > 0
              ? `${facts.pending} pending`
              : facts.firing > 0
                ? "needs attention"
                : "all quiet"
          }
          tone={facts.firing > 0 ? "firing" : undefined}
        />
      </div>
      <div className={STAGE_CELL_CLASS}>
        <Stage
          label="Delivery"
          primary={
            <>
              {facts.routeCount} {facts.routeCount === 1 ? "route" : "routes"} →{" "}
              {facts.receiverCount}{" "}
              {facts.receiverCount === 1 ? "receiver" : "receivers"}
            </>
          }
          secondary={
            facts.unroutedFiring > 0
              ? `${facts.unroutedFiring} firing unrouted`
              : facts.routeCount === 0
                ? "no routes configured"
                : "routes matching"
          }
          tone={facts.unroutedFiring > 0 ? "degraded" : undefined}
        />
      </div>
      <div className={STAGE_CELL_CLASS}>
        <Stage
          label="Watching"
          primary={
            <>
              {facts.watchingRules}{" "}
              {facts.watchingRules === 1 ? "rule" : "rules"} ·{" "}
              {facts.watchingSlos} {facts.watchingSlos === 1 ? "SLO" : "SLOs"}
            </>
          }
          secondary={
            facts.pausedRules > 0
              ? `${facts.pausedRules} paused`
              : "none paused"
          }
        />
      </div>
      <div className={STAGE_CELL_CLASS}>
        <Stage
          label="Silenced"
          primary={facts.silenced}
          secondary={`${facts.activeSilences} active ${
            facts.activeSilences === 1 ? "silence" : "silences"
          }`}
        />
      </div>
    </section>
  );
}
