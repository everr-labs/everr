// Replaces `<input type="datetime-local">`, whose popup is the browser's and
// ignores the app's theme. The value keeps the `datetime-local` string shape
// so callers keep their parsing. The time is a field on the surface, not
// inside the calendar: changing only the clock is at least as common as
// changing the day.
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

/** A `datetime-local` value as a Date (no zone in the form, so parsed as
 * local time, which is what it means here). */
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

  // Picking a day keeps the clock already set; with none yet, now stands in
  // (a window starting "today" almost always means from now).
  const setDay = (day: Date | undefined) => {
    if (!day) return;
    const base = date ?? new Date();
    const next = new Date(day);
    next.setHours(base.getHours(), base.getMinutes(), 0, 0);
    onChange(toLocalValue(next));
    // Left open, the calendar sits over the time field the user reaches for next.
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
    // Wrapper, not a bare <Popover>: while open, base-ui appends
    // position:fixed focus guards after the trigger, so it stops being the
    // last child and a `space-y-*` parent would nudge the form down by the
    // gap. Contained here, the consumer's stack sees one element.
    <div className={cn("flex gap-2", className)}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          render={
            <Button
              id={id}
              type="button"
              variant="outline"
              disabled={disabled}
              className={cn(
                "min-w-0 flex-1 justify-between font-normal",
                !date && "text-muted-foreground",
              )}
            />
          }
        >
          {/* A spelled month avoids the 04/07 April-or-July coin flip. */}
          <span className="truncate">
            {date ? format(date, "d MMM yyyy") : placeholder}
          </span>
          <ChevronDownIcon data-icon="inline-end" />
        </PopoverTrigger>
        <PopoverContent className="w-auto overflow-hidden p-0" align="start">
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
        // The native clock glyph opens the browser picker this component
        // replaces. Width fits a 12-hour locale's "09:30 AM".
        className="w-[6.5rem] shrink-0 appearance-none [&::-webkit-calendar-picker-indicator]:hidden"
        value={date ? `${pad(date.getHours())}:${pad(date.getMinutes())}` : ""}
        onChange={(e) => setTime(e.target.value)}
      />
    </div>
  );
}
