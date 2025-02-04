import { useMemo, useState } from 'react';
import { Check, ChevronsUpDown } from 'lucide-react';

import { cn } from '.';
import { Button } from './button';
import {
	Command,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
} from './command';
import { Popover, PopoverContent, PopoverTrigger } from './popover';

interface Props {
	options?: { value: string; label: string; imageUrl?: string }[];
	value?: string;
	onChange?: (value: string) => void;
}
export function Combobox({ options, value, onChange }: Props) {
	const [open, setOpen] = useState(false);

	const currentOption = useMemo(() => {
		return options?.find((options) => options.value === value);
	}, [value, options]);

	return (
		<div className="relative w-full">
			<Popover open={open} onOpenChange={setOpen}>
				<PopoverTrigger asChild>
					<Button
						variant="outline"
						role="combobox"
						aria-expanded={open}
						className={cn(
							'w-full justify-between',
							!value && 'text-muted-foreground',
						)}
					>
						{currentOption ? (
							<span className="flex items-center">
								<img
									className="mr-2 size-4"
									src={currentOption.imageUrl}
									alt=""
								/>

								{currentOption.label}
							</span>
						) : (
							'Select...'
						)}
						<ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
					</Button>
				</PopoverTrigger>
				<PopoverContent className="popover-content p-0">
					<Command>
						<CommandInput placeholder="Search..." />
						<CommandList>
							<CommandEmpty>No options found.</CommandEmpty>
							<CommandGroup>
								{options?.map((option) => (
									<CommandItem
										className="flex items-center"
										key={option.value}
										value={option.value}
										onSelect={(currentValue) => {
											onChange?.(currentValue);
											setOpen(false);
										}}
									>
										<Check
											className={cn(
												'mr-2 size-4',
												value === option.value ? 'opacity-100' : 'opacity-0',
											)}
										/>
										{option.imageUrl && (
											<img
												className="mr-2 size-4"
												src={option.imageUrl}
												alt=""
											/>
										)}
										{option.label}
									</CommandItem>
								))}
							</CommandGroup>
						</CommandList>
					</Command>
				</PopoverContent>
			</Popover>
		</div>
	);
}
