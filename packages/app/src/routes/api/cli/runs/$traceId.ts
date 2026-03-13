import { createFileRoute } from "@tanstack/react-router";
import {
  emptyRunResourceUsage,
  getRunResourceUsage,
  type ResourceUsageSummary,
} from "@/data/resource-usage";
import { getAllJobsSteps, getRunDetails, getRunJobs } from "@/data/runs";
import { cliAuthMiddleware } from "../-auth";

type CliRunResourceUsage = {
  jobs: Record<string, ResourceUsageSummary>;
  steps: Record<string, Record<string, ResourceUsageSummary>>;
};

function toCliRunResourceUsage(
  resourceUsage: Awaited<ReturnType<typeof getRunResourceUsage>>,
): CliRunResourceUsage {
  return {
    jobs: Object.fromEntries(
      Object.entries(resourceUsage.jobs).map(([jobId, usage]) => [
        jobId,
        usage.summary,
      ]),
    ),
    steps: Object.fromEntries(
      Object.entries(resourceUsage.steps).map(([jobId, stepUsage]) => [
        jobId,
        Object.fromEntries(
          Object.entries(stepUsage).map(([stepNumber, usage]) => [
            stepNumber,
            usage.summary,
          ]),
        ),
      ]),
    ),
  };
}

export const Route = createFileRoute("/api/cli/runs/$traceId")({
  server: {
    middleware: [cliAuthMiddleware],
    handlers: {
      GET: async ({ params }) => {
        const traceId = params.traceId;
        if (!traceId) {
          return Response.json(
            { error: "Missing traceId path parameter." },
            { status: 400 },
          );
        }

        const [run, jobs] = await Promise.all([
          getRunDetails({ data: traceId }),
          getRunJobs({ data: traceId }),
        ]);

        if (!run) {
          return Response.json({ error: "Run not found" }, { status: 404 });
        }

        const jobIds = jobs.map((j) => j.jobId);
        const steps =
          jobIds.length > 0
            ? await getAllJobsSteps({ data: { traceId, jobIds } })
            : {};
        const resourceUsage =
          jobIds.length > 0
            ? await getRunResourceUsage({
                traceId,
                runId: run.runId,
                runAttempt: run.runAttempt,
                stepsByJobId: steps,
              })
            : emptyRunResourceUsage();

        return Response.json({
          run,
          jobs,
          steps,
          resourceUsage: toCliRunResourceUsage(resourceUsage),
        });
      },
    },
  },
});
