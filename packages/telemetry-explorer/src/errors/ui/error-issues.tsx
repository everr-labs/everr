import type { TimeRange } from "@everr/ui/lib/time-range";
import {
  keepPreviousData,
  useInfiniteQuery,
  useQuery,
} from "@tanstack/react-query";
import { useMemo } from "react";
import {
  errorIssuesInfiniteOptions,
  errorServicesOptions,
} from "../data/options";
import type { ErrorsRepositoryLike } from "../data/repository";
import type { AttributeFilter } from "../data/schemas";
import { PAGE_SIZE } from "../data/schemas";
import type { ErrorSort } from "../data/types";
import { ErrorFilters, ErrorSearchForm } from "./error-filters";
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
  onSearchChange: (patch: Partial<ErrorIssuesSearchValue>) => void;
  renderIssueLink: RenderErrorIssueLink;
};

export function ErrorIssues({
  repo,
  timeRange,
  refresh,
  search,
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
      attributes: search.attributes,
    }),
    placeholderData: keepPreviousData,
  });
  const issues = useMemo(
    () => (issuesQuery.data?.pages ?? []).flatMap((page) => page?.issues ?? []),
    [issuesQuery.data],
  );
  const servicesQuery = useQuery(
    errorServicesOptions(repo, {
      timeRange,
      refresh,
      attributes: search.attributes,
    }),
  );

  return (
    <div className="min-h-0 flex-1 overflow-hidden">
      <section className="bg-background text-foreground flex h-full min-h-0 flex-col overflow-hidden">
        <div className="border-b bg-muted/10 px-3 py-2">
          <ErrorSearchForm
            value={search.q}
            onChange={(q) => onSearchChange({ q })}
          />
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-1 grid-rows-[auto_minmax(0,1fr)] lg:grid-cols-[260px_minmax(0,1fr)] lg:grid-rows-[minmax(0,1fr)]">
          <ErrorFilters
            repo={repo}
            timeRange={timeRange}
            value={search}
            services={servicesQuery.data ?? []}
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
