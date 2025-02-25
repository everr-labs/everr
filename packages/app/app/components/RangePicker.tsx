import type { HTMLAttributes } from 'react';
import { useState } from 'react';
import { addMonths, endOfDay, format, parseISO, startOfDay } from 'date-fns';
import { Calendar as CalendarIcon } from 'lucide-react';

import type { DateRange } from '@citric/ui';
import {
	Button,
	Calendar,
	cn,
	Popover,
	PopoverContent,
	PopoverTrigger,
} from '@citric/ui';

import { useTimeRange } from './TimeRangeContext';

type Props = Omit<HTMLAttributes<HTMLDivElement>, 'onChange'>;

export function RangePicker({ className }: Props) {
	const { range, setRange } = useTimeRange();
	const [open, setOpen] = useState(false);
	const [selectedRange, setSelectedRange] = useState<DateRange>({
		from: parseISO(range.from),
		to: parseISO(range.to),
	});

	return (
		<div className={cn('grid gap-2', className)}>
			<Popover open={open} onOpenChange={setOpen} modal>
				{/* TODO: add quick dates */}
				<PopoverTrigger asChild>
					<Button
						onClick={() => {
							setOpen((prev) => !prev);
						}}
						id="date"
						variant={'outline'}
						className={cn(
							'flex w-[250px] justify-between text-left font-normal',
						)}
					>
						{format(range.from, 'LLL d, y')} - {format(range.to, 'LLL dd, y')}
						<CalendarIcon className="ml-2 h-4 w-4" />
					</Button>
				</PopoverTrigger>

				<PopoverContent className="w-auto p-0" align="end">
					<Calendar
						initialFocus
						numberOfMonths={2}
						mode="range"
						defaultMonth={addMonths(selectedRange.from ?? new Date(), -1)}
						selected={selectedRange}
						onSelect={(range) => {
							if (range) setSelectedRange(range);
						}}
						disabled={{ after: new Date() }}
						className="pb-0"
					/>
					<div className="flex flex-col items-center justify-end gap-2 p-2">
						<Button
							size="sm"
							className="w-full"
							onClick={() => {
								if (
									selectedRange.from !== undefined &&
									selectedRange.to !== undefined
								) {
									const range = {
										from: startOfDay(selectedRange.from),
										to: endOfDay(selectedRange.to),
									};

									setRange({
										from: range.from.toISOString(),
										to: range.to.toISOString(),
									});
								}

								setOpen(false);
							}}
							disabled={!selectedRange.from || !selectedRange.to}
						>
							Apply
						</Button>
						<span className="text-xs text-muted-foreground">
							All dates are in UTC (00:00 to 23:59:59)
						</span>
					</div>
				</PopoverContent>
			</Popover>
		</div>
	);
}
