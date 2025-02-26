import type { ReactNode } from 'react';
import { RangePicker } from '@/components/RangePicker';

interface Props {
	title: ReactNode;
	subtitle?: string;
}
export function PageHeader({ title, subtitle }: Props) {
	return (
		<header className="flex items-end justify-between">
			<div>
				<h1 className="flex items-center gap-2 text-3xl font-bold tracking-tight">
					{title}
				</h1>
				{subtitle && <p className="text-muted-foreground">{subtitle}</p>}
			</div>
			<RangePicker />
		</header>
	);
}
