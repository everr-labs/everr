import { dataQueryOptions } from "@everr/ui/lib/query-options";
import { withViewerTimeRange } from "@everr/ui/lib/time-range";
import { keepPreviousData } from "@tanstack/react-query";
import type { ProfilesRepositoryLike } from "./repository";
import type { ProfileFilterInput, ProfileSpanTimelineInput } from "./schemas";
import type { SampleTypeOption } from "./types";

// The keys keep the range as the URL has it; each fetch resolves it to exact
// timestamps in the viewer's zone, so a page refresh moves a relative range on.

type FilterInput = {
  repo: ProfilesRepositoryLike;
  filters: ProfileFilterInput;
};

type SampleTypeInput = FilterInput & {
  /** The queries wait while it is absent. */
  sampleType: SampleTypeOption | undefined;
};

// `enabled` holds a query back until its sample type is known, so the fetch
// always has one.
function picked(sampleType: SampleTypeOption | undefined): SampleTypeOption {
  if (!sampleType) throw new Error("The query ran before a sample type was picked.");
  return sampleType;
}

export function profileSampleTypesOptions({ repo, filters }: FilterInput) {
  return dataQueryOptions({
    queryKey: ["profiles", "sample-types", filters] as const,
    queryFn: () => repo.listSampleTypes(withViewerTimeRange(filters)),
    placeholderData: keepPreviousData,
  });
}

export function profileStacksOptions({
  repo,
  filters,
  sampleType,
  enabled = true,
}: SampleTypeInput & { enabled?: boolean }) {
  return dataQueryOptions({
    queryKey: ["profiles", "stacks", filters, sampleType] as const,
    queryFn: () => repo.stacks(withViewerTimeRange({ ...filters, ...picked(sampleType) })),
    enabled: enabled && sampleType !== undefined,
  });
}

export function profileHistogramOptions({
  repo,
  filters,
  sampleType,
  enabled,
}: SampleTypeInput & { enabled: boolean }) {
  return dataQueryOptions({
    queryKey: ["profiles", "histogram", filters, sampleType] as const,
    queryFn: () => repo.histogram(withViewerTimeRange({ ...filters, ...picked(sampleType) })),
    enabled: enabled && sampleType !== undefined,
    placeholderData: keepPreviousData,
  });
}

export function profileSpanTimelineOptions({
  repo,
  input,
  enabled,
}: {
  repo: ProfilesRepositoryLike;
  input: ProfileSpanTimelineInput;
  enabled: boolean;
}) {
  return dataQueryOptions({
    queryKey: ["profiles", "span-timeline", input] as const,
    queryFn: () => repo.spanTimeline(withViewerTimeRange(input)),
    enabled,
  });
}

export function profileVersionsOptions({
  repo,
  filters,
  enabled,
}: FilterInput & { enabled: boolean }) {
  return dataQueryOptions({
    queryKey: ["profiles", "versions", filters] as const,
    queryFn: () => repo.listVersions(withViewerTimeRange(filters)),
    enabled,
    placeholderData: keepPreviousData,
  });
}

export function profileExampleTracesOptions({
  repo,
  filters,
  sampleType,
  functionName,
}: SampleTypeInput & { functionName: string | undefined }) {
  return dataQueryOptions({
    queryKey: ["profiles", "example-traces", filters, sampleType, functionName] as const,
    queryFn: () =>
      repo.exampleTraces(
        withViewerTimeRange({
          ...filters,
          ...picked(sampleType),
          functionName: functionName ?? "",
        }),
      ),
    enabled: sampleType !== undefined && functionName !== undefined,
  });
}
