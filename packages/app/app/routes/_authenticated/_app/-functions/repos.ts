import { clickhouse } from '@/clickhouse';
import { PaginationSchema, RangeSchema } from '@/lib/validators';
import { createServerFn } from '@tanstack/start';
import { intersect } from 'valibot';

interface GetRepoResult {
	repo: string;
	total_run_time: number;
	success_rate: number | null;
	avg_duration_successful: number | null;
	avg_duration_all: number | null;
	last_run_time: string;
}

export const getRepos = createServerFn({ method: 'GET' })
	.validator(intersect([PaginationSchema, RangeSchema]))
	.handler(async ({ data: { pageSize, pageIndex, ...range } }) => {
		console.log(range);
		const result = await Promise.all([
			clickhouse.query<GetRepoResult>({
				query: `SELECT 
                  repo,
                  count() AS total_runs,
                  max(timestamp) AS last_run_time,
                  sum(duration) AS total_run_time,
                  avg(duration) AS avg_duration_all,
                  avgIf(duration, status = 'success') AS avg_duration_successful,
                  round(countIf(status = 'success') / count() * 100, 2) AS success_rate
                FROM pipelines_mv
                WHERE timestamp BETWEEN parseDateTimeBestEffort({from:String}) AND parseDateTimeBestEffort({to:String})
                GROUP BY repo
                ORDER BY last_run_time DESC
                LIMIT {pageSize:UInt32}
                OFFSET {pageIndex:UInt32} * {pageSize:UInt32};`,
				params: {
					pageSize,
					pageIndex,
					from: range.from.toISOString(),
					to: range.to.toISOString(),
				},
			}),
			clickhouse.query<{ total: number }>({
				query: `SELECT 
                  COUNT(DISTINCT repo)::Int32 as total
                FROM
                  pipelines_mv
                WHERE
                  timestamp BETWEEN parseDateTimeBestEffort({from:String}) AND parseDateTimeBestEffort({to:String})
                GROUP BY repo`,
				params: {
					from: range.from.toISOString(),
					to: range.to.toISOString(),
				},
			}),
			// TODO: Pagination
		]);

		return { data: result[0], total: result[1][0]?.total ?? 0 };
	});
