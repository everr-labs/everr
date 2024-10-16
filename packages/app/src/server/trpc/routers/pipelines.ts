import { addSeconds, differenceInSeconds, format, parseISO } from 'date-fns';
import { z } from 'zod';

import { PaginatedData } from '../schemas';
import { createTRPCRouter, protectedProcedure } from '../trpc';

const Range = z.object({
	from: z.date().transform((d) => format(d, "yyyy-MM-dd'T'HH:mm:ss'Z'")),
	to: z.date().transform((d) => format(d, "yyyy-MM-dd'T'HH:mm:ss'Z'")),
});

interface DataPoint {
	time: string;
	value: number;
}

export const pipelinesRouter = createTRPCRouter({
	getCostSeries: protectedProcedure
		.input(z.object({ range: Range }))
		.query(async ({ input: { range }, ctx: { clickhouse } }) => {
			const result = await clickhouse.query<{
				time: string;
				repo: string;
				labels: string;
				value: number;
			}>({
				query: `SELECT 	buckets.time as time,
												repos.repo   as repo,
												repos.labels as labels,
												durations.value as value
								FROM (
									SELECT toStartOfInterval(timestamp, toIntervalDay(1)) AS time
									FROM jobs_mv
									WHERE timestamp BETWEEN parseDateTimeBestEffort({from:String}) AND parseDateTimeBestEffort({to:String})
									GROUP BY ALL
									ORDER BY time
									WITH FILL
									FROM toStartOfInterval(parseDateTimeBestEffort({from:String}), toIntervalDay(1))
									TO parseDateTimeBestEffort({to:String})
									STEP toIntervalDay(1)
								) as buckets
								CROSS JOIN (
									SELECT distinct repo,
																	labels
									FROM jobs_mv
									WHERE timestamp BETWEEN parseDateTimeBestEffort({from:String}) AND parseDateTimeBestEffort({to:String})
								) as repos
								LEFT JOIN (
									SELECT 	toStartOfInterval(timestamp, toIntervalDay(1)) AS time,
													repo,
													labels,
													sum(ceiling(jobs_mv.duration / 60000000000))   as value
									FROM jobs_mv
									WHERE timestamp BETWEEN parseDateTimeBestEffort({from:String}) AND parseDateTimeBestEffort({to:String})
									GROUP BY ALL
									ORDER BY time
								) durations
								ON
									buckets.time = durations.time
									AND repos.repo = durations.repo
									AND repos.labels = durations.labels;`,
				params: {
					...range,
				},
			});

			type WithWildcards<T> = T & Record<string, number>;

			type A = WithWildcards<{ time: string }>;

			const r: A[] = [];

			for (const item of result) {
				const previousEntry = r[r.length - 1];

				if (previousEntry?.time === item.time) {
					previousEntry[item.repo] =
						(previousEntry[item.repo] ?? 0) + item.value * 0.04;
				} else {
					r.push({
						['time']: item.time,
						[item.repo]: item.value * 0.04,
					} as A);
				}
			}

			return r;
		}),

	getAll: protectedProcedure
		.input(
			PaginatedData.extend({
				range: Range,
			}),
		)
		.query(
			async ({
				input: { pageSize, pageIndex, range },
				ctx: { clickhouse },
			}) => {
				const result = await Promise.all([
					clickhouse.query<{
						repo: string;
						total_run_time: number;
						success_rate: number | null;
						avg_duration_successful: number | null;
						avg_duration_all: number | null;
						last_run_time: string;
					}>({
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
						params: range,
					}),
					// TODO: Pagination
				]);

				return { data: result[0], total: result[1][0]?.total ?? 0 };
			},
		),

	getDurationSeries: protectedProcedure
		.input(z.object({ range: Range, repo: z.string() }))
		.query(async ({ input: { range, repo }, ctx: { clickhouse } }) => {
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

			const diff = differenceInSeconds(
				parseISO(range.from),
				parseISO(range.to),
			);
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
					from: prevRange.from.toISOString().replace('T', ' ').replace('Z', ''),
					to: prevRange.to.toISOString().replace('T', ' ').replace('Z', ''),
					repo,
				},
			});

			return { result, prevRangeResult };
		}),

	getSuccessRateSeries: protectedProcedure
		.input(z.object({ range: Range, repo: z.string() }))
		.query(async ({ input: { range, repo }, ctx: { clickhouse } }) => {
			const result = await clickhouse.query<{ time: string; value: number }>({
				query: `SELECT 
	  							toStartOfInterval(timestamp, toIntervalDay(1)) AS time,
									round((sumIf(1, status = 'success') / count()) * 100, 2) AS value
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
		}),
});
