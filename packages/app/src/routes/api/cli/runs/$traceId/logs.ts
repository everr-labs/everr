import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { getStepLogs } from "@/data/runs/server";

const StepLogsQuerySchema = z
  .object({
    jobName: z.string().min(1).optional(),
    jobId: z.string().min(1).optional(),
    stepNumber: z.string().min(1),
    tail: z.coerce.number().int().min(1).max(5000).optional(),
    limit: z.coerce.number().int().min(1).max(5000).optional(),
    offset: z.coerce.number().int().min(0).optional(),
    egrep: z.string().min(1).optional(),
  })
  .refine((value) => value.tail === undefined || value.limit === undefined, {
    message: "Provide either tail or limit, not both.",
    path: ["tail"],
  })
  .refine((value) => value.jobName !== undefined || value.jobId !== undefined, {
    message: "Provide either jobName or jobId.",
    path: ["jobName"],
  });

export const Route = createFileRoute("/api/cli/runs/$traceId/logs")({
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
        const parsed = StepLogsQuerySchema.safeParse({
          jobName: url.searchParams.get("jobName") ?? undefined,
          jobId: url.searchParams.get("jobId") ?? undefined,
          stepNumber: url.searchParams.get("stepNumber") ?? undefined,
          tail: url.searchParams.get("tail") ?? undefined,
          limit: url.searchParams.get("limit") ?? undefined,
          offset: url.searchParams.get("offset") ?? undefined,
          egrep: url.searchParams.get("egrep") ?? undefined,
        });

        if (!parsed.success) {
          return Response.json(
            {
              error:
                "Invalid query parameters. Required: jobName or jobId, stepNumber. Optional: tail, limit, offset, egrep.",
            },
            { status: 400 },
          );
        }

        try {
          const { logs, offset } = await getStepLogs({
            data: {
              traceId,
              jobName: parsed.data.jobName,
              jobId: parsed.data.jobId,
              stepNumber: parsed.data.stepNumber,
              tail: parsed.data.tail,
              limit: parsed.data.limit,
              offset: parsed.data.offset,
              egrep: parsed.data.egrep,
            },
          });

          return Response.json({ logs, offset });
        } catch (err) {
          if (
            typeof err === "object" &&
            err !== null &&
            "type" in err &&
            err.type === "CANNOT_COMPILE_REGEXP"
          ) {
            return Response.json(
              {
                error:
                  "Invalid regular expression pattern. Look at https://github.com/google/re2/wiki/Syntax for reference.",
              },
              { status: 400 },
            );
          }
          throw err;
        }
      },
    },
  },
});
