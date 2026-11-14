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
import { ChevronDownIcon } from "lucide-react";
import { type ComponentType, useState } from "react";

export interface ExploreFilterSelectOption {
  value: string;
  label: string;
}

/**
 * Single-select sibling of `ExploreFilterPill`, for rail filters that always
 * hold exactly one value, so there is no "All" row and no clear control.
 */
export function ExploreFilterSelect({
  id,
  label,
  icon: Icon,
  value,
  options,
  onChange,
  placeholder,
  searchPlaceholder,
}: {
  id?: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  value: string | undefined;
  options: readonly ExploreFilterSelectOption[];
  onChange: (value: string) => void;
  placeholder: string;
  searchPlaceholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const selected = options.find((option) => option.value === value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            id={id}
            variant="outline"
            // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role, jsx-a11y/role-has-required-aria-props -- Matches ExploreFilterPill; PopoverTrigger supplies the popup relationship.
            role="combobox"
            aria-expanded={open}
            aria-label={label}
            disabled={options.length === 0}
            className="w-full max-w-none gap-1.5"
          />
        }
      >
        <Icon data-icon="inline-start" className="text-muted-foreground size-3.5 shrink-0" />
        <span className={cn("flex-1 truncate text-left", !selected && "text-muted-foreground")}>
          {selected?.label ?? placeholder}
        </span>
        <ChevronDownIcon className="text-muted-foreground size-3 shrink-0" />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-0">
        <Command className="p-0 *-data-[slot=command-input-wrapper]:p-0">
          <CommandInput
            wrapperClassName="p-0 border-b"
            inputGroupClassName="border-none rounded-none bg-transparent h-9"
            placeholder={searchPlaceholder ?? "Search..."}
          />
          <CommandList>
            <CommandEmpty>No results.</CommandEmpty>
            <CommandGroup>
              {options.map((option) => (
                <CommandItem
                  key={option.value}
                  value={option.label}
                  data-checked={option.value === value || undefined}
                  onSelect={() => {
                    onChange(option.value);
                    setOpen(false);
                  }}
                >
                  <span className="truncate">{option.label}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
