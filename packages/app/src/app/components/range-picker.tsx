import type { HTMLAttributes } from 'react';
import type { DateRange } from 'react-day-picker';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { endOfDay, format, startOfDay } from 'date-fns';
import { Calendar as CalendarIcon } from 'lucide-react';

import { useTimeRange } from './TimeRangeContext';

interface Range {
	from: Date;
	to: Date;
}
interface Props extends Omit<HTMLAttributes<HTMLDivElement>, 'onChange'> {
	onChange?: (range: Range) => void;
}

export function RangePicker({ className, onChange }: Props) {
	const { range, setRange } = useTimeRange();
	const [open, setOpen] = useState(false);
	const [selectedRange, setSelectedRange] = useState<DateRange>(range);

	return (
		<div className={cn('grid gap-2', className)}>
			<Popover open={open} onOpenChange={setOpen}>
				<PopoverTrigger asChild>
					<Button
						onClick={() => {
							setSelectedRange(range);
							setOpen((prev) => !prev);
						}}
						id="date"
						variant={'outline'}
						className={cn('w-[300px] justify-start text-left font-normal')}
					>
						<CalendarIcon className="mr-2 h-4 w-4" />
						{format(range.from, 'LLL dd, y')} - {format(range.to, 'LLL dd, y')}
					</Button>
				</PopoverTrigger>
				<PopoverContent className="w-auto p-0" align="start">
					<Calendar
						initialFocus
						mode="range"
						defaultMonth={selectedRange.from}
						selected={selectedRange}
						onSelect={(range) => range && setSelectedRange(range)}
						disabled={{ after: new Date() }}
					/>
					<div className="p-2">
						<Button
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

									onChange?.(range);
									setRange(range);
								}

								setOpen(false);
							}}
							disabled={!selectedRange.from || !selectedRange.to}
						>
							Apply
						</Button>
					</div>
				</PopoverContent>
			</Popover>
		</div>
	);
}
