// A date-and-time field: a date button that opens a calendar, and a time
// field beside it.
//
// Replaces `<input type="datetime-local">`, whose popup is drawn by the
// browser and so ignores the app's theme entirely — a light OS widget over a
// dark surface, with a text half that only accepts one segment order. Both
// halves here are ours, and the value stays in the `datetime-local` string
// shape (`YYYY-MM-DDTHH:mm`, local time) so callers keep whatever parsing
// they already had.
//
// Shape follows shadcn's date-picker-time example: the clock is a field on
// the surface, not something you open a calendar to reach, because changing
// only the time is at least as common as changing the day.
import { Button } from "@everr/ui/components/button";
import { Calendar } from "@everr/ui/components/calendar";
import { Input } from "@everr/ui/components/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@everr/ui/components/popover";
import { cn } from "@everr/ui/lib/utils";
import { format } from "date-fns";
import { ChevronDownIcon } from "lucide-react";
import { useState } from "react";

const pad = (n: number) => String(n).padStart(2, "0");

/** A Date as a `datetime-local` value: local time, minute precision. */
function toLocalValue(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}`;
}

/**
 * A `datetime-local` value as a Date. The form carries no zone, so the
 * platform reads it as local time, which is what it means here.
 */
function fromLocalValue(v: string): Date | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function DateTimePicker({
  id,
  value,
  onChange,
  placeholder = "Pick a date",
  timeLabel = "Time",
  disabled,
  className,
}: {
  id?: string;
  /** A `datetime-local` value (`YYYY-MM-DDTHH:mm`), or "" when unset. */
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /** Accessible name for the time field; distinguishes two on one form. */
  timeLabel?: string;
  disabled?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const date = fromLocalValue(value);

  // Picking a day keeps the clock the field already had. With no value yet
  // there is nothing to keep, so the current time stands in: a window that
  // starts "today" almost always means from now, and the time field is right
  // there for the exception.
  const setDay = (day: Date | undefined) => {
    if (!day) return;
    const base = date ?? new Date();
    const next = new Date(day);
    next.setHours(base.getHours(), base.getMinutes(), 0, 0);
    onChange(toLocalValue(next));
    // The calendar has answered its one question; keeping it open would sit
    // over the time field the user reaches for next.
    setOpen(false);
  };

  // Symmetrically, a time with no day yet lands on today.
  const setTime = (hhmm: string) => {
    const [h, m] = hhmm.split(":").map(Number);
    if (!Number.isFinite(h) || !Number.isFinite(m)) return;
    const next = new Date(date ?? new Date());
    next.setHours(h, m, 0, 0);
    onChange(toLocalValue(next));
  };

  return (
    // Wrapper, not a bare <Popover>: while open, base-ui appends focus guards
    // as siblings of the trigger. They are position:fixed and so cost no
    // height, but they do make the trigger stop being the last child, and a
    // `space-y-*` parent gives every child but the last a bottom margin — so
    // opening the calendar would nudge everything below it down by the gap.
    // Contained here, the consumer's stack only ever sees this one element.
    <div className={cn("flex gap-2", className)}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          render={
            <Button
              id={id}
              type="button"
              variant="outline"
              disabled={disabled}
              // Takes the leftover width so the time field, whose content is
              // fixed-length, can be sized to its content.
              className={cn(
                "min-w-0 flex-1 justify-between font-normal",
                !date && "text-muted-foreground",
              )}
            />
          }
        >
          {/* A spelled month is never the "is 04/07 April or July" coin flip
              a numeric locale format is. */}
          <span className="truncate">
            {date ? format(date, "d MMM yyyy") : placeholder}
          </span>
          <ChevronDownIcon data-icon="inline-end" />
        </PopoverTrigger>
        <PopoverContent className="w-auto overflow-hidden p-0" align="start">
          {/* Plain caption with chevrons, not month/year dropdowns: the dates
              reached from here are days or weeks out, never a jump to another
              year, and two comboboxes in the caption cost more than they earn. */}
          <Calendar
            mode="single"
            selected={date ?? undefined}
            onSelect={setDay}
            defaultMonth={date ?? undefined}
            autoFocus
          />
        </PopoverContent>
      </Popover>
      <Input
        type="time"
        aria-label={timeLabel}
        disabled={disabled}
        // The native clock glyph opens the browser's own picker, the very
        // widget this component exists to replace. Width fits a 12-hour
        // locale's "09:30 AM", which is wider than the 24h form.
        className="w-[6.5rem] shrink-0 appearance-none [&::-webkit-calendar-picker-indicator]:hidden"
        value={date ? `${pad(date.getHours())}:${pad(date.getMinutes())}` : ""}
        onChange={(e) => setTime(e.target.value)}
      />
    </div>
  );
}
