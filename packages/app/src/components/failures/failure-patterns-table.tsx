import { Link } from "@tanstack/react-router";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription } from "@/components/ui/empty";
import type { FailurePattern } from "@/data/failures";
import { formatRelativeTime } from "@/lib/formatting";

interface FailurePatternsTableProps {
  data: FailurePattern[];
}

function PatternRow({ pattern }: { pattern: FailurePattern }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <>
      <tr className="border-b hover:bg-muted/50">
        <td className="py-2 pr-4">
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? (
              <ChevronDown className="size-3" />
            ) : (
              <ChevronRight className="size-3" />
            )}
          </Button>
        </td>
        <td className="py-2 pr-4">
          <div
            className="max-w-md truncate font-mono text-xs"
            title={pattern.pattern}
          >
            {pattern.pattern}
          </div>
        </td>
        <td className="py-2 pr-4">
          <Badge variant="destructive">{pattern.count}</Badge>
        </td>
        <td className="py-2 pr-4">
          <div className="flex flex-wrap gap-1">
            {pattern.affectedRepos.map((repo) => (
              <Badge key={repo} variant="outline" className="text-[10px]">
                {repo}
              </Badge>
            ))}
          </div>
        </td>
        <td className="py-2 text-xs text-muted-foreground">
          {formatRelativeTime(pattern.lastOccurrence)}
        </td>
      </tr>
      {expanded && (
        <tr className="border-b bg-muted/30">
          <td />
          <td colSpan={4} className="py-3 pr-4">
            <div className="space-y-2">
              <div className="text-xs text-muted-foreground">Sample Runs:</div>
              <div className="flex flex-wrap gap-2">
                {pattern.sampleTraceIds.map((traceId, idx) => (
                  <Link
                    key={traceId}
                    to="/dashboard/runs/$traceId"
                    params={{ traceId }}
                    className="font-mono text-xs hover:underline"
                  >
                    {pattern.sampleRunIds[idx]}
                    {pattern.sampleJobNames[idx] && (
                      <span className="text-muted-foreground ml-1">
                        ({pattern.sampleJobNames[idx]})
                      </span>
                    )}
                  </Link>
                ))}
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

export function FailurePatternsTable({ data }: FailurePatternsTableProps) {
  if (data.length === 0) {
    return (
      <Empty>
        <EmptyDescription>No failure patterns found</EmptyDescription>
      </Empty>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-muted-foreground">
            <th className="pb-2 pr-4 w-8 font-medium" />
            <th className="pb-2 pr-4 font-medium">Pattern</th>
            <th className="pb-2 pr-4 font-medium">Count</th>
            <th className="pb-2 pr-4 font-medium">Affected Repos</th>
            <th className="pb-2 font-medium">Last Seen</th>
          </tr>
        </thead>
        <tbody>
          {data.map((pattern) => (
            <PatternRow key={pattern.pattern} pattern={pattern} />
          ))}
        </tbody>
      </table>
    </div>
  );
}
