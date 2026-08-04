import { ChevronDownIcon } from "lucide-react";
import {
  type ComponentType,
  type ReactNode,
  type SVGProps,
  useState,
} from "react";
import { Button } from "./button";
import { Command, CommandGroup, CommandItem, CommandList } from "./command";
import { Popover, PopoverContent, PopoverTrigger } from "./popover";

/** One closed-set choice: the committed value, its display label, optional icon. */
export interface OptionComboboxItem {
  value: string;
  /** Rendered in the row and on the trigger; style it at the call site. */
  label: ReactNode;
  /** Any svg-props component: lucide icons and inlined brand marks alike. */
  icon?: ComponentType<SVGProps<SVGSVGElement>>;
}

/**
 * The closed-set sibling of SuggestCombobox: holds exactly one value from a
 * fixed option list, with no free text and no search. Options can carry an
 * icon, shown both in the row and on the trigger.
 */
export function OptionCombobox({
  id,
  label,
  value,
  onChange,
  options,
  placeholder,
  className,
  disabled,
}: {
  id?: string;
  /** Accessible name for the trigger when no <Label htmlFor={id}> names it. */
  label?: string;
  value: string;
  onChange: (value: string) => void;
  options: OptionComboboxItem[];
  /** Muted trigger text while no value is picked. */
  placeholder?: string;
  className?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const selected = options.find((o) => o.value === value);

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
            <CommandList>
              <CommandGroup>
                {options.map((o) => (
                  <CommandItem
                    key={o.value}
                    value={o.value}
                    data-checked={o.value === value || undefined}
                    onSelect={() => {
                      onChange(o.value);
                      setOpen(false);
                    }}
                  >
                    {o.icon && (
                      <o.icon className="text-muted-foreground" aria-hidden />
                    )}
                    {o.label}
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
