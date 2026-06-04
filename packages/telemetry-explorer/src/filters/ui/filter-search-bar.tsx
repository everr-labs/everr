import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@everr/ui/components/input-group";
import { Search, X } from "lucide-react";
import { useEffect, useState } from "react";

export function FilterSearchBar({
  id,
  label,
  value,
  onChange,
  placeholder,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (next: string) => void;
  placeholder: string;
}) {
  const [draft, setDraft] = useState(value);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  return (
    <form
      className="w-full"
      onSubmit={(event) => {
        event.preventDefault();
        onChange(draft.trim());
      }}
    >
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <InputGroup className="h-8">
        <InputGroupAddon>
          <Search />
        </InputGroupAddon>
        <InputGroupInput
          id={id}
          type="text"
          name="q"
          value={draft}
          onChange={(event) => setDraft(event.currentTarget.value)}
          placeholder={placeholder}
        />
        <InputGroupAddon align="inline-end">
          {value ? (
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
          ) : null}
          <InputGroupButton type="submit" variant="secondary">
            Search
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>
    </form>
  );
}
