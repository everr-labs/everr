import { isValid, resolve } from "@everr/datemath";
import { ScrollArea } from "@everr/ui/components/scroll-area";
import { ChevronDownIcon, Clock, XIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { useIsMobile } from "../hooks/use-mobile";
import { DEFAULT_TIME_RANGE, type TimeRange } from "../lib/time-range";
import { cn } from "../lib/utils";
import { Button } from "./button";
import { Input } from "./input";
import { Popover, PopoverContent, PopoverTrigger } from "./popover";
import { Sheet, SheetClose, SheetContent, SheetTitle, SheetTrigger } from "./sheet";
import { Tooltip, TooltipContent, TooltipTrigger } from "./tooltip";

export type { TimeRange };
export { DEFAULT_TIME_RANGE };

export interface QuickRange {
  label: string;
  from: string;
  to: string;
}

export interface QuickRangeGroup {
  label: string;
  ranges: QuickRange[];
}

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
      { label: "This month so far", from: "now/M", to: "now" },
    ],
  },
];

export const QUICK_RANGES: QuickRange[] = QUICK_RANGE_GROUPS.flatMap((g) => g.ranges);

export function formatTimeRangeDisplay(range: TimeRange): string {
  const preset = QUICK_RANGES.find((q) => q.from === range.from && q.to === range.to);
  if (preset) return preset.label;
  return `${range.from} to ${range.to}`;
}

export { isValid as isValidDatemath };

