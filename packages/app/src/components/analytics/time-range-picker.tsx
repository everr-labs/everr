import { resolve } from "@everr/datemath";
import { Button } from "@everr/ui/components/button";
import { Input } from "@everr/ui/components/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@everr/ui/components/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@everr/ui/components/tooltip";
import { ChevronDownIcon, Clock } from "lucide-react";
import { useMemo, useState } from "react";
import { useTimeRange } from "@/hooks/use-time-range";
import { formatTimeRangeDisplay, QUICK_RANGE_GROUPS } from "@/lib/time-range";

type ResolvedPreview = {
  date: Date;
  label: string;
};

function resolvePreview(
  expr: string,
  roundUp: boolean,
): ResolvedPreview | null {
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

export function TimeRangePicker() {
  const { timeRange, setTimeRange } = useTimeRange();

  const [open, setOpen] = useState(false);
  const [customFrom, setCustomFrom] = useState(timeRange.from);
  const [customTo, setCustomTo] = useState(timeRange.to);
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
      from: resolvePreview(timeRange.from, false)?.label ?? null,
      to: resolvePreview(timeRange.to, true)?.label ?? null,
    };
  }, [timeRange.from, timeRange.to]);

  const handlePresetClick = (from: string, to: string) => {
    setTimeRange({ from, to });
    // onChange({ from, to });
    setCustomFrom(from);
    setCustomTo(to);
    setOpen(false);
  };

  const handleApply = () => {
    if (customRangeState.canApply) {
      setTimeRange({ from: customFrom, to: customTo });
      // onChange({ from: customFrom, to: customTo });
      setOpen(false);
    }
  };

  const handleOpenChange = (nextOpen: boolean) => {
    if (nextOpen) {
      setCustomFrom(timeRange.from);
      setCustomTo(timeRange.to);
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
          {formatTimeRangeDisplay(timeRange)}
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
                        range.from === timeRange.from &&
                        range.to === timeRange.to;
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
