import { DEFAULT_TIME_RANGE } from "@everr/ui/lib/time-range";
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { getRunsHistogram } from "@/data/runs-list/server";

const ConclusionEnum = z.enum(["success", "failure", "cancellation"]);

const RunsHistogramQuerySchema = z.strictObject({
  from: z.string().optional(),
  to: z.string().optional(),
  repo: z.string().optional(),
  branch: z.string().optional(),
  conclusion: ConclusionEnum.optional(),
  workflowName: z.string().optional(),
  // Plural variants let the desktop app pass multi-select filters as repeated
  // query params while the singular ones keep the CLI working.
  repos: z.array(z.string()).optional(),
  branches: z.array(z.string()).optional(),
  conclusions: z.array(ConclusionEnum).optional(),
  workflowNames: z.array(z.string()).optional(),
  runId: z.string().optional(),
  authorEmails: z.array(z.string()).optional(),
  histogramBuckets: z.coerce.number().int().optional(),
});

// Combine repeated plural params with the legacy singular one into a single
// array (or `undefined` when neither is present).
function mergeFilter<T extends string>(
  plural: T[] | undefined,
  singular: T | undefined,
): T[] | undefined {
  const merged = [...(plural ?? []), ...(singular ? [singular] : [])];
  return merged.length > 0 ? merged : undefined;
}

export const Route = createFileRoute("/api/cli/runs/histogram")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const authorEmails = url.searchParams.getAll("authorEmails");
        const repos = url.searchParams.getAll("repos");
        const branches = url.searchParams.getAll("branches");
        const conclusions = url.searchParams.getAll("conclusions");
        const workflowNames = url.searchParams.getAll("workflowNames");
        const parsed = RunsHistogramQuerySchema.safeParse({
          ...Object.fromEntries(url.searchParams.entries()),
          repos: repos.length > 0 ? repos : undefined,
          branches: branches.length > 0 ? branches : undefined,
          conclusions: conclusions.length > 0 ? conclusions : undefined,
          workflowNames: workflowNames.length > 0 ? workflowNames : undefined,
          authorEmails: authorEmails.length > 0 ? authorEmails : undefined,
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
            repos: mergeFilter(parsed.data.repos, parsed.data.repo),
            branches: mergeFilter(parsed.data.branches, parsed.data.branch),
            conclusions: mergeFilter(
              parsed.data.conclusions,
              parsed.data.conclusion,
            ),
            workflowNames: mergeFilter(
              parsed.data.workflowNames,
              parsed.data.workflowName,
            ),
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