function resolvePreview(expr: string, roundUp: boolean): { date: Date; label: string } | null {
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
  // A phone gets a full-screen sheet: the two-column popover can't fit, and
  // the ranges want finger-sized rows. `false` on the server, so the popover
  // is what renders before hydration; the trigger looks the same either way.
  const isMobile = useIsMobile();
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

  const triggerContent = (
    <>
      <Clock data-icon="inline-start" className="size-3.5" aria-hidden="true" />
      {/* A custom absolute range reads long; on a phone it truncates so
          the header keeps its other controls. */}
      <span className="truncate max-sm:max-w-28">{formatTimeRangeDisplay(value)}</span>
      <ChevronDownIcon className="size-3 max-sm:hidden" />
    </>
  );

  const searchInput = (
    <Input
      type="search"
      placeholder="Search relative range..."
      aria-label="search"
      value={search}
      onChange={(e) => setSearch(e.target.value)}
      className="rounded-none bg-transparent border-none h-10 px-3 focus:ring-0 focus-visible:ring-0"
    />
  );
  const quickRanges = (
    <QuickRangeList
      groups={filteredGroups}
      value={value}
      large={isMobile}
      onPick={handlePresetClick}
    />
  );
  const customRange = (
    <CustomRangeForm
      from={customFrom}
      to={customTo}
      onFromChange={setCustomFrom}
      onToChange={setCustomTo}
      state={customRangeState}
      onApply={handleApply}
      inline={isMobile}
    />
  );

  if (isMobile) {
    return (
      <Sheet open={open} onOpenChange={handleOpenChange}>
        <SheetTrigger render={<Button variant="outline" className="gap-1.5" />}>
          {triggerContent}
        </SheetTrigger>
        <SheetContent
          side="bottom"
          showCloseButton={false}
          className="gap-0 pb-[env(safe-area-inset-bottom)] data-[side=bottom]:h-dvh"
        >
          <div className="flex h-12 shrink-0 items-center justify-between border-b pr-1.5 pl-4">
            <SheetTitle>Time range</SheetTitle>
            <SheetClose render={<Button variant="ghost" size="icon" aria-label="Close" />}>
              <XIcon />
            </SheetClose>
          </div>
          {currentRangePreview.from && currentRangePreview.to && (
            <p className="shrink-0 border-b px-4 py-2 text-muted-foreground text-xs">
              {currentRangePreview.from} to {currentRangePreview.to}
            </p>
          )}
          <div className="shrink-0 border-b">{searchInput}</div>
          <ScrollArea className="min-h-0 flex-1" viewportClassName="p-2">
            {quickRanges}
          </ScrollArea>
          <div className="shrink-0 border-t p-4">{customRange}</div>
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <Tooltip>
        <TooltipTrigger
          delay={0}
          render={<PopoverTrigger render={<Button variant="outline" className="gap-1.5" />} />}
        >
          {triggerContent}
        </TooltipTrigger>
        {currentRangePreview.from && currentRangePreview.to && (
          <TooltipContent>
            {currentRangePreview.from} — {currentRangePreview.to}
          </TooltipContent>
        )}
      </Tooltip>
      <PopoverContent align="end" className="w-[520px] p-0 gap-0 overflow-hidden">
        <div className="flex divide-x divide-border">
          {/* Left panel: quick ranges */}
          <div className="flex w-[200px] flex-col">
            <div className="border-b">{searchInput}</div>
            <ScrollArea className="max-h-[320px]" viewportClassName="p-1">
              {quickRanges}
            </ScrollArea>
          </div>

          {/* Right panel: custom range */}
          <div className="flex-1 p-3">{customRange}</div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function QuickRangeList({
  groups,
  value,
  large,
  onPick,
}: {
  groups: QuickRangeGroup[];
  value: TimeRange;
  /** Finger-sized rows, for the phone sheet. */
  large: boolean;
  onPick: (from: string, to: string) => void;
}) {
  if (groups.length === 0) {
    return <div className="px-2 py-3 text-xs text-muted-foreground text-center">No matches</div>;
  }
  return groups.map((group, groupIndex) => (
    <div key={group.label}>
      {groupIndex > 0 && <div className="bg-border/50 -mx-1 my-1 h-px" />}
      <div className="text-muted-foreground px-2 py-1.5 text-xs font-medium">{group.label}</div>
      {group.ranges.map((range) => {
        const isActive = range.from === value.from && range.to === value.to;
        return (
          <button
            key={`${range.from}-${range.to}`}
            type="button"
            className={cn(
              "w-full text-left rounded-md px-2 transition-colors",
              large ? "min-h-11 py-2 text-sm" : "min-h-7 py-1 text-xs/relaxed",
              isActive
                ? "bg-primary/10 text-primary font-medium"
                : "text-foreground hover:bg-accent hover:text-accent-foreground",
            )}
            onClick={() => onPick(range.from, range.to)}
          >
            {range.label}
          </button>
        );
      })}
    </div>
  ));
}

function CustomRangeForm({
  from,
  to,
  onFromChange,
  onToChange,
  state,
  onApply,
  inline,
}: {
  from: string;
  to: string;
  onFromChange: (value: string) => void;
  onToChange: (value: string) => void;
  state: {
    canApply: boolean;
    fromPreview: string | null;
    toPreview: string | null;
    rangeInverted: boolean;
  };
  onApply: () => void;
  /** From and To side by side, for the phone sheet's bottom bar. */
  inline: boolean;
}) {
  const field = (
    id: string,
    label: string,
    value: string,
    onValueChange: (value: string) => void,
    placeholder: string,
    preview: string | null,
  ) => (
    <div className="min-w-0 flex-1 space-y-1.5 flex flex-col">
      <label htmlFor={id} className="text-xs font-medium text-muted-foreground">
        {label}
      </label>
      <Input
        id={id}
        value={value}
        onChange={(e) => onValueChange(e.target.value)}
        placeholder={placeholder}
      />
      <div className="text-[11px] h-3.5 truncate">
        {preview ? (
          <span className="text-muted-foreground">→ {preview}</span>
        ) : value ? (
          <span className="text-destructive">Invalid expression</span>
        ) : null}
      </div>
    </div>
  );
  return (
    <div className="space-y-3">
      <div className="text-xs font-medium text-muted-foreground">Custom time range</div>
      <div className={cn(inline ? "flex gap-3" : "space-y-3")}>
        {field("time-range-from", "From", from, onFromChange, "now-7d", state.fromPreview)}
        {field("time-range-to", "To", to, onToChange, "now", state.toPreview)}
      </div>
      {state.rangeInverted && (
        <p className="text-destructive text-[11px]">
          &quot;From&quot; must be before &quot;To&quot;
        </p>
      )}
      <Button
        className={cn("w-full mt-1", inline && "h-10")}
        disabled={!state.canApply}
        onClick={onApply}
      >
        Apply time range
      </Button>
    </div>
  );
}
