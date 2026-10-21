import type { TimeRange } from "@everr/ui/lib/time-range";
import type { AttributeRepositoryLike } from "./repository";
import type { AttributeSource } from "./schemas";

export function attributeKeysOptions(
  repo: AttributeRepositoryLike,
  input: { timeRange: TimeRange },
  opts: { domain: string },
) {
  // oxlint-disable-next-line query/exhaustive-deps -- DI repo / input already in key; not a real missing dep
  return {
    queryKey: [opts.domain, "attributeKeys", input.timeRange] as const,
    queryFn: () => repo.attributeKeys(input),
  };
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
) {
  // oxlint-disable-next-line query/exhaustive-deps -- DI repo / input already in key; not a real missing dep
  return {
    queryKey: [
      opts.domain,
      "attributeValues",
      input.timeRange,
      input.source,
      input.key,
      input.search ?? "",
    ] as const,
    queryFn: () => repo.attributeValues(input),
  };
}
