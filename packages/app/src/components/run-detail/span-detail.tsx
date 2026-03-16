import { Link } from "@tanstack/react-router";
import { X } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { Span } from "@/data/runs";
import { formatDuration } from "@/lib/formatting";
import { cn } from "@/lib/utils";
import { ConclusionIcon } from "./conclusion-icon";

interface SpanDetailProps {
  span: Span;
  traceId: string;
  onClose: () => void;
}

function formatTimestamp(ms: number): string {
  return new Date(ms).toLocaleString();
}

export function SpanDetail({ span, traceId, onClose }: SpanDetailProps) {
  const isStep = !!span.stepNumber;

  return (
    <Card size="sm">
      <CardHeader className="flex-row items-start justify-between space-y-0">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <ConclusionIcon conclusion={span.conclusion} className="size-4" />
            <CardTitle className="text-base">{span.name}</CardTitle>
          </div>
          <CardDescription>
            {isStep ? `Step ${span.stepNumber}` : "Job"} •{" "}
            {formatDuration(span.duration, "ms")}
          </CardDescription>
        </div>
        <button
          type="button"
          onClick={onClose}
          className={cn(
            buttonVariants({ variant: "ghost", size: "sm" }),
            "h-7 w-7 p-0",
          )}
        >
          <X className="size-4" />
        </button>
      </CardHeader>
      <CardContent>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
          <dt className="text-muted-foreground">Status</dt>
          <dd className="font-medium capitalize">{span.conclusion || "—"}</dd>

          <dt className="text-muted-foreground">Duration</dt>
          <dd className="font-medium">{formatDuration(span.duration, "ms")}</dd>

          <dt className="text-muted-foreground">Started</dt>
          <dd className="font-medium">{formatTimestamp(span.startTime)}</dd>

          <dt className="text-muted-foreground">Ended</dt>
          <dd className="font-medium">{formatTimestamp(span.endTime)}</dd>

          {span.jobName && (
            <>
              <dt className="text-muted-foreground">Job</dt>
              <dd className="font-medium">{span.jobName}</dd>
            </>
          )}
        </dl>

        {isStep && span.jobId && span.stepNumber && (
          <div className="mt-4 pt-4 border-t">
            <Link
              to="/runs/$traceId/jobs/$jobId/steps/$stepNumber"
              params={{
                traceId,
                jobId: span.jobId,
                stepNumber: span.stepNumber,
              }}
              className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
            >
              View Logs
            </Link>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
