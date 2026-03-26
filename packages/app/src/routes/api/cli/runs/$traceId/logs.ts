import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { getStepLogs } from "@/data/runs/server";
import { accessTokenAuthMiddleware } from "@/lib/accessTokenAuthMiddleware";

const StepLogsQuerySchema = z
  .object({
    jobName: z.string().min(1),
    stepNumber: z.string().min(1),
    tail: z.coerce.number().int().min(1).max(5000).optional(),
    limit: z.coerce.number().int().min(1).max(5000).optional(),
    offset: z.coerce.number().int().min(0).optional(),
  })
  .refine((value) => value.tail === undefined || value.limit === undefined, {
    message: "Provide either tail or limit, not both.",
    path: ["tail"],
  });

export const Route = createFileRoute("/api/cli/runs/$traceId/logs")({
  server: {
    middleware: [accessTokenAuthMiddleware],
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
          tail: url.searchParams.get("tail") ?? undefined,
          limit: url.searchParams.get("limit") ?? undefined,
          offset: url.searchParams.get("offset") ?? undefined,
        });

        if (!parsed.success) {
          return Response.json(
            {
              error:
                "Invalid query parameters. Required: jobName, stepNumber. Optional: tail, limit, offset.",
            },
            { status: 400 },
          );
        }

        const logs = await getStepLogs({
          data: {
            traceId,
            jobName: parsed.data.jobName,
            stepNumber: parsed.data.stepNumber,
            tail: parsed.data.tail,
            limit: parsed.data.limit,
            offset: parsed.data.offset,
          },
        });

        return Response.json(logs);
      },
    },
  },
});
