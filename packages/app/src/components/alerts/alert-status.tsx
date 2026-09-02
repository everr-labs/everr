/**
 * The one place the alerting screens turn a status into a glyph, a word and a
 * tone. Triage bands, triage rows and the rule inventory all read from here,
 * so a flame always means firing and amber always means pending, whichever
 * list the reader is looking at.
 */

import { Badge } from "@everr/ui/components/badge";
import { cn } from "@everr/ui/lib/utils";
import {
  BellOff,
  Circle,
  Clock,
  Flame,
  type LucideIcon,
  Pause,
  TriangleAlert,
} from "lucide-react";
import type { RuleInventoryState } from "@/data/alerting/triage/view";
import type { AlertingSeverity } from "@/data/alerting/types";

type StatusMeta = {
  icon: LucideIcon;
  /** What the band header calls this status. */
  label: string;
  /** Foreground tone in the lists. Written out in full because Tailwind only
   *  keeps classes it can see as literals. */
  text: string;
  /** Band-header wash behind the same tone. */
  band: string;
  /** Fill for a stretch of this state on a state chart, and the matching
   *  foreground tone for the legend glyph that keys it.
   *
   *  These are not `text`, on purpose. `silenced` is the firing red at low
   *  strength rather than a neutral grey: a silenced rule is still firing, and
   *  greying it out would say the opposite. `degraded` is hatched because it is
   *  not a state the rule reached, it is the absence of a verdict. The lists
   *  can afford to grey both; a chart that did would key nothing. */
  fill: string;
  chartText: string;
  /** The same chart tone as a raw CSS variable, for the SVG strokes and fills
   *  that cannot take a class. */
  stroke: string;
};

export const STATUS_META: Record<RuleInventoryState, StatusMeta> = {
  degraded: {
    icon: TriangleAlert,
    label: "Not evaluating",
    text: "text-muted-foreground",
    band: "bg-muted/30",
    fill: "bg-[repeating-linear-gradient(135deg,var(--muted-foreground)_0_2px,transparent_2px_5px)] opacity-70",
    chartText: "text-muted-foreground",
    stroke: "var(--muted-foreground)",
  },
  firing: {
    icon: Flame,
    label: "Firing",
    text: "text-destructive",
    band: "bg-destructive/8",
    fill: "bg-destructive",
    chartText: "text-destructive",
    stroke: "var(--destructive)",
  },
  pending: {
    icon: Clock,
    label: "Pending",
    text: "text-chart-2",
    band: "bg-chart-2/8",
    fill: "bg-chart-2",
    chartText: "text-chart-2",
    stroke: "var(--chart-2)",
  },
  silenced: {
    icon: BellOff,
    label: "Silenced",
    text: "text-muted-foreground",
    band: "bg-muted/30",
    fill: "bg-destructive/35",
    chartText: "text-destructive/50",
    stroke: "var(--destructive)",
  },
  inactive: {
    icon: Circle,
    label: "Inactive",
    text: "text-muted-foreground",
    band: "bg-muted/30",
    fill: "",
    chartText: "text-muted-foreground/60",
    stroke: "var(--muted-foreground)",
  },
  // Off, not quiet. The glyph has to differ from `inactive`, or a rule nobody
  // is evaluating reads as a rule with nothing to report.
  paused: {
    icon: Pause,
    label: "Paused",
    text: "text-muted-foreground",
    band: "bg-muted/30",
    fill: "",
    chartText: "text-muted-foreground",
    stroke: "var(--muted-foreground)",
  },
};

export function StatusIcon({
  status,
  className,
}: {
  status: RuleInventoryState;
  className?: string;
}) {
  const Icon = STATUS_META[status].icon;
  return (
    <Icon
      aria-hidden
      className={cn("size-3 shrink-0", STATUS_META[status].text, className)}
    />
  );
}

/**
 * The neutral chip a row wears when its own text has to name a status the
 * band header does not already name (a partial silence inside a firing band).
 * It stays neutral on purpose: colour in these lists belongs to the band, so a
 * coloured row chip would compete with severity for the same glance.
 */
export function StatusChip({
  status,
  children,
}: {
  status: RuleInventoryState;
  children: React.ReactNode;
}) {
  return (
    <Badge variant="outline" size="md" className="rounded-md bg-input/40">
      <StatusIcon status={status} className="text-muted-foreground" />
      {children}
    </Badge>
  );
}

const SEVERITY_TEXT: Record<AlertingSeverity, string> = {
  critical: "text-destructive",
  warning: "text-chart-2",
  info: "text-muted-foreground",
};

/** Severity is routing, not urgency-of-the-moment, so it reads as a quiet
 *  dot-and-word rather than another coloured block. */
export function SeverityLabel({
  severity,
  className,
}: {
  severity: AlertingSeverity;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 text-xs",
        SEVERITY_TEXT[severity],
        className,
      )}
    >
      <span className="size-1.5 shrink-0 rounded-full bg-current" />
      {severity}
    </span>
  );
}
