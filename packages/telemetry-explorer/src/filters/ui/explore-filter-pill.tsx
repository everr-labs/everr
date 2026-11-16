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
  /** Human label for the filter, e.g. "Service". Drives the clear control's name. */
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
  /** Classes for the trigger. The Explore rail sends `w-full max-w-none`. */
  className?: string;
  /** Id of the visible label above the control. The trigger is then named
   *  by that label and its current value, e.g. "Service All services". */
  labelId?: string;
}

/**
 * Compact, icon-led multi-select for the Explore rail's global Service /
 * Environment filters. Intentionally separate from the shared `FilterCombobox`
 * (used across many other surfaces) so this styling stays local.
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
  className,
  labelId,
}: ExploreFilterPillProps<TData>) {
  const id = useId();
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
      <PopoverTrigger
        render={
          <Button
            id={id}
            variant="outline"
            // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role, jsx-a11y/role-has-required-aria-props -- Preserve the existing composite trigger and nested clear-control DOM semantics. PopoverTrigger supplies the popup relationship; preserve the existing trigger markup.
            role="combobox"
            aria-expanded={open}
            aria-labelledby={labelId ? `${labelId} ${id}-value` : undefined}
            className={cn("max-w-52 gap-1.5", isActive && "border-primary/35", className)}
          />
        }
      >
        <Icon
          data-icon="inline-start"
          className={cn("size-3.5 shrink-0", isActive ? "text-primary" : "text-muted-foreground")}
          aria-hidden="true"
        />
        {/* flex-1 puts the chevron and the clear control at the right edge
              when the trigger fills its column, as it does in the Explore rail.
              At the width of the top bar there is no free space, so nothing
              moves. */}
        <span
          id={`${id}-value`}
          className={cn("flex-1 truncate text-left", !isActive && "text-muted-foreground")}
        >
          {display}
        </span>
        {isActive ? (
          // A native <button> would nest inside the trigger <button> (invalid
          // HTML), so this clear affordance is a span with button semantics.
          // biome-ignore lint/a11y/useSemanticElements: nested-button constraint
          <span
            // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- Preserve the existing composite trigger and nested clear-control DOM semantics.
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
      </PopoverTrigger>
      <PopoverContent align="start" className="w-(--anchor-width) min-w-48 p-0">
        <Command className="p-0 *-data-[slot=command-input-wrapper]:p-0">
          <CommandInput
            wrapperClassName="p-0 border-b"
            inputGroupClassName="border-none rounded-none bg-transparent h-9"
            placeholder={searchPlaceholder ?? "Search..."}
          />
          <CommandList>
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
