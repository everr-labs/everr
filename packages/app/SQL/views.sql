-- PIPELINES
CREATE MATERIALIZED VIEW pipelines_mv
ENGINE = MergeTree()
ORDER BY (workflow_id, timestamp)
-- POPULATE
AS
       SELECT
              if(ResourceAttributes['ci.github.workflow.id'] != '', toInt64(ResourceAttributes['ci.github.workflow.id']), 0) as workflow_id,
              Timestamp as timestamp,
              TraceId as trace_id,
              SpanId as span_id,
              SpanName as name,
              StatusMessage as status,
              Duration as duration,
              `Links.TraceId`[1] as previous_attempt_trace_id,
              ResourceAttributes['scm.git.repo'] as repo,
              ResourceAttributes['ci.system'] as ci_system,
              ResourceAttributes['ci.github.workflow.run.event'] as event,
              toInt16(ResourceAttributes['ci.github.workflow.run.run_attempt']) as attempt_number
       FROM 
              otel_traces
       WHERE 
              ParentSpanId = '' 
              AND workflow_id > 0;


-- JOBS
CREATE MATERIALIZED VIEW jobs_mv
ENGINE = MergeTree()
ORDER BY (timestamp)
-- POPULATE
AS
       SELECT
              Timestamp                                           as timestamp,
              TraceId                                             as trace_id,
              SpanId                                              as span_id,
              SpanName                                            as name,
              StatusMessage                                       as status,
              Duration                                            as duration,
              ResourceAttributes['scm.git.repo']                  as repo,
              ResourceAttributes['ci.github.workflow.job.labels'] as labels
       FROM 
              otel_traces
       WHERE 
              mapContains(SpanAttributes, 'ci.github.workflow.job.step.number') = 0 
              AND ParentSpanId != ''
