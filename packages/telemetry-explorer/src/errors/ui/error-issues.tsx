import type { TimeRange } from "@everr/ui/lib/time-range";
import { keepPreviousData, useInfiniteQuery } from "@tanstack/react-query";
import { type ReactNode, useMemo } from "react";
import { withEnvironment } from "../../filters/environment";
import { countPersistentFilters } from "../../filters/ui/explore-global-filters";
import { errorIssuesInfiniteOptions } from "../data/options";
import type { ErrorsRepositoryLike } from "../data/repository";
import type { AttributeFilter } from "../data/schemas";
import { PAGE_SIZE } from "../data/schemas";
import type { ErrorSort } from "../data/types";
import { ErrorFilters } from "./error-filters";
import { ErrorIssueList } from "./error-issue-list";
import type { RenderErrorIssueLink, RenderErrorTracked } from "./error-issue-row";

export type { RenderErrorIssueLink, RenderErrorTracked };

export type ErrorIssuesSearchValue = {
  q: string;
  service: string[];
  fingerprint: string;
  sort: ErrorSort;
  attributes: AttributeFilter[];
};

export type ErrorIssuesProps = {
  repo: ErrorsRepositoryLike;
  timeRange: TimeRange;
  refresh: string;
  search: ErrorIssuesSearchValue;
  environment?: string[];
  // The top zone of the rail: Service and Environment. The host app supplies it,
  // because the two values are search params that the pages share.
  persistentFilters?: ReactNode;
  // Above the list: the host app's actions on errors as a whole.
  banner?: ReactNode;
  onSearchChange: (patch: Partial<ErrorIssuesSearchValue>) => void;
  renderIssueLink: RenderErrorIssueLink;
  // Beside each Error: what the host app tracks for it.
  renderTracked?: RenderErrorTracked;
};

export function ErrorIssues({
  repo,
  timeRange,
  refresh,
  search,
  environment = [],
  persistentFilters,
  banner,
  onSearchChange,
  renderIssueLink,
  renderTracked,
}: ErrorIssuesProps) {
  const issuesQuery = useInfiniteQuery({
    ...errorIssuesInfiniteOptions(repo, {
      timeRange,
      refresh,
      q: search.q,
      service: search.service,
      fingerprint: search.fingerprint,
      sort: search.sort,
      limit: PAGE_SIZE,
      attributes: withEnvironment(search.attributes, environment),
    }),
    placeholderData: keepPreviousData,
  });
  const issues = useMemo(
    () => (issuesQuery.data?.pages ?? []).flatMap((page) => page?.issues ?? []),
    [issuesQuery.data],
  );

  return (
    <div className="min-h-0 flex-1 overflow-hidden">
      <section className="bg-background text-foreground flex h-full min-h-0 flex-col overflow-hidden">
        <div className="grid min-h-0 flex-1 grid-cols-1 grid-rows-[auto_minmax(0,1fr)] lg:grid-cols-[260px_minmax(0,1fr)] lg:grid-rows-[minmax(0,1fr)]">
          <ErrorFilters
            repo={repo}
            timeRange={timeRange}
            value={search}
            persistentFilters={persistentFilters}
            persistentFilterCount={countPersistentFilters(search.service, environment)}
            onChange={onSearchChange}
          />
          <main className="flex min-h-0 min-w-0 flex-col">
            {banner}
            <ErrorIssueList
              issues={issues}
              isPending={issuesQuery.isPending}
              isError={issuesQuery.isError}
              error={issuesQuery.error}
              // oxlint-disable-next-line typescript/no-misused-promises -- Preserve the existing async callback and its promise result; the caller already controls its use.
              onRetry={() => issuesQuery.refetch()}
              hasNextPage={issuesQuery.hasNextPage}
              isFetchingNextPage={issuesQuery.isFetchingNextPage}
              // oxlint-disable-next-line typescript/no-misused-promises -- Preserve the existing async callback and its promise result; the caller already controls its use.
              onLoadMore={() => issuesQuery.fetchNextPage()}
              // The same effect as "Clear page filters" in the rail. The sort
              // order, Service and Environment keep their values, so with no
              // page filter set the button would change nothing.
              onClearFilters={
                search.q || search.attributes.length > 0
                  ? () => onSearchChange({ q: "", attributes: [] })
                  : undefined
              }
              renderIssueLink={renderIssueLink}
              renderTracked={renderTracked}
            />
          </main>
        </div>
      </section>
    </div>
  );
}
