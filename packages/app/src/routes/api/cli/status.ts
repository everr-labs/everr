import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { getRunsList } from "@/data/runs-list";
import { DEFAULT_TIME_RANGE } from "@/lib/time-range";
import { cliAuthMiddleware } from "./-auth";

const STATUS_RUN_LIMIT = 10;
const ALLOWED_QUERY_PARAMS = new Set(["repo", "branch", "from", "to"]);

const StatusQuerySchema = z.object({
  repo: z.string().min(1),
  branch: z.string().min(1),
  from: z.string().optional(),
  to: z.string().optional(),
});

export const Route = createFileRoute("/api/cli/status")({
  server: {
    middleware: [cliAuthMiddleware],
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const hasUnexpectedParams = [...url.searchParams.keys()].some(
          (key) => !ALLOWED_QUERY_PARAMS.has(key),
        );

        if (hasUnexpectedParams) {
          return Response.json(
            {
              error:
                "Invalid query parameters. Required: repo, branch. Optional: from, to.",
            },
            { status: 400 },
          );
        }

        const parsed = StatusQuerySchema.safeParse({
          repo: url.searchParams.get("repo") ?? undefined,
          branch: url.searchParams.get("branch") ?? undefined,
          from: url.searchParams.get("from") ?? undefined,
          to: url.searchParams.get("to") ?? undefined,
        });

        if (!parsed.success) {
          return Response.json(
            {
              error:
                "Invalid query parameters. Required: repo, branch. Optional: from, to.",
            },
            { status: 400 },
          );
        }

        const { repo, branch, from, to } = parsed.data;
        const timeRange = {
          from: from ?? DEFAULT_TIME_RANGE.from,
          to: to ?? DEFAULT_TIME_RANGE.to,
        };

        const branchRuns = (
          await getRunsList({
            data: {
              timeRange,
              limit: STATUS_RUN_LIMIT,
              repo,
              branch,
            },
          })
        ).runs;
        if (branchRuns.length === 0) {
          return Response.json({
            status: "no_data",
            repo,
            branch,
            message: "No branch runs found for the selected time range.",
          });
        }

        const latestRun = branchRuns[0];
        const failures = branchRuns
          .filter((run) => isFailingConclusion(run.conclusion))
          .map((run) => {
            const step = run.failingSteps?.[0];
            const failedStep = step
              ? {
                  jobName: step.jobName,
                  stepNumber: step.stepNumber.toString(),
                  stepName: step.stepName,
                }
              : undefined;

            return {
              traceId: run.traceId,
              runId: run.runId,
              workflowName: run.workflowName,
              conclusion: run.conclusion,
              durationMs: run.duration,
              timestamp: run.timestamp,
              failedStep,
              logsArgs: failedStep
                ? {
                    jobName: failedStep.jobName,
                    stepNumber: failedStep.stepNumber,
                  }
                : undefined,
            };
          });
        const status = failures.length > 0 ? "attention" : "ok";

        return Response.json({
          status,
          repo,
          branch,
          latestPipeline: {
            traceId: latestRun.traceId,
            runId: latestRun.runId,
            workflowName: latestRun.workflowName,
            conclusion: latestRun.conclusion,
            durationMs: latestRun.duration,
            timestamp: latestRun.timestamp,
          },
          failures,
          message:
            failures.length > 0
              ? `Found ${failures.length} failing pipeline(s) in recent branch runs.`
              : `Everything looks good. Latest pipeline duration is ${(latestRun.duration / 1000).toFixed(2)} seconds.`,
        });
      },
    },
  },
});

function isFailingConclusion(conclusion: string): boolean {
  const normalized = conclusion.trim().toLowerCase();
  return normalized === "failure" || normalized === "failed";
}
