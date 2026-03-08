import { createServerFn } from "@tanstack/react-start";
import { query } from "@/lib/clickhouse";
import type { WaitPipelineRow } from "./wait-pipeline-status";
import {
  buildWaitPipelineStatus,
  type WaitPipelineDurationBaseline,
  WaitPipelineStatusInputSchema,
} from "./wait-pipeline-status";

export const getWaitPipelineStatus = createServerFn({
  method: "GET",
})
  .inputValidator(WaitPipelineStatusInputSchema)
  .handler(async ({ data }) => {
    const statusSql = `
      SELECT
        subject_id as subjectId,
        argMax(subject_name, event_time) as subjectName,
        argMax(subject_url, event_time) as htmlUrl,
        argMax(event_kind, event_time) as eventKind,
        argMax(event_phase, event_time) as phase,
        argMax(outcome, event_time) as conclusion,
        max(event_time) as lastEventTime,
        argMax(pipeline_run_id, event_time) as pipelineRunId,
        greatest(
          0,
          dateDiff(
            'second',
            min(event_time),
            if(argMax(event_phase, event_time) = 'finished', max(event_time), now())
          )
        ) as durationSeconds
      FROM app.cdevents
      WHERE repository = {repo:String}
        AND ref = {branch:String}
        AND startsWith(sha, {commit:String})
        AND event_time >= now() - INTERVAL 14 DAY
      GROUP BY subject_id
      ORDER BY lastEventTime DESC
    `;

    const averagesSql = `
      WITH finished_runs AS (
        SELECT
          argMax(subject_name, event_time) as workflow_name,
          greatest(0, dateDiff('second', min(event_time), max(event_time))) as duration_seconds,
          max(event_time) as last_event_time
        FROM app.cdevents
        WHERE repository = {repo:String}
          AND ref = {branch:String}
          AND event_kind = 'pipelinerun'
          AND event_time >= now() - INTERVAL 30 DAY
        GROUP BY subject_id
        HAVING argMax(event_phase, event_time) = 'finished'
      )
      SELECT
        workflow_name,
        avg(duration_seconds) as usualDurationSeconds,
        count() as sampleCount
      FROM (
        SELECT
          workflow_name,
          duration_seconds,
          row_number() OVER (
            PARTITION BY workflow_name
            ORDER BY last_event_time DESC
          ) as row_num
        FROM finished_runs
      )
      WHERE row_num <= 3
      GROUP BY workflow_name
    `;

    const [rows, baselines] = await Promise.all([
      query<WaitPipelineRow>(statusSql, data),
      query<{
        workflow_name: string;
        usualDurationSeconds: string;
        sampleCount: string;
      }>(averagesSql, data),
    ]);

    const durationBaselinesByWorkflow = new Map<
      string,
      WaitPipelineDurationBaseline
    >(
      baselines.map((row) => [
        row.workflow_name,
        {
          durationSeconds: Number(row.usualDurationSeconds),
          sampleSize: Number(row.sampleCount),
        },
      ]),
    );

    return buildWaitPipelineStatus(data, rows, durationBaselinesByWorkflow);
  });
