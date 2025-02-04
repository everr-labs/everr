import { RangePicker } from '@/components/RangePicker';

interface Props {
	title: string;
}
export function PageHeader({ title }: Props) {
	return (
		<header className="flex items-center justify-between">
			<div>
				<h1 className="text-3xl font-bold tracking-tight">{title}</h1>
				<p className="text-muted-foreground">Repository pipeline analysis</p>
			</div>
			<RangePicker />
		</header>
	);
}
