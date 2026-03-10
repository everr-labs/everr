import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { getGrepMatches, getGrepTimeRangeValidationError } from "@/data/grep";
import { DEFAULT_TIME_RANGE } from "@/lib/time-range";
import { cliAuthMiddleware } from "./-auth";

const GrepQuerySchema = z
  .object({
    repo: z.string().min(1),
    pattern: z.string().min(1),
    jobName: z.string().min(1).optional(),
    stepNumber: z.string().min(1).optional(),
    branch: z.string().min(1).optional(),
    excludeBranch: z.string().min(1).optional(),
    from: z.string().optional(),
    to: z.string().optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
  })
  .refine(
    (data) => data.jobName === undefined || data.stepNumber !== undefined,
    {
      message: "Provide both jobName and stepNumber together.",
      path: ["stepNumber"],
    },
  )
  .refine(
    (data) => data.stepNumber === undefined || data.jobName !== undefined,
    {
      message: "Provide both jobName and stepNumber together.",
      path: ["jobName"],
    },
  )
  .refine((data) => !(data.branch && data.excludeBranch), {
    message: "Provide either branch or excludeBranch, not both.",
    path: ["excludeBranch"],
  });

export const Route = createFileRoute("/api/cli/grep")({
  server: {
    middleware: [cliAuthMiddleware],
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const parsed = GrepQuerySchema.safeParse({
          repo: url.searchParams.get("repo") ?? undefined,
          pattern: url.searchParams.get("pattern") ?? undefined,
          jobName: url.searchParams.get("jobName") ?? undefined,
          stepNumber: url.searchParams.get("stepNumber") ?? undefined,
          branch: url.searchParams.get("branch") ?? undefined,
          excludeBranch: url.searchParams.get("excludeBranch") ?? undefined,
          from: url.searchParams.get("from") ?? undefined,
          to: url.searchParams.get("to") ?? undefined,
          limit: url.searchParams.get("limit") ?? undefined,
        });

        if (!parsed.success) {
          return Response.json(
            {
              error:
                "Invalid query parameters. Required: repo, pattern. Optional: jobName and stepNumber together, branch, excludeBranch, from, to, limit.",
            },
            { status: 400 },
          );
        }

        const timeRange = {
          from: parsed.data.from ?? DEFAULT_TIME_RANGE.from,
          to: parsed.data.to ?? DEFAULT_TIME_RANGE.to,
        };
        const timeRangeError = getGrepTimeRangeValidationError(timeRange);
        if (timeRangeError) {
          return Response.json({ error: timeRangeError }, { status: 400 });
        }

        const result = await getGrepMatches({
          data: {
            repo: parsed.data.repo,
            pattern: parsed.data.pattern,
            jobName: parsed.data.jobName,
            stepNumber: parsed.data.stepNumber,
            branch: parsed.data.branch,
            excludeBranch: parsed.data.excludeBranch,
            limit: parsed.data.limit ?? 20,
            timeRange,
          },
        });

        return Response.json(result);
      },
    },
  },
});
