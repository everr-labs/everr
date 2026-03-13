import { Link } from "@tanstack/react-router";
import { ConclusionIcon } from "@/components/run-detail/conclusion-icon";
import { Badge } from "@/components/ui/badge";
import { Empty, EmptyDescription } from "@/components/ui/empty";
import type { RunListItem } from "@/data/runs-list";
import { formatDuration, formatRelativeTime } from "@/lib/formatting";

interface RunsTableProps {
  data: RunListItem[];
}

export function RunsTable({ data }: RunsTableProps) {
  if (data.length === 0) {
    return (
      <Empty>
        <EmptyDescription>No runs found</EmptyDescription>
      </Empty>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-muted-foreground">
            <th className="pb-2 pr-4 font-medium">Status</th>
            <th className="pb-2 pr-4 font-medium">Run ID</th>
            <th className="pb-2 pr-4 font-medium">Workflow</th>
            <th className="pb-2 pr-4 font-medium">Repository</th>
            <th className="pb-2 pr-4 font-medium">Branch</th>
            <th className="pb-2 pr-4 font-medium">Duration</th>
            <th className="pb-2 pr-4 font-medium">When</th>
            <th className="pb-2 font-medium">Sender</th>
          </tr>
        </thead>
        <tbody>
          {data.map((run) => (
            <tr
              key={run.traceId}
              className="border-b last:border-0 hover:bg-muted/50"
            >
              <td className="py-2 pr-4">
                <ConclusionIcon
                  conclusion={run.conclusion}
                  className="size-4"
                />
              </td>
              <td className="py-2 pr-4">
                <Link
                  to="/dashboard/runs/$traceId"
                  params={{ traceId: run.traceId }}
                  className="font-mono text-xs hover:underline"
                >
                  {run.runId}
                  {run.runAttempt > 1 && (
                    <span className="text-muted-foreground ml-1">
                      (#{run.runAttempt})
                    </span>
                  )}
                </Link>
              </td>
              <td className="py-2 pr-4 font-medium">{run.workflowName}</td>
              <td className="py-2 pr-4">
                <Link
                  to="/dashboard/repos"
                  search={{ name: run.repo }}
                  className="hover:underline"
                >
                  {run.repo}
                </Link>
              </td>
              <td className="py-2 pr-4">
                <Badge variant="outline">{run.branch}</Badge>
              </td>
              <td className="py-2 pr-4 font-mono text-xs">
                {formatDuration(run.duration, "ms")}
              </td>
              <td className="py-2 pr-4 text-xs text-muted-foreground">
                {formatRelativeTime(run.timestamp)}
              </td>
              <td className="py-2 text-xs text-muted-foreground">
                {run.sender || "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
