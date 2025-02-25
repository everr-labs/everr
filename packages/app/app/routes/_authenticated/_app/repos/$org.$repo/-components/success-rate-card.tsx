import { clickhouse } from '@/clickhouse';
import { useTimeRange } from '@/components/TimeRangeContext';
import { RangeSchema } from '@/lib/validators';
import { useQuery } from '@tanstack/react-query';
import { notFound } from '@tanstack/react-router';
import { createServerFn } from '@tanstack/react-start';
import { CheckCircle2Icon } from 'lucide-react';
import { object, string } from 'valibot';

import { Card, CardContent, CardHeader, CardTitle, Skeleton } from '@citric/ui';

const GetSuccessRateInputSchema = object({
	repo: string(),
	range: RangeSchema,
});

interface Data {
	success_rate: number;
}

const getSuccessRate = createServerFn({ method: 'GET' })
	.validator(GetSuccessRateInputSchema)
	.handler(async ({ data: { range, repo } }) => {
		const data = // TODO: calculate the success rate
			(
				await clickhouse.query<Data>({
					query: `SELECT round(successful/(successful+others)*100, 2) as success_rate FROM (
						SELECT
								repo,
								count(*) as successful
						FROM pipelines_mv
						WHERE
								repo = {repo:String} AND
								timestamp BETWEEN parseDateTimeBestEffort({from:String}) AND parseDateTimeBestEffort({to:String}) AND
								status = 'success'
						GROUP BY repo
				) A LEFT JOIN (
						SELECT
								repo,
								count(*) as others
						FROM pipelines_mv
						WHERE
								repo = {repo:String} AND
								timestamp BETWEEN parseDateTimeBestEffort({from:String}) AND parseDateTimeBestEffort({to:String}) AND
								status != 'success'
						GROUP BY repo
				) B ON A.repo = B.repo
            `,
					params: {
						repo,
						...range,
					},
				})
			)[0];

		if (!data) {
			throw notFound();
		}

		return data;
	});

interface Props {
	repo: string;
}
export function SuccessRateCard({ repo }: Props) {
	const { range } = useTimeRange();
	const { data, isLoading } = useQuery({
		queryKey: ['successRate.getSuccessRate', repo, range],
		queryFn: () => getSuccessRate({ data: { repo, range } }),
	});

	return (
		<Card>
			<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
				<CardTitle className="text-sm font-medium">Success Rate</CardTitle>
				<CheckCircle2Icon className="h-4 w-4 text-muted-foreground" />
			</CardHeader>
			<CardContent>
				<div className="w-full text-2xl font-bold">
					{isLoading ? (
						<Skeleton className="h-8 w-full" />
					) : (
						<div>{data?.success_rate}%</div>
					)}
				</div>
				<p className="text-xs text-muted-foreground">Of all pipeline runs</p>
			</CardContent>
		</Card>
	);
}
