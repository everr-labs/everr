import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronRightIcon, InfoIcon } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts';

import type { ChartConfig } from '@citric/ui';
import {
	ChartContainer,
	ChartTooltip,
	ChartTooltipContent,
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from '@citric/ui';

import { getLogsDistribution } from '../-functions';

interface Props {
	traceId: string;
	spanId: string;
}

const chartConfig = {
	value: {
		label: 'Log lines',
	},
} satisfies ChartConfig;

export function DistributionChart({ spanId, traceId }: Props) {
	const [isOpen, setIsOpen] = useState(false);
	const { data: distribution } = useQuery({
		queryKey: ['getLogsDistribution', traceId, spanId],
		queryFn: () => getLogsDistribution({ data: { traceId, spanId } }),
		enabled: isOpen,
		staleTime: Infinity,
	});

	return (
		<TooltipProvider>
			<Collapsible open={isOpen} onOpenChange={setIsOpen}>
				<CollapsibleTrigger asChild>
					<button className="text-lef group flex w-full cursor-pointer items-center gap-2 p-2 px-4">
						Logs volume distribution
						<Tooltip>
							<TooltipTrigger asChild>
								<InfoIcon className="h-4 w-4 text-blue-500" />
							</TooltipTrigger>
							<TooltipContent className="max-w-4xl text-left" side="bottom">
								<p>
									Large spans of time without output may indicate a bottleneck
									in your workflow.
								</p>
								<p className="mt-1">
									If the step is spending a lot of time waiting on I/O (i.e. a
									large download), you might reduce cost by switching to a less
									powerful runner. On the other hand, if the step is CPU-bound
									using a more powerful one might speed up the workflow.
								</p>
							</TooltipContent>
						</Tooltip>
						<ChevronRightIcon className="h-4 w-4 transition-all group-aria-expanded:rotate-90" />
					</button>
				</CollapsibleTrigger>
				<CollapsibleContent>
					<ChartContainer config={chartConfig} className="max-h-32 w-full">
						<BarChart
							accessibilityLayer
							data={distribution}
							margin={{ top: 0, bottom: 0, left: 0, right: 0 }}
						>
							<CartesianGrid />
							<XAxis
								dataKey="time"
								tickLine={true}
								axisLine={true}
								tickFormatter={(value: string) => value.slice(value.length - 8)}
							/>
							<YAxis
								dataKey="value"
								type="number"
								tickLine={true}
								axisLine={true}
							/>
							<ChartTooltip content={<ChartTooltipContent />} />

							<Bar
								dataKey="value"
								fill="hsl(var(--primary))"
								radius={[4, 4, 0, 0]}
							/>
						</BarChart>
					</ChartContainer>
				</CollapsibleContent>
			</Collapsible>
		</TooltipProvider>
	);
}
