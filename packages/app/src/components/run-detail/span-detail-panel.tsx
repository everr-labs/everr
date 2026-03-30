import { buttonVariants } from "@everr/ui/components/button";
import { cn } from "@everr/ui/lib/utils";
import { Link } from "@tanstack/react-router";
import { Copy, ExternalLink, GitBranch } from "lucide-react";
import { SenderCell } from "@/components/sender-cell";
import { formatDuration } from "@/lib/formatting";
import type { SpanNode } from "./trace-waterfall-utils";
import { stringToColor } from "./trace-waterfall-utils";

interface SpanDetailPanelProps {
  span: SpanNode;
  minTime: number;
  traceId: string;
}

export function SpanDetailPanel({
  span,
  minTime,
  traceId,
}: SpanDetailPanelProps) {
  return (
    <div
      className="border-l-3 bg-muted rounded-r p-3"
      style={{ borderLeftColor: stringToColor(span.name) }}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <h4 className="font-semibold text-sm">{span.name}</h4>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span>
            Duration:{" "}
            <span className="font-medium text-foreground">
              {formatDuration(span.duration, "ms")}
            </span>
          </span>
          <span>
            Start:{" "}
            <span className="font-medium text-foreground">
              {formatDuration(span.startTime - minTime, "ms")}
            </span>
          </span>
        </div>
      </div>

      {/* Tags */}
      <div className="space-y-1.5 text-xs">
        <div className="flex gap-2">
          <span className="text-muted-foreground w-20">Status</span>
          <span className="font-medium capitalize">
            {span.conclusion || "—"}
          </span>
        </div>
        {!span.stepNumber &&
          span.queueTime !== undefined &&
          span.queueTime > 0 && (
            <div className="flex gap-2">
              <span className="text-muted-foreground w-20">Queued</span>
              <span className="font-medium">
                {formatDuration(span.queueTime, "ms")}
              </span>
            </div>
          )}
        {span.jobName && (
          <div className="flex gap-2">
            <span className="text-muted-foreground w-20">Job</span>
            <span className="font-medium">{span.jobName}</span>
          </div>
        )}
        {span.stepNumber && (
          <div className="flex gap-2">
            <span className="text-muted-foreground w-20">Step</span>
            <span className="font-medium">#{span.stepNumber}</span>
          </div>
        )}
        {/* Test-specific attributes */}
        {span.testName && (
          <>
            <div className="flex gap-2">
              <span className="text-muted-foreground w-20">Test</span>
              <span className="font-medium">{span.testName}</span>
            </div>
            <div className="flex gap-2">
              <span className="text-muted-foreground w-20">Result</span>
              <span
                className={cn(
                  "font-medium capitalize",
                  span.testResult === "pass" && "text-green-600",
                  span.testResult === "fail" && "text-red-600",
                  span.testResult === "skip" && "text-yellow-600",
                )}
              >
                {span.testResult}
              </span>
            </div>
            {span.testFramework && (
              <div className="flex gap-2">
                <span className="text-muted-foreground w-20">Framework</span>
                <span className="font-medium">{span.testFramework}</span>
              </div>
            )}
            {span.testLanguage && (
              <div className="flex gap-2">
                <span className="text-muted-foreground w-20">Language</span>
                <span className="font-medium">{span.testLanguage}</span>
              </div>
            )}
            {(span.isSuite || span.isSubtest) && (
              <div className="flex gap-2">
                <span className="text-muted-foreground w-20">Type</span>
                <span className="font-medium">
                  {[span.isSuite && "Suite", span.isSubtest && "Subtest"]
                    .filter(Boolean)
                    .join(", ")}
                </span>
              </div>
            )}
          </>
        )}
        {/* Job-specific attributes */}
        {!span.stepNumber && span.headBranch && (
          <div className="flex gap-2">
            <span className="text-muted-foreground w-20">Branch</span>
            <span className="font-medium flex items-center gap-1">
              <GitBranch className="size-3" />
              {span.headBranch}
            </span>
          </div>
        )}
        {!span.stepNumber && span.headSha && (
          <div className="flex gap-2">
            <span className="text-muted-foreground w-20">SHA</span>
            <span className="font-mono text-[10px] flex items-center gap-1">
              {span.headSha.slice(0, 7)}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  navigator.clipboard.writeText(span.headSha ?? "");
                }}
                className="p-0.5 rounded hover:bg-muted-foreground/20"
                title="Copy full SHA"
              >
                <Copy className="size-3" />
              </button>
            </span>
          </div>
        )}
        {!span.stepNumber && span.runnerName && (
          <div className="flex gap-2">
            <span className="text-muted-foreground w-20">Runner</span>
            <span className="font-medium">{span.runnerName}</span>
          </div>
        )}
        {!span.stepNumber && span.labels && (
          <div className="flex gap-2">
            <span className="text-muted-foreground w-20">Labels</span>
            <span className="font-medium">{span.labels}</span>
          </div>
        )}
        {!span.stepNumber && span.sender && (
          <div className="flex gap-2">
            <span className="text-muted-foreground w-20">Triggered by</span>
            <SenderCell sender={span.sender} className="font-medium" />
          </div>
        )}
        {!span.stepNumber &&
          span.runAttempt !== undefined &&
          span.runAttempt > 1 && (
            <div className="flex gap-2">
              <span className="text-muted-foreground w-20">Attempt</span>
              <span className="font-medium">#{span.runAttempt}</span>
            </div>
          )}
        <div className="flex gap-2">
          <span className="text-muted-foreground w-20">Span ID</span>
          <span className="font-mono text-[10px]">
            {span.spanId.slice(0, 16)}...
          </span>
        </div>
      </div>

      {/* Actions */}
      {(span.stepNumber || span.htmlUrl) && (
        <div className="mt-3 pt-3 border-t flex gap-2">
          {span.stepNumber && span.jobId && (
            <Link
              to="/runs/$traceId/jobs/$jobId/steps/$stepNumber"
              params={{
                traceId,
                jobId: span.jobId,
                stepNumber: span.stepNumber,
              }}
              className={cn(
                buttonVariants({
                  variant: "outline",
                  size: "sm",
                }),
                "h-7 text-xs",
              )}
            >
              View Logs
            </Link>
          )}
          {!span.stepNumber && span.htmlUrl && (
            <a
              href={span.htmlUrl}
              target="_blank"
              rel="noopener noreferrer"
              className={cn(
                buttonVariants({
                  variant: "outline",
                  size: "sm",
                }),
                "h-7 text-xs gap-1",
              )}
            >
              <ExternalLink className="size-3" />
              View on GitHub
            </a>
          )}
        </div>
      )}
    </div>
  );
}
