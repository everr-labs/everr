import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { getStepLogs } from "@/data/runs";
import { cliTokenAuthMiddleware } from "../../-token-auth";

const StepLogsQuerySchema = z.object({
  jobName: z.string().min(1),
  stepNumber: z.string().min(1),
  fullLogs: z
    .string()
    .transform((value) => value === "true" || value === "1")
    .optional(),
});

export const Route = createFileRoute("/api/cli/runs/$traceId/logs")({
  server: {
    middleware: [cliTokenAuthMiddleware],
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
        const parsed = StepLogsQuerySchema.safeParse({
          jobName: url.searchParams.get("jobName") ?? undefined,
          stepNumber: url.searchParams.get("stepNumber") ?? undefined,
          fullLogs: url.searchParams.get("fullLogs") ?? undefined,
        });

        if (!parsed.success) {
          return Response.json(
            {
              error:
                "Invalid query parameters. Required: jobName, stepNumber. Optional: fullLogs=true|false.",
            },
            { status: 400 },
          );
        }

        const logs = await getStepLogs({
          data: {
            traceId,
            jobName: parsed.data.jobName,
            stepNumber: parsed.data.stepNumber,
            fullLogs: parsed.data.fullLogs,
          },
        });

        return Response.json(logs);
      },
    },
  },
});
