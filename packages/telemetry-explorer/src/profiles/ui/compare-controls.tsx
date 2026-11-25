import { Button } from "@everr/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@everr/ui/components/dropdown-menu";
import type { TimeRange } from "@everr/ui/lib/time-range";
import { ChevronDown, GitCompareArrows } from "lucide-react";
import type { ReactNode } from "react";
import type { ProfileStacks } from "../data/types";
import { BASELINE_LABELS, BASELINES, type Baseline } from "../model/diff";
import { formatProfileValue } from "../model/format";
import type { ProfileVersion } from "../model/versions";

export function CompareMenu({
  value,
  onChange,
}: {
  value: Baseline | undefined;
  onChange: (value: Baseline | undefined) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant={value ? "secondary" : "outline"} size="sm" />}>
        <GitCompareArrows data-icon="inline-start" />
        {value ? `Compared with ${BASELINE_LABELS[value].toLowerCase()}` : "Compare"}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuRadioGroup
          value={value ?? "off"}
          onValueChange={(next) => onChange(BASELINES.find((baseline) => baseline === next))}
        >
          <DropdownMenuRadioItem value="off">No comparison</DropdownMenuRadioItem>
          {BASELINES.map((baseline) => (
            <DropdownMenuRadioItem key={baseline} value={baseline}>
              {BASELINE_LABELS[baseline]}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Picks one `service.version`; `exclude` is the other side of the comparison. */
export function VersionMenu({
  label,
  versions,
  value,
  exclude,
  onChange,
}: {
  label: string;
  versions: readonly ProfileVersion[];
  value: string | undefined;
  exclude: string | undefined;
  onChange: (version: string) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="outline" size="sm" className="font-mono" />}>
        <span className="text-muted-foreground font-sans">{label}</span>
        {value ?? "none"}
        <ChevronDown data-icon="inline-end" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-72">
        <DropdownMenuRadioGroup
          value={value ?? ""}
          onValueChange={(next) => {
            if (typeof next === "string") onChange(next);
          }}
        >
          {versions.map((version) => (
            <DropdownMenuRadioItem
              key={version.version}
              value={version.version}
              disabled={version.version === exclude}
            >
              <span className="flex min-w-0 flex-1 items-baseline justify-between gap-3">
                <span className="truncate font-mono">{version.version}</span>
                <span className="text-muted-foreground shrink-0 text-xs">
                  last seen {formatInstant(version.lastSeen)}
                </span>
              </span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * What the flame graph is diffed against and the diff legend, or why there is
 * no baseline yet.
 */
export function CompareStatus({
  description,
  missing,
  baseline,
  error,
  unit,
}: {
  /** The two windows in words, e.g. which versions over which times. */
  description: ReactNode;
  /** Set when the baseline cannot be queried yet, with the reason. */
  missing: string | undefined;
  baseline: ProfileStacks | undefined;
  error: boolean;
  unit: string;
}) {
  if (missing) return <span className="text-muted-foreground">{missing}</span>;
  if (error) return <span className="text-destructive">Could not load the baseline</span>;
  if (!baseline) return <span className="text-muted-foreground">Loading the baseline…</span>;
  if (baseline.stacks.length === 0) {
    return <span className="text-muted-foreground">{description}: no samples in the baseline</span>;
  }
  const baselineTotal = baseline.stacks.reduce((sum, stack) => sum + stack.value, 0);
  return (
    <span className="text-muted-foreground flex flex-wrap items-center gap-x-2 gap-y-0.5 tabular-nums">
      <span>{description}</span>
      <span>Baseline {formatProfileValue(baselineTotal, unit)}</span>
      <span className="flex items-center gap-1">
        <span aria-hidden className="inline-block size-2 rounded-sm bg-[hsl(0_80%_62%)]" />
        larger share
      </span>
      <span className="flex items-center gap-1">
        <span aria-hidden className="inline-block size-2 rounded-sm bg-[hsl(145_55%_58%)]" />
        smaller share
      </span>
    </span>
  );
}

function formatInstant(iso: string): string {
  return new Date(iso).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** An absolute window in the viewer's time zone, the end's date only when it differs. */
export function formatWindow(range: TimeRange): string {
  const from = new Date(range.from);
  const to = new Date(range.to);
  const sameDay = from.toDateString() === to.toDateString();
  const end = sameDay
    ? to.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : formatInstant(range.to);
  return `${formatInstant(range.from)} to ${end}`;
}
