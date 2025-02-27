import type { AxisDomain } from 'recharts/types/util/types';
import { shortDuration } from '@/lib/datetime';
import { ChevronDownIcon, ChevronUpIcon, MinusIcon } from 'lucide-react';
import { Area, AreaChart, YAxis } from 'recharts';

import type { ChartConfig } from '@citric/ui';
import { ChartContainer, cn } from '@citric/ui';

const chartConfig = {
	value: {
		label: 'Success Rate',
		color: 'hsl(var(--chart-1))',
	},
} satisfies ChartConfig;

type Format = 'duration' | 'percent';

interface Props {
	data: { value: number; time: string }[];
	value: number | null;
	format?: Format;
	prevValue?: number | null;
	deltaFormat?: Format;
	/**
	 * TODO: this name sucks.
	 * Whether a negative value should be treated as an improvement.
	 * I.e. for a metric like "error rate", a lower value is better.
	 */
	negativeDeltaIsBetter?: boolean;
	className?: string;
	domain?: AxisDomain;
}

export function CellChart({
	data,
	value,
	prevValue,
	format,
	deltaFormat,
	negativeDeltaIsBetter = false,
	domain,
}: Props) {
	const stringValue = getStringValue(value, format);
	const delta = getDelta(prevValue, value, deltaFormat);

	return (
		<div className="relative flex items-center justify-center">
			<ChartContainer config={chartConfig} className="h-16 w-full">
				<AreaChart data={data} margin={{ bottom: 0, top: 0 }}>
					<defs>
						<linearGradient id="fillColor" x1="0" y1="0" x2="0" y2="1">
							<stop
								offset="5%"
								stopColor="var(--color-value)"
								stopOpacity={0.8}
							/>
							<stop
								offset="95%"
								stopColor="var(--color-value)"
								stopOpacity={0.2}
							/>
						</linearGradient>
					</defs>
					<YAxis domain={domain} hide />
					<Area
						isAnimationActive={false}
						dataKey="value"
						type="basis"
						fill="url(#fillColor)"
						fillOpacity={0.4}
						stroke="var(--color-value)"
					/>
				</AreaChart>
			</ChartContainer>
			<div className="absolute flex items-center gap-2 font-bold">
				<span className="text-lg">{stringValue}</span>
				{delta != undefined && (
					<span
						className={cn('text-md flex items-center', {
							'text-green-500':
								(delta > 0 && !negativeDeltaIsBetter) ||
								(delta < 0 && negativeDeltaIsBetter),
							'text-red-500':
								(delta > 0 && negativeDeltaIsBetter) ||
								(delta < 0 && !negativeDeltaIsBetter),
							'text-muted-foreground': delta === 0,
						})}
					>
						{delta > 0 ? (
							<ChevronUpIcon className="h-4 w-4" />
						) : delta < 0 ? (
							<ChevronDownIcon className="h-4 w-4" />
						) : (
							<MinusIcon className="h-4 w-4" />
						)}
						{getStringValue(delta, deltaFormat)}
					</span>
				)}
			</div>
		</div>
	);
}

function getDelta(
	prevValue: number | null | undefined,
	value: number | null,
	format?: Format,
) {
	if (prevValue == null || value === null) {
		return null;
	}

	switch (format) {
		case 'percent':
			return ((value - prevValue) / prevValue) * 100;
		default:
			return value - prevValue;
	}
}

function getStringValue(value: number | null, format?: Format) {
	if (value === null) {
		return '-';
	}

	switch (format) {
		case 'duration':
			return shortDuration(value);
		case 'percent':
			return `${Math.abs(value).toFixed(2)}%`;
		default:
			return value.toFixed(2);
	}
}
