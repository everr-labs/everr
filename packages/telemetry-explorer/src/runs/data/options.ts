import { inViewerTimeRange, viewerBucketWindow } from "@everr/ui/lib/time-range";
import { infiniteQueryOptions, queryOptions } from "@tanstack/react-query";
import type { RunsExplorerInput, RunsFilter, RunsHistogramInput } from "../schemas";
import type { RunsRepositoryLike } from "./repository";

// Offset-based infinite scroll: each page advances the offset by the number of
// rows already loaded and stops once a short page comes back. Only the first
// page requests the total (for the footer count).
export function runsExplorerInfiniteOptions(
  repo: RunsRepositoryLike,
  input: Omit<RunsExplorerInput, "offset" | "includeTotalCount">,
) {
  return infiniteQueryOptions({
    queryKey: ["runs", "explorer", "infinite", input] as const,
    queryFn: ({ pageParam }: { pageParam: number }) =>
      inViewerTimeRange(input.timeRange, { runs: [], totalCount: 0 }, (timeRange) =>
        repo.explorer({
          ...input,
          timeRange,
          offset: pageParam,
          includeTotalCount: pageParam === 0,
        }),
      ),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) => {
      if (!lastPage || lastPage.runs.length < input.limit) return undefined;
      return allPages.reduce((count, page) => count + page.runs.length, 0);
    },
  });
}

export function runsHistogramOptions(
  repo: RunsRepositoryLike,
  input: Omit<RunsHistogramInput, "utcOffsetMinutes">,
) {
  return queryOptions({
    queryKey: ["runs", "histogram", input] as const,
    queryFn: () =>
      inViewerTimeRange(input.timeRange, [], () =>
        repo.histogram({ ...input, ...viewerBucketWindow(input.timeRange) }),
      ),
  });
}

// Plain object (not queryOptions) so consumers can spread it and add a `select`
// while keeping `queryFn` required — the FilterCombobox needs that exact shape.
export function runsFilterOptions(repo: RunsRepositoryLike, input: Pick<RunsFilter, "timeRange">) {
  return {
    queryKey: ["runs", "filterOptions", input] as const,
    queryFn: () =>
      inViewerTimeRange(
        input.timeRange,
        { repos: [], branches: [], workflowNames: [] },
        (timeRange) => repo.filterOptions({ ...input, timeRange }),
      ),
  };
}
