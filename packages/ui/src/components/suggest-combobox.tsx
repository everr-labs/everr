import { useQuery } from "@tanstack/react-query";
import { ChevronDownIcon } from "lucide-react";
import { cn } from "../lib/utils";
import { Button } from "./button";
import {
  type ComboboxQueryOptions,
  CustomValueItem,
  useComboboxCustomEntry,
} from "./combobox-custom-entry";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "./command";
import { Popover, PopoverContent, PopoverTrigger } from "./popover";

/** One suggestion row. `value` is committed; `label` is its display name. */
export interface SuggestItem {
  value: string;
  label?: string;
  hint?: string;
  tag?: string;
}

type SuggestQueryOptions<TData> = ComboboxQueryOptions<TData, SuggestItem>;

interface SuggestComboboxProps<TData> {
  /** Accessible name for the trigger; not rendered visibly. */
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: SuggestQueryOptions<TData>;
  placeholder: string;
  searchPlaceholder?: string;
  className?: string;
  disabled?: boolean;
  displayValue?: string;
}

/**
 * FilterCombobox's single-value sibling: a field that holds exactly one
 * string, prepopulated with async suggestions but never constrained by them.
 * Typing text that matches no suggestion offers a `Use "<text>"` row, so a
 * custom entry is always one Enter away. Suggestions load only while the
 * popover is open and never block typing.
 */
export function SuggestCombobox<TData>({
  label,
  value,
  onChange,
  options,
  placeholder,
  searchPlaceholder,
  className,
  disabled,
  displayValue,
}: SuggestComboboxProps<TData>) {
  const { open, onOpenChange, search, setSearch, query, offerCustom } =
    useComboboxCustomEntry();

  const { data: items = [], isLoading } = useQuery({
    ...options,
    enabled: open,
  });

  const commit = (next: string) => {
    onChange(next);
    // Closing also resets the search text.
    onOpenChange(false);
  };

  // Hidden when it would duplicate a real suggestion.
  const showCustom = offerCustom((q) => items.some((item) => item.value === q));
  const selected = items.find((item) => item.value === value);
  const selectedLabel = displayValue ?? selected?.label;

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger
        render={
          <Button
            variant="outline"
            role="combobox"
            aria-expanded={open}
            aria-label={label}
            disabled={disabled}
            className={cn("h-8 w-full justify-between font-normal", className)}
          />
        }
      >
        {value ? (
          <span
            className={cn(
              "min-w-0 flex-1 truncate text-left text-xs",
              !selectedLabel && "font-mono",
            )}
          >
            {selectedLabel ?? value}
          </span>
        ) : (
          <span className="text-muted-foreground min-w-0 flex-1 truncate text-left text-xs">
            {placeholder}
          </span>
        )}
        <ChevronDownIcon
          className="text-muted-foreground size-3.5 shrink-0"
          aria-hidden="true"
        />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-(--anchor-width) min-w-48 p-0">
        <Command className="p-0 *-data-[slot=command-input-wrapper]:p-0">
          <CommandInput
            wrapperClassName="p-0 border-b"
            inputGroupClassName="border-none rounded-none bg-transparent h-8"
            placeholder={searchPlaceholder ?? `Search or type...`}
            value={search}
            onValueChange={setSearch}
          />
          <CommandList>
            <CommandEmpty>
              {isLoading ? "Loading..." : "No suggestions. Type a value."}
            </CommandEmpty>
            <CommandGroup>
              {showCustom && (
                <CustomValueItem query={query} onSelect={() => commit(query)} />
              )}
              {items.map((item) => (
                <CommandItem
                  key={item.value}
                  value={item.value}
                  keywords={[item.label, item.hint].filter(
                    (keyword): keyword is string => keyword !== undefined,
                  )}
                  data-checked={value === item.value || undefined}
                  onSelect={() => commit(item.value)}
                >
                  <span className="min-w-0 flex-1">
                    <span
                      className={cn(
                        "block truncate",
                        !item.label && "font-mono",
                      )}
                    >
                      {item.label ?? item.value}
                    </span>
                    {item.hint && (
                      <span className="block truncate font-mono text-[0.6875rem] text-muted-foreground">
                        {item.hint}
                      </span>
                    )}
                  </span>
                  {item.tag && (
                    <span className="text-muted-foreground ml-auto shrink-0 text-[0.625rem] tracking-wide uppercase">
                      {item.tag}
                    </span>
                  )}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
