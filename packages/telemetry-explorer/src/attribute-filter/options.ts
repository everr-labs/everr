import type { Query, QueryKey } from "@tanstack/react-query";
import { inViewerTimeRange, type TimeRange } from "@everr/ui/lib/time-range";
import { type FilterOptionsCache, withLastKnown } from "../filters/data/filter-options-cache";
import type { AttributeRepositoryLike } from "./repository";
import type { AttributeSource } from "./schemas";

export function attributeKeysOptions(
  repo: AttributeRepositoryLike,
  input: { timeRange: TimeRange },
  opts: { domain: string },
  cache?: FilterOptionsCache,
) {
  // oxlint-disable-next-line query/exhaustive-deps -- DI repo / input already in key; not a real missing dep
  const options = {
    queryKey: [opts.domain, "attributeKeys", input.timeRange] as const,
    queryFn: () =>
      inViewerTimeRange(input.timeRange, [], (timeRange) =>
        repo.attributeKeys({ ...input, timeRange }),
      ),
  };
  return withLastKnown(options, cache, [opts.domain, "attributeKeys"]);
}

export function attributeValuesOptions(
  repo: AttributeRepositoryLike,
  input: {
    timeRange: TimeRange;
    source: AttributeSource;
    key: string;
    search?: string;
  },
  opts: { domain: string },
  cache?: FilterOptionsCache,
) {
  // oxlint-disable-next-line query/exhaustive-deps -- DI repo / input already in key; not a real missing dep
  const options = {
    queryKey: [
      opts.domain,
      "attributeValues",
      input.timeRange,
      input.source,
      input.key,
      input.search ?? "",
    ] as const,
    queryFn: () =>
      inViewerTimeRange(input.timeRange, [], (timeRange) =>
        repo.attributeValues({ ...input, timeRange }),
      ),
    // Keeps the last results while typing, so the list does not collapse and
    // regrow on every keystroke. Only for the same attribute.
    placeholderData: (
      previous: string[] | undefined,
      previousQuery: Query<string[], Error, string[], QueryKey> | undefined,
    ) =>
      previousQuery?.queryKey[3] === input.source && previousQuery.queryKey[4] === input.key
        ? previous
        : undefined,
  };
  // A searched list is a slice of the full one, so it is never stored or shown in its place.
  return withLastKnown(options, input.search ? undefined : cache, [
    opts.domain,
    "attributeValues",
    input.source,
    input.key,
  ]);
}
