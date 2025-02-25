import { clickhouse } from '@/clickhouse';
import { PaginationSchema, RangeSchema } from '@/lib/validators';
import { notFound } from '@tanstack/react-router';
import { createServerFn } from '@tanstack/start';
import { intersect, object, string } from 'valibot';

const GetRepoInputSchema = object({
	repo: string(),
});
export const getRepo = createServerFn({ method: 'GET' })
	.validator(GetRepoInputSchema)
	.handler(async ({ data: { repo } }) => {
		const result = await clickhouse.query({
			query: `SELECT * from pipelines_mv 
              WHERE 
                repo = {repo:String} 
              LIMIT 1`,
			params: {
				repo,
			},
		});

		if (result.length === 0) {
			throw notFound();
		}

		return result[0];
	});

interface Repo {
	workflow_id: number;
	timestamp: string;
	trace_id: string;
	span_id: string;
	name: string;
	// TODO: more stauses
	status: 'cancelled' | 'success';
	duration: string;
	previous_attempt_trace_id: string;
	repo: string;
	ci_system: string;
	event: string;
	attempt_number: number;
}

interface Meta {
	total: number;
}

const GetPipelinesInputSchema = intersect([
	PaginationSchema,
	object({
		repo: string(),
		range: RangeSchema,
	}),
]);
export const getPipelines = createServerFn({ method: 'GET' })
	.validator(GetPipelinesInputSchema)
	.handler(async ({ data: { repo, range, pageIndex, pageSize } }) => {
		const params = {
			repo,
			...range,
		};

		const result = await clickhouse.query<Repo>({
			query: `SELECT * from pipelines_mv 
              WHERE 
                repo = {repo:String} AND 
                timestamp BETWEEN parseDateTimeBestEffort({from:String}) AND parseDateTimeBestEffort({to:String})
								ORDER BY timestamp DESC
              LIMIT  {pageSize:Int}
							OFFSET {pageIndex:Int} * {pageSize:Int}
            `,
			params: {
				...params,
				pageIndex,
				pageSize,
			},
		});

		const meta = (
			await clickhouse.query<Meta>({
				query: `SELECT count(*) as total from pipelines_mv 
              WHERE 
                repo = {repo:String} AND 
                timestamp BETWEEN parseDateTimeBestEffort({from:String}) AND parseDateTimeBestEffort({to:String})
            `,
				params,
			})
		)[0];

		if (result.length === 0 || !meta) {
			throw notFound();
		}

		return { data: result, total: meta.total };
	});
