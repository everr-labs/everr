import { Button } from "@everr/ui/components/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@everr/ui/components/empty";
import { Skeleton } from "@everr/ui/components/skeleton";
import { RefreshCw } from "lucide-react";
import type { ErrorIssueSummary } from "@/data/errors/types";
import { ErrorIssueRow, type RenderErrorIssueLink } from "./error-issue-row";

export function ErrorIssueList({
  issues,
  isPending,
  isError,
  onRetry,
  renderIssueLink,
}: {
  issues: ErrorIssueSummary[];
  isPending: boolean;
  isError: boolean;
  onRetry: () => void;
  renderIssueLink: RenderErrorIssueLink;
}) {
  if (isPending) {
    return (
      <div className="flex flex-col">
        {Array.from({ length: 8 }).map((_, index) => (
          <div key={index} className="border-b px-3 py-2.5">
            <div className="flex items-start gap-3">
              <Skeleton className="size-7" />
              <div className="min-w-0 flex-1">
                <Skeleton className="h-4 w-56" />
                <Skeleton className="mt-2 h-3 w-96 max-w-full" />
                <Skeleton className="mt-3 h-5 w-64 max-w-full" />
              </div>
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <Empty className="min-h-60 border-0">
        <EmptyHeader>
          <EmptyTitle>Failed to load errors</EmptyTitle>
          <EmptyDescription>Refresh the list and try again.</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button type="button" variant="outline" onClick={onRetry}>
            <RefreshCw data-icon="inline-start" />
            Retry
          </Button>
        </EmptyContent>
      </Empty>
    );
  }

  if (issues.length === 0) {
    return (
      <Empty className="min-h-60 border-0">
        <EmptyHeader>
          <EmptyTitle>No exception logs found</EmptyTitle>
          <EmptyDescription>
            No grouped error issues match the selected filters.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <ul className="min-w-0 list-none p-0">
      {issues.map((issue) => (
        <ErrorIssueRow
          key={issue.fingerprint}
          issue={issue}
          renderIssueLink={renderIssueLink}
        />
      ))}
    </ul>
  );
}
