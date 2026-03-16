import { Link } from "@tanstack/react-router";
import { Copy } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import type { TestExecution } from "@/data/flaky-tests";
import { cn } from "@/lib/utils";

interface FlakyTestTimelineProps {
  data: TestExecution[];
}

function formatDuration(seconds: number): string {
  if (seconds < 1) return `${Math.round(seconds * 1000)}ms`;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.floor(seconds % 60);
  return `${minutes}m ${remainingSeconds}s`;
}

function formatTimestamp(timestamp: string): string {
  return new Date(timestamp).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getResultColor(result: string): string {
  switch (result) {
    case "pass":
      return "text-green-600";
    case "fail":
      return "text-red-600";
    case "skip":
      return "text-yellow-600";
    default:
      return "text-muted-foreground";
  }
}

function getResultBg(result: string): string {
  switch (result) {
    case "pass":
      return "bg-green-100 dark:bg-green-950";
    case "fail":
      return "bg-red-100 dark:bg-red-950";
    case "skip":
      return "bg-yellow-100 dark:bg-yellow-950";
    default:
      return "bg-muted";
  }
}

export function FlakyTestTimeline({ data }: FlakyTestTimelineProps) {
  if (data.length === 0) {
    return (
      <div className="flex h-[200px] items-center justify-center text-muted-foreground text-sm">
        No execution history available
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-muted-foreground">
            <th className="pb-2 pr-4 font-medium">Result</th>
            <th className="pb-2 pr-4 font-medium">Run</th>
            <th className="pb-2 pr-4 font-medium">Branch</th>
            <th className="pb-2 pr-4 font-medium">SHA</th>
            <th className="pb-2 pr-4 font-medium">Duration</th>
            <th className="pb-2 pr-4 font-medium">Runner</th>
            <th className="pb-2 font-medium">Timestamp</th>
          </tr>
        </thead>
        <tbody>
          {data.map((exec, i) => (
            <tr
              // biome-ignore lint/suspicious/noArrayIndexKey: Unique per row in ordered result set
              key={i}
              className="border-b last:border-0 hover:bg-muted/50"
            >
              <td className="py-2 pr-4">
                <span
                  className={cn(
                    "inline-block rounded px-2 py-0.5 text-xs font-medium capitalize",
                    getResultBg(exec.testResult),
                    getResultColor(exec.testResult),
                  )}
                >
                  {exec.testResult}
                </span>
              </td>
              <td className="py-2 pr-4">
                <Link
                  to="/dashboard/runs/$traceId"
                  params={{ traceId: exec.traceId }}
                  className={cn(
                    buttonVariants({ variant: "link", size: "sm" }),
                    "h-auto p-0 text-xs",
                  )}
                >
                  {exec.runId}
                  {exec.runAttempt > 1 && (
                    <span className="text-muted-foreground ml-1">
                      (#{exec.runAttempt})
                    </span>
                  )}
                </Link>
              </td>
              <td className="py-2 pr-4 text-xs">{exec.headBranch}</td>
              <td className="py-2 pr-4">
                <span className="font-mono text-[10px] inline-flex items-center gap-1">
                  {exec.headSha.slice(0, 7)}
                  <button
                    type="button"
                    onClick={() => navigator.clipboard.writeText(exec.headSha)}
                    className="p-0.5 rounded hover:bg-muted-foreground/20"
                    title="Copy full SHA"
                  >
                    <Copy className="size-3" />
                  </button>
                </span>
              </td>
              <td className="py-2 pr-4 font-mono text-xs">
                {formatDuration(exec.testDuration)}
              </td>
              <td className="py-2 pr-4 text-xs">{exec.runnerName || "—"}</td>
              <td className="py-2 text-xs text-muted-foreground">
                {formatTimestamp(exec.timestamp)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
