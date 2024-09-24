import { RangePicker } from '@/components/RangePicker';
import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/_app/')({
	component: Index,
});

function Index() {
	return (
		<div className="p-2">
			<RangePicker />
		</div>
	);
}
