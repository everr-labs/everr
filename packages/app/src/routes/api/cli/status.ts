import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { getRunsList } from "@/data/runs-list";
import { DEFAULT_TIME_RANGE } from "@/lib/time-range";
import { cliTokenAuthMiddleware } from "./-token-auth";

const StatusQuerySchema = z.object({
  repo: z.string().min(1),
  branch: z.string().min(1),
  mainBranch: z.string().min(1).optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  recentRuns: z.coerce.number().int().min(1).max(100).optional(),
  slowdownThresholdPct: z.coerce.number().min(1).max(500).optional(),
});

export const Route = createFileRoute("/api/cli/status")({
  server: {
    middleware: [cliTokenAuthMiddleware],
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const parsed = StatusQuerySchema.safeParse({
          repo: url.searchParams.get("repo") ?? undefined,
          branch: url.searchParams.get("branch") ?? undefined,
          mainBranch: url.searchParams.get("mainBranch") ?? undefined,
          from: url.searchParams.get("from") ?? undefined,
          to: url.searchParams.get("to") ?? undefined,
          recentRuns: url.searchParams.get("recentRuns") ?? undefined,
          slowdownThresholdPct:
            url.searchParams.get("slowdownThresholdPct") ?? undefined,
        });

        if (!parsed.success) {
          return Response.json(
            {
              error:
                "Invalid query parameters. Required: repo, branch. Optional: mainBranch, from, to, recentRuns, slowdownThresholdPct.",
            },
            { status: 400 },
          );
        }

        const {
          repo,
          branch,
          mainBranch = "main",
          from,
          to,
          recentRuns = 10,
          slowdownThresholdPct = 20,
        } = parsed.data;
        const timeRange = {
          from: from ?? DEFAULT_TIME_RANGE.from,
          to: to ?? DEFAULT_TIME_RANGE.to,
        };

        const [branchRunsResult, mainRecentResult, mainOlderResult] =
          await Promise.all([
            getRunsList({
              data: {
                timeRange,
                page: 1,
                pageSize: recentRuns,
                repo,
                branch,
              },
            }),
            getRunsList({
              data: {
                timeRange,
                page: 1,
                pageSize: recentRuns,
                repo,
                branch: mainBranch,
                conclusion: "success",
              },
            }),
            getRunsList({
              data: {
                timeRange,
                page: 2,
                pageSize: recentRuns,
                repo,
                branch: mainBranch,
                conclusion: "success",
              },
            }),
          ]);

        const branchRuns = branchRunsResult.runs;
        if (branchRuns.length === 0) {
          return Response.json({
            status: "no_data",
            repo,
            branch,
            message: "No branch runs found for the selected time range.",
          });
        }

        const latestRun = branchRuns[0];
        const failingPipelines = branchRuns
          .filter((run) => run.conclusion === "failure")
          .map((run) => ({
            traceId: run.traceId,
            runId: run.runId,
            workflowName: run.workflowName,
            conclusion: run.conclusion,
            duration: run.duration,
            timestamp: run.timestamp,
          }));

        const mainRecentAvg = average(
          mainRecentResult.runs.map((r) => r.duration),
        );
        const mainOlderAvg = average(
          mainOlderResult.runs.map((r) => r.duration),
        );

        const slowdownVsRecentPct =
          mainRecentAvg && mainRecentAvg > 0
            ? ((latestRun.duration - mainRecentAvg) / mainRecentAvg) * 100
            : null;
        const slowdownVsOlderPct =
          mainOlderAvg && mainOlderAvg > 0
            ? ((latestRun.duration - mainOlderAvg) / mainOlderAvg) * 100
            : null;

        const slowdownDetected =
          (slowdownVsRecentPct ?? Number.NEGATIVE_INFINITY) >=
            slowdownThresholdPct ||
          (slowdownVsOlderPct ?? Number.NEGATIVE_INFINITY) >=
            slowdownThresholdPct;
        const status =
          failingPipelines.length > 0 || slowdownDetected ? "attention" : "ok";

        return Response.json({
          status,
          repo,
          branch,
          mainBranch,
          inspectedRuns: {
            branch: branchRuns.length,
            mainRecent: mainRecentResult.runs.length,
            mainOlder: mainOlderResult.runs.length,
          },
          latestPipeline: {
            traceId: latestRun.traceId,
            runId: latestRun.runId,
            workflowName: latestRun.workflowName,
            conclusion: latestRun.conclusion,
            duration: latestRun.duration,
            timestamp: latestRun.timestamp,
          },
          failingPipelines,
          slowdown: {
            detected: slowdownDetected,
            thresholdPct: slowdownThresholdPct,
            latestDuration: latestRun.duration,
            mainRecentAvgDuration: mainRecentAvg,
            mainOlderAvgDuration: mainOlderAvg,
            slowdownVsRecentPct,
            slowdownVsOlderPct,
          },
          message:
            failingPipelines.length > 0
              ? `Found ${failingPipelines.length} failing pipeline(s) in recent branch runs.`
              : slowdownDetected
                ? "No recent branch failures, but latest pipeline duration is slower than main baselines."
                : `Everything looks good. Latest pipeline duration is ${latestRun.duration.toFixed(2)} seconds.`,
        });
      },
    },
  },
});

function average(values: number[]): number | null {
  if (values.length === 0) {
    return null;
  }
  return values.reduce((acc, value) => acc + value, 0) / values.length;
}
