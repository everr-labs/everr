import { isValid, resolve } from "@everr/datemath";
import { ChevronDownIcon, Clock } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useTimeRange } from "@/hooks/use-time-range";
import { formatTimeRangeDisplay, QUICK_RANGE_GROUPS } from "@/lib/time-range";
import { Input } from "../ui/input";

function formatPreview(expr: string, roundUp: boolean): string | null {
  if (!isValid(expr)) return null;
  try {
    const date = resolve(expr, { roundUp });
    return date.toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
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

  const fromPreview = formatPreview(customFrom, false);
  const toPreview = formatPreview(customTo, true);
  const rangeInverted =
    fromPreview !== null &&
    toPreview !== null &&
    resolve(customFrom, { roundUp: false }) >=
      resolve(customTo, { roundUp: true });
  const canApply = fromPreview !== null && toPreview !== null && !rangeInverted;

  const handlePresetClick = (from: string, to: string) => {
    setTimeRange({ from, to });
    // onChange({ from, to });
    setCustomFrom(from);
    setCustomTo(to);
    setOpen(false);
  };

  const handleApply = () => {
    if (canApply) {
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

  const resolvedFrom = formatPreview(timeRange.from, false);
  const resolvedTo = formatPreview(timeRange.to, true);

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
        {resolvedFrom && resolvedTo && (
          <TooltipContent>
            {resolvedFrom} — {resolvedTo}
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
                {fromPreview ? (
                  <span className="text-muted-foreground">→ {fromPreview}</span>
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
                {toPreview ? (
                  <span className="text-muted-foreground">→ {toPreview}</span>
                ) : customTo ? (
                  <span className="text-destructive">Invalid expression</span>
                ) : null}
              </div>
            </div>

            {rangeInverted && (
              <p className="text-destructive text-[11px]">
                "From" must be before "To"
              </p>
            )}
            <Button
              className="w-full mt-1"
              disabled={!canApply}
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
