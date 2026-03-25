import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@everr/ui/components/collapsible";
import { cn } from "@everr/ui/lib/utils";
import { Link } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";
import type { Job, Step } from "@/data/runs/schemas";
import { formatDuration } from "@/lib/formatting";
import { ConclusionIcon } from "./conclusion-icon";

interface JobTreeNavProps {
  jobs: Job[];
  stepsByJobId: Record<string, Step[]>;
  traceId: string;
  selectedJobId?: string;
}

export function JobTreeNav({
  jobs,
  stepsByJobId,
  traceId,
  selectedJobId,
}: JobTreeNavProps) {
  if (jobs.length === 0) {
    return <p className="text-muted-foreground px-2 text-xs">No jobs found</p>;
  }

  return (
    <div className="space-y-0.5">
      {jobs.map((job) => {
        const steps = stepsByJobId[job.jobId] ?? [];

        return (
          <Collapsible
            key={job.jobId}
            defaultOpen={selectedJobId === job.jobId}
          >
            <CollapsibleTrigger className="group flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-sm transition-colors hover:bg-muted">
              <ChevronRight className="size-3.5 shrink-0 opacity-60 transition-transform group-data-[panel-open]:rotate-90" />
              <ConclusionIcon
                conclusion={job.conclusion}
                className="size-3.5 shrink-0"
              />
              <span className="truncate">{job.name}</span>
              <span className="ml-auto shrink-0 opacity-60">
                {formatDuration(job.duration, "ms")}
              </span>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="ml-3 space-y-px border-l pl-2">
                {steps.map((step) => {
                  return (
                    <Link
                      key={step.stepNumber}
                      to="/runs/$traceId/jobs/$jobId/steps/$stepNumber"
                      params={{
                        traceId,
                        jobId: job.jobId,
                        stepNumber: step.stepNumber,
                      }}
                      className={cn(
                        "flex w-full items-center justify-between rounded px-2 py-0.5 text-left text-xs transition-colors",
                      )}
                      inactiveProps={{
                        className: "hover:bg-muted",
                      }}
                      activeProps={{
                        className: "bg-primary text-primary-foreground",
                      }}
                    >
                      <div className="flex min-w-0 items-center gap-1.5">
                        <ConclusionIcon
                          conclusion={step.conclusion}
                          className="size-3 shrink-0"
                        />
                        <span className="truncate">{step.name}</span>
                      </div>
                      <span className="ml-2 shrink-0 opacity-60">
                        {formatDuration(step.duration, "ms")}
                      </span>
                    </Link>
                  );
                })}
                {steps.length === 0 && (
                  <p className="text-muted-foreground px-2 py-1 text-xs">
                    No steps
                  </p>
                )}
              </div>
            </CollapsibleContent>
          </Collapsible>
        );
      })}
    </div>
  );
}
