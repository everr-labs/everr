import { Button } from "@everr/ui/components/button";
import { Meter } from "@everr/ui/components/meter";
import { cn } from "@everr/ui/lib/utils";
import { BellOff, Send } from "lucide-react";
import type { TriageAlert, TriageStatus } from "@/data/alerting/triage/view";
import { AlertSparkline } from "./alert-sparkline";
import { STATUS_META, StatusChip } from "./alert-status";
import { RowTarget, SelectableRow } from "./list-row";

/** "firing for", not "since": the row already says how long, and the verb
 *  names which clock is running. */
const SINCE_LABEL: Record<TriageStatus, string> = {
  degraded: "failing for",
  firing: "firing for",
  pending: "pending for",
};

function BandHeader({
  status,
  count,
  first,
}: {
  status: TriageStatus;
  count: number;
  /** The list already has a top border; the first band must not draw a second. */
  first: boolean;
}) {
  const meta = STATUS_META[status];
  const Icon = meta.icon;
  return (
    <div
      className={cn(
        "flex items-center gap-2 px-3 py-1.5",
        !first && "border-t",
        meta.band,
      )}
    >
      <Icon aria-hidden className={cn("size-3", meta.text)} />
      <h2 className={cn("text-xs font-semibold tracking-wide", meta.text)}>
        {meta.label} · {count}
      </h2>
    </div>
  );
}

function TriageRow({
  alert,
  selected,
  onOpen,
  onSilence,
  onExpireSilence,
}: {
  alert: TriageAlert;
  selected: boolean;
  onOpen: () => void;
  onSilence: () => void;
  onExpireSilence: () => void;
}) {
  const dimmed = alert.silence?.wholeRule === true;
  const partialSilence = alert.silence && !alert.silence.wholeRule;

  return (
    <SelectableRow
      selected={selected}
      onOpen={onOpen}
      className={cn(
        // Two tiers, both measured against the list column rather than the
        // window: the first drops the sparkline and tightens the measured
        // column, the second is the full table. Without them, opening the
        // detail panel would keep five columns in half the width and crush
        // the rule name, the one thing the reader is scanning for.
        "grid grid-cols-1 items-center gap-x-6 gap-y-3 border-t px-3 py-3.5 @[44rem]/list:grid-cols-[minmax(0,1fr)_10rem_7rem_6.5rem] @[53rem]/list:grid-cols-[minmax(0,1fr)_12rem_7rem_5rem_6.5rem]",
        dimmed && "opacity-60",
      )}
    >
      <div className="flex min-w-0 flex-col gap-1">
        <RowTarget onOpen={onOpen} className="text-sm font-medium">
          {alert.name}
        </RowTarget>
        {/* The failure code gets its own line rather than sitting beside the
            name: these identifiers are long, and squeezing them onto the name
            line truncates the one word the reader is scanning for. */}
        {alert.error && (
          <span className="w-fit max-w-full truncate rounded border border-chart-5/45 px-1.5 py-px font-mono text-xs text-chart-2">
            {alert.error}
          </span>
        )}
        {partialSilence && (
          <StatusChip status="silenced">
            silenced · {alert.silence?.expiresIn} left
          </StatusChip>
        )}
        {/* Delivery is the answer to "has anyone been told?", which is the
            second thing a responder asks after "what is on fire?". */}
        <p className="flex min-w-0 items-center gap-1.5 truncate text-xs text-muted-foreground">
          {alert.silence?.wholeRule ? (
            <>
              <BellOff aria-hidden className="size-2.5 shrink-0" />
              <span className="truncate font-mono">
                silenced · {alert.silence.expiresIn} left
                {/* Nothing held yet is the common case right after silencing;
                    printing "0 held" makes the reader stop and parse a zero. */}
                {alert.silence.suppressed > 0 &&
                  ` · ${alert.silence.suppressed} held`}
              </span>
            </>
          ) : (
            <>
              <Send aria-hidden className="size-2.5 shrink-0" />
              <span className="truncate">{alert.notification}</span>
            </>
          )}
        </p>
      </div>

      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="truncate text-xs text-muted-foreground">
          {alert.measured}
        </span>
        <div className="flex items-baseline gap-1.5">
          <span className="font-mono text-base tabular-nums">
            {alert.value}
          </span>
          <span className="font-mono text-xs text-muted-foreground">
            {alert.condition}
          </span>
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <span className="text-xs text-muted-foreground">
          {SINCE_LABEL[alert.status]}
        </span>
        <div className="flex items-baseline gap-1.5">
          <span className="font-mono text-sm tabular-nums">{alert.since}</span>
          {alert.pending && (
            <span className="font-mono text-xs text-muted-foreground tabular-nums">
              of {alert.pending.total}
            </span>
          )}
        </div>
        {alert.pending && (
          <Meter
            size="sm"
            tone="warning"
            layers={[{ pct: alert.pending.percent, tone: "warning" }]}
          />
        )}
      </div>

      <div className="hidden justify-end @[53rem]/list:flex">
        <AlertSparkline
          spark={alert.spark}
          tone={STATUS_META[alert.status].stroke}
          name={alert.name}
        />
      </div>

      {/* biome-ignore lint/a11y/noStaticElementInteractions: stops the row click when using the silence controls */}
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: stops the row click when using the silence controls */}
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex justify-start @[44rem]/list:justify-end"
      >
        {alert.silence?.wholeRule ? (
          <Button variant="ghost" size="sm" onClick={onExpireSilence}>
            Cancel silence
          </Button>
        ) : (
          <Button variant="ghost" size="sm" onClick={onSilence}>
            Silence
          </Button>
        )}
      </div>
    </SelectableRow>
  );
}

/**
 * The triage list: every rule that wants attention right now, grouped under a
 * coloured band header per status. The colour lives in the band, never in the
 * row, so the group a row belongs to is legible before any single row is read
 * and severity keeps the only other colour on the line.
 */
export function TriageList({
  alerts,
  openPath,
  onOpen,
  onSilence,
  onExpireSilence,
}: {
  /** In triage order, as the server returns them: the list draws a band
   *  header wherever the status changes and never re-sorts. What "worst
   *  first" means is alerting semantics, and it lives with the rest of them. */
  alerts: TriageAlert[];
  openPath: string | null;
  onOpen: (path: string) => void;
  onSilence: (path: string) => void;
  onExpireSilence: (path: string) => void;
}) {
  const counts = new Map<TriageStatus, number>();
  for (const a of alerts) counts.set(a.status, (counts.get(a.status) ?? 0) + 1);

  let band: TriageStatus | null = null;

  return (
    <div className="border-b">
      {alerts.map((alert, index) => {
        const startsBand = alert.status !== band;
        band = alert.status;
        return (
          <div key={alert.path}>
            {startsBand && (
              <BandHeader
                status={band}
                count={counts.get(band) ?? 0}
                first={index === 0}
              />
            )}
            <TriageRow
              alert={alert}
              selected={openPath === alert.path}
              onOpen={() => onOpen(alert.path)}
              onSilence={() => onSilence(alert.path)}
              onExpireSilence={() => onExpireSilence(alert.path)}
            />
          </div>
        );
      })}
    </div>
  );
}
