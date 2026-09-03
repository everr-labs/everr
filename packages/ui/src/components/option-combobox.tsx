import { ChevronDownIcon } from "lucide-react";
import {
  type ComponentType,
  type ReactNode,
  type SVGProps,
  useMemo,
  useState,
} from "react";
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

/** One closed-set choice with an optional explanation for the menu row. */
export interface OptionComboboxItem {
  value: string;
  /** Rendered in the row and on the trigger; style it at the call site. */
  label: ReactNode;
  /** Supporting copy shown only in the expanded menu. */
  description?: ReactNode;
  /** Any svg-props component: lucide icons and inlined brand marks alike. */
  icon?: ComponentType<SVGProps<SVGSVGElement>>;
  /** Heading the row is listed under. Groups appear in the order their first
   *  item does; items without one are listed first, unheaded. */
  group?: string;
}

/**
 * The closed-set sibling of SuggestCombobox: holds exactly one value from a
 * fixed option list, with no free text. Options can carry an icon, menu-only
 * supporting copy and a group heading; `searchable` adds a search field for
 * lists too long to scan, matching on the value and on a string label.
 */
export function OptionCombobox({
  id,
  label,
  value,
  onChange,
  options,
  placeholder,
  searchable = false,
  searchPlaceholder = "Search…",
  emptyMessage = "No match.",
  className,
  disabled,
}: {
  id?: string;
  /** Accessible name for the trigger when no <Label htmlFor={id}> names it. */
  label?: string;
  /** `null` while nothing is picked. */
  value: string | null;
  onChange: (value: string) => void;
  options: OptionComboboxItem[];
  /** Muted trigger text while no value is picked. */
  placeholder?: string;
  searchable?: boolean;
  searchPlaceholder?: string;
  /** What the menu says when a search matches nothing. */
  emptyMessage?: string;
  className?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const selected = options.find((o) => o.value === value);

  // Insertion order of a Map is the order the groups were met, so a caller
  // that hands the options in sorted order gets sorted groups for free.
  const groups = useMemo(() => {
    const byGroup = new Map<string | undefined, OptionComboboxItem[]>();
    for (const option of options) {
      const bucket = byGroup.get(option.group);
      if (bucket) bucket.push(option);
      else byGroup.set(option.group, [option]);
    }
    return [...byGroup];
  }, [options]);

  return (
    // The wrapper keeps Base UI's focus-guard spans (siblings of the trigger
    // while open) out of the consumer's layout: in a space-y parent their
    // presence would change which child is :last and shift what follows.
    <div className={className}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          render={
            <Button
              id={id}
              variant="outline"
              role="combobox"
              aria-expanded={open}
              aria-label={label}
              disabled={disabled}
              className="h-8 w-full justify-between font-normal"
            />
          }
        >
          {selected || value ? (
            <span className="flex min-w-0 flex-1 items-center gap-2 text-left text-xs">
              {selected?.icon && (
                <selected.icon
                  className="text-muted-foreground size-3.5 shrink-0"
                  aria-hidden="true"
                />
              )}
              <span className="truncate">{selected?.label ?? value}</span>
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
        <PopoverContent align="start" className="w-(--anchor-width) p-0">
          <Command className="p-0">
            {searchable && <CommandInput placeholder={searchPlaceholder} />}
            <CommandList>
              {searchable && <CommandEmpty>{emptyMessage}</CommandEmpty>}
              {groups.map(([group, items]) => (
                <CommandGroup key={group ?? ""} heading={group}>
                  {items.map((o) => (
                    <CommandItem
                      key={o.value}
                      value={o.value}
                      // cmdk matches the value alone; the word on the row is
                      // what a reader types.
                      keywords={
                        typeof o.label === "string" ? [o.label] : undefined
                      }
                      data-checked={o.value === value || undefined}
                      onSelect={() => {
                        onChange(o.value);
                        setOpen(false);
                      }}
                    >
                      {o.icon && (
                        <o.icon
                          className="text-muted-foreground mt-0.5 self-start"
                          aria-hidden
                        />
                      )}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate">{o.label}</span>
                        {o.description && (
                          <span className="text-muted-foreground block whitespace-normal text-xs leading-snug">
                            {o.description}
                          </span>
                        )}
                      </span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              ))}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}
