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
import type { RenderErrorIssueLink } from "./error-issue-row";

export type { RenderErrorIssueLink };

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
  onSearchChange: (patch: Partial<ErrorIssuesSearchValue>) => void;
  renderIssueLink: RenderErrorIssueLink;
};

export function ErrorIssues({
  repo,
  timeRange,
  refresh,
  search,
  environment = [],
  persistentFilters,
  onSearchChange,
  renderIssueLink,
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
            persistentFilterCount={countPersistentFilters(
              search.service,
              environment,
            )}
            onChange={onSearchChange}
          />
          <main className="min-h-0 min-w-0">
            <div className="flex h-full min-h-0 flex-col">
              <ErrorIssueList
                issues={issues}
                isPending={issuesQuery.isPending}
                isError={issuesQuery.isError}
                onRetry={() => issuesQuery.refetch()}
                hasNextPage={issuesQuery.hasNextPage}
                isFetchingNextPage={issuesQuery.isFetchingNextPage}
                onLoadMore={() => issuesQuery.fetchNextPage()}
                renderIssueLink={renderIssueLink}
              />
            </div>
          </main>
        </div>
      </section>
    </div>
  );
}
