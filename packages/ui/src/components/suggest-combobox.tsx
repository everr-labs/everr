import type { QueryFunction, QueryKey } from "@tanstack/react-query";
import { useQuery } from "@tanstack/react-query";
import { ChevronDownIcon } from "lucide-react";
import { useState } from "react";
import { cn } from "../lib/utils";
import { Button } from "./button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "./command";
import { Popover, PopoverContent, PopoverTrigger } from "./popover";

/**
 * One suggestion row: the string committed on select, an optional secondary
 * `hint` (shown muted, also searchable), and an optional muted `tag` badge
 * (e.g. "synthetic") teaching where the suggestion comes from.
 */
export interface SuggestItem {
  value: string;
  hint?: string;
  tag?: string;
}

interface SuggestQueryOptions<TData> {
  queryKey: QueryKey;
  queryFn: QueryFunction<TData>;
  select: (data: TData) => SuggestItem[];
  staleTime?: number;
}

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
}: SuggestComboboxProps<TData>) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const { data: items = [], isLoading } = useQuery({
    ...options,
    enabled: open,
  });

  const commit = (next: string) => {
    onChange(next);
    setOpen(false);
    setSearch("");
  };

  const query = search.trim();
  // The custom row's cmdk value IS the typed text, so it always survives the
  // filter; hidden when it would duplicate a real suggestion.
  const showCustom =
    query.length > 0 && !items.some((item) => item.value === query);

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setSearch("");
      }}
    >
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
          <span className="min-w-0 flex-1 truncate text-left font-mono text-xs">
            {value}
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
      <PopoverContent
        align="start"
        className="w-(--radix-popper-anchor-width) min-w-48 p-0"
      >
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
                <CommandItem value={query} onSelect={() => commit(query)}>
                  <span className="text-muted-foreground shrink-0">Use</span>
                  <span className="truncate font-mono">
                    &quot;{query}&quot;
                  </span>
                </CommandItem>
              )}
              {items.map((item) => (
                <CommandItem
                  key={item.value}
                  value={item.value}
                  keywords={item.hint ? [item.hint] : undefined}
                  data-checked={value === item.value || undefined}
                  onSelect={() => commit(item.value)}
                >
                  <span className="truncate font-mono">{item.value}</span>
                  {item.hint && (
                    <span className="text-muted-foreground min-w-0 truncate">
                      {item.hint}
                    </span>
                  )}
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
