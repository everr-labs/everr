import { ConclusionIcon, SenderCell } from "@everr/telemetry-explorer/runs";
import { Empty, EmptyDescription } from "@everr/ui/components/empty";
import { RelativeTime } from "@everr/ui/components/relative-time";
import { Link } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";
import type { RepoRecentRun } from "#app/data/repo-detail/schemas.ts";

interface RepoRecentRunsProps {
  data: RepoRecentRun[];
}

export function RepoRecentRuns({ data }: RepoRecentRunsProps) {
  if (data.length === 0) {
    return (
      <Empty>
        <EmptyDescription>No recent runs</EmptyDescription>
      </Empty>
    );
  }

  return (
    <div className="space-y-3">
      {data.map((run) => (
        <Link
          key={run.traceId}
          to="/runs/$traceId"
          params={{ traceId: run.traceId }}
          className="hover:bg-muted/50 -mx-2 flex items-center justify-between rounded-md px-2 py-2 transition-colors"
        >
          <div className="flex items-center gap-3">
            <ConclusionIcon conclusion={run.conclusion} className="size-4" />
            <div className="flex flex-col">
              <span className="text-sm font-medium">{run.workflowName}</span>
              <span className="text-muted-foreground text-xs">
                {run.branch}
                {run.sender && (
                  <>
                    {" • "}
                    <SenderCell sender={run.sender} />
                  </>
                )}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground text-xs">
              <RelativeTime timestamp={run.timestamp} />
            </span>
            <ChevronRight className="text-muted-foreground size-4" />
          </div>
        </Link>
      ))}
    </div>
  );
}
