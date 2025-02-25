import type { ColumnDef } from '@tanstack/react-table';
import { useCallback, useState } from 'react';
import { CellChart } from '@/components/CellChart';
import { DataTable } from '@/components/data-table';
import { useTimeRange } from '@/components/TimeRangeContext';
import { shortDuration } from '@/lib/datetime';
import {
	getDefaultRangeFrom,
	getDefaultRangeTo,
	RangeSchema,
} from '@/lib/validators';
import { SiGithub } from '@icons-pack/react-simple-icons';
import { useQuery } from '@tanstack/react-query';
import {
	createFileRoute,
	Link,
	retainSearchParams,
	stripSearchParams,
} from '@tanstack/react-router';
import { endOfDay, format, formatRelative, parseISO } from 'date-fns';
import { Bar, BarChart, ReferenceArea, XAxis } from 'recharts';

import type { ChartConfig } from '@citric/ui';
import {
	Card,
	CardContent,
	CardHeader,
	CardTitle,
	ChartContainer,
	ChartTooltip,
	ChartTooltipContent,
} from '@citric/ui';

import { PageHeader } from './-components/page-header';
import { getCostSeries } from './-functions/pipelines';
import {
	getDurationSeries,
	getFailureRateSeries,
	getRepos,
} from './-functions/repos';

export const Route = createFileRoute('/_authenticated/_app/')({
	validateSearch: RangeSchema,
	search: {
		middlewares: [
			retainSearchParams(['from', 'to']),
			// TODO: check this, we should strip from and to if they are the default values
			stripSearchParams({
				from: getDefaultRangeFrom(),
				to: getDefaultRangeTo(),
			}),
		],
	},
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
	const { setRange } = useTimeRange();

	const config = Object.keys(data?.[0] ?? {})
		.filter((k) => k !== 'time')
		.reduce<ChartConfig>((prev, curr, i) => {
			prev[curr.replaceAll('/', '--')] = {
				label: curr,
				color: `hsl(var(--chart-${i + 1}))`,
			};
			return prev;
		}, {});

	const [refAreaLeft, setRefAreaLeft] = useState<string>();
	const [refAreaRight, setRefAreaRight] = useState<string>();

	const zoom = useCallback(() => {
		if (
			refAreaLeft === refAreaRight ||
			refAreaRight === undefined ||
			refAreaLeft === undefined
		) {
			setRefAreaLeft(undefined);
			setRefAreaRight(undefined);

			return;
		}

		setRange({
			from: parseISO(refAreaLeft).toISOString(),
			to: endOfDay(parseISO(refAreaRight)).toISOString(),
		});

		setRefAreaLeft(undefined);
		setRefAreaRight(undefined);
	}, [refAreaLeft, refAreaRight, setRange]);

	return (
		<Card className="w-full overflow-hidden">
			<CardHeader>
				<CardTitle>Daily spend</CardTitle>
			</CardHeader>
			<CardContent className="p-0">
				<ChartContainer config={config} className="max-h-48 w-full">
					<BarChart
						accessibilityLayer
						data={data}
						margin={{
							left: 0,
							right: 0,
						}}
						onMouseDown={(e) => {
							setRefAreaLeft(e.activeLabel);
						}}
						onMouseMove={(e) => {
							if (refAreaLeft) {
								setRefAreaRight(e.activeLabel);
							}
						}}
						onMouseUp={zoom}
					>
						<XAxis
							dataKey="time"
							tickLine={false}
							axisLine={true}
							hide
							tickMargin={8}
							tickFormatter={(value: string) =>
								format(parseISO(value), 'dd/MM')
							}
						/>
						{refAreaLeft && refAreaRight ? (
							<ReferenceArea
								x1={refAreaLeft}
								x2={refAreaRight}
								strokeOpacity={0.3}
							/>
						) : null}
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
								<Bar
									isAnimationActive={false}
									key={key}
									dataKey={key}
									fill={`var(--color-${key.replaceAll('/', '--')})`}
									// fillOpacity={0.4}
									// stroke={`#0f0`}
									radius={[2, 2, 0, 0]}
								/>
							))}
					</BarChart>
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
	{
		header: 'Last execution',
		meta: {
			shrink: true,
		},
		cell: ({
			row: {
				original: { last_run_time },
			},
		}) => {
			return (
				<div className="whitespace-nowrap first-letter:capitalize">
					{formatRelative(parseISO(last_run_time), new Date())}
				</div>
			);
		},
	},
	{
		header: 'Total runs',
		accessorKey: 'total_runs',
		meta: {
			shrink: true,
			align: 'right',
		},
	},
	{
		header: 'Failure rate',
		meta: {
			noPadding: true,
			className: 'w-1/4',
		},
		cell: function SuccessRateCell({
			row: {
				original: { repo, failure_rate },
			},
		}) {
			const { range } = useTimeRange();

			const { data } = useQuery({
				queryKey: ['getFailureRateSeries', { range, repo }],
				queryFn: () => getFailureRateSeries({ data: { ...range, repo } }),
			});

			return (
				<CellChart
					data={data ?? []}
					value={failure_rate}
					format="percent"
					domain={[0, 100]}
				/>
			);
		},
	},
	{
		header: 'Total run time',
		accessorKey: 'total_run_time',
		meta: {
			shrink: true,
			align: 'right',
		},
		accessorFn: ({ total_run_time }) => shortDuration(total_run_time),
	},
	{
		header: 'AVG. workflow duration',
		meta: {
			noPadding: true,
			className: 'w-1/4',
		},
		cell: function AVGDurationCell({
			row: {
				original: { repo, avg_duration_all },
			},
		}) {
			const { range } = useTimeRange();

			const { data } = useQuery({
				queryKey: ['getDurationSeries', { range, repo }],
				queryFn: () => getDurationSeries({ data: { ...range, repo } }),
			});

			return (
				<CellChart
					data={data?.result ?? []}
					value={avg_duration_all}
					prevValue={data?.prevRangeResult[0]?.value}
					format="duration"
					deltaFormat="percent"
					negativeDeltaIsBetter
				/>
			);
		},
	},
];
