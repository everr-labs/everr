import { buttonVariants } from "@everr/ui/components/button";
import { cn } from "@everr/ui/lib/utils";
import { Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { formatRelativeTime } from "@/lib/formatting";
import { ConclusionIcon } from "./conclusion-icon";

interface RunHeaderProps {
  runId: string;
  runAttempt?: number;
  workflowName: string;
  conclusion: string;
  repo: string;
  branch: string;
  timestamp: string;
}

export function RunHeader({
  runId,
  runAttempt,
  workflowName,
  conclusion,
  repo,
  branch,
  timestamp,
}: RunHeaderProps) {
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-3">
        <Link
          to="/"
          className={cn(
            buttonVariants({ variant: "ghost", size: "sm" }),
            "h-7 px-2",
          )}
        >
          <ArrowLeft className="size-4" />
        </Link>
        <ConclusionIcon conclusion={conclusion} className="size-5" />
        <h1 className="text-lg font-semibold tracking-tight">
          {workflowName} #{runId}
          {runAttempt !== undefined && runAttempt > 1 && (
            <span className="text-muted-foreground ml-1 text-sm font-normal">
              (attempt #{runAttempt})
            </span>
          )}
        </h1>
      </div>
      <p className="text-muted-foreground ml-14 text-xs">
        {repo} • {branch} • {formatRelativeTime(timestamp)}
      </p>
    </div>
  );
}
