import { createServerFn } from "@tanstack/react-start";
import { query } from "@/lib/clickhouse";
import type { WatchRow } from "./watch-status";
import {
  buildWatchStatus,
  type WatchDurationBaseline,
  WatchStatusInputSchema,
} from "./watch-status";

export const getWatchStatus = createServerFn({
  method: "GET",
})
  .inputValidator(WatchStatusInputSchema)
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
        argMax(attributes['pipeline.run_id'], event_time) as pipelineRunId,
        greatest(
          0,
          dateDiff(
            'second',
            min(event_time),
            if(argMax(event_phase, event_time) = 'finished', max(event_time), now())
          )
        ) as durationSeconds
      FROM app.cdevents
      WHERE event_kind IN ('pipelinerun', 'taskrun', 'workflowjob')
        AND event_time >= now() - INTERVAL 14 DAY
        AND repository = {repo:String}
        AND ref = {branch:String}
        AND startsWith(sha, {commit:String})
      GROUP BY subject_id
      ORDER BY lastEventTime DESC
    `;

    const averagesSql = `
      SELECT
        workflow_name,
        toUInt64(round(avg(duration_seconds))) as usualDurationSeconds,
        count() as sampleCount
      FROM (
        SELECT
          argMax(subject_name, event_time) as workflow_name,
          greatest(0, dateDiff('second', min(event_time), max(event_time))) as duration_seconds,
          max(event_time) as last_event_time
        FROM app.cdevents
        WHERE event_kind = 'pipelinerun'
          AND event_time >= now() - INTERVAL 30 DAY
          AND repository = {repo:String}
          AND ref = {branch:String}
        GROUP BY subject_id
        HAVING argMax(event_phase, event_time) = 'finished'
        ORDER BY workflow_name, last_event_time DESC
        LIMIT 3 BY workflow_name
      )
      GROUP BY workflow_name
    `;

    const [rows, baselines] = await Promise.all([
      query<WatchRow>(statusSql, data),
      query<{
        workflow_name: string;
        usualDurationSeconds: string;
        sampleCount: string;
      }>(averagesSql, data),
    ]);

    const durationBaselinesByWorkflow = new Map<string, WatchDurationBaseline>(
      baselines.map((row) => [
        row.workflow_name,
        {
          durationSeconds: Math.round(Number(row.usualDurationSeconds)),
          sampleSize: Number(row.sampleCount),
        },
      ]),
    );

    return buildWatchStatus(data, rows, durationBaselinesByWorkflow);
  });
