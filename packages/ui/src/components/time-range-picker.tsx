import { isValid, parse, resolve } from "@everr/datemath";
import { ScrollArea } from "@everr/ui/components/scroll-area";
import { CheckIcon, ChevronDownIcon, Clock, XIcon } from "lucide-react";
import { type KeyboardEvent, useMemo, useState } from "react";
import { useIsMobile } from "../hooks/use-mobile";
import { DEFAULT_TIME_RANGE, type TimeRange } from "../lib/time-range";
import { cn } from "../lib/utils";
import { Button } from "./button";
import { Calendar } from "./calendar";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "./command";
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

const DURATION_UNITS: { unit: string; singular: string; pattern: RegExp }[] = [
  { unit: "s", singular: "second", pattern: /^(s|secs?|seconds?)$/ },
  { unit: "m", singular: "minute", pattern: /^(m|mins?|minutes?)$/ },
  { unit: "h", singular: "hour", pattern: /^(h|hrs?|hours?)$/ },
  { unit: "d", singular: "day", pattern: /^(d|days?)$/ },
  { unit: "w", singular: "week", pattern: /^(w|wks?|weeks?)$/ },
  { unit: "M", singular: "month", pattern: /^(mo|mos|months?)$/ },
  { unit: "y", singular: "year", pattern: /^(y|yrs?|years?)$/ },
];

/**
 * Reads what people type into the range search as a relative range: "3h",
 * "90 min", "last 2 weeks", "now-45m". Months need "mo" or "month", since a
 * bare "m" is minutes. Null when the text is not a duration.
 */
export function parseRelativeRange(text: string): QuickRange | null {
  const match = /^(?:last\s+|now\s*-\s*)?(\d+)\s*([a-z]+)$/i.exec(text.trim());
  if (!match) return null;
  const amount = Number(match[1]);
  const word = match[2] ?? "";
  // "M" is the one case-sensitive unit: datemath's month.
  const unit =
    word === "M"
      ? DURATION_UNITS[5]
      : DURATION_UNITS.find((u) => u.pattern.test(word.toLowerCase()));
  if (!unit || amount <= 0) return null;
  const from = `now-${amount}${unit.unit}`;
  return {
    label: `Last ${amount} ${unit.singular}${amount === 1 ? "" : "s"}`,
    from,
    to: "now",
  };
}

/** The fields take a date the way people write one ("2026-11-09 14:00",
 *  "2026-11-09"); Date.parse only reads local time reliably as
 *  "2026-11-09T14:00", and reads a bare date as UTC midnight. */
function normalize(expr: string): string {
  const text = expr.trim();
  const match = /^(\d{4}-\d{2}-\d{2})(?:[ T](\d{1,2}):(\d{2})(:\d{2})?)?$/.exec(text);
  if (!match) return text;
  const [, day, hours = "0", minutes = "00", seconds = ""] = match;
  return `${day}T${hours.padStart(2, "0")}:${minutes}${seconds}`;
}

/** A plain date (a typed one, or the ISO timestamp a zoom stores), not
 *  "now"-relative math. */
function isAbsolute(expr: string): boolean {
  try {
    const parsed = parse(normalize(expr));
    return parsed.anchor !== "now" && parsed.ops.length === 0;
  } catch {
    return false;
  }
}

const pad = (n: number) => String(n).padStart(2, "0");

/** Local wall-clock time as the fields show it. Seconds only when set. */
function toLocalInput(date: Date): string {
  const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  const time = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  return `${day} ${time}${date.getSeconds() ? `:${pad(date.getSeconds())}` : ""}`;
}

/** What a field shows for a stored expression: a stored UTC timestamp reads
 *  as local time; relative math stays as typed. */
function toEditable(expr: string): string {
  return isAbsolute(expr) ? toLocalInput(new Date(Date.parse(normalize(expr)))) : expr;
}

/** What the URL keeps: a typed local date becomes a UTC timestamp, so a
 *  shared link means the same moment in every time zone. */
function toStored(expr: string): string {
  return isAbsolute(expr) ? new Date(Date.parse(normalize(expr))).toISOString() : expr.trim();
}

function formatAbsolute(date: Date): string {
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    ...(date.getFullYear() === new Date().getFullYear() ? {} : { year: "numeric" }),
    hour: "numeric",
    minute: "2-digit",
  });
}

