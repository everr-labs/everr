import { createFileRoute } from "@tanstack/react-router";
import { getAllJobsSteps, getRunDetails, getRunJobs } from "@/data/runs";
import { cliTokenAuthMiddleware } from "../-token-auth";

export const Route = createFileRoute("/api/cli/runs/$traceId")({
  server: {
    middleware: [cliTokenAuthMiddleware],
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

        return Response.json({ run, jobs, steps });
      },
    },
  },
});
