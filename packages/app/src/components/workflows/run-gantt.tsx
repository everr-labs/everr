import { ConclusionIcon } from "@everr/telemetry-explorer/runs";
import { Button } from "@everr/ui/components/button";
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from "@everr/ui/components/card";
import { Empty, EmptyDescription } from "@everr/ui/components/empty";
import { ScrollArea } from "@everr/ui/components/scroll-area";
import { Skeleton } from "@everr/ui/components/skeleton";
import { formatDuration } from "@everr/ui/lib/formatting";
import { formatRelativeTime } from "@everr/ui/lib/timestamp";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { AlertCircle, ChevronLeft, ChevronRight } from "lucide-react";
import { useState } from "react";
import { workflowRunTimelinesOptions } from "@/data/workflows/options";
import type { WorkflowRunGantt } from "@/data/workflows/schemas";
import { useTimeRange } from "@/hooks/use-time-range";
import { formatCost } from "@/lib/runner-pricing";

interface WorkflowJobTimelineProps {
  workflowName: string;
  repo: string;
}

const BAR_BG: Record<string, string> = {
  success: "bg-green-600",
  failure: "bg-red-600",
  in_progress: "bg-yellow-500",
  queued: "bg-blue-500",
  waiting: "bg-blue-500",
  requested: "bg-blue-500",
};

export function WorkflowJobTimeline({
  workflowName,
  repo,
}: WorkflowJobTimelineProps) {
  const { timeRange } = useTimeRange();
  const { data, isPending, isError } = useQuery(
    workflowRunTimelinesOptions({ timeRange, workflowName, repo }),
  );
  // Track the shown run by trace id: when the run set changes (new time range)
  // the id falls out of the list and we cleanly snap back to the newest run —
  // no effect-driven state reset needed.
  const [selectedTraceId, setSelectedTraceId] = useState<string | null>(null);

  const runs = data ?? [];
  const foundIndex = runs.findIndex((r) => r.traceId === selectedTraceId);
  const index = foundIndex >= 0 ? foundIndex : 0;
  const run = runs[index];
  const isNewest = index === 0;
  const isOldest = index === runs.length - 1;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Job timeline</CardTitle>
        {run && (
          <CardAction>
            {/* biome-ignore lint/a11y/noStaticElementInteractions: arrow-key stepping while a nav button is focused */}
            <div
              className="flex items-center gap-3 text-xs"
              onKeyDown={(e) => {
                if (e.key === "ArrowLeft" && !isNewest) {
                  e.preventDefault();
                  setSelectedTraceId(runs[index - 1].traceId);
                } else if (e.key === "ArrowRight" && !isOldest) {
                  e.preventDefault();
                  setSelectedTraceId(runs[index + 1].traceId);
                }
              }}
            >
              <div className="flex items-center gap-3 text-muted-foreground tabular-nums">
                <span>
                  total{" "}
                  <span className="text-foreground">
                    {formatDuration(run.wallClockMs, "ms")}
                  </span>
                </span>
                <span className="font-mono text-foreground">
                  {formatCost(run.estimatedCost)}
                </span>
              </div>
              <div className="flex items-center gap-1">
                <Button
                  variant="outline"
                  size="icon-sm"
                  aria-label="Newer run"
                  disabled={isNewest}
                  onClick={() => setSelectedTraceId(runs[index - 1].traceId)}
                >
                  <ChevronLeft />
                </Button>
                <span className="w-10 text-center text-muted-foreground tabular-nums">
                  {index + 1}/{runs.length}
                </span>
                <Button
                  variant="outline"
                  size="icon-sm"
                  aria-label="Older run"
                  disabled={isOldest}
                  onClick={() => setSelectedTraceId(runs[index + 1].traceId)}
                >
                  <ChevronRight />
                </Button>
              </div>
            </div>
          </CardAction>
        )}
      </CardHeader>
      <CardContent className="min-h-0 flex-1">
        {isPending ? (
          <Skeleton className="h-40 w-full" />
        ) : isError ? (
          <div className="flex h-40 flex-col items-center justify-center gap-2 text-muted-foreground">
            <AlertCircle className="size-8" />
            <p className="text-sm">Failed to load data</p>
          </div>
        ) : run ? (
          <RunLanes run={run} />
        ) : (
          <Empty>
            <EmptyDescription>No recent run with job timing</EmptyDescription>
          </Empty>
        )}
      </CardContent>
    </Card>
  );
}

function RunLanes({ run }: { run: WorkflowRunGantt }) {
  const span = run.wallClockMs;
  const toPct = (ms: number) =>
    span > 0 ? ((ms - run.startMs) / span) * 100 : 0;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-xs">
        <ConclusionIcon conclusion={run.conclusion} className="size-4" />
        <Link
          to="/runs/$traceId"
          params={{ traceId: run.traceId }}
          className="font-mono hover:underline"
        >
          {run.runId}
          {run.runAttempt > 1 && (
            <span className="ml-1 text-muted-foreground">
              (#{run.runAttempt})
            </span>
          )}
        </Link>
        <span className="text-muted-foreground">
          {formatRelativeTime(run.timestamp)}
        </span>
      </div>

      <ScrollArea className="max-h-[320px]" viewportClassName="space-y-1">
        {run.jobs.map((job) => {
          const left = toPct(job.startMs);
          const width = Math.max(toPct(job.endMs) - left, 1.5);
          return (
            <div key={job.jobId} className="flex items-center gap-2">
              <ConclusionIcon
                conclusion={job.conclusion}
                className="size-3.5 shrink-0"
              />
              <span
                className="w-36 shrink-0 truncate text-xs text-muted-foreground"
                title={job.name}
              >
                {job.name}
              </span>
              <div className="relative h-5 min-w-0 flex-1 rounded-sm bg-muted/40">
                <div
                  className={`absolute inset-y-0.5 rounded-[3px] ${
                    BAR_BG[job.conclusion] ?? "bg-muted-foreground"
                  }`}
                  style={{ left: `${left}%`, width: `${width}%` }}
                  title={`${job.name} · ${job.conclusion} · ${formatDuration(job.durationMs, "ms")} · ${formatCost(job.estimatedCost)}`}
                />
              </div>
              <span className="w-14 shrink-0 text-right font-mono text-[11px] text-muted-foreground tabular-nums">
                {formatDuration(job.durationMs, "ms")}
              </span>
            </div>
          );
        })}
      </ScrollArea>
    </div>
  );
}
