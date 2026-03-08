import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { query } from "@/lib/clickhouse";
import { getWorkOS } from "@/lib/workos";
import { cliAuthMiddleware } from "../-auth";

type FirstFailingStep = {
  jobId: string;
  jobName: string;
  stepName: string;
  stepNumber: string;
};

const FailuresQuerySchema = z.object({
  gitEmail: z.string().email(),
  repo: z.string().optional(),
  branch: z.string().optional(),
});

export const Route = createFileRoute("/api/cli/notifier/failures")({
  server: {
    middleware: [cliAuthMiddleware],
    handlers: {
      GET: async ({ request, context }) => {
        const url = new URL(request.url);
        const parsed = FailuresQuerySchema.safeParse({
          gitEmail: url.searchParams.get("gitEmail") ?? undefined,
          repo: url.searchParams.get("repo") ?? undefined,
          branch: url.searchParams.get("branch") ?? undefined,
        });

        if (!parsed.success) {
          return Response.json(
            {
              error:
                "Invalid query parameters. Required: gitEmail. Optional: repo, branch.",
            },
            { status: 400 },
          );
        }

        const workos = getWorkOS();
        const user = await workos.userManagement.getUser(context.auth.userId);
        const verifiedMatch =
          user.emailVerified &&
          user.email.trim().toLowerCase() ===
            parsed.data.gitEmail.trim().toLowerCase();

        if (!verifiedMatch) {
          return Response.json({
            verified_match: false,
            failures: [],
          });
        }

        const conditions = [
          "Timestamp >= now() - INTERVAL 5 MINUTE",
          "ResourceAttributes['cicd.pipeline.run.id'] != ''",
          "lowerUTF8(ResourceAttributes['vcs.ref.head.revision.author.email']) = lowerUTF8({gitEmail:String})",
          "(lowerUTF8(ResourceAttributes['cicd.pipeline.task.run.result']) IN ('failure', 'failed') OR lowerUTF8(ResourceAttributes['cicd.pipeline.result']) IN ('failure', 'failed'))",
        ];
        const params: Record<string, unknown> = {
          gitEmail: parsed.data.gitEmail,
        };

        if (parsed.data.repo) {
          conditions.push(
            "ResourceAttributes['vcs.repository.name'] = {repo:String}",
          );
          params.repo = parsed.data.repo;
        }

        if (parsed.data.branch) {
          conditions.push(
            "ResourceAttributes['vcs.ref.head.name'] = {branch:String}",
          );
          params.branch = parsed.data.branch;
        }

        const result = await query<{
          traceId: string;
          runId: string;
          repo: string;
          branch: string;
          workflowName: string;
          failureTime: string;
        }>(
          `
            SELECT
              TraceId as traceId,
              anyLast(ResourceAttributes['cicd.pipeline.run.id']) as runId,
              anyLast(ResourceAttributes['vcs.repository.name']) as repo,
              anyLast(ResourceAttributes['vcs.ref.head.name']) as branch,
              anyLast(ResourceAttributes['cicd.pipeline.name']) as workflowName,
              max(Timestamp) as failureTime
            FROM traces
            WHERE ${conditions.join("\n              AND ")}
            GROUP BY TraceId
            ORDER BY failureTime DESC
            LIMIT 20
          `,
          params,
        );

        const firstFailingStepByTraceId = new Map<string, FirstFailingStep>();
        if (result.length > 0) {
          const failingStepsResult = await query<{
            trace_id: string;
            jobId: string;
            jobName: string;
            stepName: string;
            stepNumber: string;
          }>(
            `
              SELECT
                TraceId as trace_id,
                ResourceAttributes['cicd.pipeline.task.run.id'] as jobId,
                ResourceAttributes['cicd.pipeline.task.name'] as jobName,
                SpanAttributes['everr.github.workflow_job_step.number'] as stepNumber,
                anyLast(SpanName) as stepName
              FROM traces
              WHERE TraceId IN {traceIds:Array(String)}
                AND SpanAttributes['everr.github.workflow_job_step.number'] != ''
                AND lowerUTF8(StatusMessage) NOT IN ('success', 'skip')
              GROUP BY trace_id, jobId, jobName, stepNumber
            `,
            {
              traceIds: result.map((row) => row.traceId),
            },
          );

          for (const row of failingStepsResult) {
            const current = firstFailingStepByTraceId.get(row.trace_id);
            if (
              !current ||
              compareFailingSteps(
                {
                  jobId: row.jobId,
                  jobName: row.jobName,
                  stepName: row.stepName,
                  stepNumber: row.stepNumber,
                },
                current,
              ) < 0
            ) {
              firstFailingStepByTraceId.set(row.trace_id, {
                jobId: row.jobId,
                jobName: row.jobName,
                stepName: row.stepName,
                stepNumber: row.stepNumber,
              });
            }
          }
        }

        return Response.json({
          verified_match: true,
          failures: result.map((row) => ({
            dedupe_key: `${row.traceId}:${row.failureTime}`,
            trace_id: row.traceId,
            repo: row.repo,
            branch: row.branch,
            workflow_name: row.workflowName || "Workflow",
            failure_time: row.failureTime,
            details_url: `${url.origin}/dashboard/runs/${encodeURIComponent(row.traceId)}`,
            job_name: firstFailingStepByTraceId.get(row.traceId)?.jobName,
            step_number: firstFailingStepByTraceId.get(row.traceId)?.stepNumber,
            step_name: firstFailingStepByTraceId.get(row.traceId)?.stepName,
          })),
        });
      },
    },
  },
});

function compareFailingSteps(a: FirstFailingStep, b: FirstFailingStep): number {
  const jobComparison = a.jobId.localeCompare(b.jobId);
  if (jobComparison !== 0) {
    return jobComparison;
  }

  return parseStepNumber(a.stepNumber) - parseStepNumber(b.stepNumber);
}

function parseStepNumber(value: string): number {
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? Number.MAX_SAFE_INTEGER : parsed;
}
