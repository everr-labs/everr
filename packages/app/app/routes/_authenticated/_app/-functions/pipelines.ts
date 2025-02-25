import { clickhouse } from '@/clickhouse';
import { RangeSchema } from '@/lib/validators';
import { createServerFn } from '@tanstack/start';

export const getCostSeries = createServerFn({ method: 'GET' })
	.validator(RangeSchema)
	.handler(async ({ data: range }) => {
		const result = await clickhouse.query<{
			time: string;
			repo: string;
			labels: string;
			value: number;
		}>({
			query: `SELECT 
								buckets.time as time,
								repos.repo   as repo,
								repos.labels as labels,
								durations.billable_minutes as value
							FROM (
								SELECT toStartOfInterval(timestamp, toIntervalDay(1)) AS time
								FROM jobs_mv
								WHERE 
									timestamp BETWEEN parseDateTimeBestEffort({from:String}) AND parseDateTimeBestEffort({to:String})
								GROUP BY ALL
								ORDER BY time
								WITH FILL
								FROM toStartOfInterval(parseDateTimeBestEffort({from:String}), toIntervalDay(1))
								TO parseDateTimeBestEffort({to:String})
								STEP toIntervalDay(1)
							) as buckets
							CROSS JOIN (
								SELECT 
									distinct repo,
									labels
								FROM jobs_mv
								WHERE 
									timestamp BETWEEN parseDateTimeBestEffort({from:String}) AND parseDateTimeBestEffort({to:String})
							) as repos
							LEFT JOIN (
								SELECT 	
									toStartOfInterval(timestamp, toIntervalDay(1)) AS time,
									repo,
									labels,
									sum(ceiling(jobs_mv.duration / 60000000000))   as billable_minutes
								FROM jobs_mv
								WHERE 
									timestamp BETWEEN parseDateTimeBestEffort({from:String}) AND parseDateTimeBestEffort({to:String})
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
					(previousEntry[item.repo] ?? 0) + item.value * 0.008;
			} else {
				r.push({
					['time']: item.time,
					[item.repo]: item.value * 0.008,
				} as A);
			}
		}

		return r;
	});
