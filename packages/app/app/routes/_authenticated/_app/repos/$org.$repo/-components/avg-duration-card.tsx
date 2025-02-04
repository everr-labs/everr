import { clickhouse } from '@/clickhouse';
import { useTimeRange } from '@/components/TimeRangeContext';
import { shortDuration } from '@/lib/datetime';
import { RangeSchema } from '@/lib/validators';
import { useQuery } from '@tanstack/react-query';
import { notFound } from '@tanstack/react-router';
import { createServerFn } from '@tanstack/start';
import { ClockIcon } from 'lucide-react';
import { object, string } from 'valibot';

import { Card, CardContent, CardHeader, CardTitle, Skeleton } from '@citric/ui';

const GetAvgDurationInputSchema = object({
	repo: string(),
	range: RangeSchema,
});

interface Data {
	avg_duration: number;
}

const getAvgDuration = createServerFn({ method: 'GET' })
	.validator(GetAvgDurationInputSchema)
	.handler(async ({ data: { range, repo } }) => {
		const data = (
			await clickhouse.query<Data>({
				query: `SELECT avg(duration) as avg_duration 
            FROM pipelines_mv
            WHERE 
              repo = {repo:String} AND
              timestamp BETWEEN parseDateTimeBestEffort({from:String}) AND parseDateTimeBestEffort({to:String})
            `,
				params: {
					repo,
					from: range.from.toISOString(),
					to: range.to.toISOString(),
				},
			})
		)[0];

		if (!data) {
			// eslint-disable-next-line @typescript-eslint/only-throw-error
			throw notFound();
		}

		return data;
	});

interface Props {
	repo: string;
}
export function AvgDurationCard({ repo }: Props) {
	const { range } = useTimeRange();
	const { data, isLoading } = useQuery({
		queryKey: ['avgDuration.getAvgDuration', repo, range],
		queryFn: () => getAvgDuration({ data: { repo, range } }),
	});

	return (
		<Card>
			<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
				<CardTitle className="text-sm font-medium">Avg. Duration</CardTitle>
				<ClockIcon className="h-4 w-4 text-muted-foreground" />
			</CardHeader>
			<CardContent>
				<div className="w-full text-2xl font-bold">
					{isLoading ? (
						<Skeleton className="h-8 w-full" />
					) : (
						<div>{shortDuration(data?.avg_duration)}</div>
					)}
				</div>
				<p className="text-xs text-muted-foreground">Per pipeline run</p>
			</CardContent>
		</Card>
	);
}
