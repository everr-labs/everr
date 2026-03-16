import { createServerFn } from "@tanstack/react-start";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { workflowJobs, workflowRuns } from "@/db/schema";
import type { WatchRow } from "./watch-status";
import {
  buildWatchStatus,
  type WatchDurationBaseline,
  WatchStatusInputSchema,
} from "./watch-status";

const WatchStatusServerInputSchema = WatchStatusInputSchema.extend({
  tenantId: z.number().int().positive(),
});

function buildDurationBaselines(
  rows: Array<{
    workflowName: string;
    startedAt: Date | null;
    completedAt: Date | null;
    lastEventAt: Date;
  }>,
): Map<string, WatchDurationBaseline> {
  const recentDurationsByWorkflow = new Map<string, number[]>();

  for (const row of rows) {
    const durations = recentDurationsByWorkflow.get(row.workflowName) ?? [];
    if (durations.length >= 3) {
      continue;
    }

    const startMs = row.startedAt?.getTime() ?? row.lastEventAt.getTime();
    const endMs = row.completedAt?.getTime() ?? row.lastEventAt.getTime();
    durations.push(Math.max(0, Math.round((endMs - startMs) / 1000)));
    recentDurationsByWorkflow.set(row.workflowName, durations);
  }

  const baselines = new Map<string, WatchDurationBaseline>();
  for (const [workflowName, durations] of recentDurationsByWorkflow) {
    const totalDuration = durations.reduce(
      (sum, duration) => sum + duration,
      0,
    );
    baselines.set(workflowName, {
      durationSeconds: Math.max(
        0,
        Math.round(totalDuration / durations.length),
      ),
      sampleSize: durations.length,
    });
  }

  return baselines;
}

export const getWatchStatus = createServerFn({
  method: "GET",
})
  .inputValidator(WatchStatusServerInputSchema)
  .handler(async ({ data }) => {
    const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);

    const [runResults, jobResults] = await Promise.all([
      db
        .select({
          tenantId: workflowRuns.tenantId,
          runId: workflowRuns.runId,
          attempts: workflowRuns.attempts,
          workflowName: workflowRuns.workflowName,
          metadata: workflowRuns.metadata,
          status: workflowRuns.status,
          conclusion: workflowRuns.conclusion,
          lastEventAt: workflowRuns.lastEventAt,
          startedAt: workflowRuns.startedAt,
          completedAt: workflowRuns.completedAt,
        })
        .from(workflowRuns)
        .where(
          and(
            eq(workflowRuns.tenantId, data.tenantId),
            eq(workflowRuns.repository, data.repo),
            eq(workflowRuns.ref, data.branch),
            sql`left(${workflowRuns.sha}, ${data.commit.length}) = ${data.commit}`,
            gte(workflowRuns.lastEventAt, fourteenDaysAgo),
          ),
        )
        .orderBy(desc(workflowRuns.lastEventAt)),

      db
        .select({
          tenantId: workflowJobs.tenantId,
          jobId: workflowJobs.jobId,
          runId: workflowJobs.runId,
          attempts: workflowJobs.attempts,
          jobName: workflowJobs.jobName,
          metadata: workflowJobs.metadata,
          status: workflowJobs.status,
          conclusion: workflowJobs.conclusion,
          lastEventAt: workflowJobs.lastEventAt,
          startedAt: workflowJobs.startedAt,
          completedAt: workflowJobs.completedAt,
        })
        .from(workflowJobs)
        .where(
          and(
            eq(workflowJobs.tenantId, data.tenantId),
            eq(workflowJobs.repository, data.repo),
            eq(workflowJobs.ref, data.branch),
            sql`left(${workflowJobs.sha}, ${data.commit.length}) = ${data.commit}`,
            gte(workflowJobs.lastEventAt, fourteenDaysAgo),
          ),
        )
        .orderBy(desc(workflowJobs.lastEventAt)),
    ]);

    const now = Date.now();

    const rows: WatchRow[] = [
      ...runResults.map((r): WatchRow => {
        const startMs = r.startedAt?.getTime() ?? r.lastEventAt.getTime();
        const endMs =
          r.status === "completed"
            ? (r.completedAt?.getTime() ?? r.lastEventAt.getTime())
            : now;
        const durationSeconds = Math.max(
          0,
          Math.round((endMs - startMs) / 1000),
        );

        return {
          subjectId: String(r.runId),
          attempts: r.attempts,
          subjectName: r.workflowName,
          htmlUrl: r.metadata?.html_url ?? "",
          status: r.status,
          conclusion: r.conclusion,
          lastEventTime: r.lastEventAt.toISOString(),
          eventKind: "pipelinerun",
          pipelineRunId: String(r.runId),
          durationSeconds: String(durationSeconds),
        };
      }),
      ...jobResults.map((j): WatchRow => {
        const startMs = j.startedAt?.getTime() ?? j.lastEventAt.getTime();
        const endMs =
          j.status === "completed"
            ? (j.completedAt?.getTime() ?? j.lastEventAt.getTime())
            : now;
        const durationSeconds = Math.max(
          0,
          Math.round((endMs - startMs) / 1000),
        );

        return {
          subjectId: String(j.jobId),
          attempts: j.attempts,
          subjectName: j.jobName,
          htmlUrl: j.metadata?.html_url ?? "",
          status: j.status,
          conclusion: j.conclusion,
          lastEventTime: j.lastEventAt.toISOString(),
          eventKind: "taskrun",
          pipelineRunId: String(j.runId),
          durationSeconds: String(durationSeconds),
        };
      }),
    ];

    // Duration baselines: average the 3 most recent completed runs per workflow.
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const baselineRows = await db
      .select({
        workflowName: workflowRuns.workflowName,
        startedAt: workflowRuns.startedAt,
        completedAt: workflowRuns.completedAt,
        lastEventAt: workflowRuns.lastEventAt,
      })
      .from(workflowRuns)
      .where(
        and(
          eq(workflowRuns.tenantId, data.tenantId),
          eq(workflowRuns.repository, data.repo),
          eq(workflowRuns.ref, data.branch),
          eq(workflowRuns.status, "completed"),
          gte(workflowRuns.lastEventAt, thirtyDaysAgo),
        ),
      )
      .orderBy(workflowRuns.workflowName, desc(workflowRuns.lastEventAt));

    const durationBaselinesByWorkflow = buildDurationBaselines(baselineRows);

    return buildWatchStatus(data, rows, durationBaselinesByWorkflow);
  });
