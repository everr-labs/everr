import type { MetricKind } from "../data/schemas";
import { Badge } from "@everr/ui/components/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@everr/ui/components/tooltip";
import { cn } from "@everr/ui/lib/utils";
import { METRIC_KIND_LABELS, METRIC_KIND_SHORT_LABELS } from "./format";

/** The name with its namespace dimmed, so the last segment, which tells
 *  metrics in one namespace apart, stands out. */
export function MetricName({ name }: { name: string }) {
  const cut = name.lastIndexOf(".") + 1;
  return (
    <>
      <span className="text-muted-foreground">{name.slice(0, cut)}</span>
      {name.slice(cut)}
    </>
  );
}

/** The type as plain text, for lists: an exponential histogram's is shortened
 *  as in the type filter, with the full name on hover. */
export function MetricKindLabel({ kind }: { kind: MetricKind }) {
  const short = METRIC_KIND_SHORT_LABELS[kind];
  const title = short === METRIC_KIND_LABELS[kind] ? undefined : METRIC_KIND_LABELS[kind];
  return (
    // A titled label is positioned, so in a catalog row it sits above the
    // link's cover and shows its title on hover; the rest stays clickable.
    <span
      className={cn("text-muted-foreground text-xs whitespace-nowrap", title && "relative")}
      title={title}
    >
      {short}
    </span>
  );
}

const KIND_DESCRIPTIONS: Record<MetricKind, string> = {
  gauge: "A value sampled at a point in time, such as memory in use. Charted as reported.",
  counter:
    "A sum that only goes up, such as requests served. Charted as its per-second rate or its increase.",
  updown: "A sum that goes up and down, such as requests in flight. Charted as its current level.",
  histogram:
    "Measurements counted into buckets, such as request durations. Charted as percentiles, average or rate.",
  exponential_histogram:
    "A histogram whose buckets grow exponentially in size, set by a scale instead of fixed bounds.",
  summary: "Quantiles the SDK computed before export, such as p50 and p99.",
};

/** The metric's type next to its name, with what the type means on hover. */
export function MetricKindBadge({ kind }: { kind: MetricKind }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={<Badge variant="outline" size="md" tabIndex={0} className="cursor-default" />}
      >
        {METRIC_KIND_LABELS[kind]}
      </TooltipTrigger>
      <TooltipContent className="max-w-64">{KIND_DESCRIPTIONS[kind]}</TooltipContent>
    </Tooltip>
  );
}

/** A query on a chart with several: its letter joined to its metric in one
 *  outlined control. The selected query, the one the rail's attributes
 *  filter, has a brighter outline and letter. */
export function queryTagClass(selected: boolean) {
  return cn(
    "inline-flex h-6 min-w-0 items-stretch overflow-hidden rounded-md border text-xs",
    selected && "border-foreground/30",
  );
}

export function queryLetterClass(selected: boolean) {
  return cn(
    "flex shrink-0 items-center gap-1.5 border-r px-2 font-mono",
    selected ? "bg-foreground/[0.07] text-foreground" : "text-muted-foreground",
  );
}

/** The read-only tag, heading a query's lines in the series list. */
export function QueryTag({ id, metric }: { id: string; metric: string }) {
  return (
    <span className={queryTagClass(false)}>
      <span className={queryLetterClass(false)}>{id}</span>
      <span className="block min-w-0 truncate px-2 font-mono leading-[22px]" title={metric}>
        <MetricName name={metric} />
      </span>
    </span>
  );
}
