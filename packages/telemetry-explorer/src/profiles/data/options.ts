import { getRefreshIntervalMs } from "@everr/ui/components/refresh-picker";
import { keepPreviousData, queryOptions, skipToken } from "@tanstack/react-query";
import type { ProfilesRepositoryLike } from "./repository";
import type { ProfileFilterInput, ProfileSpanTimelineInput } from "./schemas";
import type { SampleTypeOption } from "./types";

type FilterInput = {
  repo: ProfilesRepositoryLike;
  refresh: string;
  filters: ProfileFilterInput;
};

type SampleTypeInput = FilterInput & {
  /** The queries wait while it is absent. */
  sampleType: SampleTypeOption | undefined;
};

export function refetchInterval(refresh: string) {
  const refreshMs = getRefreshIntervalMs(refresh);
  return refreshMs && refreshMs > 0 ? refreshMs : false;
}

export function profileSampleTypesOptions({ repo, refresh, filters }: FilterInput) {
  return queryOptions({
    queryKey: ["profiles", "sample-types", filters] as const,
    queryFn: () => repo.listSampleTypes(filters),
    refetchInterval: refetchInterval(refresh),
    placeholderData: keepPreviousData,
  });
}

export function profileStacksOptions({
  repo,
  refresh,
  filters,
  sampleType,
  enabled = true,
}: SampleTypeInput & { enabled?: boolean }) {
  return queryOptions({
    queryKey: ["profiles", "stacks", filters, sampleType] as const,
    queryFn: enabled && sampleType ? () => repo.stacks({ ...filters, ...sampleType }) : skipToken,
    refetchInterval: refetchInterval(refresh),
  });
}

export function profileHistogramOptions({
  repo,
  refresh,
  filters,
  sampleType,
  enabled,
}: SampleTypeInput & { enabled: boolean }) {
  return queryOptions({
    queryKey: ["profiles", "histogram", filters, sampleType] as const,
    queryFn:
      enabled && sampleType ? () => repo.histogram({ ...filters, ...sampleType }) : skipToken,
    refetchInterval: refetchInterval(refresh),
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
  return queryOptions({
    queryKey: ["profiles", "span-timeline", input] as const,
    queryFn: () => repo.spanTimeline(input),
    enabled,
  });
}

export function profileVersionsOptions({
  repo,
  refresh,
  filters,
  enabled,
}: FilterInput & { enabled: boolean }) {
  return queryOptions({
    queryKey: ["profiles", "versions", filters] as const,
    queryFn: () => repo.listVersions(filters),
    enabled,
    refetchInterval: refetchInterval(refresh),
    placeholderData: keepPreviousData,
  });
}

export function profileExampleTracesOptions({
  repo,
  refresh,
  filters,
  sampleType,
  functionName,
}: SampleTypeInput & { functionName: string | undefined }) {
  return queryOptions({
    queryKey: ["profiles", "example-traces", filters, sampleType, functionName] as const,
    queryFn:
      sampleType && functionName !== undefined
        ? () => repo.exampleTraces({ ...filters, ...sampleType, functionName })
        : skipToken,
    refetchInterval: refetchInterval(refresh),
  });
}
