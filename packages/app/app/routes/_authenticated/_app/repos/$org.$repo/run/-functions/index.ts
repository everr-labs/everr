import { clickhouse } from '@/clickhouse';
import type { Log, Span } from '@/types';
import { queryOptions } from '@tanstack/react-query';
import { createServerFn } from '@tanstack/start';
import type { InferInput} from 'valibot';
import { object, string } from 'valibot';

const GetPipelineSchema = object({
	traceId: string(),
	org: string(),
	repo: string(),
});

export const getPipeline = createServerFn({ method: 'GET' })
	.validator(GetPipelineSchema)
	.handler(async ({ data: { traceId } }) => {
		// TODO: also filter by repo and org
		const result = await clickhouse.query<Span>({
			query: `SELECT 
      Timestamp,
      TraceId,
      SpanId,
      ParentSpanId,
      SpanName,
      SpanKind,
      ServiceName,
      Duration::Int64 as Duration,
      StatusCode,
      StatusMessage,
      SpanAttributes,
      ResourceAttributes,
      Events.Name,
      Links.TraceId
      FROM 
        otel_traces
      WHERE
        TraceId = {traceId:String}
      ORDER BY
        Timestamp ASC,
        SpanAttributes['ci.github.workflow.job.step.number'] ASC;
      `,
			params: {
				traceId,
			},
		});

		return result;
	});

export const getPipelineOptions = (
	params: InferInput<typeof GetPipelineSchema>,
) =>
	queryOptions({
		queryKey: ['getPipeline', params.traceId],
		queryFn: () => getPipeline({ data: params }),
		staleTime: Infinity,
	});

const LogsDisributionInputSchema = object({
	traceId: string(),
	spanId: string(),
});

export const getLogsDistribution = createServerFn({ method: 'GET' })
	.validator(LogsDisributionInputSchema)
	.handler(async ({ data: { traceId, spanId } }) => {
		const result = await clickhouse.query<{
			value: number;
			time: string;
		}>({
			query: `SELECT 
        COUNT(*)::Int16 as value,
        toStartOfInterval(Timestamp , INTERVAL 1 SECOND) AS time
      FROM 
        otel_logs 
      WHERE 
        TraceId = {traceId:String}
        AND SpanId = {spanId:String}
      GROUP BY time
      ORDER BY time
      WITH FILL STEP toIntervalSecond(1);
    `,
			params: {
				traceId,
				spanId,
			},
		});
		return result;
	});

const GetLogsSchema = object({
	traceId: string(),
	spanId: string(),
});

export const getLogs = createServerFn({ method: 'GET' })
	.validator(GetLogsSchema)
	.handler(async ({ data: { traceId, spanId } }) => {
		const result = await clickhouse.query<Log>({
			query: `SELECT 
        *
      FROM 
        otel_logs
      WHERE
        TraceId = {traceId:String} 
        AND SpanId = {spanId:String}
      ORDER BY
        Timestamp ASC;
    `,
			params: {
				traceId,
				spanId,
			},
		});
		return result;
	});
