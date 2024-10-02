import { RangePicker } from '@/components/RangePicker';
import { trpc } from '@/utils/trpc';
import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/_authenticated/_app/')({
	component: Index,
});

function Index() {
	trpc.greeting.useQuery();

	return (
		<div className="p-2">
			<RangePicker />
		</div>
	);
}
