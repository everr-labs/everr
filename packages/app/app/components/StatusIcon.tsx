import type { ForwardedRef } from 'react';
import { forwardRef } from 'react';
import type {Conclusion} from '@/types';
import { QuestionMarkCircledIcon } from '@radix-ui/react-icons';
import { CheckCircle2Icon, CircleOffIcon, OctagonAlert } from 'lucide-react';

import {
	cn,
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from '@citric/ui';

export interface Props {
	status: Conclusion;
	className?: string;
}

export function StatusIcon({ status, className }: Props) {
	return (
		<TooltipProvider>
			<Tooltip>
				<TooltipTrigger asChild>
					<span>
						<Icon status={status} className={className} />
					</span>
				</TooltipTrigger>
				<TooltipContent className="text-sm font-normal capitalize">
					{status}
				</TooltipContent>
			</Tooltip>
		</TooltipProvider>
	);
}

interface IconProps {
	status: Conclusion;
	className?: string;
}

const baseClassName = 'h-4 w-4 shrink-0';

const Icon = forwardRef(
	({ status, className }: IconProps, ref: ForwardedRef<SVGSVGElement>) => {
		switch (status) {
			case 'success':
				return (
					<CheckCircle2Icon
						ref={ref}
						className={cn(baseClassName, 'text-green-500', className)}
					/>
				);
			case 'cancelled':
				return (
					<OctagonAlert
						className={cn(baseClassName, 'text-muted-foreground', className)}
					/>
				);
			case 'skipped':
				return (
					<CircleOffIcon
						className={cn(baseClassName, 'text-muted-foreground', className)}
					/>
				);

			// TODO: Add more cases
			default:
				return (
					<QuestionMarkCircledIcon
						className={cn(baseClassName, 'text-muted-foreground', className)}
					/>
				);
		}
	},
);
Icon.displayName = 'Icon';
