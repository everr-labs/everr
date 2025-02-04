import type { ReactNode } from 'react';

import { cn } from '@citric/ui';

interface Props {
	children: ReactNode;
	className?: string;
}
export function GradientText({ children, className }: Props) {
	return (
		<span
			className={cn(
				'bg-gradient-to-r from-accent2 to-primary bg-clip-text text-transparent',
				className,
			)}
		>
			{children}
		</span>
	);
}
