import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@everr/ui/components/input-group";
import { Kbd } from "@everr/ui/components/kbd";
import { Label } from "@everr/ui/components/label";
import { cn } from "@everr/ui/lib/utils";
import { CornerDownLeft, Search, X } from "lucide-react";
import { type ComponentType, useEffect, useState } from "react";

export function FilterSearchBar({
  id,
  label,
  value,
  onChange,
  placeholder,
  icon: Icon = Search,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (next: string) => void;
  placeholder: string;
  // The leading icon. Fields that hold one kind of value (a trace id, for
  // example) say so with their own icon instead of the generic magnifier.
  icon?: ComponentType<{ className?: string }>;
}) {
  const [draft, setDraft] = useState(value);
  // Whether the input itself holds focus. `group-focus-within` would also match
  // the clear button, and hiding a focused button drops the focus on the floor.
  const [inputFocused, setInputFocused] = useState(false);
  // Take the draft again when the value changes from outside, for example on
  // "Clear page filters", on a link, or on Back.
  useEffect(() => {
    setDraft(value);
  }, [value]);

  // `dirty` = the field holds an edit that hasn't been run yet. It colours the
  // leading icon, so an unrun edit reads as pending under the "press Enter"
  // hint.
  const dirty = draft.trim() !== value;

  const commit = () => {
    if (dirty) onChange(draft.trim());
  };

  return (
    <form
      className="flex w-full flex-col gap-1"
      onSubmit={(event) => {
        event.preventDefault();
        commit();
      }}
    >
      <Label htmlFor={id} className="text-muted-foreground text-xs">
        {label}
      </Label>
      <InputGroup className="h-9">
        <InputGroupAddon>
          <Icon
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
          name={id}
          value={draft}
          onChange={(event) => setDraft(event.currentTarget.value)}
          // Leaving the field runs the edit it holds. Without this a typed but
          // unsubmitted draft looks applied while the results ignore it.
          onFocus={() => setInputFocused(true)}
          onBlur={() => {
            setInputFocused(false);
            commit();
          }}
          placeholder={placeholder}
          className="text-sm"
        />
        {/* The hint and the clear button share one slot, so only one of them
            renders at a time. */}
        <InputGroupAddon align="inline-end">
          {inputFocused ? (
            <Kbd className="gap-1 px-1.5">
              <CornerDownLeft className="size-3" />
              Enter
            </Kbd>
          ) : value.length > 0 ? (
            <InputGroupButton
              size="icon-xs"
              aria-label={`Clear ${label.toLowerCase()}`}
              onClick={() => {
                setDraft("");
                onChange("");
              }}
            >
              <X />
            </InputGroupButton>
          ) : null}
        </InputGroupAddon>
      </InputGroup>
    </form>
  );
}
