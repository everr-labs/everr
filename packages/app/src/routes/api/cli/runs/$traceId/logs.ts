import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { getStepLogs } from "@/data/runs/server";
import { cliAuthMiddleware } from "../../-auth";

const StepLogsQuerySchema = z
  .object({
    jobName: z.string().min(1),
    stepNumber: z.string().min(1),
    fullLogs: z
      .string()
      .transform((value) => value === "true" || value === "1")
      .optional(),
    limit: z.coerce.number().int().min(1).max(5000).optional(),
    offset: z.coerce.number().int().min(0).optional(),
  })
  .refine(
    (value) =>
      value.fullLogs !== true ||
      (value.limit === undefined && value.offset === undefined),
    {
      message: "Provide either fullLogs or limit/offset paging, not both.",
      path: ["fullLogs"],
    },
  );

export const Route = createFileRoute("/api/cli/runs/$traceId/logs")({
  server: {
    middleware: [cliAuthMiddleware],
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
          limit: url.searchParams.get("limit") ?? undefined,
          offset: url.searchParams.get("offset") ?? undefined,
        });

        if (!parsed.success) {
          return Response.json(
            {
              error:
                "Invalid query parameters. Required: jobName, stepNumber. Optional: fullLogs=true|false, limit, offset.",
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
            limit: parsed.data.limit,
            offset: parsed.data.offset,
          },
        });

        return Response.json(logs);
      },
    },
  },
});
