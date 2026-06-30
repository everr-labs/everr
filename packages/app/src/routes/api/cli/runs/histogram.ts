import { RUN_STATUS_FILTERS } from "@everr/telemetry-explorer/runs";
import { DEFAULT_TIME_RANGE } from "@everr/ui/lib/time-range";
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { getRunsHistogram } from "@/data/runs-list/server";

// This endpoint is consumed only by the desktop app, which always sends
// multi-select filters as repeated plural params.
const RunsHistogramQuerySchema = z.strictObject({
  from: z.string().optional(),
  to: z.string().optional(),
  repos: z.array(z.string()).optional(),
  branches: z.array(z.string()).optional(),
  conclusions: z.array(z.enum(RUN_STATUS_FILTERS)).optional(),
  workflowNames: z.array(z.string()).optional(),
  runId: z.string().optional(),
  authorEmails: z.array(z.string()).optional(),
  histogramBuckets: z.coerce.number().int().optional(),
});

export const Route = createFileRoute("/api/cli/runs/histogram")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const getAll = (key: string) => {
          const values = url.searchParams.getAll(key);
          return values.length > 0 ? values : undefined;
        };
        const parsed = RunsHistogramQuerySchema.safeParse({
          from: url.searchParams.get("from") ?? undefined,
          to: url.searchParams.get("to") ?? undefined,
          repos: getAll("repos"),
          branches: getAll("branches"),
          conclusions: getAll("conclusions"),
          workflowNames: getAll("workflowNames"),
          runId: url.searchParams.get("runId") ?? undefined,
          authorEmails: getAll("authorEmails"),
          histogramBuckets:
            url.searchParams.get("histogramBuckets") ?? undefined,
        });

        if (!parsed.success) {
          return Response.json(
            {
              error:
                "Invalid query parameters for runs histogram. Check filter and bucket values.",
            },
            { status: 400 },
          );
        }

        const timeRange = {
          from: parsed.data.from ?? DEFAULT_TIME_RANGE.from,
          to: parsed.data.to ?? DEFAULT_TIME_RANGE.to,
        };

        const buckets = await getRunsHistogram({
          data: {
            timeRange,
            repos: parsed.data.repos,
            branches: parsed.data.branches,
            conclusions: parsed.data.conclusions,
            workflowNames: parsed.data.workflowNames,
            runId: parsed.data.runId,
            authorEmails: parsed.data.authorEmails,
            histogramBuckets: parsed.data.histogramBuckets,
          },
        });

        return Response.json(buckets);
      },
    },
  },
});
