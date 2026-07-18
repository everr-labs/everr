// The shared owner of the comboboxes' `Use "<typed text>"` machinery:
// controlled search state that resets when the popover closes, the trimmed
// query, the "offer a custom row?" decision, and the row itself. Consumed by
// filter-combobox (multi-select) and suggest-combobox (single-value) so both
// comboboxes stay behaviorally identical.
import type { QueryFunction, QueryKey } from "@tanstack/react-query";
import { useState } from "react";
import { CommandItem } from "./command";

/**
 * Async suggestion source for a combobox: a TanStack query plus a `select`
 * mapping its data to the combobox's item shape. Suggestions load only while
 * the popover is open and never block typing.
 */
export interface ComboboxQueryOptions<TData, TItem> {
  queryKey: QueryKey;
  queryFn: QueryFunction<TData>;
  select: (data: TData) => TItem[];
  staleTime?: number;
}

/**
 * Search state + custom-entry derivation: the popover's open state, the
 * controlled search text (reset whenever the popover closes), the trimmed
 * query, and `offerCustom` deciding whether the custom row shows.
 * `offerCustom` takes a predicate (rather than the hook taking it up front)
 * because the loaded items it dedupes against come from a query gated on the
 * hook's own `open` state.
 */
export function useComboboxCustomEntry() {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const onOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next) setSearch("");
  };

  const query = search.trim();
  /**
   * True when the typed text should be offered as a custom row: non-empty,
   * and not a duplicate of a loaded item (or, for multi-select, an existing
   * selection) per the caller's predicate.
   */
  const offerCustom = (isDuplicate: (query: string) => boolean) =>
    query.length > 0 && !isDuplicate(query);

  return { open, onOpenChange, search, setSearch, query, offerCustom };
}

/** The `Use "<typed text>"` row committing the raw query as a value. */
export function CustomValueItem({
  query,
  onSelect,
}: {
  query: string;
  onSelect: () => void;
}) {
  // The custom row's cmdk value IS the typed text, so it always survives the
  // filter.
  return (
    <CommandItem value={query} onSelect={onSelect}>
      <span className="text-muted-foreground shrink-0">Use</span>
      <span className="truncate font-mono">&quot;{query}&quot;</span>
    </CommandItem>
  );
}
