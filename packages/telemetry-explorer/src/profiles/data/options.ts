import { getRefreshIntervalMs } from "@everr/ui/components/refresh-picker";
import { keepPreviousData, queryOptions } from "@tanstack/react-query";
import type { ProfilesRepositoryLike } from "./repository";
import type { ProfileFilterInput, ProfileSpanTimelineInput } from "./schemas";

type FilterInput = {
  repo: ProfilesRepositoryLike;
  refresh: string;
  filters: ProfileFilterInput;
};

type SampleTypeInput = FilterInput & {
  sampleType: string | undefined;
  sampleUnit: string | undefined;
};

function refetchInterval(refresh: string) {
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
  sampleUnit,
  enabled = true,
}: SampleTypeInput & { enabled?: boolean }) {
  return queryOptions({
    queryKey: ["profiles", "stacks", filters, sampleType, sampleUnit] as const,
    queryFn: () =>
      repo.stacks({ ...filters, sampleType: sampleType ?? "", sampleUnit: sampleUnit ?? "" }),
    enabled: enabled && sampleType !== undefined && sampleUnit !== undefined,
    refetchInterval: refetchInterval(refresh),
  });
}

export function profileHistogramOptions({
  repo,
  refresh,
  filters,
  sampleType,
  sampleUnit,
  enabled,
}: SampleTypeInput & { enabled: boolean }) {
  return queryOptions({
    queryKey: ["profiles", "histogram", filters, sampleType, sampleUnit] as const,
    queryFn: () =>
      repo.histogram({ ...filters, sampleType: sampleType ?? "", sampleUnit: sampleUnit ?? "" }),
    enabled: enabled && sampleType !== undefined && sampleUnit !== undefined,
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
  sampleUnit,
  functionName,
}: SampleTypeInput & { functionName: string | undefined }) {
  return queryOptions({
    queryKey: [
      "profiles",
      "example-traces",
      filters,
      sampleType,
      sampleUnit,
      functionName,
    ] as const,
    queryFn: () =>
      repo.exampleTraces({
        ...filters,
        sampleType: sampleType ?? "",
        sampleUnit: sampleUnit ?? "",
        functionName: functionName ?? "",
      }),
    enabled: sampleType !== undefined && sampleUnit !== undefined && functionName !== undefined,
    refetchInterval: refetchInterval(refresh),
  });
}
