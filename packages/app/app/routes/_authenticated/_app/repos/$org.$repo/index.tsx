import type { ColumnDef } from '@tanstack/react-table';
import { DataTable } from '@/components/data-table';
import { StatusBadge } from '@/components/status-badge';
import { useTimeRange } from '@/components/TimeRangeContext';
import { shortDuration } from '@/lib/datetime';
import {
	getDefaultRangeFrom,
	getDefaultRangeTo,
	RangeSchema,
} from '@/lib/validators';
import {
	createFileRoute,
	Link,
	notFound,
	retainSearchParams,
	stripSearchParams,
} from '@tanstack/react-router';
import { DollarSign, GitPullRequest } from 'lucide-react';

import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
	Skeleton,
} from '@citric/ui';

import { PageHeader } from '../../-components/page-header';
import { AvgDurationCard } from './-components/avg-duration-card';
import { SuccessRateCard } from './-components/success-rate-card';
import { getPipelines, getRepo } from './-functions';

export const Route = createFileRoute('/_authenticated/_app/repos/$org/$repo/')({
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
	loader: async ({ params: { org, repo } }) => {
		try {
			await getRepo({ data: { repo: `${org}/${repo}` } });
		} catch (_) {
			return notFound();
		}
	},
	component: RepositoryPage,
});

function RepositoryPage() {
	const { org, repo } = Route.useParams();
	const { range } = useTimeRange();

	return (
		<div className="flex flex-col gap-4">
			<PageHeader title={`${org}/${repo}`} />

			<div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
				<Card>
					<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
						<CardTitle className="text-sm font-medium">Total Runs</CardTitle>
						<GitPullRequest className="h-4 w-4 text-muted-foreground" />
					</CardHeader>
					<CardContent>
						<div className="w-full text-2xl font-bold">
							<Skeleton className="h-8 w-full" />
						</div>
						<p className="text-xs text-muted-foreground">Pipeline executions</p>
					</CardContent>
				</Card>

				<SuccessRateCard repo={`${org}/${repo}`} />

				<AvgDurationCard repo={`${org}/${repo}`} />

				<Card>
					<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
						<CardTitle className="text-sm font-medium">Total Spend</CardTitle>
						<DollarSign className="h-4 w-4 text-muted-foreground" />
					</CardHeader>
					<CardContent>
						<div className="text-2xl font-bold">$1,234.56</div>
						<p className="text-xs text-muted-foreground">All pipeline runs</p>
					</CardContent>
				</Card>
			</div>

			<Card>
				<CardHeader>
					<CardTitle>Recent Pipeline Runs</CardTitle>
					<CardDescription>
						A list of the most recent pipeline executions for this repository.
					</CardDescription>
				</CardHeader>
				<CardContent>
					<DataTable
						queryFn={getPipelines}
						queryKey={['getPipelines']}
						params={{
							repo: `${org}/${repo}`,
							range,
						}}
						columns={columns}
					/>
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<CardTitle>Pipeline Performance Trends</CardTitle>
					<CardDescription>
						Visualizing success rate and average duration over time.
					</CardDescription>
				</CardHeader>
				<CardContent>chart</CardContent>
			</Card>
		</div>
	);
}

const columns: ColumnDef<
	Awaited<ReturnType<typeof getPipelines>>['data'][number]
>[] = [
	{
		header: 'Run ID',
		cell: function RunID({
			row: {
				original: { trace_id, repo: slug },
			},
		}) {
			const [org, repo] = slug.split('/') as [string, string];
			const { range } = useTimeRange();

			return (
				<Link
					to="/repos/$org/$repo/run/$traceId/$"
					search={range}
					params={{ org, repo, traceId: trace_id }}
				>
					{trace_id}
				</Link>
			);
		},
	},
	{
		header: 'Name',
		accessorKey: 'name',
	},
	{
		header: 'Started at',
		accessorKey: 'timestamp',
	},
	{
		header: 'Duration',
		accessorKey: 'duration',
		cell: ({
			row: {
				original: { duration },
			},
		}) => shortDuration(parseInt(duration)),
	},
	{
		header: 'Event',
		accessorKey: 'event',
	},
	{
		header: 'Status',
		accessorKey: 'status',
		cell: ({
			row: {
				original: { status },
			},
		}) => <StatusBadge status={status} />,
	},
];
