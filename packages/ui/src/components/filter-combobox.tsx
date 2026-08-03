import { useQuery } from "@tanstack/react-query";
import { ChevronDownIcon, XIcon } from "lucide-react";
import { useId } from "react";
import { cn } from "../lib/utils";
import { Badge } from "./badge";
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
import { Label } from "./label";
import { Popover, PopoverContent, PopoverTrigger } from "./popover";

type FilterQueryOptions<TData> = ComboboxQueryOptions<TData, string>;

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
  const { open, onOpenChange, search, setSearch, query, offerCustom } =
    useComboboxCustomEntry();

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

  // Hidden when it would duplicate a loaded item or a selection.
  const showCustom =
    allowCustom && offerCustom((q) => items.includes(q) || values.includes(q));

  // Selections the query did not return (custom entries, or values whose
  // suggestion aged out of the list) still need a checked row: without one
  // they hide behind the trigger's +N badge with no way to toggle them off
  // short of clearing everything.
  const selectedOnly = values.filter((v) => !items.includes(v));

  return (
    <div className="flex flex-col gap-1">
      <Label htmlFor={id} className="text-muted-foreground text-xs">
        {label}
      </Label>
      <Popover open={open} onOpenChange={onOpenChange}>
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
          className="w-(--anchor-width) min-w-48 p-0"
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
                  <CustomValueItem
                    query={query}
                    onSelect={() => {
                      toggleSelection(query);
                      setSearch("");
                    }}
                  />
                )}
                {selectedOnly.map((item) => (
                  <CommandItem
                    key={item}
                    value={item}
                    data-checked
                    onSelect={() => toggleSelection(item)}
                  >
                    <span className="truncate">{item}</span>
                  </CommandItem>
                ))}
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
