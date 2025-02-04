import type { ColumnDef } from '@tanstack/react-table';
import { DataTable } from '@/components/data-table';
import { useTimeRange } from '@/components/TimeRangeContext';
import { SiGithub } from '@icons-pack/react-simple-icons';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { format, parseISO } from 'date-fns';
import { Area, AreaChart, XAxis } from 'recharts';

import type { ChartConfig } from '@citric/ui';
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
	ChartContainer,
	ChartTooltip,
	ChartTooltipContent,
} from '@citric/ui';

import { PageHeader } from './-components/page-header';
import { getCostSeries } from './-functions/pipelines';
import { getRepos } from './-functions/repos';

export const Route = createFileRoute('/_authenticated/_app/')({
	component: Index,
});

function Index() {
	const { range } = useTimeRange();

	return (
		<div className="flex flex-col gap-2">
			<PageHeader title="Dashboard" />

			<div className="grid grid-cols-3 gap-2">
				<CostCard />
			</div>

			<Card>
				<CardHeader>
					<CardTitle>Repositories</CardTitle>
				</CardHeader>

				<CardContent>
					<DataTable
						columns={columns}
						params={{ ...range }}
						queryFn={getRepos}
						queryKey={['getRepos']}
					/>
				</CardContent>
			</Card>
		</div>
	);
}

function CostCard() {
	const { range } = useTimeRange();
	const { data } = useQuery({
		queryKey: ['pipelines.getCostSeries', range],
		queryFn: () => getCostSeries({ data: range }),
	});

	const config = Object.keys(data?.[0] ?? {})
		.filter((k) => k !== 'time')
		.reduce<ChartConfig>((prev, curr, i) => {
			prev[curr.replaceAll('/', '--')] = {
				label: curr,
				color: `hsl(var(--chart-${i + 1}))`,
			};
			return prev;
		}, {});

	return (
		<Card className="w-full">
			<CardHeader>
				<CardTitle>Daily spend</CardTitle>
				<CardDescription>Ignoring Free tier</CardDescription>
			</CardHeader>
			<CardContent className="p-0">
				<ChartContainer config={config} className="max-h-48 w-full">
					<AreaChart
						accessibilityLayer
						data={data}
						margin={{
							left: 0,
							right: 0,
						}}
					>
						<XAxis
							dataKey="time"
							tickLine={false}
							axisLine={false}
							tickMargin={8}
							tickFormatter={(value: string) =>
								format(parseISO(value), 'MMM d')
							}
						/>
						<ChartTooltip
							content={
								<ChartTooltipContent
									indicator="dot"
									valueFormatter={(value) => {
										if (typeof value === 'number') {
											return `$${value.toFixed(2)}`;
										}
										return '';
									}}
								/>
							}
							labelFormatter={(value: string) =>
								format(parseISO(value), 'yyyy-MM-dd')
							}
						/>

						{Object.keys(data?.[0] ?? {})
							.filter((k) => k !== 'time')
							.map((key) => (
								<Area
									isAnimationActive={false}
									key={key}
									dataKey={key}
									type="bump"
									fill={`var(--color-${key.replaceAll('/', '--')})`}
									fillOpacity={0.4}
									stroke={`var(--color-${key.replaceAll('/', '--')})`}
								/>
							))}
					</AreaChart>
				</ChartContainer>
			</CardContent>
		</Card>
	);
}

type Data = Awaited<ReturnType<typeof getRepos>>['data'][number];

const columns: ColumnDef<Data>[] = [
	{
		header: 'Repo',
		cell: function Repo({
			row: {
				original: { repo: slug },
			},
		}) {
			const [org, repo] = slug.split('/') as [string, string];
			const { range } = useTimeRange();

			return (
				<Link
					to="/repos/$org/$repo"
					from="/"
					search={{ ...range }}
					params={{ org, repo }}
					className="flex items-center"
				>
					<SiGithub className="mr-1 h-4 w-4" />
					{org}/{repo}
				</Link>
			);
		},
	},
	// {
	// 	header: 'Last execution',
	// 	meta: {
	// 		shrink: true,
	// 	},
	// 	cell: ({
	// 		row: {
	// 			original: { last_run_time },
	// 		},
	// 	}) => {
	// 		return (
	// 			<div className="whitespace-nowrap first-letter:capitalize">
	// 				{formatRelative(parseISO(last_run_time), new Date())}
	// 			</div>
	// 		);
	// 	},
	// },
	// {
	// 	header: 'Total runs',
	// 	accessorKey: 'total_runs',
	// 	meta: {
	// 		shrink: true,
	// 		align: 'right',
	// 	},
	// },
	// {
	// 	header: 'Success rate',
	// 	meta: {
	// 		noPadding: true,
	// 		className: 'w-1/4',
	// 	},
	// 	cell: SuccessRateCell,
	// },
	// {
	// 	header: 'Total run time',
	// 	accessorKey: 'total_run_time',
	// 	meta: {
	// 		shrink: true,
	// 		align: 'right',
	// 	},
	// 	accessorFn: ({ total_run_time }) => shortDuration(total_run_time),
	// },
	// {
	// 	header: 'AVG. workflow duration',
	// 	meta: {
	// 		noPadding: true,
	// 		className: 'w-1/4',
	// 	},
	// 	cell: AVGDurationCell,
	// },
];

// function AVGDurationCell({
// 	row: {
// 		original: { repo, avg_duration_all },
// 	},
// }: CellContext<Data, unknown>) {
// 	const { range } = useTimeRange();

// 	const { data } = api.pipelines.getDurationSeries.useQuery({
// 		range,
// 		repo,
// 	});

// 	return (
// 		<CellChart
// 			data={data?.result ?? []}
// 			value={avg_duration_all}
// 			prevValue={data?.prevRangeResult[0]?.value}
// 			format="duration"
// 			deltaFormat="percent"
// 			negativeDeltaIsBetter
// 		/>
// 	);
// }

// function SuccessRateCell({
// 	row: {
// 		original: { repo, success_rate },
// 	},
// }: CellContext<Data, unknown>) {
// 	const { range } = useTimeRange();

// 	const result = api.pipelines.getSuccessRateSeries.useQuery({
// 		range,
// 		repo,
// 	});
// 	return (
// 		<CellChart
// 			data={result.data ?? []}
// 			value={success_rate}
// 			format="percent"
// 			domain={[0, 100]}
// 		/>
// 	);
// }
