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
 * The comboboxes' shared `Use "<typed text>"` machinery, so filter-combobox
 * and suggest-combobox stay behaviorally identical: popover open state,
 * search text (reset on close), the trimmed query, and `offerCustom`
 * deciding whether the custom row shows. `offerCustom` takes a predicate at
 * call time because the items it dedupes against come from a query gated on
 * this hook's own `open` state.
 */
export function useComboboxCustomEntry() {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const onOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next) setSearch("");
  };

  const query = search.trim();
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
