import { isValid, parse, resolve } from "@everr/datemath";
import { ScrollArea } from "@everr/ui/components/scroll-area";
import { CheckIcon, ChevronDownIcon, Clock, XIcon } from "lucide-react";
import { notifyManager, useQueryClient } from "@tanstack/react-query";
import { type KeyboardEvent, useCallback, useMemo, useState, useSyncExternalStore } from "react";
import { flushSync } from "react-dom";
import { useIsMobile } from "../hooks/use-mobile";
import { DEFAULT_TIME_RANGE, isEmptyTimeRange, type TimeRange } from "../lib/time-range";
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
import { InputGroup, InputGroupAddon, InputGroupInput } from "./input-group";
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
  // A relative range can end before it starts at some times of day, as
  // "now/d" to "now-5h" does before 05:00; pages then show nothing, and the
  // trigger says why. Only the viewer's clock knows, so the server says no.
  // It's checked again whenever a query starts fetching, as a refresh does,
  // so the trigger always matches the data on the page. React Query can
  // report that while another component renders, so the check waits.
  const queryCache = useQueryClient().getQueryCache();
  const onFetch = useCallback(
    (check: () => void) =>
      queryCache.subscribe((event) => {
        if (event.type === "updated" && event.action.type === "fetch") {
          notifyManager.schedule(check);
        }
      }),
    [queryCache],
  );
  const empty = useSyncExternalStore(
    onFetch,
    () => isEmptyTimeRange(value),
    () => false,
  );
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
  // Set once a field is typed in: from then on, picking days keeps the times
  // typed. Before that the times are the stored range's (a zoom's 14:23, say),
  // which a new day pick shouldn't carry over.
  const [keepTimes, setKeepTimes] = useState(false);
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
    };
  }, [customFrom, customTo]);

  // Resolved on every render, with the range check: "now" moves.
  const currentRangePreview = {
    from: resolvePreview(value.from, false)?.label ?? null,
    to: resolvePreview(value.to, true)?.label ?? null,
  };

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
    const typedFrom = keepTimes ? customRangeState.fromDate : null;
    const typedTo = keepTimes ? customRangeState.toDate : null;
    const from = new Date(first);
    from.setHours(typedFrom?.getHours() ?? 0, typedFrom?.getMinutes() ?? 0, 0, 0);
    const to = new Date(last);
    if (typedTo) to.setHours(typedTo.getHours(), typedTo.getMinutes(), typedTo.getSeconds(), 0);
    else to.setHours(23, 59, 59, 0);
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
      setKeepTimes(false);
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
      {empty ? <span className="sr-only">, ends before it starts</span> : null}
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
            {/* Headings stay pinned while their group scrolls under them, so
                the list never opens on half a heading. The group's own
                overflow clip would turn sticky off. */}
            <CommandGroup
              heading={group.label}
              className="overflow-visible **:[[cmdk-group-heading]]:bg-popover **:[[cmdk-group-heading]]:sticky **:[[cmdk-group-heading]]:top-0 **:[[cmdk-group-heading]]:z-10 **:[[cmdk-group-heading]]:-mx-1 **:[[cmdk-group-heading]]:px-3.5"
            >
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
          ? {
              from: customRangeState.fromDate,
              // A range that ends at midnight ends on the day before.
              to: new Date(customRangeState.toDate.getTime() - 1),
            }
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
        setKeepTimes(true);
      }}
      onToChange={(next) => {
        setCustomTo(next);
        setPickStart(null);
        setKeepTimes(true);
      }}
      state={customRangeState}
      onApply={handleApply}
      touch={isMobile}
    />
  );

  if (isMobile) {
    return (
      <Sheet open={open} onOpenChange={handleOpenChange}>
        <SheetTrigger
          render={
            <Button
              variant="outline"
              aria-invalid={empty || undefined}
              className={cn(
                "gap-1.5",
                empty && "text-destructive hover:text-destructive aria-expanded:text-destructive",
              )}
            />
          }
        >
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
          render={
            <PopoverTrigger
              render={
                <Button
                  variant="outline"
                  aria-invalid={empty || undefined}
                  className={cn(
                    "gap-1.5",
                    empty &&
                      "text-destructive hover:text-destructive aria-expanded:text-destructive",
                  )}
                />
              }
            />
          }
        >
          {triggerContent}
        </TooltipTrigger>
        {empty ? (
          <TooltipContent>
            Ends before it starts: {currentRangePreview.from} — {currentRangePreview.to}
          </TooltipContent>
        ) : (
          currentRangePreview.from &&
          currentRangePreview.to && (
            <TooltipContent>
              {currentRangePreview.from} — {currentRangePreview.to}
            </TooltipContent>
          )
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
    fromDate: Date | null;
    toDate: Date | null;
  };
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
        {/* One line under the fields: the time zone they are read in, or
            what's wrong with them. Always there, so the button never moves. */}
        <p
          aria-live="polite"
          className={cn(
            "min-w-0 flex-1 truncate text-[11px]",
            error ? "text-destructive" : "text-muted-foreground",
          )}
        >
          {error ?? localTimeLabel(state.fromDate, state.toDate)}
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
    // The label is an addon at the field's start, behind a divider, so it
    // reads as the field's name and not as part of its value. It hugs its
    // text: the fields sit side by side, so their values never need to line up.
    <InputGroup className="min-w-0 flex-1">
      <InputGroupAddon className="border-border/60 h-full border-r px-2.5 py-0">
        <label htmlFor={id}>{label}</label>
      </InputGroupAddon>
      <InputGroupInput
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "ArrowUp" || e.key === "ArrowDown") {
            const input = e.currentTarget;
            const step = stepAtCaret(
              value,
              input.selectionStart ?? value.length,
              e.key === "ArrowUp" ? 1 : -1,
              e.shiftKey,
            );
            if (step) {
              e.preventDefault();
              // Rendered now, so the selection lands on the new text.
              flushSync(() => onChange(step.value));
              input.setSelectionRange(step.select[0], step.select[1]);
              return;
            }
          }
          onKeyDown(e);
        }}
        placeholder={placeholder}
        aria-invalid={invalid || undefined}
        spellCheck={false}
        autoComplete="off"
        className="pl-2.5! tabular-nums"
      />
    </InputGroup>
  );
}

