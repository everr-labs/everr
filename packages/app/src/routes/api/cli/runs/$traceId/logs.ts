import { createFileRoute } from "@tanstack/react-router";
import { RE2 } from "re2-wasm";
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
    egrep: z.string().min(1).optional(),
  })
  .refine((value) => value.tail === undefined || value.limit === undefined, {
    message: "Provide either tail or limit, not both.",
    path: ["tail"],
  });

function isRe2Error(e: unknown): boolean {
  return e instanceof Error && e.message.toLowerCase().includes("re2");
}

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
          egrep: url.searchParams.get("egrep") ?? undefined,
        });

        if (!parsed.success) {
          return Response.json(
            {
              error:
                "Invalid query parameters. Required: jobName, stepNumber. Optional: tail, limit, offset, egrep.",
            },
            { status: 400 },
          );
        }

        if (parsed.data.egrep !== undefined) {
          try {
            new RE2(parsed.data.egrep, "u");
          } catch {
            return Response.json(
              { error: "Invalid re2 pattern." },
              { status: 400 },
            );
          }
        }

        try {
          const { logs, offset } = await getStepLogs({
            data: {
              traceId,
              jobName: parsed.data.jobName,
              stepNumber: parsed.data.stepNumber,
              tail: parsed.data.tail,
              limit: parsed.data.limit,
              offset: parsed.data.offset,
              egrep: parsed.data.egrep,
            },
          });

          return Response.json({ logs, offset });
        } catch (e) {
          if (isRe2Error(e)) {
            return Response.json(
              { error: "Invalid re2 pattern." },
              { status: 400 },
            );
          }
          throw e;
        }
      },
    },
  },
});
