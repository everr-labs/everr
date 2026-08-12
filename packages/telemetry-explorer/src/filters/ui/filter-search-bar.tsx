import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@everr/ui/components/input-group";
import { Kbd } from "@everr/ui/components/kbd";
import { cn } from "@everr/ui/lib/utils";
import { CornerDownLeft, Search, X } from "lucide-react";
import { useEffect, useState } from "react";

export function FilterSearchBar({
  id,
  label,
  value,
  onChange,
  placeholder,
  showLabel = false,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (next: string) => void;
  placeholder: string;
  // In the filter rail the label is the heading of the section. It is then
  // visible, and it has the style of every other section label. There is one
  // <label> element in both cases, so the accessible name keeps its shape.
  showLabel?: boolean;
}) {
  const [draft, setDraft] = useState(value);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  // `dirty` = the field holds an edit that hasn't been run yet; it drives the
  // submit CTA so the otherwise-empty right side communicates "press Enter to
  // search" instead of stranding a lone button across a wide bar.
  const dirty = draft.trim() !== value;
  const hasApplied = value.length > 0;

  return (
    <form
      className={cn("w-full", showLabel && "flex flex-col gap-1")}
      onSubmit={(event) => {
        event.preventDefault();
        onChange(draft.trim());
      }}
    >
      <label
        htmlFor={id}
        className={cn(showLabel ? "text-muted-foreground text-xs" : "sr-only")}
      >
        {label}
      </label>
      <InputGroup className="h-9">
        <InputGroupAddon>
          <Search
            className={cn(
              "transition-colors duration-200",
              dirty
                ? "text-foreground"
                : "text-muted-foreground group-focus-within/input-group:text-foreground",
            )}
          />
        </InputGroupAddon>
        <InputGroupInput
          id={id}
          type="text"
          name="q"
          value={draft}
          onChange={(event) => setDraft(event.currentTarget.value)}
          placeholder={placeholder}
          className="text-sm"
        />
        <InputGroupAddon align="inline-end" className="gap-1.5">
          {dirty ? (
            <InputGroupButton
              type="submit"
              variant="default"
              className="h-6 gap-1 px-2 font-medium"
            >
              <Search className="size-3" />
              Search
            </InputGroupButton>
          ) : hasApplied ? (
            <InputGroupButton
              size="icon-xs"
              aria-label="Clear search"
              onClick={() => {
                setDraft("");
                onChange("");
              }}
            >
              <X />
            </InputGroupButton>
          ) : (
            <Kbd className="hidden gap-1 px-1.5 group-focus-within/input-group:inline-flex">
              <CornerDownLeft className="size-3" />
              Enter
            </Kbd>
          )}
        </InputGroupAddon>
      </InputGroup>
    </form>
  );
}
