import { forwardRef } from 'react';
import { CitrusIcon } from 'lucide-react';

import { cn } from '@citric/ui';

interface Props {
	iconOnly?: boolean;
	logoClassName?: string;
	className?: string;
}
export const Logo = forwardRef<HTMLDivElement, Props>(
	({ iconOnly = false, logoClassName, className }, ref) => {
		return (
			<div ref={ref} className={cn('flex place-items-center', className)}>
				<span
					className={cn(
						'grid size-9 place-items-center rounded-lg border border-secondary bg-gradient-to-tr from-accent2 to-primary p-1 text-primary-foreground',
						logoClassName,
					)}
				>
					<CitrusIcon className="h-full w-full" />
				</span>
				{!iconOnly && <span className="ml-2">Citric</span>}
			</div>
		);
	},
);
