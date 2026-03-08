import { createServerFn } from "@tanstack/react-start";
import { query } from "@/lib/clickhouse";
import type { WaitPipelineRow } from "./wait-pipeline-status";
import {
  buildWaitPipelineStatus,
  WaitPipelineStatusInputSchema,
} from "./wait-pipeline-status";

export const getWaitPipelineStatus = createServerFn({
  method: "GET",
})
  .inputValidator(WaitPipelineStatusInputSchema)
  .handler(async ({ data }) => {
    const sql = `
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

    const rows = await query<WaitPipelineRow>(sql, data);

    return buildWaitPipelineStatus(data, rows);
  });
