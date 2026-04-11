import { isValid, resolve } from "@everr/datemath";
import { ChevronDownIcon, Clock } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "./button";
import { Input } from "./input";
import { Popover, PopoverContent, PopoverTrigger } from "./popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "./tooltip";

export interface TimeRange {
  from: string;
  to: string;
}

export interface QuickRange {
  label: string;
  from: string;
  to: string;
}

export interface QuickRangeGroup {
  label: string;
  ranges: QuickRange[];
}

export const DEFAULT_TIME_RANGE: TimeRange = {
  from: "now-7d",
  to: "now",
} as const;

export const QUICK_RANGE_GROUPS: QuickRangeGroup[] = [
  {
    label: "Relative",
    ranges: [
      { label: "Last 5 minutes", from: "now-5m", to: "now" },
      { label: "Last 15 minutes", from: "now-15m", to: "now" },
      { label: "Last 1 hour", from: "now-1h", to: "now" },
      { label: "Last 6 hours", from: "now-6h", to: "now" },
      { label: "Last 12 hours", from: "now-12h", to: "now" },
      { label: "Last 24 hours", from: "now-24h", to: "now" },
      { label: "Last 2 days", from: "now-2d", to: "now" },
      { label: "Last 7 days", from: "now-7d", to: "now" },
      { label: "Last 14 days", from: "now-14d", to: "now" },
      { label: "Last 30 days", from: "now-30d", to: "now" },
      { label: "Last 90 days", from: "now-90d", to: "now" },
      { label: "Last 1 year", from: "now-1y", to: "now" },
    ],
  },
  {
    label: "Calendar",
    ranges: [
      { label: "Today", from: "now/d", to: "now/d" },
      { label: "Yesterday", from: "now-1d/d", to: "now-1d/d" },
      { label: "This week", from: "now/w", to: "now/w" },
      { label: "This month", from: "now/M", to: "now/M" },
    ],
  },
];

export const QUICK_RANGES: QuickRange[] = QUICK_RANGE_GROUPS.flatMap(
  (g) => g.ranges,
);

export function formatTimeRangeDisplay(range: TimeRange): string {
  const preset = QUICK_RANGES.find(
    (q) => q.from === range.from && q.to === range.to,
  );
  if (preset) return preset.label;
  return `${range.from} to ${range.to}`;
}

export { isValid as isValidDatemath };

function resolvePreview(
  expr: string,
  roundUp: boolean,
): { date: Date; label: string } | null {
  try {
    const date = resolve(expr, { roundUp });
    return {
      date,
      label: date.toLocaleString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      }),
    };
  } catch {
    return null;
  }
}

