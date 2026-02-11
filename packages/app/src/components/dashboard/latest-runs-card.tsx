import { Link } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";
import { ConclusionIcon } from "@/components/run-detail/conclusion-icon";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { Run } from "@/data/runs";
import { formatRelativeTime } from "@/lib/formatting";

interface LatestRunsCardProps {
  runs: Run[];
  isLoading?: boolean;
}

export function LatestRunsCard({ runs, isLoading }: LatestRunsCardProps) {
  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-3 w-40" />
        </CardHeader>
        <CardContent className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: Static skeleton items
            <div key={i} className="flex items-center justify-between">
              <div className="space-y-1">
                <Skeleton className="h-4 w-48" />
                <Skeleton className="h-3 w-32" />
              </div>
              <Skeleton className="size-4" />
            </div>
          ))}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Latest Runs</CardTitle>
          <Link
            to="/dashboard/runs"
            search={{
              from: "now-7d",
              to: "now",
              page: 1,
              repo: undefined,
              branch: undefined,
              conclusion: undefined,
              workflowName: undefined,
              runId: undefined,
            }}
            className="text-muted-foreground hover:text-foreground text-xs"
          >
            View all
          </Link>
        </div>
        <CardDescription>Recent workflow executions</CardDescription>
      </CardHeader>
      <CardContent>
        {runs.length === 0 ? (
          <p className="text-muted-foreground text-sm">No runs found</p>
        ) : (
          <div className="space-y-3">
            {runs.map((run) => (
              <Link
                key={run.traceId}
                to="/dashboard/runs/$traceId"
                params={{ traceId: run.traceId }}
                className="hover:bg-muted/50 -mx-2 flex items-center justify-between rounded-md px-2 py-2 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <ConclusionIcon
                    conclusion={run.conclusion}
                    className="size-4"
                  />
                  <div className="flex flex-col">
                    <span className="text-sm font-medium">
                      {run.workflowName}
                    </span>
                    <span className="text-muted-foreground text-xs">
                      {run.repo} • {run.branch}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground text-xs">
                    {formatRelativeTime(run.timestamp)}
                  </span>
                  <ChevronRight className="text-muted-foreground size-4" />
                </div>
              </Link>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
