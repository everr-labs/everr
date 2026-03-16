import { Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { formatRelativeTime } from "@/lib/formatting";
import { cn } from "@/lib/utils";
import { ConclusionIcon } from "./conclusion-icon";

interface RunHeaderProps {
  runId: string;
  attempts?: number;
  workflowName: string;
  conclusion: string;
  repo: string;
  branch: string;
  timestamp: string;
}

export function RunHeader({
  runId,
  attempts,
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
          to="/dashboard"
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
          {attempts !== undefined && attempts > 1 && (
            <span className="text-muted-foreground ml-1 text-sm font-normal">
              (attempt #{attempts})
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
