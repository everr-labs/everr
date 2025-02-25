import { clickhouse } from '@/clickhouse';
import { PaginationSchema, RangeSchema } from '@/lib/validators';
import { createServerFn } from '@tanstack/start';
import { addSeconds, differenceInSeconds, parseISO } from 'date-fns';
import { intersect, object, string } from 'valibot';

interface GetRepoResult {
	repo: `${string}/${string}`;
	total_run_time: number;
	failure_rate: number | null;
	avg_duration_successful: number | null;
	avg_duration_all: number | null;
	last_run_time: string;
}

export const getRepos = createServerFn({ method: 'GET' })
	.validator(intersect([PaginationSchema, RangeSchema]))
	.handler(async ({ data: { pageSize, pageIndex, ...range } }) => {
		const result = await Promise.all([
			clickhouse.query<GetRepoResult>({
				query: `SELECT 
                  repo,
                  count() AS total_runs,
                  max(timestamp) AS last_run_time,
                  sum(duration) AS total_run_time,
                  avg(duration) AS avg_duration_all,
                  avgIf(duration, status = 'success') AS avg_duration_successful,
                  round(countIf(status != 'success') / count() * 100, 2) AS failure_rate
                FROM pipelines_mv
                WHERE timestamp BETWEEN parseDateTimeBestEffort({from:String}) AND parseDateTimeBestEffort({to:String})
                GROUP BY repo
                ORDER BY last_run_time DESC
                LIMIT {pageSize:UInt32}
                OFFSET {pageIndex:UInt32} * {pageSize:UInt32};`,
				params: {
					pageSize,
					pageIndex,
					...range,
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
					...range,
				},
			}),
			// TODO: Pagination
		]);

		return { data: result[0], total: result[1][0]?.total ?? 0 };
	});

interface DataPoint {
	time: string;
	value: number;
}

export const getDurationSeries = createServerFn({ method: 'GET' })
	.validator(intersect([RangeSchema, object({ repo: string() })]))
	.handler(async ({ data: { repo, ...range } }) => {
		const result = await clickhouse.query<DataPoint>({
			query: `SELECT 
						toStartOfInterval(timestamp, toIntervalDay(1)) AS time,
						avg(duration) as value
					FROM
						pipelines_mv
					WHERE
						timestamp BETWEEN parseDateTimeBestEffort({from:String}) AND parseDateTimeBestEffort({to:String})
						AND repo = {repo:String}
					GROUP BY ALL
					ORDER BY time
					WITH FILL
					FROM parseDateTimeBestEffort({from:String})
					TO parseDateTimeBestEffort({to:String})
					STEP toIntervalDay(1)`,
			params: {
				...range,
				repo,
			},
		});

		const diff = differenceInSeconds(range.from, range.to);
		const prevRange = {
			from: addSeconds(parseISO(range.from), diff),
			to: addSeconds(parseISO(range.from), -1),
		};

		const prevRangeResult = await clickhouse.query<
			| {
					value: number;
			  }
			| undefined
		>({
			query: `SELECT 
						avg(duration) as value
					FROM
						pipelines_mv
					WHERE
						timestamp BETWEEN parseDateTimeBestEffort({from:String}) AND parseDateTimeBestEffort({to:String})
						AND repo = {repo:String}
					GROUP BY repo`,
			params: {
				from: prevRange.from.toISOString(),
				to: prevRange.to.toISOString(),
				repo,
			},
		});

		return { result, prevRangeResult };
	});

export const getFailureRateSeries = createServerFn({ method: 'GET' })
	.validator(intersect([RangeSchema, object({ repo: string() })]))
	.handler(async ({ data: { repo, ...range } }) => {
		const result = await clickhouse.query<DataPoint>({
			query: `SELECT 
	  							toStartOfInterval(timestamp, toIntervalDay(1)) AS time,
									round((sumIf(1, status != 'success') / count()) * 100, 2) AS value
							FROM
									pipelines_mv
							WHERE
									timestamp BETWEEN parseDateTimeBestEffort({from:String}) AND parseDateTimeBestEffort({to:String})
									AND repo = {repo:String}
							GROUP BY ALL
							ORDER BY time
							WITH FILL
							FROM parseDateTimeBestEffort({from:String})
							TO parseDateTimeBestEffort({to:String})
							STEP toIntervalDay(1)
							INTERPOLATE (value);`,
			params: {
				...range,
				repo,
			},
		});

		return result;
	});