// The parts of "2026-11-10 09:30:00", by position, and how far Shift steps
// each one: a quarter hour, a quarter day, a week.
const DATE_PARTS = [
  { start: 0, end: 4, big: 1, add: (d: Date, n: number) => d.setFullYear(d.getFullYear() + n) },
  { start: 5, end: 7, big: 3, add: (d: Date, n: number) => d.setMonth(d.getMonth() + n) },
  { start: 8, end: 10, big: 7, add: (d: Date, n: number) => d.setDate(d.getDate() + n) },
  { start: 11, end: 13, big: 6, add: (d: Date, n: number) => d.setHours(d.getHours() + n) },
  { start: 14, end: 16, big: 15, add: (d: Date, n: number) => d.setMinutes(d.getMinutes() + n) },
  { start: 17, end: 19, big: 10, add: (d: Date, n: number) => d.setSeconds(d.getSeconds() + n) },
];

/**
 * Up and Down on a field, as in a native date input: the part under the
 * caret steps by one (Shift: a bigger step), and stays selected. A date steps
 * the way a clock does (23:00 plus an hour is the next day); relative math
 * steps its one number wherever the caret is ("now-7d" to "now-8d"). Null when there is nothing to step.
 */
function stepAtCaret(
  value: string,
  caret: number,
  direction: 1 | -1,
  big: boolean,
): { value: string; select: [number, number] } | null {
  const date = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value);
  if (date) {
    const [y, mo, d, h, mi, sec] = date.slice(1).map((n) => Number(n ?? 0));
    const part = DATE_PARTS.find(
      (p) => caret >= p.start && caret <= p.end && p.end <= value.length,
    );
    if (!part) return null;
    const next = new Date(y ?? 0, (mo ?? 1) - 1, d, h, mi, sec);
    part.add(next, direction * (big ? part.big : 1));
    const day = `${next.getFullYear()}-${pad(next.getMonth() + 1)}-${pad(next.getDate())}`;
    const time = `${pad(next.getHours())}:${pad(next.getMinutes())}`;
    // Seconds stay shown if they were, so every part keeps its position.
    const seconds = date[6] === undefined ? "" : `:${pad(next.getSeconds())}`;
    return { value: `${day} ${time}${seconds}`, select: [part.start, part.end] };
  }
  const relative = /^(now\s*[-+]\s*)(\d+)([smhdwMy].*)$/.exec(value);
  if (relative) {
    const [, head = "", amount = "", tail = ""] = relative;
    const n = Math.max(1, Number(amount) + direction * (big ? 10 : 1));
    return {
      value: `${head}${n}${tail}`,
      select: [head.length, head.length + String(n).length],
    };
  }
  return null;
}

function utcOffset(date: Date): string {
  const minutes = -date.getTimezoneOffset();
  const abs = Math.abs(minutes);
  const sign = minutes < 0 ? "-" : "+";
  return `UTC${sign}${Math.floor(abs / 60)}${abs % 60 ? `:${pad(abs % 60)}` : ""}`;
}

/** "Europe/Lisbon, UTC+1": the zone the fields are read in, with the offset
 *  at the range's own dates (a July range in Lisbon is UTC+1, even in
 *  winter). Both offsets when the range crosses a daylight-saving change. */
function localTimeLabel(from: Date | null, to: Date | null): string {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const start = utcOffset(from ?? new Date());
  const end = utcOffset(to ?? from ?? new Date());
  return `${zone}, ${start === end ? start : `${start} → ${end}`}`;
}