const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? "" : "s"}`;

/** "3 days", "6 hours", "45 minutes": whole days when the range is whole
 *  days (a calendar pick ends at 23:59:59, a second short of one). */
function formatDuration(ms: number): string {
  const days = ms / 86_400_000;
  if (Math.round(days) >= 1 && Math.abs(days - Math.round(days)) < 0.001)
    return plural(Math.round(days), "day");
  const hours = ms / 3_600_000;
  if (hours >= 48) return plural(Math.round(days), "day");
  if (hours >= 1) return plural(Math.round(hours), "hour");
  return plural(Math.max(1, Math.round(ms / 60_000)), "minute");
}

export function formatTimeRangeDisplay(range: TimeRange): string {
  const preset = QUICK_RANGES.find((q) => q.from === range.from && q.to === range.to);
  if (preset) return preset.label;
  // A relative range typed by hand reads as one: "now-3h" to "now" is "Last 3 hours".
  const relative = range.to === "now" ? parseRelativeRange(range.from) : null;
  if (relative) return relative.label;
  // Two plain dates (a picked or zoomed range) read as local times.
  if (isAbsolute(range.from) && isAbsolute(range.to)) {
    return `${formatAbsolute(new Date(Date.parse(range.from)))} – ${formatAbsolute(new Date(Date.parse(range.to)))}`;
  }
  return `${range.from} to ${range.to}`;
}

export { isValid as isValidDatemath };

function resolvePreview(expr: string, roundUp: boolean): { date: Date; label: string } | null {
  try {
    const date = resolve(normalize(expr), { roundUp });
    return { date, label: formatAbsolute(date) };
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
  const [customFrom, setCustomFrom] = useState(() => toEditable(value.from));
  const [customTo, setCustomTo] = useState(() => toEditable(value.to));
  // The calendar: the month on show, and the first day of a range being
  // picked (null when no pick is in progress).
  const [month, setMonth] = useState(() => new Date());
  const [pickStart, setPickStart] = useState<Date | null>(null);
  // The day under the pointer while a pick is in progress: the range a second
  // click would make, shown before the click.
  const [hoverDay, setHoverDay] = useState<Date | null>(null);
  const [search, setSearch] = useState("");
  // The highlighted row, by its key. Opening starts it on the current range,
  // like a select; a new search moves it to the first result, so Enter picks
  // the top match.
  const [highlight, setHighlight] = useState("");

  const filteredGroups = useMemo(() => filterQuickRanges(search), [search]);
  const customRangeState = useMemo(() => {
    const from = resolvePreview(customFrom, false);
    const to = resolvePreview(customTo, true);
    const rangeInverted = from !== null && to !== null && from.date >= to.date;

    return {
      canApply: from !== null && to !== null && !rangeInverted,
      fromDate: from?.date ?? null,
      toDate: to?.date ?? null,
      fromInvalid: from === null && customFrom.trim() !== "",
      toInvalid: to === null && customTo.trim() !== "",
      rangeInverted,
      // Relative math ("now-7d/d") resolves to a moment the field doesn't
      // show, so the summary spells it out; typed dates already read as one.
      resolved:
        from && to && !(isAbsolute(customFrom) && isAbsolute(customTo))
          ? `${from.label} → ${to.label}`
          : null,
      duration:
        from && to && !rangeInverted
          ? formatDuration(to.date.getTime() - from.date.getTime())
          : null,
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
    setCustomFrom(toEditable(from));
    setCustomTo(toEditable(to));
    setOpen(false);
  };

  const handleApply = () => {
    if (customRangeState.canApply) {
      onChange({ from: toStored(customFrom), to: toStored(customTo) });
      setOpen(false);
    }
  };

  // One click picks that whole day, ready to apply; a second click makes it
  // the other end of the range, whichever way round the two were clicked.
  const handleDayPick = (day: Date) => {
    const start = pickStart ?? day;
    const [first, last] = start <= day ? [start, day] : [day, start];
    const from = new Date(first);
    from.setHours(0, 0, 0, 0);
    const to = new Date(last);
    to.setHours(23, 59, 59, 0);
    setCustomFrom(toLocalInput(from));
    setCustomTo(toLocalInput(to));
    setPickStart(pickStart ? null : day);
  };

  const handleOpenChange = (nextOpen: boolean) => {
    if (nextOpen) {
      setCustomFrom(toEditable(value.from));
      setCustomTo(toEditable(value.to));
      setPickStart(null);
      setHoverDay(null);
      setMonth(resolvePreview(value.to, true)?.date ?? new Date());
      setSearch("");
      setHighlight(rangeKey(value));
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

  // The same search-and-pick list as the other dropdowns (Command): arrow
  // keys, Enter, the highlight, the check on the current range and the
  // listbox semantics all come from there. Filtering stays ours, so a typed
  // duration ("3h") can add a range the presets don't have.
  const quickRanges = (
    <Command
      // cmdk names its input and list from this label (aria-labelledby wins
      // over an aria-label on the input).
      label="Search relative range"
      shouldFilter={false}
      value={highlight}
      onValueChange={setHighlight}
      className="h-auto rounded-none bg-transparent p-0"
    >
      <CommandInput
        // Flush with a divider, as in the filter dropdowns (FilterCombobox,
        // the Explore filters).
        wrapperClassName="p-0 border-b"
        inputGroupClassName="border-none rounded-none bg-transparent h-9"
        // The placeholder teaches what the search takes besides preset names.
        placeholder="Search or type 3h, 2w…"
        value={search}
        onValueChange={(next) => {
          setSearch(next);
          const first = filterQuickRanges(next).flatMap((g) => g.ranges)[0];
          setHighlight(first ? rangeKey(first) : "");
        }}
      />
      <CommandList className="max-h-none min-h-0 flex-1">
        <CommandEmpty className="text-muted-foreground px-2.5 py-1.5 text-left break-all">
          No range matches “{search.trim()}”
        </CommandEmpty>
        {filteredGroups.map((group, groupIndex) => (
          <div key={group.label}>
            {groupIndex > 0 && <CommandSeparator className="bg-border/50 mx-0" />}
            <CommandGroup heading={group.label}>
              {group.ranges.map((range) => (
                <CommandItem
                  key={rangeKey(range)}
                  value={rangeKey(range)}
                  data-checked={(range.from === value.from && range.to === value.to) || undefined}
                  onSelect={() => handlePresetClick(range.from, range.to)}
                >
                  {range.label}
                </CommandItem>
              ))}
            </CommandGroup>
          </div>
        ))}
      </CommandList>
    </Command>
  );
  // The phone sheet has no search box (the keyboard would cover the list), so
  // it keeps plain finger-sized rows.
  const touchRanges = <TouchRangeList value={value} onPick={handlePresetClick} />;
  // Desktop only: the phone sheet has the room for the fields alone.
  const preview =
    pickStart && hoverDay
      ? pickStart <= hoverDay
        ? { from: pickStart, to: hoverDay }
        : { from: hoverDay, to: pickStart }
      : undefined;
  const calendar = (
    <Calendar
      mode="range"
      selected={
        customRangeState.fromDate && customRangeState.toDate
          ? { from: customRangeState.fromDate, to: customRangeState.toDate }
          : undefined
      }
      onSelect={(_range, day) => handleDayPick(day)}
      month={month}
      onMonthChange={setMonth}
      // Six rows in every month, so paging months never resizes the popover.
      fixedWeeks
      // Nothing to see in the future: telemetry stops at now.
      disabled={{ after: new Date() }}
      endMonth={new Date()}
      onDayMouseEnter={(day) => setHoverDay(day)}
      modifiers={{
        preview,
        preview_start: preview?.from ?? false,
        preview_end: preview?.to ?? false,
      }}
    />
  );
  const customRange = (
    <CustomRangeForm
      from={customFrom}
      to={customTo}
      onFromChange={(next) => {
        setCustomFrom(next);
        setPickStart(null);
      }}
      onToChange={(next) => {
        setCustomTo(next);
        setPickStart(null);
      }}
      state={customRangeState}
      picking={pickStart !== null}
      onApply={handleApply}
      touch={isMobile}
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
          {/* No search box or resolved-range line here: the whole list fits a
              scroll, and the keyboard a search box raises would cover it. */}
          <ScrollArea className="min-h-0 flex-1" viewportClassName="p-2">
            {touchRanges}
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
      <PopoverContent align="end" className="w-auto p-0 gap-0 overflow-hidden">
        <div className="flex divide-x divide-border">
          {/* The list takes the calendar's height and scrolls inside it, so
              the two columns end on one line. */}
          <div className="relative w-[200px]">
            <div className="absolute inset-0 flex flex-col">{quickRanges}</div>
          </div>
          {/* The hover preview clears when the pointer leaves the calendar,
              not each day: between two days it would flash off for a frame. */}
          <div className="p-3" onMouseLeave={() => setHoverDay(null)}>
            {calendar}
          </div>
        </div>
        {/* The fields span both columns: the calendar fills them, and so can
            typing (a time, or relative math like now-7d/d). */}
        <div className="border-t p-3">{customRange}</div>
      </PopoverContent>
    </Popover>
  );
}

function rangeKey(range: { from: string; to: string }) {
  return `${range.from} ${range.to}`;
}

/** The quick ranges whose name matches the search, plus the range a typed
 *  duration ("3h") stands for, listed first. If the duration is a preset
 *  ("1h"), the preset is listed instead, so it shows as the current range. */
function filterQuickRanges(search: string): QuickRangeGroup[] {
  const q = search.trim().toLowerCase();
  if (!q) return QUICK_RANGE_GROUPS;
  const groups = QUICK_RANGE_GROUPS.map((group) => ({
    ...group,
    ranges: group.ranges.filter((r) => r.label.toLowerCase().includes(q)),
  })).filter((group) => group.ranges.length > 0);
  const typed = parseRelativeRange(search);
  if (!typed) return groups;
  const listed = groups.some((g) => g.ranges.some((r) => rangeKey(r) === rangeKey(typed)));
  if (listed) return groups;
  const preset = QUICK_RANGES.find((r) => rangeKey(r) === rangeKey(typed));
  return [{ label: "Relative", ranges: [preset ?? typed] }, ...groups];
}

function TouchRangeList({
  value,
  onPick,
}: {
  value: TimeRange;
  onPick: (from: string, to: string) => void;
}) {
  return QUICK_RANGE_GROUPS.map((group, groupIndex) => (
    <div key={group.label}>
      {groupIndex > 0 && <div className="bg-border/50 -mx-1 my-1 h-px" />}
      <div className="text-muted-foreground px-2.5 py-1.5 text-xs font-medium">{group.label}</div>
      {group.ranges.map((range) => {
        const isActive = rangeKey(range) === rangeKey(value);
        return (
          <button
            key={rangeKey(range)}
            type="button"
            aria-pressed={isActive}
            className="text-foreground active:bg-white/[0.07] flex min-h-11 w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm"
            onClick={() => onPick(range.from, range.to)}
          >
            {range.label}
            {isActive && <CheckIcon aria-hidden className="ml-auto size-3.5 shrink-0" />}
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
  picking,
  onApply,
  touch,
}: {
  from: string;
  to: string;
  onFromChange: (value: string) => void;
  onToChange: (value: string) => void;
  state: {
    canApply: boolean;
    fromInvalid: boolean;
    toInvalid: boolean;
    rangeInverted: boolean;
    resolved: string | null;
    duration: string | null;
  };
  /** One day is picked on the calendar and a second click would extend it. */
  picking: boolean;
  onApply: () => void;
  /** The phone sheet: stacked fields and a taller button. */
  touch: boolean;
}) {
  // Enter in either field applies, as in any form.
  const applyOnEnter = (e: KeyboardEvent) => {
    if (e.key === "Enter" && state.canApply) {
      e.preventDefault();
      onApply();
    }
  };
  const error =
    state.fromInvalid || state.toInvalid
      ? "Not a date or expression"
      : state.rangeInverted
        ? "From must be before To"
        : null;
  return (
    <div className="flex flex-col gap-2.5">
      <div className={cn("flex gap-2", touch && "flex-col")}>
        <RangeField
          id="time-range-from"
          label="From"
          value={from}
          onChange={onFromChange}
          onKeyDown={applyOnEnter}
          placeholder="now-7d"
          invalid={state.fromInvalid || state.rangeInverted}
        />
        <RangeField
          id="time-range-to"
          label="To"
          value={to}
          onChange={onToChange}
          onKeyDown={applyOnEnter}
          placeholder="now"
          invalid={state.toInvalid}
        />
      </div>
      <div className={cn("flex items-center gap-3", touch && "flex-col items-stretch")}>
        {/* One line for what the fields add up to: the length of the range,
            where relative math lands, or what's wrong. Always there, so the
            button never moves. */}
        <p
          aria-live="polite"
          className={cn(
            "min-w-0 flex-1 truncate text-[11px]",
            error ? "text-destructive" : "text-muted-foreground",
          )}
        >
          {error ??
            [state.resolved, state.duration, picking && "click another day to extend"]
              .filter(Boolean)
              .join(" · ")}
        </p>
        <Button
          size={touch ? "default" : "sm"}
          className={cn(touch && "h-10 w-full")}
          disabled={!state.canApply}
          onClick={onApply}
        >
          Apply time range
        </Button>
      </div>
    </div>
  );
}

function RangeField({
  id,
  label,
  value,
  onChange,
  onKeyDown,
  placeholder,
  invalid,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  onKeyDown: (e: KeyboardEvent) => void;
  placeholder: string;
  invalid: boolean;
}) {
  return (
    <div className="relative min-w-0 flex-1">
      {/* The label sits in the field, like a prefix: two short fields side
          by side, without a row of labels above them. */}
      <label
        htmlFor={id}
        className="text-muted-foreground pointer-events-none absolute inset-y-0 left-2.5 flex items-center text-xs"
      >
        {label}
      </label>
      <Input
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        aria-invalid={invalid || undefined}
        spellCheck={false}
        autoComplete="off"
        className="pl-12 tabular-nums"
      />
    </div>
  );
}
