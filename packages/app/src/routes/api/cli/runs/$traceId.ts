import { createFileRoute } from "@tanstack/react-router";
import { isFailureConclusion } from "@/data/runs/schemas";
import { getAllJobsSteps, getRunDetails, getRunJobs } from "@/data/runs/server";

export const Route = createFileRoute("/api/cli/runs/$traceId")({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        const traceId = params.traceId;
        if (!traceId) {
          return Response.json(
            { error: "Missing traceId path parameter." },
            { status: 400 },
          );
        }

        const url = new URL(request.url);
        const failedOnly = url.searchParams.get("failed") === "true";

        const [run, jobs] = await Promise.all([
          getRunDetails({ data: traceId }),
          getRunJobs({ data: traceId }),
        ]);

        if (!run) {
          return Response.json({ error: "Run not found" }, { status: 404 });
        }

        const filteredJobs = failedOnly
          ? jobs.filter((j) => isFailureConclusion(j.conclusion))
          : jobs;

        const jobIds = filteredJobs.map((j) => j.jobId);
        const steps =
          jobIds.length > 0
            ? await getAllJobsSteps({ data: { traceId, jobIds } })
            : {};

        const enrichedJobs = filteredJobs.map((job) => {
          const jobSteps = (steps[job.jobId] ?? []).map((s) => ({
            stepNumber: Number(s.stepNumber),
            name: s.name,
            conclusion: s.conclusion,
            duration: s.duration,
          }));

          return {
            ...job,
            steps: failedOnly
              ? jobSteps.filter((s) => isFailureConclusion(s.conclusion))
              : jobSteps,
          };
        });

        return Response.json({ run, jobs: enrichedJobs });
      },
    },
  },
});
