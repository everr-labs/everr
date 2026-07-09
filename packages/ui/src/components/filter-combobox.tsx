import type { QueryFunction, QueryKey } from "@tanstack/react-query";
import { useQuery } from "@tanstack/react-query";
import { ChevronDownIcon, XIcon } from "lucide-react";
import { useId, useState } from "react";
import { cn } from "../lib/utils";
import { Badge } from "./badge";
import { Button } from "./button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "./command";
import { Label } from "./label";
import { Popover, PopoverContent, PopoverTrigger } from "./popover";

interface FilterQueryOptions<TData> {
  queryKey: QueryKey;
  queryFn: QueryFunction<TData>;
  select: (data: TData) => string[];
  staleTime?: number;
}

interface FilterComboboxProps<TData> {
  label: string;
  values: string[];
  onChange: (values: string[]) => void;
  options: FilterQueryOptions<TData>;
  placeholder: string;
  searchPlaceholder?: string;
  className?: string;
  /**
   * Offer a `Use "<typed text>"` row when the search text matches no loaded
   * item, so suggestions assist without constraining what can be selected.
   */
  allowCustom?: boolean;
}

export function FilterCombobox<TData>({
  label,
  values,
  onChange,
  options,
  placeholder,
  searchPlaceholder,
  className = "w-45",
  allowCustom = false,
}: FilterComboboxProps<TData>) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const { data: items = [], isLoading } = useQuery({
    ...options,
    enabled: open,
  });

  const isAll = values.length === 0;

  const toggleSelection = (value: string) => {
    if (values.includes(value)) {
      onChange(values.filter((v) => v !== value));
    } else {
      onChange([...values, value]);
    }
  };

  const maxShownItems = 1;
  const visibleItems = values.slice(0, maxShownItems);
  const hiddenCount = values.length - visibleItems.length;

  // The custom row's cmdk value IS the typed text, so it always survives the
  // filter; hidden when it would duplicate a loaded item or a selection.
  const query = search.trim();
  const showCustom =
    allowCustom &&
    query.length > 0 &&
    !items.includes(query) &&
    !values.includes(query);

  return (
    <div className="flex flex-col gap-1">
      <Label htmlFor={id} className="text-muted-foreground text-xs">
        {label}
      </Label>
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
              id={id}
              variant="outline"
              role="combobox"
              aria-expanded={open}
              className={cn("h-8 justify-between", className)}
            />
          }
        >
          <div className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden">
            {isAll ? (
              <span className="text-muted-foreground truncate text-xs">
                {placeholder}
              </span>
            ) : (
              <>
                {visibleItems.map((val) => (
                  <Badge key={val} variant="outline" className="min-w-0 shrink">
                    <span className="truncate">{val}</span>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-3.5"
                      aria-label={`Remove ${val}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleSelection(val);
                      }}
                      render={<span />}
                      nativeButton={false}
                    >
                      <XIcon className="size-2.5" />
                    </Button>
                  </Badge>
                ))}
                {hiddenCount > 0 && (
                  <Badge variant="outline" className="shrink-0">
                    +{hiddenCount}
                  </Badge>
                )}
              </>
            )}
          </div>
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
              placeholder={searchPlaceholder ?? `Search...`}
              value={search}
              onValueChange={setSearch}
            />
            <CommandList>
              <CommandEmpty>
                {isLoading ? "Loading..." : "No results."}
              </CommandEmpty>
              <CommandGroup>
                <CommandItem
                  value="__all__"
                  data-checked={isAll || undefined}
                  onSelect={() => onChange([])}
                >
                  <span className="truncate">{placeholder}</span>
                </CommandItem>
                {showCustom && (
                  <CommandItem
                    value={query}
                    onSelect={() => {
                      toggleSelection(query);
                      setSearch("");
                    }}
                  >
                    <span className="text-muted-foreground shrink-0">Use</span>
                    <span className="truncate font-mono">
                      &quot;{query}&quot;
                    </span>
                  </CommandItem>
                )}
                {items.map((item) => (
                  <CommandItem
                    key={item}
                    value={item}
                    data-checked={values.includes(item) || undefined}
                    onSelect={() => toggleSelection(item)}
                  >
                    <span className="truncate">{item}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}
