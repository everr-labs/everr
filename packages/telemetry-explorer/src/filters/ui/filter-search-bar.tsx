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
import { type ComponentType, useRef, useState } from "react";

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
  // What the field has already asked for. It guards the commit, so leaving the
  // field right after Enter doesn't run the same search a second time: the
  // committed value arrives back through `value` a navigation later, too late
  // for blur to see it.
  const committedRef = useRef(value);
  // Take the draft again when the value changes from outside, for example on
  // "Clear page filters", on a link, or on Back. Comparing during render costs
  // one pass; an effect would show the old draft for a frame first.
  const lastValueRef = useRef(value);
  if (lastValueRef.current !== value) {
    lastValueRef.current = value;
    committedRef.current = value;
    setDraft(value);
  }

  // `dirty` = the field holds an edit that hasn't been run yet. It colours the
  // leading icon, so an unrun edit reads as pending under the "press Enter"
  // hint.
  const dirty = draft.trim() !== value;

  const commit = (next: string) => {
    if (next === committedRef.current) return;
    committedRef.current = next;
    onChange(next);
  };

  return (
    <form
      className="flex w-full flex-col gap-1"
      onSubmit={(event) => {
        event.preventDefault();
        commit(draft.trim());
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
          onBlur={() => commit(draft.trim())}
          placeholder={placeholder}
          className="text-sm"
        />
        {/* The hint and the clear button share one slot: `hidden` takes the one
            that is out of turn off the layout, so they never sit side by side. */}
        <InputGroupAddon align="inline-end">
          <Kbd className="hidden gap-1 px-1.5 group-focus-within/input-group:inline-flex">
            <CornerDownLeft className="size-3" />
            Enter
          </Kbd>
          {value.length > 0 ? (
            <InputGroupButton
              size="icon-xs"
              aria-label={`Clear ${label.toLowerCase()}`}
              className="group-focus-within/input-group:hidden"
              onClick={() => {
                setDraft("");
                commit("");
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
