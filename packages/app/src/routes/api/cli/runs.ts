import { RUN_STATUS_FILTERS } from "@everr/telemetry-explorer/runs";
import { DEFAULT_TIME_RANGE } from "@everr/ui/lib/time-range";
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { getRunsList } from "@/data/runs-list/server";

const ConclusionEnum = z.enum(RUN_STATUS_FILTERS);

const RunsListQuerySchema = z.strictObject({
  from: z.string().optional(),
  to: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().min(0).optional(),
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
  includeTotalCount: z
    .enum(["true", "false"])
    .transform((value) => value === "true")
    .optional(),
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

export const Route = createFileRoute("/api/cli/runs")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const authorEmails = url.searchParams.getAll("authorEmails");
        const repos = url.searchParams.getAll("repos");
        const branches = url.searchParams.getAll("branches");
        const conclusions = url.searchParams.getAll("conclusions");
        const workflowNames = url.searchParams.getAll("workflowNames");
        const parsed = RunsListQuerySchema.safeParse({
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
                "Invalid query parameters for runs listing. Check limit, offset, and filter values.",
            },
            { status: 400 },
          );
        }

        const timeRange = {
          from: parsed.data.from ?? DEFAULT_TIME_RANGE.from,
          to: parsed.data.to ?? DEFAULT_TIME_RANGE.to,
        };

        const result = await getRunsList({
          data: {
            timeRange,
            limit: parsed.data.limit,
            offset: parsed.data.offset,
            repos: mergeFilter(parsed.data.repos, parsed.data.repo),
            branches: mergeFilter(parsed.data.branches, parsed.data.branch),
            conclusions: mergeFilter(parsed.data.conclusions, parsed.data.conclusion),
            workflowNames: mergeFilter(parsed.data.workflowNames, parsed.data.workflowName),
            runId: parsed.data.runId,
            authorEmails: parsed.data.authorEmails,
            includeTotalCount: parsed.data.includeTotalCount,
          },
        });

        return Response.json({
          ...result,
          filters: {
            from: timeRange.from,
            to: timeRange.to,
            repo: parsed.data.repo ?? undefined,
            branch: parsed.data.branch ?? undefined,
            conclusion: parsed.data.conclusion ?? undefined,
            workflowName: parsed.data.workflowName ?? undefined,
            runId: parsed.data.runId ?? undefined,
            authorEmails: parsed.data.authorEmails,
            limit: parsed.data.limit ?? 20,
            offset: parsed.data.offset ?? 0,
          },
        });
      },
    },
  },
});
