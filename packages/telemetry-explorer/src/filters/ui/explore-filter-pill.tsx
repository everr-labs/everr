import { Button } from "@everr/ui/components/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@everr/ui/components/command";
import { Popover, PopoverContent, PopoverTrigger } from "@everr/ui/components/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@everr/ui/components/tooltip";
import { cn } from "@everr/ui/lib/utils";
import type { QueryFunction, QueryKey } from "@tanstack/react-query";
import { useQuery } from "@tanstack/react-query";
import { ChevronDownIcon, XIcon } from "lucide-react";
import { type ComponentType, useId, useState } from "react";

interface FilterQueryOptions<TData> {
  queryKey: QueryKey;
  queryFn: QueryFunction<TData>;
  select: (data: TData) => string[];
}

export interface ExploreFilterPillProps<TData> {
  /** Human label for the filter, e.g. "Service". Drives a11y + tooltip copy. */
  label: string;
  /** Leading glyph. Establishes the filter's identity in place of a text label. */
  icon: ComponentType<{ className?: string }>;
  values: string[];
  onChange: (values: string[]) => void;
  options: FilterQueryOptions<TData>;
  /** Empty-state copy shown when nothing is selected, e.g. "All services". */
  placeholder: string;
  searchPlaceholder?: string;
  /** Plural noun for the multi-select count, e.g. "services". Defaults to `${label}s`. */
  countNoun?: string;
}

/**
 * Compact, icon-led multi-select pill for the Explore topbar's global Service /
 * Environment filters. Speaks the same visual language as the time-range pill
 * (outline button · leading icon · value · chevron · tooltip) so the toolbar
 * reads as one coherent row. Intentionally separate from the shared
 * `FilterCombobox` (used across many other surfaces) so this restyle stays local.
 */
export function ExploreFilterPill<TData>({
  label,
  icon: Icon,
  values,
  onChange,
  options,
  placeholder,
  searchPlaceholder,
  countNoun,
}: ExploreFilterPillProps<TData>) {
  const id = useId();
  const listboxId = `${id}-listbox`;
  const [open, setOpen] = useState(false);

  const { data: items = [], isLoading } = useQuery({
    ...options,
    enabled: open,
  });

  const count = values.length;
  const isActive = count > 0;
  const noun = countNoun ?? `${label.toLowerCase()}s`;

  const display = count === 0 ? placeholder : count === 1 ? values[0] : `${count} ${noun}`;

  const toggle = (value: string) => {
    if (values.includes(value)) {
      onChange(values.filter((v) => v !== value));
    } else {
      onChange([...values, value]);
    }
  };

  const clear = (e: { stopPropagation: () => void }) => {
    e.stopPropagation();
    onChange([]);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger
          delay={0}
          render={
            <PopoverTrigger
              render={
                <Button
                  id={id}
                  variant="outline"
                  // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- trigger opens a searchable listbox popover (combobox pattern); a rich <button> with icon + label + chevron can't be an <input>/<select>
                  role="combobox"
                  aria-expanded={open}
                  aria-controls={listboxId}
                  className={cn("max-w-52 gap-1.5", isActive && "border-primary/35")}
                />
              }
            />
          }
        >
          <Icon
            data-icon="inline-start"
            className={cn("size-3.5 shrink-0", isActive ? "text-primary" : "text-muted-foreground")}
            aria-hidden="true"
          />
          <span className={cn("truncate", !isActive && "text-muted-foreground")}>{display}</span>
          {isActive ? (
            // A native <button> would nest inside the trigger <button> (invalid
            // HTML), so this clear affordance is a span with button semantics.
            <span
              // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- a native <button> would nest inside the trigger <button> (invalid HTML), so this clear affordance is a span with button semantics
              role="button"
              tabIndex={0}
              aria-label={`Clear ${label} filter`}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={clear}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  clear(e);
                }
              }}
              className="text-muted-foreground hover:text-foreground -mr-0.5 flex size-4 shrink-0 items-center justify-center rounded-sm transition-colors"
            >
              <XIcon className="size-3" />
            </span>
          ) : (
            <ChevronDownIcon className="text-muted-foreground size-3 shrink-0" />
          )}
        </TooltipTrigger>
        {/* Open downward: these pills sit in a topbar, so a top-side tooltip can
            collide with window chrome above (e.g. the desktop traffic lights). */}
        <TooltipContent side="bottom">
          {isActive ? `${label}: ${values.join(", ")}` : `Filter by ${label.toLowerCase()}`}
        </TooltipContent>
      </Tooltip>
      <PopoverContent align="start" className="w-64 p-0">
        <Command className="p-0 *-data-[slot=command-input-wrapper]:p-0">
          <CommandInput
            wrapperClassName="p-0 border-b"
            inputGroupClassName="border-none rounded-none bg-transparent h-9"
            placeholder={searchPlaceholder ?? "Search..."}
          />
          <CommandList id={listboxId}>
            <CommandEmpty>{isLoading ? "Loading…" : "No results."}</CommandEmpty>
            <CommandGroup>
              <CommandItem
                value="__all__"
                data-checked={!isActive || undefined}
                onSelect={() => onChange([])}
              >
                <Icon className="text-muted-foreground size-3.5" />
                <span className="truncate">{placeholder}</span>
              </CommandItem>
              {items.map((item) => (
                <CommandItem
                  key={item}
                  value={item}
                  data-checked={values.includes(item) || undefined}
                  onSelect={() => toggle(item)}
                >
                  <span className="truncate">{item}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
