import { Button } from "@everr/ui/components/button";
import { Meter } from "@everr/ui/components/meter";
import { cn } from "@everr/ui/lib/utils";
import { BellOff, Send } from "lucide-react";
import { useMemo } from "react";
import type { TriageAlert, TriageStatus } from "@/data/alerting/triage/view";
import { ALERTING_SEVERITIES } from "@/data/alerting/vocabulary";
import { AlertSparkline } from "./alert-sparkline";
import { STATUS_META, StatusChip } from "./alert-status";

/** Worst first. A rule we cannot evaluate outranks one that is firing: a
 *  missing verdict hides an unknown number of firing instances. */
const BAND_ORDER: TriageStatus[] = ["degraded", "firing", "pending"];

/** The two orders as lookups rather than `indexOf` scans: the comparator runs
 *  them once per comparison, not once per row. */
const bandRank = rankOf(BAND_ORDER);

/** Worst first, which is the vocabulary read backwards: `ALERTING_SEVERITIES`
 *  is ascending, and it is the list the Zod and Postgres enums are built from,
 *  so a severity added there cannot fall out of this sort. */
const severityRank = rankOf([...ALERTING_SEVERITIES].reverse());

function rankOf<T extends string>(order: readonly T[]): Record<T, number> {
  return Object.fromEntries(order.map((k, i) => [k, i])) as Record<T, number>;
}

/** "firing for", not "since": the row already says how long, and the verb
 *  names which clock is running. */
const SINCE_LABEL: Record<TriageStatus, string> = {
  degraded: "failing for",
  firing: "firing for",
  pending: "pending for",
};

/** A silenced rule is still firing, so it stays in its own band, dimmed in
 *  place. Exiling it to the bottom would hide the fact that the thing you
 *  silenced is still happening. */
function sortForTriage(alerts: TriageAlert[]) {
  return alerts.slice().sort((a, b) => {
    const band = bandRank[a.status] - bandRank[b.status];
    if (band !== 0) return band;
    const sev = severityRank[a.severity] - severityRank[b.severity];
    if (sev !== 0) return sev;
    return Number(Boolean(a.silence)) - Number(Boolean(b.silence));
  });
}

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
    // The row is a pointer convenience, not the control: the rule name below
    // is the real button, so keyboard and screen-reader users get one clear
    // target instead of a click handler they cannot reach.
    // biome-ignore lint/a11y/noStaticElementInteractions: pointer-only row convenience, the rule name inside is the real button
    // biome-ignore lint/a11y/useKeyWithClickEvents: pointer-only row convenience, the rule name inside is the real button
    <div
      onClick={onOpen}
      className={cn(
        // Two tiers, both measured against the list column rather than the
        // window: the first drops the sparkline and tightens the measured
        // column, the second is the full table. Without them, opening the
        // detail panel would keep five columns in half the width and crush
        // the rule name, the one thing the reader is scanning for.
        "grid cursor-pointer grid-cols-1 items-center gap-x-6 gap-y-3 border-t px-3 py-3.5 transition-colors hover:bg-muted/25 @[44rem]/list:grid-cols-[minmax(0,1fr)_10rem_7rem_6.5rem] @[53rem]/list:grid-cols-[minmax(0,1fr)_12rem_7rem_5rem_6.5rem]",
        selected && "bg-muted/40",
        dimmed && "opacity-60",
      )}
    >
      <div className="flex min-w-0 flex-col gap-1">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onOpen();
          }}
          className="truncate text-left text-sm font-medium outline-2 outline-dotted outline-transparent hover:underline focus-visible:outline-primary"
        >
          {alert.name}
        </button>
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
    </div>
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
  alerts: TriageAlert[];
  openPath: string | null;
  onOpen: (path: string) => void;
  onSilence: (path: string) => void;
  onExpireSilence: (path: string) => void;
}) {
  // Sorting and counting are the whole list's worth of work, and neither
  // depends on which row is open or which one the pointer is over.
  const { sorted, counts } = useMemo(() => {
    const sorted = sortForTriage(alerts);
    const counts = new Map<TriageStatus, number>();
    for (const a of sorted)
      counts.set(a.status, (counts.get(a.status) ?? 0) + 1);
    return { sorted, counts };
  }, [alerts]);

  let band: TriageStatus | null = null;

  return (
    <div className="border-b">
      {sorted.map((alert, index) => {
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
