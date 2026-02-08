import { useMemo, useState } from "react";

export function useSortableData<T, F extends string>(
  data: T[],
  defaultField: F,
  comparator: (a: T, b: T, field: F) => number,
  defaultDirection: "asc" | "desc" = "desc",
) {
  const [sortField, setSortField] = useState<F>(defaultField);
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">(
    defaultDirection,
  );

  const sorted = useMemo(() => {
    return [...data].sort((a, b) => {
      const cmp = comparator(a, b, sortField);
      return sortDirection === "asc" ? cmp : -cmp;
    });
  }, [data, sortField, sortDirection, comparator]);

  const toggleSort = (field: F) => {
    if (sortField === field) {
      setSortDirection((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDirection("desc");
    }
  };

  return { sorted, sortField, sortDirection, toggleSort };
}