export function TimeRangePicker({
  value,
  onChange,
}: {
  value: TimeRange;
  onChange: (range: TimeRange) => void;
}) {
  const [open, setOpen] = useState(false);
  const [customFrom, setCustomFrom] = useState(value.from);
  const [customTo, setCustomTo] = useState(value.to);
  const [search, setSearch] = useState("");

  const filteredGroups = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return QUICK_RANGE_GROUPS;
    return QUICK_RANGE_GROUPS.map((group) => ({
      ...group,
      ranges: group.ranges.filter((r) => r.label.toLowerCase().includes(q)),
    })).filter((group) => group.ranges.length > 0);
  }, [search]);

  const customRangeState = useMemo(() => {
    const from = resolvePreview(customFrom, false);
    const to = resolvePreview(customTo, true);
    const rangeInverted = from !== null && to !== null && from.date >= to.date;

    return {
      canApply: from !== null && to !== null && !rangeInverted,
      fromPreview: from?.label ?? null,
      rangeInverted,
      toPreview: to?.label ?? null,
    };
  }, [customFrom, customTo]);

  const currentRangePreview = useMemo(() => {
    return {
      from: resolvePreview(value.from, false)?.label ?? null,
      to: resolvePreview(value.to, true)?.label ?? null,
    };
  }, [value.from, value.to]);

  const handlePresetClick = (from: string, to: string) => {
    onChange({ from, to });
    setCustomFrom(from);
    setCustomTo(to);
    setOpen(false);
  };

  const handleApply = () => {
    if (customRangeState.canApply) {
      onChange({ from: customFrom, to: customTo });
      setOpen(false);
    }
  };

  const handleOpenChange = (nextOpen: boolean) => {
    if (nextOpen) {
      setCustomFrom(value.from);
      setCustomTo(value.to);
      setSearch("");
    }
    setOpen(nextOpen);
  };

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <Tooltip>
        <TooltipTrigger
          delay={0}
          render={
            <PopoverTrigger
              render={
                <Button variant="outline" size="lg" className="gap-1.5" />
              }
            />
          }
        >
          <Clock
            data-icon="inline-start"
            className="size-3.5"
            aria-hidden="true"
          />
          {formatTimeRangeDisplay(value)}
          <ChevronDownIcon className="size-3" />
        </TooltipTrigger>
        {currentRangePreview.from && currentRangePreview.to && (
          <TooltipContent>
            {currentRangePreview.from} — {currentRangePreview.to}
          </TooltipContent>
        )}
      </Tooltip>
      <PopoverContent
        align="end"
        className="w-[520px] p-0 gap-0 overflow-hidden"
      >
        <div className="flex divide-x divide-border">
          {/* Left panel: quick ranges */}
          <div className="flex w-[200px] flex-col">
            <div className="border-b">
              <Input
                type="search"
                placeholder="Search relative range..."
                aria-label="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="rounded-none bg-transparent border-none h-10 px-3 focus:ring-0 focus-visible:ring-0"
              />
            </div>
            <div className="max-h-[320px] overflow-y-auto p-1">
              {filteredGroups.length === 0 ? (
                <div className="px-2 py-3 text-xs text-muted-foreground text-center">
                  No matches
                </div>
              ) : (
                filteredGroups.map((group, groupIndex) => (
                  <div key={group.label}>
                    {groupIndex > 0 && (
                      <div className="bg-border/50 -mx-1 my-1 h-px" />
                    )}
                    <div className="text-muted-foreground px-2 py-1.5 text-xs font-medium">
                      {group.label}
                    </div>
                    {group.ranges.map((range) => {
                      const isActive =
                        range.from === value.from && range.to === value.to;
                      return (
                        <button
                          key={`${range.from}-${range.to}`}
                          type="button"
                          className={`w-full text-left min-h-7 rounded-md px-2 py-1 text-xs/relaxed transition-colors ${
                            isActive
                              ? "bg-primary/10 text-primary font-medium"
                              : "text-foreground hover:bg-accent hover:text-accent-foreground"
                          }`}
                          onClick={() =>
                            handlePresetClick(range.from, range.to)
                          }
                        >
                          {range.label}
                        </button>
                      );
                    })}
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Right panel: custom range */}
          <div className="flex-1 p-3 space-y-3">
            <div className="text-xs font-medium text-muted-foreground">
              Custom time range
            </div>

            <div className="space-y-1.5 flex flex-col">
              <label
                htmlFor="time-range-from"
                className="text-xs font-medium text-muted-foreground"
              >
                From
              </label>
              <Input
                id="time-range-from"
                value={customFrom}
                onChange={(e) => setCustomFrom(e.target.value)}
                placeholder="now-7d"
              />
              <div className="text-[11px] h-3.5">
                {customRangeState.fromPreview ? (
                  <span className="text-muted-foreground">
                    → {customRangeState.fromPreview}
                  </span>
                ) : customFrom ? (
                  <span className="text-destructive">Invalid expression</span>
                ) : null}
              </div>
            </div>

            <div className="space-y-1.5 flex flex-col">
              <label
                htmlFor="time-range-to"
                className="text-xs font-medium text-muted-foreground"
              >
                To
              </label>
              <Input
                id="time-range-to"
                value={customTo}
                onChange={(e) => setCustomTo(e.target.value)}
                placeholder="now"
              />
              <div className="text-[11px] h-3.5">
                {customRangeState.toPreview ? (
                  <span className="text-muted-foreground">
                    → {customRangeState.toPreview}
                  </span>
                ) : customTo ? (
                  <span className="text-destructive">Invalid expression</span>
                ) : null}
              </div>
            </div>

            {customRangeState.rangeInverted && (
              <p className="text-destructive text-[11px]">
                "From" must be before "To"
              </p>
            )}
            <Button
              className="w-full mt-1"
              disabled={!customRangeState.canApply}
              onClick={handleApply}
            >
              Apply time range
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
