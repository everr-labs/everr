import { cn } from "@everr/ui/lib/utils";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import type * as React from "react";
import { type DayProps, DayPicker } from "react-day-picker";

/**
 * A month calendar (react-day-picker) in the app's dropdown style: the same
 * row fill as a highlighted dropdown item, lime only for the picked ends.
 * Unstyled underneath, so every look comes from the class names here.
 */
function Calendar({
  className,
  classNames,
  modifiersClassNames,
  showOutsideDays = true,
  ...props
}: React.ComponentProps<typeof DayPicker>) {
  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      className={cn("text-xs", className)}
      classNames={{
        root: "w-fit",
        months: "relative flex flex-col",
        month: "flex flex-col gap-2",
        month_caption: "flex h-7 items-center justify-center",
        caption_label: "text-xs font-medium",
        nav: "absolute inset-x-0 top-0 flex items-center justify-between",
        button_previous:
          "text-muted-foreground hover:bg-white/[0.07] hover:text-foreground focus-visible:ring-ring inline-flex size-7 items-center justify-center rounded-md outline-none focus-visible:ring-2 aria-disabled:pointer-events-none aria-disabled:opacity-30",
        button_next:
          "text-muted-foreground hover:bg-white/[0.07] hover:text-foreground focus-visible:ring-ring inline-flex size-7 items-center justify-center rounded-md outline-none focus-visible:ring-2 aria-disabled:pointer-events-none aria-disabled:opacity-30",
        month_grid: "border-collapse",
        weekdays: "flex",
        weekday: "text-muted-foreground w-9 text-[0.6875rem] font-normal",
        week: "mt-0.5 flex",
        day: "relative size-9 p-0 text-center",
        day_button:
          "focus-visible:ring-ring relative inline-flex size-9 items-center justify-center rounded-md tabular-nums outline-none hover:bg-white/[0.07] focus-visible:ring-2",
        // The ends of a range are the only lime: what was picked. The days
        // between take the dropdown highlight, joined into one band. The
        // hover variant keeps an end lime under the pointer that just picked it.
        range_start:
          "rounded-l-md bg-white/[0.07] [&>button]:bg-primary [&>button]:text-primary-foreground [&>button]:hover:bg-primary",
        range_end:
          "rounded-r-md bg-white/[0.07] [&>button]:bg-primary [&>button]:text-primary-foreground [&>button]:hover:bg-primary",
        range_middle:
          "bg-white/[0.07] first:rounded-l-md last:rounded-r-md [&>button]:rounded-none",
        selected: "",
        // A dot, not a colour: lime is for what is picked.
        today:
          "[&>button]:after:bg-current [&>button]:after:absolute [&>button]:after:bottom-1 [&>button]:after:left-1/2 [&>button]:after:size-0.75 [&>button]:after:-translate-x-1/2 [&>button]:after:rounded-full",
        outside: "text-muted-foreground/45",
        disabled: "pointer-events-none opacity-30",
        ...classNames,
      }}
      // The range a second click would make, lighter than the picked one.
      // Set the "preview" modifiers to use it.
      modifiersClassNames={{
        preview: "bg-white/[0.04] first:rounded-l-md last:rounded-r-md",
        preview_start: "rounded-l-md",
        preview_end: "rounded-r-md",
        ...modifiersClassNames,
      }}
      components={{ Chevron: CalendarChevron, Day: CalendarDay }}
      {...props}
    />
  );
}

// Past the last month you can go to, react-day-picker leaves the outside days
// blank, and a fixed six-row month ends on an empty row. They show here as
// plain numbers, dimmed by the outside and disabled styles of their cell.
function CalendarDay({ day, modifiers, children, ...props }: DayProps) {
  return (
    <td {...props}>
      {modifiers.hidden && day.outside ? (
        <span aria-hidden className="inline-flex size-9 items-center justify-center tabular-nums">
          {day.date.getDate()}
        </span>
      ) : (
        children
      )}
    </td>
  );
}

function CalendarChevron({
  orientation,
  className,
}: {
  orientation?: "left" | "right" | "up" | "down";
  className?: string;
}) {
  const Icon = orientation === "left" ? ChevronLeftIcon : ChevronRightIcon;
  return <Icon className={cn("size-3.5", className)} />;
}

export { Calendar };
